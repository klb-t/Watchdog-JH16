import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { FieldReferenceRepository } from '../../backend/watchdog_api/db/repositories/field_reference';
import { WorkbenchRepository } from '../../backend/watchdog_api/db/repositories/workbench';
import { ResearchRepository } from '../../backend/watchdog_api/db/repositories/research';
import { AutomationRepository } from '../../backend/watchdog_api/db/repositories/automation';
import { SearchRepository } from '../../backend/watchdog_api/db/repositories/search';
import { buildSearchRouter } from '../../backend/watchdog_api/api/search_routes';
import { loadSearchProfile } from '../../backend/watchdog_api/config/search';
import { loadAutomationProfile } from '../../backend/watchdog_api/config/automation';
import { errorHandler } from '../../backend/watchdog_api/api/middleware';
import { approve } from '../../backend/watchdog_api/domain/approval';
import { testSample, testAssertion } from '../helpers/field';
import { testDataset } from '../helpers/workbench';
import type { Principal } from '../../backend/watchdog_api/domain/principal';
import type { SearchResponse } from '../../shared/search';
import { sourceSnapshot } from '../fixtures/source_history';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';

async function harness(profile = loadSearchProfile()) {
  const dir = mkdtempSync(path.join(tmpdir(), 'watchdog-search-')), db = new Database(':memory:');
  db.pragma('foreign_keys = ON'); runMigrations(db);
  const store = new LocalFileSystemStore(dir), field = new FieldReferenceRepository(db, store), datasets = new WorkbenchRepository(db, store), research = new ResearchRepository(db), automation = new AutomationRepository(db, store);
  field.registerRegions([{ id: 'NL', name: 'Netherlands', parentId: null }]);
  let principal: Principal | null = { id: 'owner-a', email: null, roles: ['developer'], identityProvenance: 'fictional-test' };
  const app = express(); app.use((req, _res, next) => { req.principal = principal; next(); });
  app.use('/search', buildSearchRouter(new SearchRepository(db, store), profile)); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/search`;
  const request = (query = '') => fetch(`${base}${query}`);
  const search = async (query = ''): Promise<SearchResponse> => { const response = await request(query); assert.equal(response.status, 200); return response.json(); };
  return { db, field, datasets, research, automation, request, search,
    principal: (id: string | null, roles: string[] = []) => { principal = id ? { id, roles, email: null, identityProvenance: 'fictional-test' } : null; },
    approve: (record: ReturnType<FieldReferenceRepository['get']>) => field.saveApproval(approve({ id: record!.id, kind: 'reference_mapping', content: record!.document }, 'reviewer', '2026-09-30T00:00:00Z'), record!.contentHash, 'test'),
    close: async () => { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('unified search indexes authorized reference entities and preserves evidence, approval and literal query semantics', async () => {
  const h = await harness();
  try {
    const sample = await h.field.importDocument(testSample({ name: 'Fictional 100%_X', appearance: { colors: ['green'], shape: 'round', logo: 'X', scoreLine: null } }), 'owner-a', 'test');
    const interaction = await h.field.importDocument(testAssertion(), 'owner-a', 'test');
    const symptom = await h.field.importDocument(testAssertion({ key: 'fixture-symptom', predicate: 'ASSOCIATED_WITH_SYMPTOM', object: { id: 'fixture-symptom', name: 'Fixture symptom', type: 'symptom' }, category: 'acute_toxicity' }), 'owner-a', 'test');
    const target = await h.field.importDocument(testAssertion({ key: 'fixture-target', predicate: 'BINDS_TO', object: { id: 'fixture-target', name: 'Fixture receptor', type: 'target', targetType: 'receptor' }, category: 'pharmacodynamics' }), 'owner-a', 'test');
    const all = await h.search();
    for (const kind of ['sample', 'substance', 'interaction', 'symptom', 'target', 'market_label']) assert.ok(all.results.some(hit => hit.kind === kind));
    assert.equal(all.results.find(hit => hit.kind === 'sample')!.href, `/evidence?reference=${encodeURIComponent(sample.id)}`, 'reviewer proposals open the review interface even when responder capability is also granted');
    assert.equal((await h.search('?q=100%25_&kind=sample')).total, 1);
    assert.equal((await h.search('?q=%25_&kind=sample')).total, 1);
    assert.equal((await h.search('?q=%27%20OR%201%3D1--')).total, 0);
    assert.equal((await h.search('?q=fixture%20RECEPTOR&kind=target')).total, 1);
    h.principal('responder', ['responder']);
    assert.equal((await h.search()).total, 0, 'unapproved names do not reveal curated field records');
    h.approve(sample); h.approve(interaction); h.approve(symptom); h.approve(target);
    const accepted = await h.search('?kind=sample'); assert.equal(accepted.total, 1);
    assert.equal(accepted.results[0].provenance[0].evidenceTier, 'PRIMARY_EMPIRICAL');
    assert.equal(accepted.results[0].provenance[0].approvalState, 'APPROVED');
    assert.equal(accepted.results[0].contentHash, sample.contentHash);
    assert.ok(accepted.results[0].href.startsWith('/responder?'));
    h.field.revoke(sample.id, 'reviewer', 'test');
    assert.equal((await h.search('?kind=sample')).total, 0, 'revocation is checked on every search');
    assert.equal((await h.request('?kind=paper')).status, 403);
  } finally { await h.close(); }
});

test('unified search separates private ownership, reviewer proposals and explicitly approved shared aggregates', async () => {
  const h = await harness();
  try {
    const own = await h.datasets.importDataset({ ...testDataset(), name: 'Own fixture dataset' }, 'owner-a', 'test');
    const other = await h.datasets.importDataset({ ...testDataset(), name: 'Other fixture dataset' }, 'owner-b', 'test');
    const privateText = 'PRIVATE_CELL_SENTINEL_SEARCH_8271';
    h.research.saveDocument('owner-a', { title: 'Own fixture paper', source: 'fixture:a', text: privateText, coverage: 'excerpt', language: 'en', geography: [] });
    h.research.saveDocument('owner-b', { title: 'Other fixture paper', source: 'fixture:b', text: privateText, coverage: 'excerpt', language: 'en', geography: [] });
    h.db.prepare("INSERT INTO runs(id,run_type,status,owner_principal_id,visibility,created_at) VALUES (?,'ACQUISITION','CREATED',?,'private',?)").run('run-a', 'owner-a', '2026-09-30T00:00:00Z');
    h.db.prepare("INSERT INTO runs(id,run_type,status,owner_principal_id,visibility,created_at) VALUES (?,'ACQUISITION','CREATED',?,'private',?)").run('run-b', 'owner-b', '2026-09-30T00:00:00Z');
    const owner = await h.search();
    assert.equal(owner.results.filter(hit => hit.kind === 'dataset').length, 1);
    assert.equal(owner.results.filter(hit => hit.kind === 'paper').length, 1);
    assert.equal(owner.results.filter(hit => hit.kind === 'run').length, 1);
    assert.ok(!JSON.stringify(owner).includes('Other fixture'));
    assert.ok(!JSON.stringify(owner).includes(privateText));
    assert.equal((await h.search(`?q=${privateText}`)).total, 0, 'private paper text is not searched as metadata');
    await h.datasets.approveDataset(other.id, 'owner-b', other.contentHash, true, 'test');
    h.principal('institution', ['institutional']);
    const published = await h.search('?kind=dataset'); assert.equal(published.total, 1);
    assert.equal(published.results[0].id, other.id); assert.equal(published.results[0].visibility, 'shared_aggregate');
    assert.equal((await h.request('?kind=paper')).status, 403);
    await h.datasets.revokeDataset(other.id, 'owner-b', 'test');
    assert.equal((await h.search('?kind=dataset')).total, 0);
    h.principal('owner-a', ['institutional']); assert.equal((await h.search('?kind=dataset')).total, 0, 'own proposed dataset is unavailable without review capability');
    assert.equal(own.approvalState, 'PROPOSED');
    h.principal('admin', ['developer']); assert.equal((await h.search('?kind=paper')).total, 0, 'administration does not reveal another owner’s papers');
  } finally { await h.close(); }
});

test('public target name results retain unapproved measurement provenance and link to actual source memory', async () => {
  const h = await harness();
  try {
    const snapshot = await sourceSnapshot(h.db, h.automation, { InChIKey: 'FICTIONAL-KEY' }, { name: 'Fictional public compound' });
    h.automation.alias(snapshot.id, 'Fictional synonym', 'pl', 'pubchem');
    h.automation.activity(snapshot.id, { targetId: 'FIXTURE123', targetName: 'Fictional public receptor', measure: 'Ki', assayType: 'B', activityId: 9999991,
      organism: 'Homo sapiens', flags: ['FICTIONAL_TEST_DATA'], value: null, unit: null, relation: null, assayId: 'fixture-assay', assayDescription: 'Fictional measurement fixture' }, snapshot.receipt);
    h.principal('responder', ['responder']);
    const targets = await h.search('?kind=target&q=public%20receptor'); assert.equal(targets.total, 1);
    assert.equal(targets.results[0].provenance[0].approvalState, 'PROPOSED');
    assert.ok(targets.results[0].href.startsWith(`/memory?substance=${encodeURIComponent(snapshot.id)}&target=`));
    assert.ok(h.automation.substance(snapshot.id));
    assert.equal((await h.search('?kind=substance&q=Fictional%20synonym')).total, 1);
    assert.equal((await h.search('?kind=substance&q=FICTIONAL-KEY')).total, 1);
    assert.equal((await h.search('?kind=substance&q=999999991')).total, 1);
  } finally { await h.close(); }
});

test('unified search rejects anonymous/unknown role access and malformed filters before reading private metadata', async () => {
  const h = await harness();
  try {
    h.principal(null); assert.equal((await h.request()).status, 401);
    h.principal('unknown', ['invented']); assert.equal((await h.request()).status, 403);
    h.principal('viewer', ['viewer']);
    for (const query of ['?kind=people', '?limit=0', '?limit=201', '?limit=1.2', '?offset=-1', '?offset=1000001', '?q=a&q=b', '?owner=owner-b', '?q=' + 'a'.repeat(161)]) assert.equal((await h.request(query)).status, 400, query);
    assert.equal((await h.request('?kind=dataset')).status, 403);
    const response = await h.request('?kind=source'); assert.equal(response.headers.get('cache-control'), 'no-store');
    const sources = await response.json(); assert.ok(sources.results.length > 0);
    assert.ok(sources.results.every((hit: any) => hit.visibility === 'registry' && hit.status));
  } finally { await h.close(); }
});

test('unified search paginates the complete owned catalogue beyond legacy 200-paper windows with stable deterministic ordering', async () => {
  const h = await harness();
  try {
    for (let i = 204; i >= 0; i--) h.research.saveDocument('owner-a', { title: `Fixture paper ${String(i).padStart(3, '0')}`, source: `fixture:${i}`, text: '', coverage: 'identifier_only', language: null, geography: [] });
    const first = await h.search('?kind=paper&limit=200'), second = await h.search('?kind=paper&limit=200&offset=200');
    assert.equal(first.total, 205); assert.equal(first.results.length, 200); assert.equal(first.nextOffset, 200);
    assert.equal(second.total, 205); assert.equal(second.results.length, 5); assert.equal(second.nextOffset, null);
    const labels = [...first.results, ...second.results].map(hit => hit.label);
    assert.equal(new Set(labels).size, 205); assert.equal(labels[0], 'Fixture paper 000'); assert.equal(labels[204], 'Fixture paper 204');
    assert.deepEqual(await h.search('?kind=paper&limit=200'), first);
    assert.equal(first.profile.limits.defaultPage, 50); assert.equal(first.profile.contentHash.length, 64);
  } finally { await h.close(); }
});

test('unified search finds only owned schedules and refuses tampered schedule provenance', async () => {
  const h = await harness();
  try {
    const profile = loadAutomationProfile(); h.automation.archiveProfile(profile);
    const request = { kind: 'paper_scan', providers: ['arxiv'], scope: 'all_science', lookbackDays: 7, maxRequests: 1, pageLimit: 1 };
    const schedule = h.automation.saveSchedule('owner-a', { name: 'Fictional daily literature', recurrence: { kind: 'daily_utc', hour: 8, minute: 0 }, request, enabled: true }, profile.contentHash);
    h.automation.saveSchedule('owner-b', { name: 'Other owner schedule', recurrence: { kind: 'interval', minutes: 60 }, request, enabled: true }, profile.contentHash);
    const result = await h.search('?kind=schedule'); assert.equal(result.total, 1); assert.equal(result.results[0].id, schedule.id);
    h.principal('owner-a', ['viewer']); assert.equal((await h.request('?kind=schedule')).status, 403);
    h.principal('owner-a', ['researcher']);
    h.db.prepare('UPDATE automation_schedules SET content_hash=? WHERE id=?').run('0'.repeat(64), schedule.id);
    assert.equal((await h.request('?kind=schedule')).status, 500);
  } finally { await h.close(); }
});

test('configured pagination boundary remains explicit instead of silently presenting a partial catalogue as complete', async () => {
  const { contentHash: _originalHash, ...body } = loadSearchProfile(), limited = { ...body, limits: { ...body.limits, defaultPage: 1, maximumPage: 1, maximumOffset: 0 } };
  const h = await harness({ ...limited, contentHash: canonicalHash(limited) });
  try {
    for (const title of ['Fixture first paper', 'Fixture second paper']) h.research.saveDocument('owner-a', { title, source: 'fixture:pagination', text: '', coverage: 'identifier_only', language: null, geography: [] });
    const result = await h.search('?kind=paper');
    assert.equal(result.total, 2); assert.equal(result.results.length, 1); assert.equal(result.nextOffset, null);
    assert.equal(result.paginationBoundaryReached, true);
    const narrowed = await h.search('?kind=paper&q=second'); assert.equal(narrowed.total, 1); assert.equal(narrowed.paginationBoundaryReached, false);
  } finally { await h.close(); }
});
