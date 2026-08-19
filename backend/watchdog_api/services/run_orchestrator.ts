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
    private store: ObjectStore
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

          const adapter = sourceRegistry.getAdapter(config.source_id);
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

        if (runType === 'ANALYSIS' || runType === 'PIPELINE') {
          this.runRepo.updateStatus(runId, 'ANALYZING');
          stateAtFailure = 'LOADING_OBSERVATIONS';
          const obsRunId = config.source_run_id || runId;
          const observations = this.obsRepo.getByRunId(obsRunId);

          stateAtFailure = 'EXECUTING_ANALYSIS';
          const analyzer = analyzerRegistry.get(config.method_id);
          const results = analyzer.analyze(observations, {
            method_id: config.method_id,
            method_version: analyzer.analyzer_version,
            parameters: config.method_params ?? {},
          });

          stateAtFailure = 'PERSISTING_RESULTS';
          const analysisRunId = this.anRepo.createAnalysisRun(runId, {
            executorId: analyzer.analyzer_id,
            executorVersion: analyzer.analyzer_version,
          });
          this.anRepo.insertMany(analysisRunId, results);
        }

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
      analyses: analysisRows.map(a => ({
        method_spec_id: a.method_spec_id ?? null,
        method_spec_hash: null,
        approval_state: 'APPROVED',
        approved_by: null,
        executor_id: a.executor_id ?? null,
        executor_version: a.executor_version ?? null,
        input_series_ids: JSON.parse(a.input_series_ids_json ?? '[]'),
        input_hashes: JSON.parse(a.input_hashes_json ?? '[]'),
      })),
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

  submitJob(type: 'ACQUISITION' | 'ANALYSIS' | 'PIPELINE', config: any): string {
    // E1.25: the effective configuration is hashed at submission, so the
    // manifest can name exactly which configuration produced the run. A run
    // whose config is unidentifiable is not reproducible.
    const runId = this.runRepo.createRun({
      runType: type,
      config,
      presetId: config.preset_id,
      presetVersion: config.preset_version,
      effectiveConfigHash: canonicalHash(config),
    });
    setImmediate(() => {
      this.executeRun(runId).catch(console.error);
    });
    return runId;
  }
}
