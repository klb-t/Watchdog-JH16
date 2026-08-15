import { test, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { AcquisitionRepository } from '../../backend/watchdog_api/db/repositories/acquisition';
import { ArtifactRepository } from '../../backend/watchdog_api/db/repositories/artifacts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runs, rawBlobs, fetchEvents, manifests } from '../../backend/watchdog_api/db/schema';
import { randomUUID } from 'node:crypto';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
const TEST_STORE_PATH = path.join(process.cwd(), 'test_object_store');

beforeEach(() => {
  sqlite = new Database(':memory:');
  db = drizzle(sqlite);
  
  // Minimal manual migration for test (avoids full drizzle-kit setup in CI)
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

test('Persistence: Deduplicate physical blobs but maintain fetch history', async () => {
  const store = new LocalFileSystemStore(TEST_STORE_PATH);
  const repo = new AcquisitionRepository(db, store);
  
  const runId = randomUUID();
  db.insert(runs).values({ id: runId, type: 'ACQUISITION', status: 'QUEUED', config: '{}', created_at: new Date().toISOString() }).run();

  const payload = Buffer.from('identical provider response');

  // Fetch 1
  await repo.recordFetch(runId, 'src1', payload, 'SUCCESS');
  // Fetch 2 (e.g. later run or different source getting same response)
  await repo.recordFetch(runId, 'src2', payload, 'SUCCESS');

  const blobs = db.select().from(rawBlobs).all();
  const fetches = db.select().from(fetchEvents).all();

  assert.strictEqual(blobs.length, 1, 'Only one physical blob should exist due to content addressing');
  assert.strictEqual(fetches.length, 2, 'Two logical fetch events must exist');
  assert.strictEqual(fetches[0].raw_blob_id, blobs[0].id);
  assert.strictEqual(fetches[1].raw_blob_id, blobs[0].id);
});

test('Persistence: WORM Constraint on Manifests', async () => {
  const repo = new ArtifactRepository(db);
  const runId = randomUUID();
  
  db.insert(runs).values({ id: runId, type: 'ANALYSIS', status: 'QUEUED', config: '{}', created_at: new Date().toISOString() }).run();

  // First finalization
  repo.finalizeManifest(runId, 'file://manifest/uri', 'abc');
  
  const allManifests = db.select().from(manifests).all();
  assert.strictEqual(allManifests.length, 1);

  // Attempting to finalize/mutate again throws WORM violation
  assert.throws(() => {
    repo.finalizeManifest(runId, 'file://manifest/uri2', 'def');
  }, /WORM Violation/);
});

test('Persistence: WORM Constraint on Object Store', async () => {
  const store = new LocalFileSystemStore(TEST_STORE_PATH);
  const payload = Buffer.from('data');
  const key = 'raw/fixedhash123';
  
  await store.put(key, payload);
  
  // Attempt to overwrite the same key should fail (WORM compliance)
  await assert.rejects(async () => {
    await store.put(key, Buffer.from('mutated data'));
  }, /WORM Violation/);
});
