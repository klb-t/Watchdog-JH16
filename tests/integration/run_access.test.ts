import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import express from 'express';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { RunRepository } from '../../backend/watchdog_api/db/repositories/runs';
import { AcquisitionRepository } from '../../backend/watchdog_api/db/repositories/acquisition';
import { ArtifactRepository } from '../../backend/watchdog_api/db/repositories/artifacts';
import { AuditRepository } from '../../backend/watchdog_api/db/repositories/audit';
import { WorkbenchRepository } from '../../backend/watchdog_api/db/repositories/workbench';
import { WorkbenchService } from '../../backend/watchdog_api/workbench/service';
import { loadWorkbenchProfile } from '../../backend/watchdog_api/config/workbench';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { buildApiRouter } from '../../backend/watchdog_api/api/routes';
import { errorHandler } from '../../backend/watchdog_api/api/middleware';
import { defaultFigure } from '../../shared/workbench';
import { testDataset } from '../helpers/workbench';

test('E4/E5: legacy API cannot bypass workbench ownership, raw-blob provenance or method review', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'watchdog-run-access-'));
  const sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys=ON'); runMigrations(sqlite);
  const db = drizzle(sqlite), store = new LocalFileSystemStore(directory);
  const runs = new RunRepository(db), acquisitions = new AcquisitionRepository(db, store), artifacts = new ArtifactRepository(db);
  const workbench = new WorkbenchRepository(sqlite, store), service = new WorkbenchService(workbench, loadWorkbenchProfile());
  let actor = 'alice';
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.principal = { id: actor, roles: ['researcher'], email: null, identityProvenance: 'test' }; next(); });
  app.use('/api', buildApiRouter(db, store, new AuditRepository(sqlite))); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  const call = (route: string, body?: unknown) => fetch(base + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const runId = runs.createRun({ runType: 'ACQUISITION', config: {}, ownerPrincipalId: 'alice' });
    const blobId = await acquisitions.recordFetch({ runId, sourceId: 'offline_fixture', payload: Buffer.from('private observation'), status: 'success' });
    artifacts.recordArtifact({ runId, kind: 'raw', objectUri: 'test', sha256: 'a'.repeat(64) });
    assert.equal(artifacts.getArtifacts(runId)[0].owner_principal_id, 'alice');
    assert.equal((await call(`/artifacts/${blobId}`)).status, 200);
    const imported = await workbench.importDataset(testDataset(), 'alice', 'test');
    const record = (await workbench.approveDataset(imported.id, 'alice', imported.contentHash, true, 'test'))!;
    const figure = defaultFigure(record, service.profile); figure.channels.x = 'interest'; figure.channels.y = 'mentions';
    const method = await service.prepare('alice', figure, 'pearson', 'test');
    workbench.approveMethod(method.id, 'alice', method.hash, 'test');
    const result = await service.execute('alice', method.id, 'test');
    assert.equal((await call(`/runs/${result.runId}/results`)).status, 200);
    actor = 'bob';
    assert.deepEqual((await (await call('/runs')).json()).runs, []);
    for (const id of [runId, result.runId]) {
      for (const suffix of ['', '/results', '/manifest', '/fetch-events', '/charts', '/narrative', '/export?format=csv'])
        assert.equal((await call(`/runs/${id}${suffix}`)).status, 404, suffix);
      assert.equal((await call(`/runs/${id}/narrative/generate`, { provider: 'openrouter' })).status, 404);
    }
    assert.equal((await call(`/artifacts/${blobId}`)).status, 404);
    assert.equal((await call(`/artifacts/dataset-raw-${record.contentHash}`)).status, 404, 'sharing a reviewed dataset does not open an unreviewed raw endpoint');
    assert.equal((await call('/runs', { type: 'ANALYSIS', config: { source_run_id: runId } })).status, 404);
    assert.equal((await call(`/method-specs/${method.id}/approve`, { expectedHash: method.hash })).status, 404);
    const spec = await (await call('/method-specs/jh2016-faithful')).json();
    assert.equal((await call('/method-specs/jh2016-faithful/approve', { approved_by: 'alice', expectedHash: spec.spec_hash })).status, 400);
    assert.equal((await call('/method-specs/jh2016-faithful/approve', { expectedHash: '0'.repeat(64) })).status, 409);
    assert.equal((await call('/method-specs/jh2016-faithful/approve', { expectedHash: spec.spec_hash })).status, 200);
    assert.equal((sqlite.prepare("SELECT approved_by FROM method_specs WHERE id='jh2016-faithful'").get() as any).approved_by, 'bob');
    // Physical deduplication is compatible with distinct owners and events.
    const bobRun = runs.createRun({ runType: 'ACQUISITION', config: {}, ownerPrincipalId: 'bob' });
    assert.equal(await acquisitions.recordFetch({ runId: bobRun, sourceId: 'offline_fixture', payload: Buffer.from('private observation'), status: 'success' }), blobId);
    assert.equal((await call(`/artifacts/${blobId}`)).status, 200);
    const submitted = await call('/runs', { type: 'ACQUISITION', config: { source_id: 'offline_fixture', source_params: { fixture_name: 'test_api' }, language: 'en', query_expansion_mode: 'STRICT_CANONICAL' } });
    assert.equal(submitted.status, 202); const { run_id } = await submitted.json();
    assert.equal(runs.getRun(run_id)!.owner_principal_id, 'bob');
    for (let i = 0; i < 60 && !['COMPLETED', 'FAILED'].includes(runs.getRun(run_id)!.status); i++) await new Promise(r => setTimeout(r, 20));
    assert.equal(runs.getRun(run_id)!.status, 'COMPLETED', runs.getRun(run_id)!.error_details ?? runs.getRun(run_id)!.error_code ?? '');
    const analysisSubmit = await call('/runs', { type: 'ANALYSIS', config: { source_run_id: run_id, method_id: 'jh16_faithful', method_params: { reference_scores: { alcohol: 72 } } } });
    assert.equal(analysisSubmit.status, 202); const analysisId = (await analysisSubmit.json()).run_id;
    for (let i = 0; i < 60 && !['COMPLETED', 'FAILED'].includes(runs.getRun(analysisId)!.status); i++) await new Promise(r => setTimeout(r, 20));
    assert.equal(runs.getRun(analysisId)!.status, 'COMPLETED', runs.getRun(analysisId)!.error_details ?? '');
    assert.ok((await (await call(`/runs/${analysisId}/results`)).json()).analysis_results.length > 0);
    actor = 'alice'; assert.equal((await call(`/runs/${analysisId}/results`)).status, 404);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve())); sqlite.close(); rmSync(directory, { recursive: true, force: true });
  }
});
