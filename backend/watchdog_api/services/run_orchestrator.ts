import { tracer } from '../utils/tracer';
import { RunRepository } from '../db/repositories/runs';
import { AcquisitionRepository } from '../db/repositories/acquisition';
import { ObservationRepository, AnalysisResultRepository } from '../db/repositories/data';
import { ArtifactRepository } from '../db/repositories/artifacts';
import { sourceRegistry } from '../sources/registry';
import { analyzerRegistry } from '../analytics/registry';
import { ObjectStore } from '../storage/object_store';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

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
   * Main entry point for a generic end-to-end pipeline run.
   * Can be configured just for acquisition, just for analysis, or both.
   */
  async executeRun(runId: string) {
    await tracer.runWithSpan('orchestrator', `executeRun:${runId}`, async () => {
      let stateAtFailure: string | null = null;
      try {
        const runRecord = this.runRepo.getRun(runId);
        if (!runRecord) throw new Error("Run not found");
        
        const config = JSON.parse(runRecord.config);

        if (runRecord.type === 'ACQUISITION' || runRecord.type === 'PIPELINE') {
           this.runRepo.updateStatus(runId, 'ACQUIRING');
           tracer.emit('START_ACQUISITION', { source: config.source_id });
           
           const adapter = sourceRegistry.getAdapter(config.source_id);
           const params = config.source_params || {};
           
           const validated = adapter.validate_params(params);
           if (!validated.valid) throw new Error(`Invalid params: ${validated.errors?.join(', ')}`);

           stateAtFailure = 'FETCHING';
           const raw = await adapter.fetch(validated.normalized_params);
           
           stateAtFailure = 'ARCHIVING_RAW';
           // Archive raw response - preserves WORM evidence even if normalization fails
           const provenanceMetadata = adapter.provenance ? adapter.provenance(raw) : undefined;
           raw.raw_blob_id = await this.acqRepo.recordFetch(runId, config.source_id, raw.payload, raw.status, adapter.adapter_version, provenanceMetadata);
           
           if (raw.status === 'SUCCESS') {
             this.runRepo.updateStatus(runId, 'NORMALIZING');
             stateAtFailure = 'NORMALIZING';
             const observations = adapter.normalize(raw, validated.normalized_params);
             
             stateAtFailure = 'PERSISTING_OBSERVATIONS';
             this.obsRepo.insertMany(runId, observations);
           } else {
             throw new Error(`Fetch failed with status: ${raw.status}`);
           }
        }

        if (runRecord.type === 'ANALYSIS' || runRecord.type === 'PIPELINE') {
           this.runRepo.updateStatus(runId, 'ANALYZING');
           stateAtFailure = 'LOADING_OBSERVATIONS';
           // Load observations (either from this run or a referenced source run)
           const obsRunId = config.source_run_id || runId;
           const observations = this.obsRepo.getByRunId(obsRunId);
           
           stateAtFailure = 'EXECUTING_ANALYSIS';
           const analyzer = analyzerRegistry.get(config.method_id);
           const results = analyzer.analyze(observations, {
             method_id: config.method_id,
             method_version: analyzer.analyzer_version,
             parameters: config.method_params
           });

           stateAtFailure = 'PERSISTING_RESULTS';
           this.anRepo.insertMany(runId, results);
        }

        this.runRepo.updateStatus(runId, 'SUCCESS');
        tracer.emit('RUN_COMPLETED', { runId });

      } catch (err: any) {
        this.runRepo.updateStatus(runId, 'FAILED', err.message);
        tracer.emit('STATE_AT_FAILURE', { state: stateAtFailure, error: err.message });
      }
    });
  }

  // Helper to submit jobs
  submitJob(type: 'ACQUISITION' | 'ANALYSIS' | 'PIPELINE', config: any): string {
    const runId = this.runRepo.createRun(type, config);
    this.runRepo.updateStatus(runId, 'QUEUED');
    // In a real environment, dispatch to Redis/Queue. Here we run asynchronously.
    setImmediate(() => {
      this.executeRun(runId).catch(console.error);
    });
    return runId;
  }
}
