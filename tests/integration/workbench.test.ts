import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { WorkbenchRepository } from '../../backend/watchdog_api/db/repositories/workbench';
import { AuditRepository } from '../../backend/watchdog_api/db/repositories/audit';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { WorkbenchService } from '../../backend/watchdog_api/workbench/service';
import { loadWorkbenchProfile } from '../../backend/watchdog_api/config/workbench';
import { buildWorkbenchRouter } from '../../backend/watchdog_api/api/workbench_routes';
import { buildDiagnosticRouter } from '../../backend/watchdog_api/api/diagnostic_routes';
import { traceMiddleware, errorHandler } from '../../backend/watchdog_api/api/middleware';
import { defaultFigure, validateDataset, csvExport } from '../../shared/workbench';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';
import { testDataset } from '../helpers/workbench';
import { tracer } from '../../backend/watchdog_api/utils/tracer';

async function harness() {
  const dir = mkdtempSync(path.join(tmpdir(), 'watchdog-workbench-')), db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db);
  const repo = new WorkbenchRepository(db, new LocalFileSystemStore(dir)), service = new WorkbenchService(repo, loadWorkbenchProfile());
  let actor = 'test-owner', roles = ['researcher'];
  const app = express(); app.use(express.json({ limit: '2mb' })); app.use(traceMiddleware);
  app.use((req, _res, next) => { req.principal = { id: actor, roles, email: null, identityProvenance: 'test' }; next(); });
  app.use('/wb', buildWorkbenchRouter(repo, service)); app.use('/diag', buildDiagnosticRouter(new AuditRepository(db))); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = (route: string, body?: unknown) => fetch(base + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const approved = async (share = false) => { const r = await repo.importDataset(testDataset(), 'test-owner', 'test'); return (await repo.approveDataset(r.id, 'test-owner', r.contentHash, share, 'test'))!; };
  return { db, repo, service, call, approved, principal: (id: string, r: string[]) => { actor = id; roles = r; },
    close: async () => { await new Promise<void>(r => server.close(() => r())); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('E5: private/proposed data never reaches institutional users; explicit reviewed aggregate sharing does', async () => {
  const h = await harness();
  try {
    const response = await h.call('/wb/datasets', testDataset()); assert.equal(response.status, 201); const { record } = await response.json();
    assert.equal(record.approvalState, 'PROPOSED');
    const figure = defaultFigure(record, loadWorkbenchProfile());
    assert.equal((await h.call('/wb/figures', { spec: figure, favorite: true })).status, 409);
    h.principal('institution', ['law_enforcement']); assert.equal((await (await h.call('/wb/datasets')).json()).records.length, 0);
    assert.equal((await h.call('/wb/datasets', testDataset())).status, 403);
    h.principal('test-owner', ['researcher']);
    assert.equal((await h.call(`/wb/datasets/${record.id}/approve`, { expectedHash: '0'.repeat(64), shareAggregate: true })).status, 409);
    assert.equal((await h.call(`/wb/datasets/${record.id}/approve`, { expectedHash: record.contentHash, shareAggregate: true, actor: 'spoofed' })).status, 400);
    assert.equal((await h.call(`/wb/datasets/${record.id}/approve`, { expectedHash: record.contentHash, shareAggregate: true })).status, 200);
    h.principal('institution', ['law_enforcement']); const shared = await (await h.call('/wb/datasets')).json(); assert.equal(shared.records.length, 1);
    assert.equal(shared.records[0].approvedBy, 'test-owner');
    assert.equal((await h.call('/wb/figures', { spec: figure, favorite: true })).status, 201);
    h.principal('another-institution', ['institutional']); assert.equal((await (await h.call('/wb/figures')).json()).figures.length, 0);
    assert.equal((await h.call(`/wb/datasets/${record.id}/revoke`, {})).status, 403);
    h.principal('test-owner', ['researcher']); await h.call(`/wb/datasets/${record.id}/revoke`, {});
    h.principal('institution', ['law_enforcement']); assert.equal((await h.call('/wb/export', { figure, format: 'json' })).status, 409);
  } finally { await h.close(); }
});

test('E5: raw blobs deduplicate while imports and per-owner approval contexts remain separate', async () => {
  const h = await harness();
  try {
    const first = await h.repo.importDataset(testDataset(), 'test-owner', '1');
    const repeated = await h.repo.importDataset(testDataset(), 'test-owner', '2'); assert.equal(first.id, repeated.id);
    const second = await h.repo.importDataset(testDataset(), 'other-owner', '3'); assert.notEqual(first.id, second.id);
    assert.equal((h.db.prepare('SELECT count(*) n FROM raw_blobs').get() as any).n, 1);
    assert.equal((h.db.prepare('SELECT count(*) n FROM dataset_import_events').get() as any).n, 3);
    assert.equal(await h.repo.getDataset(first.id, 'other-owner', true), null);
  } finally { await h.close(); }
});

test('E5: exact figure settings, camera, extra dimensions and favourites persist across repository instances', async () => {
  const h = await harness();
  try {
    const record = await h.approved(), spec = defaultFigure(record, loadWorkbenchProfile()); spec.renderer = 'scatter3d';
    spec.channels = { ...spec.channels, x: 'interest', y: 'mentions', z: 'sentiment', time: 'date', color: 'language', alpha: 'sentiment', size: 'mentions', facet: 'region' };
    spec.style.opacity = 0.35; spec.camera.yaw = 90; spec.timeValue = '2026-09-01';
    const saved = await h.repo.saveFigure('test-owner', spec, true, 'test');
    const restarted = new WorkbenchRepository(h.db, h.repo.store);
    assert.deepEqual(restarted.figures('test-owner')[0].spec, spec); assert.equal(saved.hash, canonicalHash(spec));
    h.db.prepare("UPDATE figures SET spec_json=replace(spec_json,'0.35','0.45') WHERE id=?").run(saved.id);
    assert.throws(() => restarted.figures('test-owner'), /integrity/);
    assert.equal((await h.call('/wb/figures', { spec: { ...spec, renderer: 'unregistered-renderer' }, favorite: true })).status, 400);
  } finally { await h.close(); }
});

test('E5: approved statistical selection executes existing primitives, retains missingness, flags and reproducibility inputs', async () => {
  const h = await harness();
  try {
    const record = await h.approved(), figure = defaultFigure(record, loadWorkbenchProfile()); figure.channels.x = 'interest'; figure.channels.y = 'mentions';
    const prepared = await (await h.call('/wb/methods', { figure, method: 'pearson' })).json();
    assert.equal(prepared.method.approvalState, 'PROPOSED');
    assert.equal((await h.call(`/wb/methods/${prepared.method.id}/execute`, {})).status, 409);
    assert.equal((await h.call(`/wb/methods/${prepared.method.id}/approve`, { expectedHash: prepared.method.hash })).status, 200);
    const response = await h.call(`/wb/methods/${prepared.method.id}/execute`, {}); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.artifact.results[0].valueNumeric, 1);
    assert.equal(result.artifact.results[0].statisticMetadata.n, 4); assert.equal(result.inputs[0].values[4], null);
    assert.ok(result.artifact.qualityFlags.includes('PROVIDER_DISCONTINUITY')); assert.equal(result.traceId, response.headers.get('x-trace-id'));
    assert.equal((h.db.prepare('SELECT status FROM runs WHERE id=?').get(result.runId) as any).status, 'COMPLETED');
    assert.equal((h.db.prepare("SELECT count(*) n FROM run_steps WHERE run_id=? AND status='RUNNING'").get(result.runId) as any).n, 0);
    assert.equal((h.db.prepare('SELECT count(*) n FROM artifacts WHERE run_id=?').get(result.runId) as any).n, 1);
    const manifest = h.db.prepare('SELECT * FROM manifests WHERE run_id=?').get(result.runId) as any;
    const provenance = JSON.parse((await h.repo.store.get(manifest.object_uri)).toString());
    assert.equal(canonicalHash(provenance), manifest.sha256); assert.equal(provenance.outputs[0].sha256, result.hash);
    assert.equal(provenance.inputs.combinedHash, result.inputHash);
    assert.equal((h.db.prepare('SELECT value_numeric FROM analysis_results WHERE analysis_run_id=?').get(`analysis-${result.runId}`) as any).value_numeric, 1);
    const repeat = await h.service.execute('test-owner', prepared.method.id, 'repeat');
    assert.deepEqual(repeat.artifact, result.artifact); assert.equal(repeat.inputHash, result.inputHash);
    figure.analysis = { methodId: prepared.method.id, methodHash: prepared.method.hash, resultHash: result.hash };
    assert.equal((await h.call('/wb/figures', { spec: figure, favorite: true })).status, 201);
    assert.equal((await h.call('/wb/export', { figure, format: 'analysis' })).status, 200);
    const forged = structuredClone(figure); forged.analysis!.resultHash = '0'.repeat(64);
    assert.equal((await h.call('/wb/figures', { spec: forged, favorite: true })).status, 409);
    const stale = structuredClone(figure); stale.selectedIds = ['row-1', 'row-2'];
    assert.equal((await h.call('/wb/figures', { spec: stale, favorite: true })).status, 409);
    await h.repo.approveDataset(record.id, 'test-owner', record.contentHash, true, 'share');
    h.principal('institution', ['institutional']);
    assert.equal((await h.call('/wb/export', { figure, format: 'analysis' })).status, 409, 'shared aggregate access does not expose another actor result');
    h.principal('test-owner', ['researcher']);
    figure.style.palette = 'diverging'; const styled = await h.service.prepare('test-owner', figure, 'pearson', 'style'); assert.equal(styled.id, prepared.method.id);
    figure.selectedIds = ['row-1', 'row-2']; figure.analysis = null; const selected = await h.service.prepare('test-owner', figure, 'pearson', 'subset'); assert.notEqual(selected.id, prepared.method.id);
    assert.equal(selected.approvalState, 'PROPOSED');
    await h.repo.revokeDataset(record.id, 'test-owner', 'revoke');
    assert.equal((await h.call('/wb/export', { figure, format: 'analysis' })).status, 409);
  } finally { await h.close(); }
});

test('E5: provider/profile and data-shape validation preserves missingness and rejects silent context changes', async () => {
  const h = await harness();
  try {
    const doc = testDataset(); doc.providerProfileId = 'google-trends-export';
    assert.equal((await h.call('/wb/datasets', doc)).status, 400);
    doc.normalization = 'within_export_0_100'; assert.equal((await h.call('/wb/datasets', doc)).status, 201);
    const wrong = testDataset(); delete wrong.rows[4].missingReasons.interest; assert.throws(() => validateDataset(wrong), /reason/);
    const duplicate = testDataset(); duplicate.rows[1].id = duplicate.rows[0].id; assert.throws(() => validateDataset(duplicate), /unique/);
    const record = await h.approved(), figure = defaultFigure(record, loadWorkbenchProfile()); figure.channels.x = 'missing-column';
    assert.equal((await h.call('/wb/figures', { spec: figure, favorite: true })).status, 400);
  } finally { await h.close(); }
});

test('E5: CSV export retains signed numbers, selected rows, missing reasons, provenance and spreadsheet safety', async () => {
  const h = await harness();
  try {
    const record = await h.approved(), figure = defaultFigure(record, loadWorkbenchProfile());
    record.document.rows[0].values.region = '=HYPERLINK("https://example.org")';
    figure.selectedIds = ['row-1', 'row-5']; const csv = csvExport(record, figure);
    assert.match(csv, /'\=HYPERLINK/); assert.match(csv, /"-1"/); assert.ok(!csv.includes('row-2'));
    assert.match(csv, /Not reported by fictional source/); assert.ok(csv.includes(record.contentHash)); assert.match(csv, /RAW_OBSERVATIONAL/);
  } finally { await h.close(); }
});

test('E4/E5: diagnostics are developer-only, trace IDs are path-safe, mode changes are audited', async () => {
  const h = await harness(), previous = tracer.getMode();
  try {
    for (const role of ['researcher', 'responder', 'institutional', 'law_enforcement', 'admin']) {
      h.principal('test-owner', [role]); assert.equal((await h.call('/diag/state')).status, 403);
    }
    h.principal('test-owner', ['developer']); assert.equal((await h.call('/diag/state')).status, 200);
    assert.equal((await h.call('/diag/mode', { mode: 'ERRORS' })).status, 200);
    assert.equal((h.db.prepare("SELECT count(*) n FROM audit_events WHERE action='diagnostics.mode'").get() as any).n, 1);
    assert.equal((await h.call('/diag/traces/2026-09-09/unsafe-id')).status, 400);
  } finally { tracer.setMode(previous); await h.close(); }
});
