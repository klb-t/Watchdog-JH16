import { tracer } from '../utils/tracer';
import { RunRepository } from '../db/repositories/runs';
import { AcquisitionRepository } from '../db/repositories/acquisition';
import { ObservationRepository, AnalysisResultRepository } from '../db/repositories/data';
import { ArtifactRepository } from '../db/repositories/artifacts';
import { sourceRegistry } from '../sources/registry';
import { analyzerRegistry } from '../analytics/registry';
import { ObjectStore } from '../storage/object_store';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { SourceRequest, QueryExpansionMode, QUERY_EXPANSION_MODES } from '../sources/base';
import { Observation } from '../domain/observation';
import { buildManifest, serializeManifest, ManifestFetchRecord, ManifestMissingObservation } from './manifest';
import { detectDiscontinuities, annotateWithDiscontinuities } from './discontinuity';
import { AnalysisResultValue } from '../domain/method_spec';
import { canonicalHash } from '../domain/canonical';
import { MethodSpecRepository } from '../db/repositories/method_specs';
import { TypeScriptMethodExecutor } from '../analysis/executor';
import type { SourceAdapter } from '../sources/base';
import type { TypedSeries } from '../domain/method_spec';
import { captureAnalysisInput, freezeAnalysisInput, persistAnalysisWithInput, readAnalysisInput, assertAnalysisInputAccess } from './analysis_inputs';

/**
 * One (entity, dimension) pair to acquire. The preset decides both; the
 * adapter is told, never left to infer.
 */
export interface AcquisitionPlanItem {
  entityId: string;
  dimension: string;
  renderedQuery: string;
}

export class RunOrchestrator {
  private runRepo: RunRepository;
  private acqRepo: AcquisitionRepository;
  private obsRepo: ObservationRepository;
  private anRepo: AnalysisResultRepository;
  private artRepo: ArtifactRepository;

  constructor(
    private db: BetterSQLite3Database<any>,
    private store: ObjectStore,
    private readonly resolveSource: (id: string, owner: string, personal: boolean) => Promise<SourceAdapter> = id => sourceRegistry.resolveAdapter(id)
  ) {
    this.runRepo = new RunRepository(db);
    this.acqRepo = new AcquisitionRepository(db, store);
    this.obsRepo = new ObservationRepository(db);
    this.anRepo = new AnalysisResultRepository(db);
    this.artRepo = new ArtifactRepository(db);
  }

  /**
   * Builds the acquisition plan from run config.
   *
   * This is where `dimension` is decided — in the orchestrator, from the
   * preset — so that it can travel to the adapter on `SourceRequest` rather
   * than being recovered from query text downstream.
   */
  private buildPlan(config: any): AcquisitionPlanItem[] {
    if (Array.isArray(config.plan) && config.plan.length > 0) {
      return config.plan;
    }

    const entities: string[] = config.entities ?? ['alcohol'];
    const templates: Record<string, string> =
      config.query_templates ?? { popularity: '"{entity}"', harm: '"{entity}" "harm" OR "harmful"' };

    const plan: AcquisitionPlanItem[] = [];
    for (const entityId of [...entities].sort()) {
      for (const dimension of Object.keys(templates).sort()) {
        plan.push({
          entityId,
          dimension,
          renderedQuery: templates[dimension].replace('{entity}', entityId),
        });
      }
    }
    return plan;
  }

  private resolveLanguage(config: any): string {
    const language = config.language;
    if (typeof language !== 'string' || language.length === 0) {
      throw new Error(
        "Run config is missing 'language'. Per D15 it is part of the query plan's identity and is never defaulted."
      );
    }
    return language;
  }

  private resolveExpansionMode(config: any): QueryExpansionMode {
    const mode = config.query_expansion_mode;
    if (!QUERY_EXPANSION_MODES.includes(mode)) {
      throw new Error(
        `Run config is missing a valid 'query_expansion_mode' (one of ${QUERY_EXPANSION_MODES.join(', ')}). Per D15 it is never defaulted.`
      );
    }
    return mode;
  }

  async executeRun(runId: string) {
    await tracer.runWithSpan('orchestrator', `executeRun:${runId}`, async () => {
      let stateAtFailure: string | null = null;
      try {
        const runRecord = this.runRepo.getRun(runId);
        if (!runRecord) throw new Error('Run not found');

        const config = JSON.parse(runRecord.effective_config ?? '{}');
        const runType = runRecord.run_type;

        this.runRepo.updateStatus(runId, 'VALIDATING');
        this.runRepo.updateStatus(runId, 'QUEUED');
        this.runRepo.updateStatus(runId, 'RUNNING');

        if (runType === 'ACQUISITION' || runType === 'PIPELINE') {
          tracer.emit('START_ACQUISITION', { source: config.source_id });

          if (config.method_spec_id) this.requirePinnedSpec(config);
          const adapter = await this.resolveSource(config.source_id, runRecord.owner_principal_id, config.personal_credentials === true);
          if (config.method_spec_id && !adapter.capabilities().includes('result_count')) throw new Error('The JH16 MethodSpec requires result counts');
          const validated = adapter.validate_params(config.source_params || {});
          if (!validated.valid) throw new Error(`Invalid params: ${validated.errors?.join(', ')}`);

          // D15: the query plan's identity — language and expansion mode —
          // is resolved here, from configuration, and travels to the adapter.
          // Both are required; neither is defaulted silently.
          const language = this.resolveLanguage(config);
          const queryExpansionMode = this.resolveExpansionMode(config);

          const plan = this.buildPlan(config);
          const observations: Observation[] = [];

          for (const item of plan) {
            const request: SourceRequest = {
              renderedQuery: item.renderedQuery,
              dimension: item.dimension,
              entityId: item.entityId,
              language,
              queryExpansionMode,
              presetId: runRecord.preset_id ?? config.preset_id ?? 'ad-hoc',
              presetVersion: runRecord.preset_version ?? config.preset_version ?? '0',
              params: validated.normalized_params,
            };

            stateAtFailure = 'FETCHING';
            const raw = await adapter.fetch(request);

            stateAtFailure = 'ARCHIVING_RAW';
            // Raw bytes are archived before normalisation, so evidence
            // survives a later stage breaking.
            raw.raw_blob_id = (await this.acqRepo.recordFetch({
              runId,
              sourceId: config.source_id,
              payload: raw.payload,
              status: raw.status,
              adapterVersion: adapter.adapter_version,
              renderedQuery: item.renderedQuery,
              httpStatus: raw.http_status,
              provenance: adapter.provenance ? adapter.provenance(raw) : undefined,
            })) ?? undefined;

            if (raw.status !== 'SUCCESS') {
              throw new Error(`Fetch failed with status: ${raw.status}`);
            }

            stateAtFailure = 'NORMALIZING';
            observations.push(...adapter.normalize(raw));
          }

          this.runRepo.updateStatus(runId, 'NORMALIZING');

          // E3.3: detected before persistence, so the warning is stored on the
          // rows themselves. A chart tooltip and an exported row do not consult
          // the manifest, and a flag that lives only there is a flag most
          // readers never see.
          stateAtFailure = 'DETECTING_DISCONTINUITIES';
          const annotated = annotateWithDiscontinuities(
            observations, detectDiscontinuities(observations));

          stateAtFailure = 'PERSISTING_OBSERVATIONS';
          this.obsRepo.insertMany(runId, annotated);
        }

        if (runType === 'ANALYSIS') {
          // Existing observations are already normalized. Retain the lifecycle
          // stage, with an explicit reuse event instead of skipping it.
          this.runRepo.updateStatus(runId, 'NORMALIZING');
          tracer.emit('NORMALIZATION_REUSED', { sourceRunId: config.source_run_id ?? runId });
        }
        this.runRepo.updateStatus(runId, 'ANALYZING');
        if (runType === 'ANALYSIS' || runType === 'PIPELINE') {
          stateAtFailure = 'LOADING_OBSERVATIONS';
          const obsRunId = config.source_run_id || runId;
          const captured = captureAnalysisInput(this.db, this.store, runId, obsRunId);
          const observations = captured.observations;

          stateAtFailure = 'EXECUTING_ANALYSIS';
          if (config.method_spec_id) {
            const row = this.requirePinnedSpec(config), spec = JSON.parse(row.spec_json);
            const entityIds = [...new Set(observations.map(o => o.entityId))].sort();
            const seriesFor = (role: string): TypedSeries => ({ name: role === 'popularity' ? 'Ni' : 'Ni_harm', unit: 'count', semanticType: 'count', entityIds,
              values: entityIds.map(id => { const matches = observations.filter(o => o.entityId === id && o.queryRole === role);
                if (matches.length > 1) throw new Error('Ambiguous JH16 input: multiple counts for one entity and dimension');
                return matches[0] && !matches[0].isMissing ? matches[0].numericValue : null; }),
              qualityFlags: [...new Set(observations.filter(o => o.queryRole === role).flatMap(o => [...o.qualityFlags]))].sort() });
            const inputs = [seriesFor('popularity'), seriesFor('harm')];
            const executor = new TypeScriptMethodExecutor();
            const frozen = freezeAnalysisInput(captured, { method_id: row.id, method_spec_id: row.id,
              method_spec_hash: row.spec_hash, method_spec: spec, typed_series: inputs,
              approval_state: 'APPROVED', approved_by: row.approved_by, approved_hash: row.approved_hash,
              executor_id: executor.executorId, executor_version: executor.executorVersion });
            const artifact = await executor.execute(spec, inputs, { approvable: {
              id: row.id, kind: 'method_spec', content: spec, approvedHash: row.approved_hash, approvedBy: row.approved_by, approvedAt: row.approved_at } });
            stateAtFailure = 'PERSISTING_RESULTS';
            await persistAnalysisWithInput(this.db, this.store, frozen, artifact.results);
          } else {
            const analyzer = analyzerRegistry.get(config.method_id);
            const parameters = config.method_params ?? {};
            const frozen = freezeAnalysisInput(captured, { method_id: config.method_id, method_spec_id: null,
              method_spec_hash: null, parameters, approval_state: 'APPROVED', approved_by: null, approved_hash: null,
              executor_id: analyzer.analyzer_id, executor_version: analyzer.analyzer_version });
            const results = analyzer.analyze(observations, { method_id: config.method_id, method_version: analyzer.analyzer_version, parameters });
            stateAtFailure = 'PERSISTING_RESULTS';
            await persistAnalysisWithInput(this.db, this.store, frozen, results);
          }
        } else tracer.emit('ANALYSIS_NOT_REQUESTED', { runType });

        this.runRepo.updateStatus(runId, 'EXPORTING');

        stateAtFailure = 'FINALIZING_MANIFEST';
        await this.finalizeManifest(runId);

        tracer.emit('RUN_COMPLETED', { runId });

      } catch (err: any) {
        const current = this.runRepo.getRun(runId);
        if (current && !['FAILED', 'COMPLETED', 'CANCELLED'].includes(current.status)) {
          this.runRepo.updateStatus(runId, 'FAILED', err.message, String(err.stack ?? ''));
        }
        tracer.emit('STATE_AT_FAILURE', { state: stateAtFailure, error: err.message });
      }
    });
  }

  /**
   * Assembles and stores the run manifest (E1.19/E1.27).
   *
   * Every finalised run writes one. It is the scientific claim; a run that
   * completed without one has produced working material and nothing else.
   */
  private async finalizeManifest(runId: string): Promise<void> {
    const run = this.runRepo.getRun(runId);
    if (!run) return;
    assertAnalysisInputAccess(this.db, runId, run.owner_principal_id, [], 'EXPORTING');
    if (this.artRepo.getManifest(runId)) throw new Error('Finalized manifest cannot be replaced');

    const fetchRows = this.acqRepo.getFetchEvents(runId);
    const input = run.run_type === 'ACQUISITION' ? null
      : await readAnalysisInput(this.db, this.store, runId, run.owner_principal_id);
    if (input && input.evidence.status !== 'verified') throw new Error('Consumed analysis input evidence is unavailable');
    if (!this.runRepo.getOwnedRun(runId, run.owner_principal_id)) throw new Error('Run ownership changed before manifest creation');
    const observations = input ? input.observations! : this.obsRepo.getByRunId(runId);
    const results = this.anRepo.getByRunId(runId);

    const fetches: ManifestFetchRecord[] = input ? input.receipts.flatMap(record => record.receipt.fetches) : fetchRows.map(f => ({
      source_id: f.source_id,
      provider_id: f.provider_id ?? null,
      provider_version: f.provider_version ?? null,
      rendered_query: f.rendered_query ?? null,
      request_hash: f.request_hash ?? null,
      raw_blob_sha256: f.raw_blob_id ? (this.acqRepo.getRawBlob(f.raw_blob_id)?.sha256 ?? null) : null,
      http_status: f.http_status ?? null,
      status: f.status,
    }));

    // Every missing observation is enumerated with its reason, and every flag
    // raised anywhere in the run reaches the manifest.
    const missingObservations: ManifestMissingObservation[] = observations
      .filter(o => o.isMissing)
      .map(o => ({
        entity_id: o.entityId,
        query_role: o.queryRole,
        missing_reason: (o as Extract<Observation, { isMissing: true }>).missingReason,
      }));

    // Analysis disclosure uses the verified consumed-input artifact. Acquisition
    // manifests retain their existing persisted-row path; neither substitutes
    // a present-day source lookup for historical analysis input.
    const discontinuity = detectDiscontinuities(observations);

    const qualityFlags = new Set<string>();
    for (const o of observations) for (const f of o.qualityFlags ?? []) qualityFlags.add(f);
    for (const f of discontinuity.flags) qualityFlags.add(f);

    const analysisRows = this.anRepo.listAnalysisRuns(runId);

    const manifest = buildManifest({
      run: {
        id: run.id, run_type: run.run_type, status: 'COMPLETED', created_at: run.created_at,
        started_at: run.started_at, completed_at: run.completed_at,
        app_version: run.app_version, git_commit: run.git_commit,
        effective_config: run.effective_config, effective_config_hash: run.effective_config_hash,
        preset_id: run.preset_id, preset_version: run.preset_version,
      },
      presetLocked: Boolean(run.preset_id),
      fetches,
      analyses: analysisRows.map(a => {
        const pinned = input?.receipts.find(record => record.analysisRunId === a.id);
        if (pinned) {
          const execution = pinned.receipt.execution;
          return { method_spec_id: execution.method_spec_id, method_spec_hash: execution.method_spec_hash,
            approval_state: execution.approval_state, approved_by: execution.approved_by,
            executor_id: execution.executor_id, executor_version: execution.executor_version,
            input_series_ids: pinned.receipt.series.map(row => row.id), input_hashes: pinned.receipt.series.map(row => row.sha256),
            input_receipt: { schema: pinned.receipt.schema, source_run_id: pinned.receipt.source_run.id,
              sha256: pinned.sha256, object_uri: pinned.objectUri } };
        }
        const methods = new MethodSpecRepository(this.db), spec = a.method_spec_id ? methods.get(a.method_spec_id) : null;
        return {
        method_spec_id: a.method_spec_id ?? null,
        method_spec_hash: spec?.spec_hash ?? null,
        approval_state: spec ? methods.readApprovalState(spec.id) : 'APPROVED',
        approved_by: spec?.approved_by ?? null,
        executor_id: a.executor_id ?? null,
        executor_version: a.executor_version ?? null,
        input_series_ids: JSON.parse(a.input_series_ids_json ?? '[]'),
        input_hashes: JSON.parse(a.input_hashes_json ?? '[]'),
      }; }),
      artifacts: this.artRepo.getArtifacts(runId).map(a => ({
        kind: a.kind, sha256: a.sha256, object_uri: a.object_uri,
      })),
      missingObservations,
      qualityFlags: [...qualityFlags],
      discontinuities: discontinuity.records.map(r => ({
        series_key: r.seriesKey, kind: r.kind, attribute: r.attribute,
        from: r.from, to: r.to, at: r.at,
      })),
      discontinuityCoverage: discontinuity.coverage,
    });

    const { bytes, sha256 } = serializeManifest(manifest);
    assertAnalysisInputAccess(this.db, runId, run.owner_principal_id,
      input?.receipts.map(record => record.receipt.source_run.id) ?? [], 'EXPORTING');
    const uri = await this.store.put(`manifests/${runId}.json`, bytes);
    this.db.transaction(() => {
      assertAnalysisInputAccess(this.db, runId, run.owner_principal_id,
        input?.receipts.map(record => record.receipt.source_run.id) ?? [], 'EXPORTING');
      this.artRepo.finalizeManifest(runId, uri, sha256);
      this.runRepo.updateStatus(runId, 'COMPLETED');
    });

    void (results as readonly AnalysisResultValue[]);
    tracer.emit('MANIFEST_FINALIZED', { runId, sha256 });
  }

  private requirePinnedSpec(config: any) {
    const repo = new MethodSpecRepository(this.db), row = repo.get(config.method_spec_id);
    if (config.method_spec_id !== 'jh2016-faithful' || !row || row.spec_hash !== config.method_spec_hash ||
      canonicalHash(JSON.parse(row.spec_json)) !== config.method_spec_hash || repo.readApprovalState(row.id) !== 'APPROVED')
      throw new Error('An individually reviewed, hash-pinned JH16 MethodSpec is required');
    return row;
  }

  submitJob(type: 'ACQUISITION' | 'ANALYSIS' | 'PIPELINE', config: any, ownerPrincipalId?: string): string {
    // E1.25: the effective configuration is hashed at submission, so the
    // manifest can name exactly which configuration produced the run. A run
    // whose config is unidentifiable is not reproducible.
    const runId = this.runRepo.createRun({
      runType: type,
      config,
      presetId: config.preset_id,
      presetVersion: config.preset_version,
      effectiveConfigHash: canonicalHash(config),
      ownerPrincipalId,
    });
    setImmediate(() => {
      this.executeRun(runId).catch(console.error);
    });
    return runId;
  }
}
