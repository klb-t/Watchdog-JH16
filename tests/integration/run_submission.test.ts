import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import express from 'express';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { RunRepository } from '../../backend/watchdog_api/db/repositories/runs';
import { ObservationRepository, AnalysisResultRepository } from '../../backend/watchdog_api/db/repositories/data';
import { ArtifactRepository } from '../../backend/watchdog_api/db/repositories/artifacts';
import { AuditRepository } from '../../backend/watchdog_api/db/repositories/audit';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { RunOrchestrator } from '../../backend/watchdog_api/services/run_orchestrator';
import { sourceRegistry } from '../../backend/watchdog_api/sources/registry';
import { buildApiRouter } from '../../backend/watchdog_api/api/routes';
import { errorHandler } from '../../backend/watchdog_api/api/middleware';
import { canonicalHash, canonicalizeJson } from '../../backend/watchdog_api/domain/canonical';
import { tracer } from '../../backend/watchdog_api/utils/tracer';

const before = JSON.parse(readFileSync('tests/fixtures/run-submission-before.json', 'utf8'));

test('A4-WD-001: actual HTTP rejects before queue/writes; valid legacy analysis keeps exact results and reopened evidence', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wd-run-submission-'));
  const filename = path.join(directory, 'runs.sqlite');
  let sqlite = new Database(filename); sqlite.pragma('foreign_keys=ON'); runMigrations(sqlite);
  const db = drizzle(sqlite), owner = 'local-user'; let actor = owner;
  const runs = new RunRepository(db), observations = new ObservationRepository(db), analyses = new AnalysisResultRepository(db);
  const artifacts = new ArtifactRepository(db), localStore = new LocalFileSystemStore(path.join(directory, 'objects'));
  let writes = 0, submissions = 0, sourceResolutions = 0, egress = 0;
  const store = { get: localStore.get.bind(localStore), put: async (key: string, bytes: Buffer) => { ++writes; return localStore.put(key, bytes); } };
  const submit = RunOrchestrator.prototype.submitJob, resolve = sourceRegistry.resolveAdapter;
  // Count the real boundaries and delegate unchanged; valid requests still run the
  // production queue, orchestrator and registered analyzer, not substitute outputs.
  t.mock.method(RunOrchestrator.prototype, 'submitJob', function(this: RunOrchestrator, ...args: Parameters<typeof submit>) {
    ++submissions; return submit.apply(this, args);
  });
  t.mock.method(sourceRegistry, 'resolveAdapter', function(...args: Parameters<typeof resolve>) {
    ++sourceResolutions; return resolve.apply(sourceRegistry, args);
  });
  tracer.setMode('OFF');
  const sourceId = runs.createRun({ runType: 'ACQUISITION', config: { synthetic: true }, ownerPrincipalId: owner });
  const base = { seriesId: '', entityId: 'audit_entity', queryText: 'synthetic', language: 'en',
    queryExpansionMode: 'STRICT_CANONICAL' as const, retrievedAt: '2026-10-09T00:00:00.000Z',
    sourceId: 'audit-source', sourceAdapterVersion: 'fixture-1', qualityFlags: ['COUNT_PARSE_UNCERTAIN'] as const };
  observations.insertMany(sourceId, [
    { ...base, queryRole: 'popularity', numericValue: 100, isMissing: false },
    { ...base, queryRole: 'harm', numericValue: null, isMissing: true, missingReason: 'RATE_LIMITED' },
  ]);
  const config = { source_run_id: sourceId, method_id: 'jh16_faithful', method_params: { reference_scores: { audit_entity: 7 } } };
  const controls = { method_spec_id: 'audit-missing-unapproved', method_spec_hash: 'unapproved-fixture-hash',
    personal_credentials: true, plan: [{ entityId: 'audit_only', dimension: 'custom', renderedQuery: 'synthetic-only' }] };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.principal = { id: actor, roles: ['researcher'], email: null, identityProvenance: 'test' }; next(); });
  app.use('/api', buildApiRouter(db, store, new AuditRepository(sqlite))); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/runs`, nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (...args: Parameters<typeof fetch>) => {
    if (String(args[0]) !== url) { ++egress; throw new Error('Synthetic test forbids external network'); }
    return nativeFetch(...args);
  });
  const post = async (body: unknown) => { const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() }; };
  try {
    const changes = () => (sqlite.prepare('SELECT total_changes() AS count').get() as any).count;
    const initialChanges = changes(), initialRows = sqlite.serialize();
    const rejected = [
      ...Object.entries(controls).map(([key, value]) => ({ type: 'ANALYSIS', config: { ...config, [key]: value } })),
      { type: 'ANALYSIS', config: { ...config, ...controls } },
      { type: 'ANALYSIS', config, method_spec_id: 'audit-missing-unapproved' },
      { type: 'ANALYSIS', config: { ...config, source_id_typo: 'offline_fixture' } },
    ];
    for (const body of rejected) {
      const result = await post(body);
      assert.equal(result.status, 400); assert.equal(result.body.error, 'VALIDATION_ERROR');
      assert.equal(result.body.details[0].code, 'unrecognized_keys');
      const keys = Object.keys(body.config).filter(key => !Object.hasOwn(config, key));
      assert.deepEqual(result.body.details[0].keys, keys.length ? keys : ['method_spec_id']);
      assert.deepEqual(result.body.details[0].path, keys.length ? ['config'] : []);
      assert.equal(submissions, 0); assert.equal(changes(), initialChanges); assert.equal(writes, 0);
      assert.equal(sourceResolutions, 0); assert.equal(egress, 0);
    }
    await new Promise<void>(done => setImmediate(done));
    assert.deepEqual(sqlite.serialize(), initialRows, 'rejection cannot leave a partial job or ledger write');
    actor = 'other'; assert.equal((await post({ type: 'ANALYSIS', config })).status, 404);
    assert.equal(submissions, 0); assert.equal(changes(), initialChanges); actor = owner;

    const accepted = await post({ type: 'ANALYSIS', config });
    assert.equal(accepted.status, 202); assert.equal(submissions, 1);
    const runId = accepted.body.run_id;
    for (let n = 0; n < 100 && !['COMPLETED', 'FAILED'].includes(runs.getRun(runId)!.status); ++n)
      await new Promise(done => setTimeout(done, 10));
    const run = runs.getRun(runId)!; assert.equal(run.status, 'COMPLETED', run.error_details ?? '');
    const orderedConfig = { method_id: config.method_id, method_params: config.method_params, source_run_id: sourceId };
    assert.equal(run.effective_config, JSON.stringify(orderedConfig), 'same existing schema key order and config bytes');
    assert.equal(run.effective_config_hash, canonicalHash(config));
    assert.equal(canonicalizeJson(analyses.getByRunId(runId)), before.analysisResultsCanonical);
    assert.equal(analyses.getByRunId(runId).find(row => row.metricKey === 'Hi')!.isMissing, true);
    const manifest = artifacts.getManifest(runId)!; assert.ok(manifest);
    const bytes = await store.get(manifest.object_uri);
    assert.equal(canonicalHash(JSON.parse(bytes.toString())), manifest.sha256);
    assert.equal(sourceResolutions, 0); assert.equal(egress, 0);
    assert.equal((sqlite.prepare('SELECT count(*) AS count FROM assistant_reservations').get() as any).count, 0);

    // Internal reviewed-plan input has its own contract: a direct unreviewed pin
    // remains rejected by the actual consumer, rather than silently downgraded.
    const failedId = runs.createRun({ runType: 'ANALYSIS', config: { ...config, ...controls }, ownerPrincipalId: owner });
    await new RunOrchestrator(db, store).executeRun(failedId);
    assert.equal(runs.getRun(failedId)!.status, 'FAILED');
    assert.match(runs.getRun(failedId)!.error_code!, /reviewed, hash-pinned/);
    assert.equal(analyses.getByRunId(failedId).length, 0); assert.equal(artifacts.getManifest(failedId), undefined);
    const failed = runs.getRun(failedId), resultBytes = canonicalizeJson(analyses.getByRunId(runId));
    sqlite.close(); sqlite = new Database(filename); sqlite.pragma('foreign_keys=ON');
    const reopened = drizzle(sqlite);
    assert.deepEqual(new RunRepository(reopened).getRun(runId), run);
    assert.deepEqual(new RunRepository(reopened).getRun(failedId), failed);
    assert.equal(canonicalizeJson(new AnalysisResultRepository(reopened).getByRunId(runId)), resultBytes);
    assert.deepEqual(new ArtifactRepository(reopened).getManifest(runId), manifest);
    assert.deepEqual(await localStore.get(manifest.object_uri), bytes);
  } finally {
    await new Promise<void>(done => server.close(() => done())); sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
