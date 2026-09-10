import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import express from 'express';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { WorkbenchRepository } from '../../backend/watchdog_api/db/repositories/workbench';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { WorkbenchService } from '../../backend/watchdog_api/workbench/service';
import { loadWorkbenchProfile } from '../../backend/watchdog_api/config/workbench';
import { buildWorkbenchRouter } from '../../backend/watchdog_api/api/workbench_routes';
import { traceMiddleware, errorHandler } from '../../backend/watchdog_api/api/middleware';
import { canonicalHash, canonicalizeJson } from '../../backend/watchdog_api/domain/canonical';
import { readZip } from '../../backend/watchdog_api/utils/zip';
import { testGeometry, regionDataset, regionFigure } from '../helpers/geography';

async function harness() {
  const directory = mkdtempSync(path.join(tmpdir(), 'watchdog-geography-')), db = new Database(':memory:');
  db.pragma('foreign_keys = ON'); runMigrations(db);
  const repo = new WorkbenchRepository(db, new LocalFileSystemStore(path.join(directory, 'store'))), profile = loadWorkbenchProfile();
  const service = new WorkbenchService(repo, profile);
  let actor = 'owner', roles = ['researcher'];
  const app = express(); app.use(express.json({ limit: '2mb' })); app.use(traceMiddleware);
  app.use((req, _res, next) => { req.principal = { id: actor, roles, email: null, identityProvenance: 'test' }; next(); });
  app.use(buildWorkbenchRouter(repo, service)); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const call = (route: string, body?: unknown) => fetch(`http://127.0.0.1:${(server.address() as any).port}${route}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { directory, db, repo, profile, call, principal: (id: string, nextRoles = ['researcher']) => { actor = id; roles = nextRoles; }, close: async () => {
    await new Promise<void>(r => server.close(() => r())); db.close(); rmSync(directory, { recursive: true, force: true });
  } };
}

test('E5 geography: source deduplication preserves separate ownership, explicit approval, sharing and WORM versions', async () => {
  const h = await harness();
  try {
    assert.deepEqual((await (await h.call('/geometry-layers')).json()).records, []);
    const source = testGeometry(), imported = await h.call('/geometry-layers', source); assert.equal(imported.status, 201);
    assert.ok(imported.headers.get('x-trace-id')); const first = (await imported.json()).record;
    assert.equal(first.approvalState, 'PROPOSED'); assert.equal(first.visibility, 'private');
    assert.equal((await (await h.call('/geometry-layers', source)).json()).record.id, first.id);
    h.principal('another'); const second = (await (await h.call('/geometry-layers', source)).json()).record; assert.notEqual(second.id, first.id);
    assert.equal((h.db.prepare('SELECT count(*) n FROM raw_blobs').get() as any).n, 1);
    assert.equal((h.db.prepare('SELECT count(*) n FROM geometry_import_events').get() as any).n, 3);
    assert.equal(await h.repo.geography.get(first.id, 'another', true), null);
    h.principal('institution', ['law_enforcement']); assert.equal((await h.call('/geometry-layers', source)).status, 403);
    assert.equal((await (await h.call('/geometry-layers')).json()).records.length, 0);
    h.principal('owner'); const approve = `/geometry-layers/${first.id}/approve`;
    assert.equal((await h.call(approve, { expectedHash: '0'.repeat(64), shareAggregate: true })).status, 409);
    assert.equal((await h.call(approve, { expectedHash: first.contentHash, shareAggregate: true, actor: 'spoof' })).status, 400);
    assert.equal((await h.call(approve, { expectedHash: first.contentHash, shareAggregate: true })).status, 200);
    h.principal('institution', ['law_enforcement']); const shared = await (await h.call('/geometry-layers')).json();
    assert.equal(shared.records.length, 1); assert.equal(shared.records[0].approvedBy, 'owner');
    assert.equal((await h.call(`/geometry-layers/${first.id}/revoke`, {})).status, 403);
    h.principal('another'); assert.equal((await h.call(approve, { expectedHash: first.contentHash, shareAggregate: false })).status, 403);
    h.principal('owner'); const changed = structuredClone(source); changed.source.sourceRecordId = 'geometry-2';
    const next = (await (await h.call('/geometry-layers', changed)).json()).record;
    assert.notEqual(next.id, first.id); assert.equal(next.approvalState, 'PROPOSED'); assert.equal((await h.repo.geography.get(first.id, 'owner'))?.approvalState, 'APPROVED');
    assert.throws(() => h.db.prepare('UPDATE geometry_layers SET content_hash=? WHERE id=?').run(next.contentHash, first.id), /WORM/);
    await h.call(`/geometry-layers/${first.id}/revoke`, {}); h.principal('institution', ['institutional']);
    assert.equal((await (await h.call('/geometry-layers')).json()).records.length, 0);
    assert.ok((h.db.prepare("SELECT count(*) n FROM audit_events WHERE action LIKE 'geometry.%'").get() as any).n >= 6);
  } finally { await h.close(); }
});

test('E5 geography: exact boundary pins survive restore/export, independent verification rejects false joins and revocation blocks reuse', async () => {
  const h = await harness();
  try {
    const raw = await h.repo.importDataset(regionDataset(), 'owner', 'test'), record = (await h.repo.approveDataset(raw.id, 'owner', raw.contentHash, true, 'test'))!;
    const rawLayer = await h.repo.geography.import(testGeometry(), 'owner', 'test');
    const figure = regionFigure(record, rawLayer, h.profile);
    assert.equal((await h.call('/figures', { spec: figure, favorite: true })).status, 409);
    const layer = (await h.repo.geography.approve(rawLayer.id, 'owner', rawLayer.contentHash, true, 'test'))!;
    const wrong = structuredClone(figure); wrong.geography!.layerHash = '1'.repeat(64);
    assert.equal((await h.call('/export', { figure: wrong, format: 'svg' })).status, 400);
    wrong.geography!.layerHash = layer.contentHash; wrong.geography!.mappings['source-E'] = 'unknown-feature';
    assert.equal((await h.call('/figures', { spec: wrong, favorite: true })).status, 400);
    figure.channels.facet = 'date'; figure.selectedIds = ['region-row-2'];
    const saved = await h.call('/figures', { spec: figure, favorite: true }); assert.equal(saved.status, 201);
    assert.deepEqual((await (await h.call('/figures')).json()).figures[0].spec, figure);
    const response = await h.call('/export', { figure, format: 'zip' }); assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer()), manifestHash = response.headers.get('x-package-manifest-sha256')!;
    assert.deepEqual(Buffer.from(await (await h.call('/export', { figure, format: 'zip' })).arrayBuffer()), bytes);
    const files = new Map(readZip(bytes).map(e => [e.name, e.content]));
    assert.deepEqual(JSON.parse(files.get('rendering/geometry.json')!.toString()), layer.document);
    assert.equal(files.get('rendering/source.geojson')!.toString(), layer.document.rawInput!.text);
    assert.equal(files.get('figure.svg')!.toString(), await (await h.call('/export', { figure, format: 'svg' })).text());
    const report = JSON.parse(files.get('rendering/region-join.json')!.toString());
    assert.deepEqual(report.panels.map((p: any) => p.regions.find((r: any) => r.featureId === 'C').value), [20, 30]);
    const restored = await (await h.call('/figures/restore', JSON.parse(files.get('workspace.json')!.toString()))).json();
    assert.deepEqual(restored.figure, figure); assert.equal(restored.geometry.contentHash, layer.contentHash);
    const exported = path.join(h.directory, 'package'); mkdirSync(exported);
    for (const [name, content] of files) { const filename = path.join(exported, name); mkdirSync(path.dirname(filename), { recursive: true }); writeFileSync(filename, content); }
    const verify = (hash: string) => spawnSync(process.execPath, [path.join(exported, 'verify.mjs'), exported, hash], { encoding: 'utf8', timeout: 10000 });
    const result = verify(manifestHash); assert.equal(result.status, 0, result.stderr);
    report.panels[0].regions[0].value = 999; const altered = Buffer.from(canonicalizeJson(report)); writeFileSync(path.join(exported, 'rendering/region-join.json'), altered);
    assert.match(verify(manifestHash).stderr, /File integrity mismatch/);
    const manifest = JSON.parse(files.get('package-manifest.json')!.toString()), item = manifest.files.find((f: any) => f.path === 'rendering/region-join.json');
    item.bytes = altered.length; item.sha256 = createHash('sha256').update(altered).digest('hex'); writeFileSync(path.join(exported, 'package-manifest.json'), canonicalizeJson(manifest));
    assert.match(verify(canonicalHash(manifest)).stderr, /Region join report does not match/, 'rehashed false joins still fail independent source verification');
    h.principal('institution', ['law_enforcement']); assert.equal((await h.call('/export', { figure, format: 'svg' })).status, 200);
    h.principal('owner'); await h.repo.geography.revoke(layer.id, 'owner', 'test');
    for (const format of ['json', 'svg', 'zip']) assert.equal((await h.call('/export', { figure, format })).status, 409);
    assert.equal((await h.call('/figures/restore', { figure, profile: h.profile })).status, 409);
    h.principal('institution', ['law_enforcement']); assert.equal((await h.call('/export', { figure, format: 'svg' })).status, 409);
  } finally { await h.close(); }
});

test('E5 geography: access is checked again after source storage I/O', async () => {
  const h = await harness();
  try {
    const layer = await h.repo.geography.import(testGeometry(), 'owner', 'test'); await h.repo.geography.approve(layer.id, 'owner', layer.contentHash, true, 'test');
    const get = h.repo.store.get.bind(h.repo.store);
    h.repo.store.get = async uri => { const bytes = await get(uri); h.db.prepare("UPDATE geometry_layers SET visibility='private' WHERE id=?").run(layer.id); return bytes; };
    assert.equal(await h.repo.geography.get(layer.id, 'institution'), null);
  } finally { await h.close(); }
});
