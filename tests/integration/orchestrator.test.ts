import { test, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { RunOrchestrator } from '../../backend/watchdog_api/services/run_orchestrator';
import { RunRepository } from '../../backend/watchdog_api/db/repositories/runs';
import { ObservationRepository, AnalysisResultRepository } from '../../backend/watchdog_api/db/repositories/data';
import { tracer } from '../../backend/watchdog_api/utils/tracer';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
const TEST_STORE_PATH = path.join(process.cwd(), 'test_orchestrator_store');
let logOutput: any[] = [];

// Monkey-patch tracer.writeLog for asserting internal traces directly
const originalWriteLog = (tracer as any).writeLog.bind(tracer);
(tracer as any).writeLog = (traceId: string, filename: string, data: any) => {
  logOutput.push(data);
};

beforeEach(() => {
  tracer.setMode('TRACE');
  sqlite = new Database(':memory:');
  db = drizzle(sqlite);
  logOutput = [];
  
  db.run(sql`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      config TEXT NOT NULL,
      error_code TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
  `);
  db.run(sql`
    CREATE TABLE raw_blobs (
      id TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL UNIQUE,
      object_uri TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.run(sql`
    CREATE TABLE fetch_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      source_id TEXT NOT NULL,
      source_adapter_version TEXT,
      provenance_metadata TEXT,
      raw_blob_id TEXT REFERENCES raw_blobs(id),
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.run(sql`
    CREATE TABLE manifests (
      run_id TEXT PRIMARY KEY REFERENCES runs(id),
      object_uri TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      finalized_at TEXT NOT NULL
    );
  `);
  db.run(sql`
    CREATE TABLE observations (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      entity_id TEXT NOT NULL,
      dimension TEXT NOT NULL,
      query_text TEXT NOT NULL,
      result_count INTEGER,
      retrieved_at TEXT NOT NULL,
      source_id TEXT NOT NULL,
      raw_artifact_id TEXT
    );
  `);
  db.run(sql`
    CREATE TABLE analysis_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      entity_id TEXT,
      metric_key TEXT NOT NULL,
      value_numeric REAL,
      value_text TEXT,
      unit TEXT
    );
  `);
  
  if (fs.existsSync(TEST_STORE_PATH)) {
    fs.rmSync(TEST_STORE_PATH, { recursive: true, force: true });
  }
});

afterEach(() => {
  sqlite.close();
  if (fs.existsSync(TEST_STORE_PATH)) {
    fs.rmSync(TEST_STORE_PATH, { recursive: true, force: true });
  }
});

test('Orchestrator - End-to-End PIPELINE run', async () => {
  const store = new LocalFileSystemStore(TEST_STORE_PATH);
  const orchestrator = new RunOrchestrator(db, store);
  const runRepo = new RunRepository(db);
  const obsRepo = new ObservationRepository(db);
  const anRepo = new AnalysisResultRepository(db);

  // Sync execution for testing
  const runId = runRepo.createRun('PIPELINE', {
    source_id: 'offline_fixture',
    source_params: { fixture_name: 'test_123' },
    method_id: 'jh16_faithful',
    method_params: {
      reference_scores: { alcohol: 72 }
    }
  });

  await orchestrator.executeRun(runId);

  const runRecord = runRepo.getRun(runId);
  assert.strictEqual(runRecord.status, 'SUCCESS');
  
  const obs = obsRepo.getByRunId(runId);
  assert.strictEqual(obs.length, 2); // Assuming the fixture returns 2
  assert.strictEqual(obs[0].entity_id, 'alcohol');

  const results = anRepo.getByRunId(runId);
  assert.ok(results.length > 0);
  const piAlc = results.find(r => r.entity_id === 'alcohol' && r.metric_key === 'Pi');
  assert.strictEqual(piAlc?.value_numeric, 100);

  // Check Traces
  const completedTrace = logOutput.find(l => l.event_type === 'RUN_COMPLETED');
  assert.ok(completedTrace, 'Completion trace should be emitted');
  assert.strictEqual(completedTrace.payload.runId, runId);
});

import { sourceRegistry } from '../../backend/watchdog_api/sources/registry';
import { fetchEvents, rawBlobs } from '../../backend/watchdog_api/db/schema';

test('Orchestrator - Graceful Failure retains evidence and states', async () => {
  const store = new LocalFileSystemStore(TEST_STORE_PATH);
  const orchestrator = new RunOrchestrator(db, store);
  const runRepo = new RunRepository(db);

  const runId = runRepo.createRun('PIPELINE', {
    source_id: 'serp_generic',
    source_params: { query: 'crash_normalize_please' }, // Force normalization error
    method_id: 'jh16_faithful',
    method_params: {}
  });

  // Hack SerpAdapter to throw on normalize
  const adapter = sourceRegistry.getAdapter('serp_generic');
  const originalNormalize = adapter.normalize;
  adapter.normalize = () => { throw new Error("Injected Normalization Crash"); };

  await orchestrator.executeRun(runId);

  // Restore
  adapter.normalize = originalNormalize;

  const runRecord = runRepo.getRun(runId);
  assert.strictEqual(runRecord.status, 'FAILED');
  assert.strictEqual(runRecord.error_code, 'Injected Normalization Crash');

  // Check state_at_failure trace
  const failureTrace = logOutput.find(l => l.event_type === 'STATE_AT_FAILURE');
  assert.ok(failureTrace);
  assert.strictEqual(failureTrace.payload.state, 'NORMALIZING'); // It fetched and saved raw, crashed normalizing

  // Verify raw blob was retained! (WORM)
  const fe = db.select().from(fetchEvents).where(sql`run_id = ${runId}`).get();
  assert.ok(fe, 'Fetch event should exist');
  assert.ok(fe.raw_blob_id, 'Raw blob ID should exist');
  const rb = db.select().from(rawBlobs).where(sql`id = ${fe.raw_blob_id}`).get();
  assert.ok(rb, 'Physical raw blob should be preserved despite normalization crash');
});
