import { test, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { AcquisitionRepository } from '../../backend/watchdog_api/db/repositories/acquisition';
import { ArtifactRepository } from '../../backend/watchdog_api/db/repositories/artifacts';
import { RunRepository } from '../../backend/watchdog_api/db/repositories/runs';
import { runMigrations, listTables } from '../../backend/watchdog_api/db/migrations';
import { rawBlobs, fetchEvents, manifests } from '../../backend/watchdog_api/db/schema';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
const TEST_STORE_PATH = path.join(process.cwd(), 'test_object_store');

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite);            // the real migration, not hand-written DDL
  db = drizzle(sqlite);

  if (fs.existsSync(TEST_STORE_PATH)) fs.rmSync(TEST_STORE_PATH, { recursive: true, force: true });
});

afterEach(() => {
  sqlite.close();
  if (fs.existsSync(TEST_STORE_PATH)) fs.rmSync(TEST_STORE_PATH, { recursive: true, force: true });
});

test('Migration runs clean on an empty file and is idempotent', () => {
  const fresh = new Database(':memory:');
  const first = runMigrations(fresh);
  assert.deepStrictEqual(first.applied, ['001_initial_schema']);

  const second = runMigrations(fresh);
  assert.deepStrictEqual(second.applied, [], 'a second run must apply nothing');
  assert.deepStrictEqual(second.alreadyPresent, ['001_initial_schema']);
  fresh.close();
});

test('Schema contains every table 02_DATA_MODEL.md specifies', () => {
  const tables = new Set(listTables(sqlite));
  const required = [
    'principals', 'roles', 'principal_roles',
    'substances', 'aliases', 'external_identifiers',
    'capabilities', 'sources', 'providers', 'provider_credentials',
    'runs', 'run_steps', 'artifacts', 'manifests',
    'fetch_events', 'raw_blobs',
    'series', 'observations',
    'method_specs', 'analysis_runs', 'analysis_results',
    'reference_score_sets', 'reference_scores',
    'narratives',
    'replication_targets', 'replication_claims', 'replication_attempts', 'replication_verdicts',
    'datasets', 'dataset_columns', 'dataset_inputs', 'transform_specs', 'transform_runs',
    'audit_events',
  ];
  for (const t of required) assert.ok(tables.has(t), `missing table: ${t}`);
});

test('Every E6 field-reference table exists and is empty (D12)', () => {
  const e6 = [
    'symptoms', 'symptom_aliases', 'substance_symptom_associations',
    'pill_types', 'tested_samples', 'pill_type_composition',
    'batch_alert_rules', 'batch_alerts',
  ];
  const tables = new Set(listTables(sqlite));

  for (const t of e6) {
    assert.ok(tables.has(t), `missing E6 table: ${t}`);
    const { n } = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
    assert.strictEqual(n, 0, `${t} must be empty at E1 — schema now, features at E6`);
  }
});

test('reference_scores carries an evidence_tier column (D12)', () => {
  const cols = (sqlite.prepare(`PRAGMA table_info(reference_scores)`).all() as { name: string }[])
    .map(c => c.name);
  assert.ok(cols.includes('evidence_tier'));
});

test('Observations cannot store a missing value that also has a number', () => {
  // The CHECK constraint enforces "missing is not zero" at the storage layer,
  // not merely in application code.
  const runRepo = new RunRepository(db);
  const runId = runRepo.createRun({ runType: 'ACQUISITION', config: {} });

  sqlite.prepare(`INSERT INTO series (id, metric_key, owner_principal_id, visibility, created_at)
                  VALUES ('s1', 'x', 'local-user', 'private', '2026-01-01T00:00:00Z')`).run();

  assert.throws(() => {
    sqlite.prepare(`INSERT INTO observations
      (id, series_id, run_id, retrieved_at, numeric_value, is_missing, missing_reason, created_at)
      VALUES ('o1', 's1', ?, '2026-01-01T00:00:00Z', 42, 1, 'PARSE_FAILED', '2026-01-01T00:00:00Z')`)
      .run(runId);
  }, /CHECK constraint failed/, 'a row cannot be both missing and numeric');

  assert.throws(() => {
    sqlite.prepare(`INSERT INTO observations
      (id, series_id, run_id, retrieved_at, numeric_value, is_missing, created_at)
      VALUES ('o2', 's1', ?, '2026-01-01T00:00:00Z', NULL, 1, '2026-01-01T00:00:00Z')`)
      .run(runId);
  }, /CHECK constraint failed/, 'a missing row must carry a reason');
});

test('Replication verdict vocabulary is closed and contains no "failed"', () => {
  const runRepo = new RunRepository(db);
  const runId = runRepo.createRun({ runType: 'ANALYSIS', config: {} });
  const now = '2026-01-01T00:00:00Z';

  sqlite.prepare(`INSERT INTO replication_targets (id,title,status,owner_principal_id,created_at)
                  VALUES ('t1','JH2016','active','local-user',?)`).run(now);
  sqlite.prepare(`INSERT INTO replication_claims
                  (id,target_id,claim_key,tolerance_kind,tolerance_value,created_at)
                  VALUES ('c1','t1','k','interval',0.7,?)`).run(now);
  sqlite.prepare(`INSERT INTO replication_attempts (id,target_id,run_id,status)
                  VALUES ('a1','t1',?,'COMPLETED')`).run(runId);

  for (const v of ['reproduced', 'deviates', 'not_computable', 'method_unclear']) {
    sqlite.prepare(`INSERT INTO replication_verdicts (id,attempt_id,claim_id,verdict,created_at)
                    VALUES (?, 'a1','c1',?,?)`).run(`v_${v}`, v, now);
  }

  assert.throws(() => {
    sqlite.prepare(`INSERT INTO replication_verdicts (id,attempt_id,claim_id,verdict,created_at)
                    VALUES ('v_bad','a1','c1','failed',?)`).run(now);
  }, /CHECK constraint failed/, "'failed' is deliberately not in the vocabulary");
});

test('Persistence: deduplicate physical blobs but maintain fetch history', async () => {
  const store = new LocalFileSystemStore(TEST_STORE_PATH);
  const repo = new AcquisitionRepository(db, store);
  const runRepo = new RunRepository(db);
  const runId = runRepo.createRun({ runType: 'ACQUISITION', config: {} });

  const payload = Buffer.from('identical provider response');

  await repo.recordFetch({ runId, sourceId: 'src1', payload, status: 'SUCCESS' });
  await repo.recordFetch({ runId, sourceId: 'src2', payload, status: 'SUCCESS' });

  const blobs = db.select().from(rawBlobs).all();
  const fetches = db.select().from(fetchEvents).all();

  assert.strictEqual(blobs.length, 1, 'one physical blob, by content address');
  assert.strictEqual(fetches.length, 2, 'two logical fetch events must survive');
  assert.strictEqual(fetches[0].raw_blob_id, blobs[0].id);
  assert.strictEqual(fetches[1].raw_blob_id, blobs[0].id);
});

test('Persistence: a blob round-trips by hash', async () => {
  const store = new LocalFileSystemStore(TEST_STORE_PATH);
  const repo = new AcquisitionRepository(db, store);
  const runRepo = new RunRepository(db);
  const runId = runRepo.createRun({ runType: 'ACQUISITION', config: {} });

  const payload = Buffer.from('round trip me');
  const expected = createHash('sha256').update(payload).digest('hex');

  const blobId = await repo.recordFetch({ runId, sourceId: 'src', payload, status: 'SUCCESS' });
  assert.ok(blobId);

  const row = repo.getRawBlob(blobId!)!;
  assert.strictEqual(row.sha256, expected);

  const bytes = await store.get(row.object_uri);
  assert.deepStrictEqual(bytes, payload);
  assert.strictEqual(createHash('sha256').update(bytes).digest('hex'), expected);
});

test('Persistence: WORM constraint on manifests', async () => {
  const repo = new ArtifactRepository(db);
  const runRepo = new RunRepository(db);
  const runId = runRepo.createRun({ runType: 'ANALYSIS', config: {} });

  repo.finalizeManifest(runId, 'file://manifest/uri', 'abc');
  assert.strictEqual(db.select().from(manifests).all().length, 1);

  assert.throws(() => repo.finalizeManifest(runId, 'file://manifest/uri2', 'def'), /WORM Violation/);
});

test('Persistence: WORM constraint on the object store', async () => {
  const store = new LocalFileSystemStore(TEST_STORE_PATH);
  await store.put('raw/fixedhash123', Buffer.from('data'));

  await assert.rejects(
    async () => store.put('raw/fixedhash123', Buffer.from('mutated data')),
    /WORM Violation/
  );
});

test('No SQL outside the repository layer (D13)', () => {
  // D2's invariant: all persistence sits behind repository interfaces. D13
  // fixes backend/watchdog_api/db as the repository layer; this asserts the
  // boundary rather than the directory name.
  const backend = path.join(process.cwd(), 'backend', 'watchdog_api');
  const repoLayer = path.join(backend, 'db');

  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      if (full.startsWith(repoLayer)) continue;

      const src = fs.readFileSync(full, 'utf-8');
      if (/\bfrom\s+['"]better-sqlite3['"]/.test(src)) offenders.push(`${full}: imports better-sqlite3`);
      if (/\b(CREATE TABLE|INSERT INTO|SELECT\s+\*\s+FROM|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i.test(src)) {
        offenders.push(`${full}: contains raw SQL`);
      }
    }
  };
  walk(backend);

  assert.deepStrictEqual(offenders, [], `SQL/driver access leaked outside the repository layer:\n${offenders.join('\n')}`);
});
