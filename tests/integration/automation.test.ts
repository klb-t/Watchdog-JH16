import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { AutomationRepository } from '../../backend/watchdog_api/db/repositories/automation';
import { PrincipalRepository } from '../../backend/watchdog_api/db/repositories/principals';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { loadAutomationProfile } from '../../backend/watchdog_api/config/automation';
import { AutomationService } from '../../backend/watchdog_api/services/automation';
import { PublicHttp } from '../../backend/watchdog_api/sources/public_http';
import { nextOccurrence } from '../../shared/automation';
import { buildAutomationRouter, buildMemoryRouter } from '../../backend/watchdog_api/api/automation_routes';
import { errorHandler } from '../../backend/watchdog_api/api/middleware';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';
import { parseArxivAtom } from '../../backend/watchdog_api/sources/atom';
import { normalizeActivity } from '../../backend/watchdog_api/sources/public_reference';

function harness() {
  const dir = mkdtempSync(path.join(tmpdir(), 'watchdog-automation-')), db = new Database(path.join(dir, 'db.sqlite'));
  db.pragma('foreign_keys=ON'); runMigrations(db);
  const repo = new AutomationRepository(db, new LocalFileSystemStore(path.join(dir, 'store'))), profile = loadAutomationProfile();
  repo.archiveProfile(profile);
  const owner = 'local-user', request = profile.defaults.paperJob;
  return { db, dir, repo, profile, owner, request, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const response = (data: unknown, status = 200) => new Response(typeof data === 'string' ? data : JSON.stringify(data), { status });
const atom = (version = '1') => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:o="http://a9.com/-/spec/opensearch/1.1/"><o:totalResults>1</o:totalResults>
  <entry><id>http://arxiv.org/abs/9999.00001v${version}</id><title>Fictional correlation &amp; regression fixture</title><summary><![CDATA[Open data example, not a real publication.]]></summary>
  <author><name>Test Fixture</name></author><published>2026-09-01T00:00:00Z</published><updated>2026-09-02T00:00:00Z</updated><category term="test.fixture" /></entry></feed>`;

test('scheduler calendar: UTC daily, leap day, anchored intervals and coalesced missed slots', () => {
  assert.equal(nextOccurrence({ kind: 'daily_utc', hour: 6, minute: 0 }, new Date('2028-02-28T23:00:00Z')), '2028-02-29T06:00:00.000Z');
  assert.equal(nextOccurrence({ kind: 'daily_utc', hour: 6, minute: 0 }, new Date('2026-10-25T06:00:00Z')), '2026-10-26T06:00:00.000Z');
  assert.equal(nextOccurrence({ kind: 'interval', minutes: 60 }, new Date('2026-09-11T08:35:00Z'), '2026-09-08T02:05:00Z'), '2026-09-11T09:05:00.000Z');
});

test('persistent scheduler: one overdue job, no overlap, owner isolation, pause and stale edits', () => {
  const h = harness();
  try {
    const start = new Date('2026-09-01T00:00:00Z'), due = new Date('2026-09-11T08:00:00Z');
    const input = { name: 'daily', enabled: true, recurrence: { kind: 'daily_utc', hour: 6, minute: 0 }, request: h.request };
    const s = h.repo.saveSchedule(h.owner, input, h.profile.contentHash, start);
    const otherConnection = new Database(path.join(h.dir, 'db.sqlite'));
    try {
      const second = new AutomationRepository(otherConnection, new LocalFileSystemStore(path.join(h.dir, 'store')));
      assert.equal(second.dispatchDue(due), 1); assert.equal(h.repo.dispatchDue(due), 0);
      assert.equal(second.dispatchDue(new Date('2026-09-12T08:00:00Z')), 0, 'outstanding job coalesces another occurrence');
      assert.equal(h.repo.jobs(h.owner).length, 1); assert.equal(h.repo.jobs('another').length, 0);
      assert.equal(h.repo.job(h.repo.jobs(h.owner)[0].id, 'another'), null);
      assert.throws(() => h.repo.saveSchedule('another', input, h.profile.contentHash, due, s.id, s.contentHash), /not found/);
      assert.throws(() => h.repo.saveSchedule(h.owner, input, h.profile.contentHash, due, s.id, 'changed'), /changed/);
      h.repo.saveSchedule(h.owner, { ...input, enabled: false }, h.profile.contentHash, due, s.id, s.contentHash);
      assert.equal(h.repo.jobs(h.owner)[0].status, 'CANCELED');
    } finally { otherConnection.close(); }
  } finally { h.close(); }
});

test('worker leases: atomic claims, interrupted work is not automatically replayed, revoked owners stop', () => {
  const h = harness(); try {
    const now = new Date(); const a = h.repo.enqueue(h.owner, h.request, h.profile.contentHash, now);
    const claim = h.repo.claim(now, 60000)!; assert.equal(claim.job.id, a.id); assert.equal(h.repo.claim(now, 60000), null);
    h.repo.claim(new Date(now.getTime() + 60001), 60000);
    assert.equal(h.repo.job(a.id, h.owner)!.status, 'INTERRUPTED');
    h.repo.finish(a.id, claim.token, 'SUCCEEDED', {}); assert.equal(h.repo.job(a.id, h.owner)!.status, 'INTERRUPTED', 'old worker cannot overwrite expired lease');
    const b = h.repo.enqueue(h.owner, h.request, h.profile.contentHash); const bClaim = h.repo.claim(new Date(), 60000)!;
    h.db.prepare('UPDATE principals SET active=0 WHERE id=?').run(h.owner);
    assert.equal(h.repo.heartbeat(b.id, bClaim.token, new Date(), 60000), false);
    const c = h.repo.enqueue(h.owner, h.request, h.profile.contentHash); h.repo.claim(new Date(), 60000);
    assert.equal(h.repo.job(c.id, h.owner)!.status, 'CANCELED');
  } finally { h.close(); }
});

test('job/profile integrity failures do not jam later jobs; one source connection across workers', () => {
  const h = harness(); try {
    assert.throws(() => h.db.prepare('UPDATE automation_profiles SET body_json=?').run('{}'), /WORM/);
    const first = h.repo.enqueue(h.owner, h.request, h.profile.contentHash);
    h.db.prepare('UPDATE automation_jobs SET request_hash=? WHERE id=?').run('0'.repeat(64), first.id);
    const later = h.repo.enqueue(h.owner, h.request, h.profile.contentHash, new Date(Date.now() + 1000));
    const claim = h.repo.claim(new Date(), 60000)!;
    assert.equal(h.repo.job(first.id, h.owner)!.error, 'SNAPSHOT_INTEGRITY_MISMATCH'); assert.equal(claim.job.id, later.id);
    const lock = h.repo.sourceLease('arxiv', 3100, 1000); assert.equal(lock.waitMs, 0);
    assert.throws(() => h.repo.sourceLease('arxiv', 3100, 1001), /another worker/);
    h.repo.releaseSource('arxiv', lock.token);
    assert.equal(h.repo.sourceLease('arxiv', 3100, 1001).waitMs, 3099);
  } finally { h.close(); }
});

test('arXiv parser handles namespaces, entities, versions and CDATA; rejects DTDs and malformed feeds', () => {
  assert.equal(parseArxivAtom(atom()).entries[0].title, 'Fictional correlation & regression fixture');
  assert.match(parseArxivAtom(atom()).entries[0].abstract, /not a real publication/);
  for (const bad of [atom().replace('<entry>', '<entry><unclosed>'), atom().replace('<o:totalResults>1</o:totalResults>', ''),
    atom().replace('&amp;', '&external;'), '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + atom()]) assert.throws(() => parseArxivAtom(bad));
});

test('paper discovery persists revisions and receipts; hints never approve replication or equate language with geography', async () => {
  const h = harness(); try {
    let revision = '1'; const calls: string[] = [];
    const service = new AutomationService(h.repo, h.profile, async url => { calls.push(url); return response(atom(revision)); }, async () => {});
    const input = { ...h.request, providers: ['arxiv'], scope: 'all_science' };
    const first = h.repo.enqueue(h.owner, input, h.profile.contentHash); await service.tick();
    assert.equal(h.repo.job(first.id, h.owner)!.status, 'SUCCEEDED'); assert.equal(h.repo.papers(h.owner).length, 1);
    h.repo.enqueue(h.owner, input, h.profile.contentHash); await service.tick(); assert.equal(h.repo.papers(h.owner).length, 1);
    revision = '2'; h.repo.enqueue(h.owner, input, h.profile.contentHash); await service.tick(); assert.equal(h.repo.papers(h.owner).length, 2);
    const p = h.repo.papers(h.owner)[0]; assert.equal(p.geography, null); assert.equal(p.sourceLanguage, null);
    assert.equal(p.screening.state, 'DISCOVERED'); assert.ok(p.screening.blockers.length); assert.equal(p.screening.clinicalUse, false);
    assert.equal(h.repo.papers('another').length, 0); assert.equal(h.repo.receipts(first.id, h.owner).length, 1);
    const raw = await h.repo.raw(h.repo.receipts(first.id, h.owner)[0].id); assert.equal(raw.toString(), atom());
    const query = new URL(calls[0]).searchParams.get('search_query')!; assert.match(query, /^lastUpdatedDate/); assert.doesNotMatch(query, /opioid/);
  } finally { h.close(); }
});

test('public HTTP records errors, enforces origin/size/budget, and never follows source redirects', async () => {
  const h = harness(); try {
    const j = h.repo.enqueue(h.owner, h.request, h.profile.contentHash); let calls = 0;
    const http = new PublicHttp(h.repo, j.id, h.profile, 1, () => {}, async (_url, init) => {
      calls++; assert.equal(init.redirect, 'error'); assert.ok(init.signal); return response({ message: 'rate limited' }, 429);
    }, async () => {});
    await assert.rejects(() => http.get('arxiv', 'https://127.0.0.1/api/query'), /outside/); assert.equal(calls, 0);
    await assert.rejects(() => http.get('arxiv', '/api/query'), /429/);
    assert.equal(h.repo.receipts(j.id, h.owner)[0].httpStatus, 429);
    await assert.rejects(() => http.get('arxiv', '/api/query'), /BUDGET/); assert.equal(calls, 1);
    const small = structuredClone(h.profile); small.worker.maxResponseBytes = 5;
    const limited = new PublicHttp(h.repo, j.id, small, 1, () => {}, async () => response('too many bytes'), async () => {});
    await assert.rejects(() => limited.get('arxiv', '/api/query'), /body limit/);
  } finally { h.close(); }
});

test('substance memory preserves exact identities, censored Ki/IC50, units, organisms, raw files and contrary versions', async () => {
  const h = harness(); try {
    const j = h.repo.enqueue(h.owner, h.profile.defaults.substanceJob, h.profile.contentHash);
    const receipt = await h.repo.receipt(j.id, 'chembl', 'https://www.ebi.ac.uk/chembl/api/data/activity.json', 200, Buffer.from('fictional test fixture'), 'test fixture');
    const subject = h.repo.putCompound(99999999, 'Fictional compound', { InChIKey: 'AAAAAAAAAAAAAA-BBBBBBBBBB-C' }, receipt);
    const raw = { activity_id: 999999991, molecule_chembl_id: 'CHEMBL99999999', target_chembl_id: 'CHEMBL99999998', target_pref_name: 'Fictional receptor subtype',
      standard_type: 'Ki', standard_value: '1.2', standard_relation: '<', standard_units: 'nM', target_organism: 'Rattus norvegicus', assay_type: 'B' };
    const ki = normalizeActivity(raw)!; h.repo.activity(subject, ki, receipt); h.repo.activity(subject, ki, receipt);
    h.repo.activity(subject, normalizeActivity({ ...raw, standard_value: '2.3', standard_relation: '>' }), receipt);
    h.repo.activity(subject, normalizeActivity({ ...raw, activity_id: 999999992, standard_type: 'IC50', standard_units: 'uM' }), receipt);
    const memory = h.repo.substance(subject)!; assert.equal(memory.activities.length, 3);
    assert.ok(memory.activities.every(a => a.approvalState === 'PROPOSED' && a.value.flags.includes('NONHUMAN_OR_UNSPECIFIED_ORGANISM')));
    assert.deepEqual([...new Set(memory.activities.map(a => a.value.unit))].sort(), ['nM', 'uM']);
    assert.equal(h.repo.substanceList('Fictional').length, 1);
    assert.equal((h.db.prepare("SELECT COUNT(*) n FROM assertions WHERE predicate='MODULATES'").get() as any).n, 1);
    assert.equal(normalizeActivity({ ...raw, standard_value: 'NaN' })!.value, null);
    assert.equal(normalizeActivity({ ...raw, standard_type: 'LogP' }), null);
    assert.throws(() => h.db.prepare('UPDATE substance_reference_records SET value_json=?').run('{}'), /WORM/);
  } finally { h.close(); }
});

test('API owner gates, explicit plan consent, cross-origin writes and responder reference access', async () => {
  const h = harness(); let server: ReturnType<express.Express['listen']> | undefined;
  try {
    const service = new AutomationService(h.repo, h.profile, async () => response(atom()), async () => {});
    const app = express(); let owner = h.owner, roles = ['dev']; app.use(express.json());
    app.use((req, _res, next) => { req.principal = { id: owner, roles, email: null, identityProvenance: 'test' }; next(); });
    app.use('/api/automation', buildAutomationRouter(h.repo, service)); app.use('/api/memory', buildMemoryRouter(h.repo)); app.use(errorHandler);
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server!.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const call = (p: string, body?: unknown, extra = {}) => fetch(base + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) } : {});
    const schedule = { name: 'test daily', enabled: true, recurrence: {kind: 'daily_utc', hour: 6, minute: 0}, request: h.request };
    assert.equal((await call('/api/automation/schedules', { schedule, profileHash: h.profile.contentHash })).status, 400);
    const body = { schedule, profileHash: h.profile.contentHash, consent: true };
    assert.equal((await call('/api/automation/schedules', body, { Origin: 'https://foreign.example' })).status, 403);
    assert.equal((await call('/api/automation/schedules', { ...body, profileHash: 'stale' })).status, 409);
    assert.equal((await call('/api/automation/schedules', body)).status, 201);
    owner = 'another'; assert.equal((await (await call('/api/automation/schedules')).json()).schedules.length, 0);
    roles = ['responder']; assert.equal((await call('/api/automation/jobs')).status, 403); assert.equal((await call('/api/memory/substances')).status, 200);
    roles = ['viewer']; assert.equal((await call('/api/memory/substances')).status, 403);
  } finally { if (server) await new Promise<void>(r => server!.close(() => r())); h.close(); }
});
