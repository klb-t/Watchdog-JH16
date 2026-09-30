import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import express from 'express';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { ResearchProjectsRepository } from '../../backend/watchdog_api/db/repositories/research_projects';
import { ResearchProjectsService } from '../../backend/watchdog_api/services/research_projects';
import { ResearchRepository } from '../../backend/watchdog_api/db/repositories/research';
import { WorkbenchRepository } from '../../backend/watchdog_api/db/repositories/workbench';
import { WorkbenchService } from '../../backend/watchdog_api/workbench/service';
import { loadWorkbenchProfile } from '../../backend/watchdog_api/config/workbench';
import { AutomationRepository } from '../../backend/watchdog_api/db/repositories/automation';
import { loadAutomationProfile } from '../../backend/watchdog_api/config/automation';
import { PrincipalRepository } from '../../backend/watchdog_api/db/repositories/principals';
import { LocalFileSystemStore, type ObjectStore } from '../../backend/watchdog_api/storage/object_store';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';
import { buildResearchProjectsRouter } from '../../backend/watchdog_api/api/research_project_routes';
import { buildWorkbenchRouter } from '../../backend/watchdog_api/api/workbench_routes';
import { errorHandler } from '../../backend/watchdog_api/api/middleware';
import { readZip } from '../../backend/watchdog_api/utils/zip';
import { defaultFigure } from '../../shared/workbench';
import type { ProjectDraft, ProjectResourceKind } from '../../shared/research_projects';
import { testDataset } from '../helpers/workbench';

const draft = (changes: Partial<ProjectDraft> = {}): ProjectDraft => ({ name: 'Fictional software research task', question: 'Can this fixture preserve exact provenance?',
  purpose: 'Synthetic software fixture, not empirical research.', state: 'DRAFT', meaning: 'unspecified', links: [], ...changes });
function harness() {
  const dir = mkdtempSync(path.join(tmpdir(), 'watchdog-projects-')), dbPath = path.join(dir, 'db.sqlite'), db = new Database(dbPath);
  db.pragma('foreign_keys=ON'); runMigrations(db);
  const store = new LocalFileSystemStore(path.join(dir, 'store')), repo = new ResearchProjectsRepository(db), service = new ResearchProjectsService(repo, store), owner = 'local-user';
  const research = new ResearchRepository(db), workbench = new WorkbenchRepository(db, store), analysis = new WorkbenchService(workbench, loadWorkbenchProfile());
  const automation = new AutomationRepository(db, store), profile = loadAutomationProfile(); automation.archiveProfile(profile);
  const principals = new PrincipalRepository(db); principals.upsertOnSignIn({ id: owner, email: null, displayName: null, role: 'developer', identityProvenance: 'test', at: new Date().toISOString() });
  const link = (kind: ProjectResourceKind, id: string) => ({ kind, id, expectedHash: repo.resource(owner, kind, id)!.summary.hash, role: `Fixture ${kind}`, notes: 'Explicit source role and limitations.' });
  return { dir, dbPath, db, store, repo, service, research, workbench, analysis, automation, profile, owner, principals, link,
    close: () => { if (db.open) db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('research projects preserve immutable revision lineage, actual WORM triggers and owner isolation', async () => {
  const h = harness(); try {
    const first = await h.service.save(h.owner, draft());
    const second = await h.service.save(h.owner, draft({ question: 'An explicitly changed question', state: 'ACTIVE', meaning: 'reanalysis' }), first.body.projectId, first.hash);
    assert.equal(second.body.revision, 2); assert.equal(second.body.previousRevisionHash, first.hash);
    assert.equal(h.repo.history(h.owner, first.body.projectId)[1].body.question, first.body.question);
    await assert.rejects(() => h.service.save(h.owner, draft(), first.body.projectId, first.hash), /changed/);
    assert.equal(h.repo.current('other-owner', first.body.projectId), null); assert.equal(h.repo.revision('other-owner', first.body.projectId, first.hash), null);
    assert.deepEqual(h.repo.list('other-owner').projects, []); assert.throws(() => h.repo.history('other-owner', first.body.projectId), /not found/);
    await assert.rejects(() => h.service.save('other-owner', draft(), first.body.projectId, second.hash), /not found/);
    assert.throws(() => h.db.prepare('UPDATE research_project_revisions SET body_json=? WHERE id=?').run('{}', first.id), /WORM/);
    assert.throws(() => h.db.prepare('DELETE FROM research_project_revisions WHERE id=?').run(first.id), /WORM/);
    assert.equal(canonicalHash(second.body), second.hash);
  } finally { h.close(); }
});

test('projects pin exact owned paper, data, method, run, figure and job provenance; schedules remain explicit live pointers', async () => {
  const h = harness(); try {
    const paper = h.research.saveDocument(h.owner, { title: 'Fictional test protocol', source: 'fixture:project', text: 'Software test methodology.', coverage: 'excerpt', language: null, geography: [] });
    const assessmentId = h.research.claimAssessment(h.owner, paper.id, 'a'.repeat(64))!;
    h.research.finishAssessment(h.owner, assessmentId, { fixture: true, documentHash: paper.hash, executionEnabled: false }, 'PROPOSED');
    const imported = await h.workbench.importDataset(testDataset(), h.owner, 'test');
    const data = (await h.workbench.approveDataset(imported.id, h.owner, imported.contentHash, false, 'test'))!;
    const figure = defaultFigure(data, h.analysis.profile); figure.channels.x = 'interest'; figure.channels.y = 'mentions';
    const method = await h.analysis.prepare(h.owner, figure, 'pearson', 'test'); h.workbench.approveMethod(method.id, h.owner, method.hash, 'test');
    const result = await h.analysis.execute(h.owner, method.id, 'test');
    const saved = await h.workbench.saveFigure(h.owner, figure, true, 'test');
    const schedule = h.automation.saveSchedule(h.owner, { name: 'Fixture daily review', recurrence: { kind: 'daily_utc', hour: 8, minute: 0 }, enabled: true,
      request: h.profile.defaults.paperJob }, h.profile.contentHash);
    const job = h.automation.enqueue(h.owner, h.profile.defaults.paperJob, h.profile.contentHash);
    const claimed = h.automation.claim(new Date(), 60000)!; h.automation.finish(job.id, claimed.token, 'SUCCEEDED', { fixture: true, discovered: 0 });
    const links = [h.link('schedule', schedule.id), h.link('paper', paper.id), h.link('assessment', assessmentId), h.link('dataset', data.id),
      h.link('method', method.id), h.link('run', result.runId), h.link('figure', saved.id), h.link('job', job.id)];
    const revision = await h.service.save(h.owner, draft({ links, meaning: 'simulation' }));
    assert.equal(revision.body.links.length, 8); assert.equal(revision.body.meaning, 'simulation');
    const pinned = revision.body.links.find(l => l.kind === 'schedule')!;
    assert.equal(pinned.binding, 'live_schedule_pointer'); assert.equal((pinned.snapshot.definition as any).enabled, true);
    assert.ok(revision.body.links.every(l => l.expectedHash === h.repo.resource(h.owner, l.kind, l.id)!.summary.hash));
    const paperSnapshot = revision.body.links.find(l => l.kind === 'paper')!;
    assert.equal((paperSnapshot.snapshot.body as any).text, paper.body.text);
    h.automation.saveSchedule(h.owner, { name: schedule.name, recurrence: schedule.recurrence, request: schedule.request, enabled: false }, h.profile.contentHash, new Date(), schedule.id, schedule.contentHash);
    assert.equal(h.service.get(h.owner, revision.body.projectId).statuses.find(s => s.kind === 'schedule')!.status, 'CHANGED');
    h.automation.enqueue(h.owner, h.profile.defaults.paperJob, h.profile.contentHash);
    assert.equal(h.repo.current(h.owner, revision.body.projectId)!.body.links.length, 8, 'future occurrences are not implicitly appended');
    h.db.prepare('UPDATE method_specs SET owner_principal_id=? WHERE id=?').run('shared-benchmark-owner', method.id);
    assert.equal(h.repo.resource(h.owner, 'method', method.id), null);
    const runOnly = await h.service.save(h.owner, draft({ links: [h.link('run', result.runId)] }));
    assert.equal(runOnly.body.links[0].expectedHash, revision.body.links.find(l => l.kind === 'run')!.expectedHash,
      'an owned finalized run remains linkable when its benchmark method belongs to another principal; its owned manifest is the authority');
  } finally { h.close(); }
});

test('schedule effective pause and reviewed data revocation are visible without rewriting pinned definitions or historical bytes', async () => {
  const h = harness(); try {
    const scheduleInput = { name: 'Fixture interval', recurrence: { kind: 'interval', minutes: 60 }, enabled: true, request: h.profile.defaults.paperJob };
    const schedule = h.automation.saveSchedule(h.owner, scheduleInput, h.profile.contentHash);
    const data = await h.workbench.importDataset(testDataset(), h.owner, 'test'); await h.workbench.approveDataset(data.id, h.owner, data.contentHash, false, 'test');
    const first = await h.service.save(h.owner, draft({ links: [h.link('schedule', schedule.id), h.link('dataset', data.id)] }));
    const archiveBefore = await h.service.export(h.owner, first.body.projectId, first.hash);
    // The worker may pause a schedule without editing its reviewed settings definition.
    h.db.prepare('UPDATE automation_schedules SET enabled=0 WHERE id=?').run(schedule.id);
    await h.workbench.revokeDataset(data.id, h.owner, 'test');
    const live = h.service.get(h.owner, first.body.projectId);
    assert.equal(live.statuses.find(s => s.kind === 'schedule')!.currentHash, schedule.contentHash);
    assert.equal(live.statuses.find(s => s.kind === 'schedule')!.status, 'CHANGED');
    assert.equal(live.statuses.find(s => s.kind === 'dataset')!.status, 'CHANGED');
    assert.equal((live.revision.body.links.find(l => l.kind === 'schedule')!.snapshot.definition as any).enabled, true);
    assert.deepEqual((await h.service.export(h.owner, first.body.projectId, first.hash)).bytes, archiveBefore.bytes);
    await h.service.save(h.owner, draft({ links: [h.link('schedule', schedule.id), h.link('dataset', data.id)] }), first.body.projectId, first.hash);
    const changed = h.automation.saveSchedule(h.owner, { ...scheduleInput, enabled: false }, h.profile.contentHash, new Date(), schedule.id, schedule.contentHash);
    assert.notEqual(changed.contentHash, schedule.contentHash);
    assert.equal(h.service.get(h.owner, first.body.projectId).statuses.find(s => s.kind === 'schedule')!.status, 'CHANGED');
  } finally { h.close(); }
});

test('project archives survive process restart, verify independently and reject file or manifest tampering', async () => {
  const h = harness(); let restarted: InstanceType<typeof Database> | undefined; try {
    const data = await h.workbench.importDataset(testDataset(), h.owner, 'test');
    h.db.exec('CREATE TABLE private_credential_canary(value TEXT NOT NULL)');
    h.db.prepare('INSERT INTO private_credential_canary VALUES (?)').run('DO_NOT_EXPORT_PRIVATE_CREDENTIAL_3845729');
    const first = await h.service.save(h.owner, draft({ links: [h.link('dataset', data.id)] }));
    const before = await h.service.export(h.owner, first.body.projectId, first.hash);
    h.db.close(); restarted = new Database(h.dbPath); restarted.pragma('foreign_keys=ON'); runMigrations(restarted);
    const restored = new ResearchProjectsService(new ResearchProjectsRepository(restarted), h.store);
    const after = await restored.export(h.owner, first.body.projectId, first.hash);
    assert.deepEqual(after.bytes, before.bytes); assert.equal(after.manifestHash, before.manifestHash);
    const entries = readZip(after.bytes), root = path.join(h.dir, 'export'); mkdirSync(root);
    assert.ok(!after.bytes.toString().includes('DO_NOT_EXPORT_PRIVATE_CREDENTIAL_3845729'));
    for (const e of entries) { const filename = path.join(root, e.name); mkdirSync(path.dirname(filename), { recursive: true }); writeFileSync(filename, e.content); }
    const verify = (hash = after.manifestHash) => spawnSync(process.execPath, [path.join(root, 'verify.mjs'), root, hash], { encoding: 'utf8', timeout: 10000 });
    assert.equal(verify().status, 0, verify().stderr); assert.match(verify().stdout, /independently supplied/);
    assert.equal(verify('0'.repeat(64)).status, 1);
    const raw = path.join(root, `objects/${data.contentHash}`), old = readFileSync(raw); writeFileSync(raw, Buffer.from('changed source bytes'));
    assert.equal(verify().status, 1); writeFileSync(raw, old);
    const metadata = path.join(root, 'revision.json'), oldMeta = readFileSync(metadata); writeFileSync(metadata, oldMeta.toString().replace('Software fixture', 'Altered fixture'));
    // Change a field guaranteed to exist rather than relying on the text of the fixture.
    const changed = JSON.parse(oldMeta.toString()); changed.meaning = 'faithful'; writeFileSync(metadata, JSON.stringify(changed)); assert.equal(verify().status, 1);
    assert.equal(createHash('sha256').update(after.bytes).digest('hex'), after.sha256);
    assert.throws(() => restarted!.prepare('UPDATE research_project_files SET object_uri=?').run('secret://fake'), /WORM/);
  } finally { restarted?.close(); h.close(); }
});

test('owner migration preserves revision hashes and archived bytes; no other owner or shared dataset is imported implicitly', async () => {
  const h = harness(); try {
    const paper = h.research.saveDocument(h.owner, { title: 'Fixture migration', source: 'fixture:test', text: 'Exact private source.', coverage: 'excerpt', language: null, geography: [] });
    const data = await h.workbench.importDataset(testDataset(), h.owner, 'test');
    const first = await h.service.save(h.owner, draft({ links: [h.link('paper', paper.id), h.link('dataset', data.id)] }));
    const before = await h.service.export(h.owner, first.body.projectId, first.hash);
    h.principals.upsertOnSignIn({ id: 'real-owner', email: null, displayName: null, role: 'researcher', identityProvenance: 'test', at: new Date().toISOString() });
    h.principals.migrateLocalUserRows('real-owner');
    assert.equal(h.repo.current(h.owner, first.body.projectId), null); assert.equal(h.repo.current('real-owner', first.body.projectId)!.hash, first.hash);
    assert.deepEqual((await h.service.export('real-owner', first.body.projectId, first.hash)).bytes, before.bytes);
    await assert.rejects(() => h.service.export(h.owner, first.body.projectId, first.hash), /not found/);
    await h.workbench.approveDataset(data.id, 'real-owner', data.contentHash, true, 'test');
    assert.equal(h.repo.resource('other-owner', 'dataset', data.id), null, 'shared aggregate access is not ownership');
    await assert.rejects(() => h.service.save('other-owner', draft({ links: [{ kind: 'dataset', id: data.id, expectedHash: data.contentHash, role: 'Guess', notes: '' }] })), /not found/);
  } finally { h.close(); }
});

test('ownership changes during asynchronous save/export win; changed source bytes never become a pinned archive', async () => {
  const h = harness(); try {
    const data = await h.workbench.importDataset(testDataset(), h.owner, 'test'), input = draft({ links: [h.link('dataset', data.id)] });
    let once = false;
    const transferStore: ObjectStore = { put: (...args) => h.store.put(...args), get: async uri => {
      const bytes = await h.store.get(uri); if (!once) { once = true; h.db.prepare('UPDATE datasets SET owner_principal_id=? WHERE id=?').run('other-owner', data.id); } return bytes;
    } };
    await assert.rejects(() => new ResearchProjectsService(h.repo, transferStore).save(h.owner, input), /linked resource changed/i);
    assert.equal(h.repo.list(h.owner).total, 0);
    h.db.prepare('UPDATE datasets SET owner_principal_id=? WHERE id=?').run(h.owner, data.id);
    const corrupted: ObjectStore = { put: (...args) => h.store.put(...args), get: async _uri => Buffer.from('tampered') };
    await assert.rejects(() => new ResearchProjectsService(h.repo, corrupted).save(h.owner, input), /recorded hash/);
    const revision = await h.service.save(h.owner, input);
    const exportStore: ObjectStore = { put: (...args) => h.store.put(...args), get: async uri => {
      const bytes = await h.store.get(uri); h.db.prepare('UPDATE research_projects SET owner_principal_id=? WHERE id=?').run('other-owner', revision.body.projectId); return bytes;
    } };
    await assert.rejects(() => new ResearchProjectsService(h.repo, exportStore).export(h.owner, revision.body.projectId, revision.hash), /ownership changed/);
    await assert.rejects(() => h.service.save(h.owner, draft({ links: [{ ...input.links[0], expectedHash: '0'.repeat(64) }] })), /hash changed/);
  } finally { h.close(); }
});

test('project API enforces profile, CSRF origin, pagination, hash-pinned revision export and current owner checks', async () => {
  const h = harness(); let server: ReturnType<express.Express['listen']> | undefined; try {
    let owner = h.owner, roles = ['researcher']; const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.principal = { id: owner, roles, email: null, identityProvenance: 'test' }; next(); });
    app.use('/api/projects', buildResearchProjectsRouter(h.service)); app.use('/api/workbench', buildWorkbenchRouter(h.workbench, h.analysis)); app.use(errorHandler);
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`, call = (url: string, body?: unknown, headers: Record<string, string> = {}) => fetch(base + url,
      body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await call('/api/projects', draft(), { Origin: 'https://foreign.example' })).status, 403);
    const created = await call('/api/projects', draft()); assert.equal(created.status, 201); const { revision } = await created.json();
    const index = await call('/api/projects?limit=1&offset=0'); assert.equal(index.headers.get('Cache-Control'), 'no-store'); assert.equal((await index.json()).total, 1);
    assert.equal((await call('/api/projects?limit=0')).status, 400);
    assert.equal((await call(`/api/projects/${revision.body.projectId}/export`)).status, 400, 'export pins a revision hash');
    const exported = await call(`/api/projects/${revision.body.projectId}/export?revision=${revision.hash}`); assert.equal(exported.status, 200);
    assert.match(exported.headers.get('Content-Type')!, /application\/zip/); assert.ok(exported.headers.get('X-Package-Manifest-SHA256'));
    assert.equal((await call(`/api/projects/${revision.body.projectId}/revisions`, { expectedHash: '0'.repeat(64), draft: draft() })).status, 409);
    owner = 'other-owner'; assert.equal((await call(`/api/projects/${revision.body.projectId}`)).status, 404);
    assert.equal((await call(`/api/projects/${revision.body.projectId}/history`)).status, 404);
    assert.equal((await call(`/api/projects/${revision.body.projectId}/export?revision=${revision.hash}`)).status, 404);
    roles = ['responder']; assert.equal((await call('/api/projects')).status, 403); assert.equal((await call('/api/projects/resources?kind=paper')).status, 403);
    roles = ['researcher']; assert.equal((await call('/api/projects/resources?kind=principals')).status, 400);
    const imported = await h.workbench.importDataset(testDataset(), h.owner, 'test'); await h.workbench.approveDataset(imported.id, h.owner, imported.contentHash, true, 'test');
    const data = (await h.workbench.getDataset(imported.id, h.owner))!, figure = defaultFigure(data, h.analysis.profile); figure.channels.y = 'interest';
    const method = await h.analysis.prepare(h.owner, figure, 'describe', 'test');
    assert.equal((await call(`/api/workbench/methods/${method.id}`)).status, 404, 'shared source does not grant another owner method access');
    owner = h.owner; assert.equal((await call(`/api/workbench/methods/${method.id}`)).status, 200);
    const generic = { ...method.spec, name: 'Exact separate generic fixture method' }, genericHash = canonicalHash(generic), genericId = 'generic-fixture-method';
    h.db.prepare('INSERT INTO method_specs(id,name,version,spec_json,spec_hash,owner_principal_id,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(genericId, generic.name, generic.specVersion, JSON.stringify(generic), genericHash, h.owner, new Date().toISOString());
    const exact = await (await call(`/api/projects/resources/method/${genericId}`)).json();
    assert.equal(exact.resource.id, genericId); assert.equal(exact.resource.hash, genericHash);
    assert.match(exact.resource.href, /resourceId=generic-fixture-method/); assert.equal(exact.resource.snapshot.spec.name, generic.name);
    owner = 'other-owner'; assert.equal((await call(`/api/projects/resources/method/${genericId}`)).status, 404);
  } finally { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); h.close(); }
});

test('archive limit covers Unicode metadata, source bytes, verifier, manifest and ZIP overhead before persistence', async () => {
  const h = harness(); try {
    const paper = h.research.saveDocument(h.owner, { title: 'Unicode fixture', source: 'fixture:size', text: '🧪'.repeat(5000), coverage: 'excerpt', language: null, geography: [] });
    h.service.profile.maxArchiveBytes = 20000;
    await assert.rejects(() => h.service.save(h.owner, draft({ links: [h.link('paper', paper.id)] })), /metadata and source files exceed/);
    assert.equal(h.repo.list(h.owner).total, 0);
    h.service.profile.maxArchiveBytes = 100000;
    const first = await h.service.save(h.owner, draft({ links: [h.link('paper', paper.id)] }));
    const archived = await h.service.export(h.owner, first.body.projectId, first.hash);
    h.service.profile.maxArchiveBytes = archived.bytes.length;
    assert.equal((await h.service.export(h.owner, first.body.projectId, first.hash)).bytes.length, archived.bytes.length, 'exact configured ZIP byte limit is accepted');
    h.service.profile.maxArchiveBytes -= 1;
    await assert.rejects(() => h.service.export(h.owner, first.body.projectId, first.hash), /configured size limit/);
  } finally { h.close(); }
});
