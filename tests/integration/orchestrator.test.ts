import { test, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { RunOrchestrator } from '../../backend/watchdog_api/services/run_orchestrator';
import { RunRepository } from '../../backend/watchdog_api/db/repositories/runs';
import { ObservationRepository, AnalysisResultRepository } from '../../backend/watchdog_api/db/repositories/data';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { tracer } from '../../backend/watchdog_api/utils/tracer';
import { sourceRegistry } from '../../backend/watchdog_api/sources/registry';
import { fetchEvents, rawBlobs } from '../../backend/watchdog_api/db/schema';
import { eq } from 'drizzle-orm';
import * as fs from 'node:fs';
import * as path from 'node:path';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
const TEST_STORE_PATH = path.join(process.cwd(), 'test_orchestrator_store');
let logOutput: any[] = [];

// Capture trace events instead of writing them to disk.
(tracer as any).writeLog = (_traceId: string, _filename: string, data: any) => {
  logOutput.push(data);
};

const PIPELINE_CONFIG = {
  source_id: 'offline_fixture',
  source_params: { fixture_name: 'test_123' },
  method_id: 'jh16_faithful',
  language: 'en',
  query_expansion_mode: 'STRICT_CANONICAL',
  entities: ['alcohol', 'cannabis'],
  query_templates: {
    popularity: '"{entity}"',
    harm: '"{entity}" "harm" OR "harmful"',
  },
  method_params: { reference_scores: { alcohol: 72, cannabis: 20 } },
};

beforeEach(() => {
  tracer.setMode('TRACE');
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite);
  db = drizzle(sqlite);
  logOutput = [];

  if (fs.existsSync(TEST_STORE_PATH)) fs.rmSync(TEST_STORE_PATH, { recursive: true, force: true });
});

afterEach(() => {
  sqlite.close();
  if (fs.existsSync(TEST_STORE_PATH)) fs.rmSync(TEST_STORE_PATH, { recursive: true, force: true });
});

test('Orchestrator - end-to-end PIPELINE run', async () => {
  const store = new LocalFileSystemStore(TEST_STORE_PATH);
  const orchestrator = new RunOrchestrator(db, store);
  const runRepo = new RunRepository(db);
  const obsRepo = new ObservationRepository(db);
  const anRepo = new AnalysisResultRepository(db);

  const runId = runRepo.createRun({ runType: 'PIPELINE', config: PIPELINE_CONFIG });
  await orchestrator.executeRun(runId);

  const runRecord = runRepo.getRun(runId)!;
  assert.strictEqual(runRecord.status, 'COMPLETED', runRecord.error_code ?? '');

  // Two entities x two dimensions.
  const obs = obsRepo.getByRunId(runId);
  assert.strictEqual(obs.length, 4);
  assert.deepStrictEqual(
    [...new Set(obs.map(o => o.entityId))].sort(),
    ['alcohol', 'cannabis']
  );
  assert.deepStrictEqual(
    [...new Set(obs.map(o => o.queryRole))].sort(),
    ['harm', 'popularity']
  );

  // The rendered query is stored exactly as sent.
  const alcoholHarm = obs.find(o => o.entityId === 'alcohol' && o.queryRole === 'harm')!;
  assert.strictEqual(alcoholHarm.queryText, '"alcohol" "harm" OR "harmful"');

  // The adapter version survives the write/read round-trip (E1.26).
  assert.strictEqual(alcoholHarm.sourceAdapterVersion, '2.0.0');

  const results = anRepo.getByRunId(runId);
  assert.ok(results.length > 0);
  const piAlc = results.find(r => r.entityId === 'alcohol' && r.metricKey === 'Pi');
  assert.strictEqual(piAlc?.valueNumeric, 100);

  const completedTrace = logOutput.find(l => l.event_type === 'RUN_COMPLETED');
  assert.ok(completedTrace, 'completion trace should be emitted');
  assert.strictEqual(completedTrace.payload.runId, runId);
});

test('Orchestrator - graceful failure retains evidence and records state', async () => {
  const store = new LocalFileSystemStore(TEST_STORE_PATH);
  const orchestrator = new RunOrchestrator(db, store);
  const runRepo = new RunRepository(db);

  const runId = runRepo.createRun({
    runType: 'PIPELINE',
    config: { ...PIPELINE_CONFIG, source_id: 'serp_generic', entities: ['alcohol'] },
  });

  const adapter = sourceRegistry.getAdapter('serp_generic');
  const originalNormalize = adapter.normalize;
  adapter.normalize = () => { throw new Error('Injected Normalization Crash'); };

  try {
    await orchestrator.executeRun(runId);
  } finally {
    adapter.normalize = originalNormalize;
  }

  const runRecord = runRepo.getRun(runId)!;
  assert.strictEqual(runRecord.status, 'FAILED');
  assert.strictEqual(runRecord.error_code, 'Injected Normalization Crash');

  const failureTrace = logOutput.find(l => l.event_type === 'STATE_AT_FAILURE');
  assert.ok(failureTrace);
  assert.strictEqual(failureTrace.payload.state, 'NORMALIZING');

  // Raw bytes archived before normalisation must survive the crash.
  const fe = db.select().from(fetchEvents).where(eq(fetchEvents.run_id, runId)).get();
  assert.ok(fe, 'fetch event should exist');
  assert.ok(fe!.raw_blob_id, 'raw blob id should exist');
  const rb = db.select().from(rawBlobs).where(eq(rawBlobs.id, fe!.raw_blob_id!)).get();
  assert.ok(rb, 'physical raw blob must be preserved despite the normalisation crash');
});
