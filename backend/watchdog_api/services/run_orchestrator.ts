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
          stateAtFailure = 'PERSISTING_OBSERVATIONS';
          this.obsRepo.insertMany(runId, observations);
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

  submitJob(type: 'ACQUISITION' | 'ANALYSIS' | 'PIPELINE', config: any): string {
    const runId = this.runRepo.createRun({ runType: type, config });
    setImmediate(() => {
      this.executeRun(runId).catch(console.error);
    });
    return runId;
  }
}
