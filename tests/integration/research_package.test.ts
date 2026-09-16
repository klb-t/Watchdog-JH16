import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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
import { errorHandler } from '../../backend/watchdog_api/api/middleware';
import { defaultFigure } from '../../shared/workbench';
import { canonicalHash, canonicalizeJson } from '../../backend/watchdog_api/domain/canonical';
import { TypeScriptMethodExecutor } from '../../backend/watchdog_api/analysis/executor';
import { readZip } from '../../backend/watchdog_api/utils/zip';
import { testDataset } from '../helpers/workbench';

async function harness() {
  const directory = mkdtempSync(path.join(tmpdir(), 'watchdog-research-')), db = new Database(':memory:');
  db.pragma('foreign_keys = ON'); runMigrations(db);
  const repo = new WorkbenchRepository(db, new LocalFileSystemStore(path.join(directory, 'store')));
  const oldProfile = loadWorkbenchProfile(), original = new WorkbenchService(repo, oldProfile);
  const nextProfile = structuredClone(oldProfile); nextProfile.version = 'later-profile'; nextProfile.palettes[0].colors[0] = '#123456';
  const { contentHash: _, ...nextDocument } = nextProfile; nextProfile.contentHash = canonicalHash(nextDocument);
  const current = new WorkbenchService(repo, nextProfile);
  let actor = 'researcher';
  const app = express(); app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { req.principal = { id: actor, roles: ['researcher'], email: null, identityProvenance: 'test' }; next(); });
  app.use(buildWorkbenchRouter(repo, current)); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = (route: string, body?: unknown) => fetch(base + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { directory, db, repo, original, current, call, principal: (id: string) => { actor = id; }, close: async () => {
    await new Promise<void>(r => server.close(() => r())); db.close(); rmSync(directory, { recursive: true, force: true });
  } };
}

test('E5 publication: historical profiles restore, archives are deterministic, independently verifiable and reproducible', async () => {
  const h = await harness();
  try {
    const doc = testDataset(); doc.rawInput = { text: 'interest,mentions\r\n10,2\r\n', mediaType: 'text/csv', separator: ',', headerRecord: 1 };
    const imported = await h.repo.importDataset(doc, 'researcher', 'test');
    const record = (await h.repo.approveDataset(imported.id, 'researcher', imported.contentHash, true, 'test'))!;
    const figure = defaultFigure(record, h.original.profile); figure.channels.x = 'interest'; figure.channels.y = 'mentions';
    const method = await h.original.prepare('researcher', figure, 'pearson', 'test');
    h.repo.approveMethod(method.id, 'researcher', method.hash, 'test');
    const result = await h.current.execute('researcher', method.id, 'test');
    assert.equal(result.profile.contentHash, h.original.profile.contentHash, 'execution preserves the pinned profile across a config update');
    figure.analysis = { methodId: method.id, methodHash: method.hash, resultHash: result.hash };
    assert.equal((await h.call('/figures', { spec: figure, favorite: true })).status, 201);
    assert.equal((await (await h.call('/profile')).json()).contentHash, h.current.profile.contentHash);
    assert.deepEqual(await (await h.call(`/profiles/${figure.profileHash}`)).json(), h.original.profile);
    assert.throws(() => h.db.prepare('UPDATE workbench_profiles SET profile_json=? WHERE content_hash=?').run('{}', figure.profileHash), /WORM/);
    assert.throws(() => h.db.prepare('DELETE FROM workbench_profiles WHERE content_hash=?').run(figure.profileHash), /WORM/);
    const response = await h.call('/export', { figure, format: 'zip' }); assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer()), manifestHash = response.headers.get('x-package-manifest-sha256')!;
    assert.equal(createHash('sha256').update(bytes).digest('hex'), response.headers.get('x-package-sha256'));
    assert.deepEqual(Buffer.from(await (await h.call('/export', { figure, format: 'zip' })).arrayBuffer()), bytes);
    const entries = readZip(bytes), files = new Map(entries.map(e => [e.name, e.content]));
    const exported = path.join(h.directory, 'package'); mkdirSync(exported);
    for (const entry of entries) { const filename = path.join(exported, entry.name); mkdirSync(path.dirname(filename), { recursive: true }); writeFileSync(filename, entry.content); }
    const verify = (hash = manifestHash) => spawnSync(process.execPath, [path.join(exported, 'verify.mjs'), exported, hash], { encoding: 'utf8', timeout: 10000 });
    const verified = verify(); assert.equal(verified.status, 0, verified.stderr); assert.match(verified.stdout, /Matches the independently supplied/);
    assert.equal(verify('0'.repeat(64)).status, 1, 'an unrelated manifest cannot be used as an integrity anchor');
    assert.equal(files.get('source.csv')!.toString(), doc.rawInput.text);
    assert.equal(files.get('figure.svg')!.toString(), await (await h.call('/export', { figure, format: 'svg' })).text(), 'standalone SVG and package share the exact renderer');
    assert.ok(files.get('figure.svg')!.toString().includes(h.original.profile.palettes[0].colors[0]));
    assert.deepEqual(JSON.parse(files.get('profile.json')!.toString()), h.original.profile);
    const manifest = JSON.parse(files.get('package-manifest.json')!.toString()); assert.equal(canonicalHash(manifest), manifestHash);
    const restored = await h.call('/figures/restore', JSON.parse(files.get('workspace.json')!.toString())); assert.equal(restored.status, 200);
    assert.deepEqual((await restored.json()).figure, figure);
    const archivedResult = JSON.parse(files.get('analysis/result.json')!.toString()), execution = JSON.parse(files.get('analysis/manifest.json')!.toString());
    const replay = await new TypeScriptMethodExecutor().execute(archivedResult.methodSpec, archivedResult.inputs, { approvable: {
      id: archivedResult.methodId, kind: 'method_spec', content: archivedResult.methodSpec, approvedHash: execution.method.approvedHash, approvedBy: execution.method.approvedBy, approvedAt: execution.method.approvedAt,
    } });
    assert.deepEqual(replay, archivedResult.artifact, 'archived inputs actually reproduce the original deterministic result');
    // The independent script must fail on a changed source value, before any result is trusted.
    const dataPath = path.join(exported, 'dataset.json'), before = readFileSync(dataPath); writeFileSync(dataPath, before.toString().replace('"interest":10', '"interest":11'));
    const tampered = verify(); assert.equal(tampered.status, 1); assert.match(tampered.stderr, /dataset.json/); writeFileSync(dataPath, before);
    // Even an internally rehashed file must still agree with linked source identities.
    const wrongFigure = structuredClone(figure); wrongFigure.datasetHash = 'f'.repeat(64);
    const changedBytes = Buffer.from(canonicalizeJson(wrongFigure)); writeFileSync(path.join(exported, 'figure.json'), changedBytes);
    const item = manifest.files.find((f: any) => f.path === 'figure.json'); item.bytes = changedBytes.length; item.sha256 = createHash('sha256').update(changedBytes).digest('hex');
    writeFileSync(path.join(exported, 'package-manifest.json'), canonicalizeJson(manifest)); assert.equal(verify(canonicalHash(manifest)).status, 1);
    h.principal('other-researcher');
    assert.equal((await h.call('/export', { figure, format: 'zip' })).status, 409, 'shared dataset access does not expose a private result');
    assert.equal((await h.call('/figures/restore', { figure, profile: h.original.profile })).status, 409);
    const sharedFigure = { ...figure, analysis: null }; assert.equal((await h.call('/export', { figure: sharedFigure, format: 'zip' })).status, 200);
    await h.repo.revokeDataset(record.id, 'researcher', 'test'); h.principal('researcher');
    assert.equal((await h.call('/export', { figure, format: 'zip' })).status, 409);
    assert.equal((await h.call('/figures/restore', { figure, profile: h.original.profile })).status, 409, 'an exported receipt never reapproves revoked data');
  } finally { await h.close(); }
});

test('E5 publication: absent profiles can be restored only with a matching, executable snapshot and accessible data', async () => {
  const h = await harness();
  try {
    const imported = await h.repo.importDataset(testDataset(), 'researcher', 'test');
    const record = (await h.repo.approveDataset(imported.id, 'researcher', imported.contentHash, false, 'test'))!;
    const profile = structuredClone(h.original.profile); profile.version = 'portable-historical-profile';
    const { contentHash, ...document } = profile; profile.contentHash = canonicalHash(document);
    const figure = defaultFigure(record, profile); figure.renderer = 'map';
    assert.equal((await h.call('/export', { figure, format: 'svg' })).status, 409);
    assert.equal((await h.call('/figures/restore', { figure, profile: { ...profile, version: 'tampered' } })).status, 400);
    assert.equal((await h.call('/figures/restore', { figure, profile })).status, 200);
    const bytes = Buffer.from(await (await h.call('/export', { figure, format: 'zip' })).arrayBuffer());
    assert.ok(readZip(bytes).some(e => e.name === 'rendering/basemap.json'));
    const unsupported = structuredClone(profile); unsupported.renderers.push({ id: 'not-implemented', label: 'Future renderer', dimensions: 3, description: 'Unavailable' });
    const { contentHash: ignored, ...unsupportedDoc } = unsupported; unsupported.contentHash = canonicalHash(unsupportedDoc);
    assert.equal((await h.call('/figures/restore', { figure: { ...figure, profileHash: unsupported.contentHash, renderer: 'not-implemented' }, profile: unsupported })).status, 400);
    assert.equal(h.repo.getProfile(unsupported.contentHash), null, 'unrenderable profile does not enter the archive through figure import');
    figure.channels.facet = 'region';
    const many = testDataset(); many.rows = Array.from({ length: 13 }, (_, i) => ({ ...structuredClone(many.rows[0]), id: `row-${i}`, values: { ...many.rows[0].values, region: `Region ${i}` } }));
    const raw = await h.repo.importDataset(many, 'researcher', 'test'); const approved = (await h.repo.approveDataset(raw.id, 'researcher', raw.contentHash, false, 'test'))!;
    const panels = defaultFigure(approved, h.current.profile); panels.channels.facet = 'region';
    assert.equal((await h.call('/export', { figure: panels, format: 'zip' })).status, 400, 'a truncated preview cannot masquerade as a complete publication figure');
    assert.equal((await h.call('/export', { figure: panels, format: 'json' })).status, 200);
  } finally { await h.close(); }
});
