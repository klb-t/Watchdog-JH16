import { evaluateReplication, loadReplicationEvaluationConfig, REPLICATION_EVALUATION_ROLE } from './replication_evaluation';
import { tracer } from '../utils/tracer';
import { buildInfo } from '../utils/build_info';
import { RunRepository } from '../db/repositories/runs';
import { AcquisitionRepository } from '../db/repositories/acquisition';
import { ObservationRepository, AnalysisResultRepository } from '../db/repositories/data';
import { ArtifactRepository } from '../db/repositories/artifacts';
import { sourceRegistry } from '../sources/registry';
import { analyzerRegistry } from '../analytics/registry';
import { ObjectStore } from '../storage/object_store';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { SourceRequest, QueryExpansionMode, QUERY_EXPANSION_MODES, RawFetchResult, baseObservationFields } from '../sources/base';
import { Observation, MissingReason } from '../domain/observation';
import { buildManifest, serializeManifest, ManifestFetchRecord, ManifestMissingObservation } from './manifest';
import { detectDiscontinuities, annotateWithDiscontinuities } from './discontinuity';
import { AnalysisResultValue } from '../domain/method_spec';
import { canonicalHash, canonicalizeJson } from '../domain/canonical';
import { createHash } from 'node:crypto';
import { evaluateJh16, loadJh16EvaluationConfig, JH16_EVALUATION_VERSION } from './jh16_evaluation';
import { MethodSpecRepository } from '../db/repositories/method_specs';
import { TypeScriptMethodExecutor } from '../analysis/executor';
import type { SourceAdapter } from '../sources/base';
import type { TypedSeries } from '../domain/method_spec';

/** Fetch statuses (as adapters report them) mapped to the reason a count is missing. */
const MISSING_REASON_FOR_STATUS: Record<string, MissingReason> = {
  RATE_LIMIT: 'RATE_LIMITED', RATE_LIMITED: 'RATE_LIMITED', QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
  CREDENTIAL_UNAVAILABLE: 'CREDENTIAL_UNAVAILABLE', FETCH_FAILED: 'FETCH_FAILED', PROVIDER_ZERO: 'PROVIDER_ZERO_RESULTS_UNRELIABLE',
  REQUEST_LIMIT: 'REQUEST_LIMIT_SETTING',
};
export const JH16_EVALUATION_ROLE = 'jh16_evaluation';

/** A run of the JH16 method, whichever of its two executors computed Pi and Hi. */
export function isJh16Run(config: any): boolean {
  return config?.method_spec_id === 'jh2016-faithful' || config?.method_id === 'jh16_faithful';
}

/** After these, no later request in the same run can succeed. */
const STOPPING_STATUSES = new Set(['QUOTA_EXHAUSTED', 'CREDENTIAL_UNAVAILABLE', 'REQUEST_LIMIT']);

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

  private missingObservation(request: SourceRequest, adapter: SourceAdapter, reason: MissingReason, raw?: RawFetchResult): Observation {
    const provider = typeof raw?.metadata?.provider === 'string' ? raw.metadata.provider : undefined;
    return { ...baseObservationFields(raw ?? { payload: null, status: 'NOT_FETCHED', request }, adapter.adapter_id, adapter.adapter_version),
      ...(provider ? { providerId: provider, providerVersion: adapter.adapter_version } : {}),
      isMissing: true, numericValue: null, missingReason: reason, qualityFlags: [] };
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

        const build = buildInfo();
        this.runRepo.setProvenance(runId, build.appVersion, build.gitCommit);
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
          // A provider state after which further requests cannot succeed in
          // this run. Remaining items are recorded as not fetched instead of
          // spending attempts against a rejected key or an empty quota.
          let providerStopped: string | null = null;

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

            if (providerStopped) {
              observations.push(this.missingObservation(request, adapter, 'NOT_FETCHED'));
              tracer.emit('FETCH_SKIPPED', { entityId: item.entityId, dimension: item.dimension, after: providerStopped });
              continue;
            }

            stateAtFailure = 'FETCHING';
            const requestedAt = new Date().toISOString();
            const raw = await adapter.fetch(request);

            stateAtFailure = 'ARCHIVING_RAW';
            // Raw bytes are archived before normalisation, so evidence
            // survives a later stage breaking.
            const provider = typeof raw.metadata?.provider === 'string' ? raw.metadata.provider : undefined;
            raw.raw_blob_id = (await this.acqRepo.recordFetch({
              runId,
              sourceId: config.source_id,
              payload: raw.payload,
              status: raw.status,
              adapterVersion: adapter.adapter_version,
              providerId: provider,
              renderedQuery: item.renderedQuery,
              requestHash: canonicalHash({ source: config.source_id, provider: provider ?? null, query: item.renderedQuery,
                language, params: validated.normalized_params, request_url: raw.metadata?.request_url ?? null }),
              httpStatus: raw.http_status,
              errorCode: raw.status === 'SUCCESS' ? undefined : String(raw.metadata?.detail ?? raw.status).slice(0, 300),
              requestedAt,
              provenance: { ...(adapter.provenance ? adapter.provenance(raw) : {}),
                ...(raw.metadata?.provider_fields ? { provider_fields: raw.metadata.provider_fields } : {}) },
            })) ?? undefined;

            stateAtFailure = 'NORMALIZING';
            if (raw.status !== 'SUCCESS') {
              // 03_JH2016_CONTRACT.md: a count that could not be obtained is
              // missing with a reason, and the run continues so the missing
              // substances are enumerated instead of the whole study vanishing.
              observations.push(this.missingObservation(request, adapter, MISSING_REASON_FOR_STATUS[raw.status] ?? 'FETCH_FAILED', raw));
              tracer.emit('FETCH_MISSING', { entityId: item.entityId, dimension: item.dimension, status: raw.status });
              if (STOPPING_STATUSES.has(raw.status)) providerStopped = raw.status;
              continue;
            }
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
          const observations = this.obsRepo.getByRunId(obsRunId);

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
            const artifact = await new TypeScriptMethodExecutor().execute(spec, inputs, { approvable: {
              id: row.id, kind: 'method_spec', content: spec, approvedHash: row.approved_hash, approvedBy: row.approved_by, approvedAt: row.approved_at } });
            const analysisRunId = this.anRepo.createAnalysisRun(runId, { methodSpecId: row.id, executorId: artifact.executorId,
              executorVersion: artifact.executorVersion, inputSeriesIds: entityIds, inputHashes: [canonicalHash(inputs)] });
            this.anRepo.insertMany(analysisRunId, artifact.results);
          } else {
            const analyzer = analyzerRegistry.get(config.method_id);
            const results = analyzer.analyze(observations, { method_id: config.method_id, method_version: analyzer.analyzer_version, parameters: config.method_params ?? {} });
            stateAtFailure = 'PERSISTING_RESULTS';
            const analysisRunId = this.anRepo.createAnalysisRun(runId, { executorId: analyzer.analyzer_id, executorVersion: analyzer.analyzer_version });
            this.anRepo.insertMany(analysisRunId, results);
          }
          if (isJh16Run(config)) {
            stateAtFailure = 'EVALUATING_JH16';
            await this.recordJh16Evaluation(runId, obsRunId);
          } else if (typeof config.replication_target_id === 'string') {
            stateAtFailure = 'EVALUATING_REPLICATION';
            await this.recordReplicationEvaluation(runId, config.replication_target_id, obsRunId);
          }
        } else tracer.emit('ANALYSIS_NOT_REQUESTED', { runType });

        this.runRepo.updateStatus(runId, 'EXPORTING');

        stateAtFailure = 'FINALIZING_MANIFEST';
        await this.finalizeManifest(runId);

        this.runRepo.updateStatus(runId, 'COMPLETED');
        tracer.emit('RUN_COMPLETED', { runId });

      } catch (err: any) {
        const current = this.runRepo.getRun(runId);
        if (current && current.status !== 'FAILED' && current.status !== 'COMPLETED') {
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

    const fetchRows = this.acqRepo.getFetchEvents(runId);
    const observations = this.obsRepo.getByRunId(runId);
    const results = this.anRepo.getByRunId(runId);

    const fetches: ManifestFetchRecord[] = fetchRows.map(f => ({
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

    // Re-detected from what was actually stored rather than trusting the
    // annotation pass: the manifest is the scientific claim, and it should rest
    // on the persisted rows, not on an in-memory result from earlier in the run.
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
    const uri = await this.store.put(`manifests/${runId}.json`, bytes);
    this.artRepo.finalizeManifest(runId, uri, sha256);

    void (results as readonly AnalysisResultValue[]);
    tracer.emit('MANIFEST_FINALIZED', { runId, sha256 });
  }

  /**
   * Stores the JH16 evaluation as an immutable analysis artifact, so the
   * manifest hashes it like every other output and later reads never recompute.
   */
  private async recordJh16Evaluation(runId: string, observationsRunId: string): Promise<void> {
    const evaluation = evaluateJh16(this.obsRepo.getByRunId(observationsRunId), this.anRepo.getByRunId(runId), loadJh16EvaluationConfig());
    const bytes = Buffer.from(canonicalizeJson(evaluation), 'utf-8');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const uri = await this.store.put(`evaluations/${runId}.json`, bytes);
    this.artRepo.recordArtifact({ runId, kind: 'analysis', objectUri: uri, sha256, byteSize: bytes.length, mediaType: 'application/json',
      metadata: { role: JH16_EVALUATION_ROLE, evaluation_version: JH16_EVALUATION_VERSION, observations_run_id: observationsRunId } });
    tracer.emit('JH16_EVALUATED', { runId, complete: evaluation.complete, reading: evaluation.hypothesis_harm.reading });
  }

  /** The same immutable-artifact treatment for any other replication target (replication_evaluation.ts). */
  private async recordReplicationEvaluation(runId: string, targetId: string, observationsRunId: string): Promise<void> {
    const evaluation = evaluateReplication(this.anRepo.getByRunId(runId), loadReplicationEvaluationConfig(targetId));
    const bytes = Buffer.from(canonicalizeJson(evaluation), 'utf-8');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const uri = await this.store.put(`evaluations/${runId}.json`, bytes);
    this.artRepo.recordArtifact({ runId, kind: 'analysis', objectUri: uri, sha256, byteSize: bytes.length, mediaType: 'application/json',
      metadata: { role: REPLICATION_EVALUATION_ROLE, evaluation_version: evaluation.evaluation_version, target_id: targetId, observations_run_id: observationsRunId } });
    tracer.emit('REPLICATION_EVALUATED', { runId, targetId, complete: evaluation.complete });
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
