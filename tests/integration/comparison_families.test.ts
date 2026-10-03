import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readZip } from '../../backend/watchdog_api/utils/zip';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';
import { summarize as verifierSummarize } from '../../config/workbench/export/verify-family.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { ResearchRepository } from '../../backend/watchdog_api/db/repositories/research';
import { PaperOperationsRepository } from '../../backend/watchdog_api/db/repositories/paper_operations';
import { PaperComparisonsRepository } from '../../backend/watchdog_api/db/repositories/paper_comparisons';
import { PaperComparisonFamiliesRepository } from '../../backend/watchdog_api/db/repositories/paper_comparison_families';
import { WorkbenchRepository } from '../../backend/watchdog_api/db/repositories/workbench';
import { WorkbenchService } from '../../backend/watchdog_api/workbench/service';
import { PaperOperationService } from '../../backend/watchdog_api/services/paper_operations';
import { PaperComparisonService } from '../../backend/watchdog_api/services/paper_comparisons';
import { PaperComparisonFamilyService } from '../../backend/watchdog_api/services/paper_comparison_families';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { loadWorkbenchProfile } from '../../backend/watchdog_api/config/workbench';
import { summarizeFamily, memberOutcome } from '../../shared/paper_comparison_family';
import type { PaperOperationInput } from '../../shared/paper_operation';
import { testDataset } from '../helpers/workbench';

/**
 * E5.7b.1 — a family is frozen before it runs, every member is reported
 * against the frozen denominator, and nothing can be dropped afterwards.
 * Fictional software fixtures only; no publication or empirical claim.
 */

const fixtureClaim = JSON.parse(readFileSync('fixtures/research_comparison/claim.json', 'utf8'));
const methodQuote = 'Pearson correlation compared scores and counts.';

async function harness(owner = 'owner') {
  const dir = mkdtempSync(path.join(tmpdir(), 'watchdog-family-'));
  const databaseFile = path.join(dir, 'research.sqlite');
  const connect = () => {
    const db = new Database(databaseFile); db.pragma('foreign_keys = ON'); runMigrations(db);
    const store = new LocalFileSystemStore(path.join(dir, 'store'));
    const wb = new WorkbenchRepository(db, store), workbench = new WorkbenchService(wb, loadWorkbenchProfile());
    const research = new ResearchRepository(db);
    const operations = new PaperOperationService(new PaperOperationsRepository(db), research, workbench);
    const comparisons = new PaperComparisonService(new PaperComparisonsRepository(db), operations);
    const families = new PaperComparisonFamilyService(new PaperComparisonFamiliesRepository(db), comparisons);
    return { db, wb, research, operations, comparisons, families };
  };
  const h = { dir, ...connect(), restart() { this.db.close(); Object.assign(this, connect()); }, close() { this.db.close(); rmSync(dir, { recursive: true, force: true }); } };
  const document = (title: string) => h.research.saveDocument(owner, { title, source: `https://example.org/${title.replace(/\W+/g, '-')}`,
    text: `${methodQuote} ${fixtureClaim.quote}`, coverage: 'excerpt', language: 'en', geography: [] });
  const paper = document('Fictional family fixture');
  const dataset = await h.wb.importDataset(testDataset(), owner, 'fixture');
  await h.wb.approveDataset(dataset.id, owner, dataset.contentHash, true, 'fixture');
  const base = (doc: { id: string; hash: string }): PaperOperationInput => ({ source: { kind: 'manual_quote', documentId: doc.id, documentHash: doc.hash, quote: methodQuote },
    method: 'pearson', datasetId: dataset.id, datasetHash: dataset.contentHash,
    bindings: [{ role: 'a', column: 'interest', rationale: 'Synthetic proportional test values.', origin: 'synthetic_scenario', requirementId: null, substitution: null },
      { role: 'b', column: 'mentions', rationale: 'Synthetic proportional test values.', origin: 'synthetic_scenario', requirementId: null, substitution: null }],
    missingPolicy: 'exclude', scopeNote: 'Software fixture. No empirical or clinical validity is claimed.' });
  /** One reviewed comparison on its own approved operation. */
  const reviewed = async (overrides: Partial<PaperOperationInput> = {}, doc = paper, approve = true) => {
    const operation = await h.operations.prepare(owner, { ...base(doc), ...overrides }, 'fixture');
    await h.operations.approve(owner, operation.id, operation.hash, operation.method.hash, 'fixture');
    const c = await h.comparisons.propose(owner, { operationId: operation.id, operationHash: operation.hash, claim: structuredClone(fixtureClaim), supersedes: null }, 'fixture');
    if (approve) await h.comparisons.approve(owner, c.id, c.hash, 'fixture');
    return c;
  };
  const input = (members: { id: string; hash: string }[], extra: Record<string, unknown> = {}) => ({
    documentId: paper.id, title: 'All fixture claims', rationale: 'Every reviewed claim of this fictional fixture, fixed before running.',
    members: members.map(m => ({ comparisonId: m.id, hash: m.hash })), supersedes: null, ...extra });
  return Object.assign(h, { paper, document, reviewed, input });
}

test('family: freezing needs exact reviews of distinct comparisons of one document version', async () => {
  const h = await harness(); try {
    const a = await h.reviewed(), unreviewed = await h.reviewed({}, h.paper, false);
    const other = h.document('Another fictional paper'), foreign = await h.reviewed({}, other);
    await assert.rejects(h.families.create('owner', h.input([a, unreviewed]), 'fixture'), /exact review/);
    await assert.rejects(h.families.create('owner', h.input([a, a]), 'fixture'), /only once/);
    await assert.rejects(h.families.create('owner', h.input([a, foreign]), 'fixture'), /named document/);
    await assert.rejects(h.families.create('owner', h.input([{ id: a.id, hash: '0'.repeat(64) }]), 'fixture'), /exact current/);
    await assert.rejects(h.families.create('stranger', h.input([a]), 'fixture'), /owned|not found/i);
    await assert.rejects(h.families.create('owner', h.input([]), 'fixture'));
    const family = await h.families.create('owner', h.input([a]), 'fixture');
    assert.equal(family.summary.denominator, 1);
    assert.equal(family.summary.counts.not_run, 1, 'a frozen family that has not run reports its members as not run, not as absent');
  } finally { h.close(); }
});

test('family: every member is reported against the frozen denominator — match, failure and refusal alike', async () => {
  const h = await harness(); try {
    const match = await h.reviewed(), failing = await h.reviewed({ missingPolicy: 'fail' }), revoked = await h.reviewed();
    const family = await h.families.create('owner', h.input([match, failing, revoked]), 'fixture');
    await h.comparisons.revoke('owner', revoked.id, revoked.hash, 'fixture');
    const ran = await h.families.execute('owner', family.id, family.hash, 'fixture');
    assert.equal(ran.summary.denominator, 3);
    assert.deepEqual(ran.summary.members.map(m => m.outcome), ['reproduced', 'failed', 'refused']);
    assert.equal(ran.summary.counts.reproduced, 1); assert.equal(ran.summary.counts.failed, 1); assert.equal(ran.summary.counts.refused, 1);
    assert.match(ran.summary.members[2].reason!, /review/i, 'the refusal keeps its reason');
    assert.ok(ran.summary.members[0].runId && ran.summary.members[1].runId);
    assert.equal(ran.summary.members[2].runId, null);
    await assert.rejects(h.families.execute('owner', family.id, '0'.repeat(64), 'fixture'), /stale/);
    // Re-running appends; the latest outcome counts, every attempt stays visible.
    const again = await h.families.execute('owner', family.id, family.hash, 'fixture');
    assert.equal(again.events.length, 6);
    assert.deepEqual(again.summary.members.map(m => m.attempts), [2, 2, 0]);
    h.restart();
    const reopened = await h.families.get('owner', family.id);
    assert.deepEqual(reopened.summary, again.summary, 'the summary is recomputed identically from stored rows after a restart');
  } finally { h.close(); }
});

test('family: membership and history cannot be edited or deleted; attempts before the freeze are disclosed, not counted', async () => {
  const h = await harness(); try {
    const a = await h.reviewed(), b = await h.reviewed();
    const early = await h.comparisons.execute('owner', a.id, a.hash, 'fixture');
    const family = await h.families.create('owner', h.input([a, b]), 'fixture');
    assert.deepEqual(family.body.priorExposure.members[0].attempts.map((x: any) => x.runId), [early.runId]);
    assert.equal(family.body.priorExposure.external, 'UNKNOWN');
    assert.equal(family.summary.counts.not_run, 2, 'a run made before the family existed does not count as a family result');
    await h.families.execute('owner', family.id, family.hash, 'fixture');
    assert.throws(() => h.db.prepare('UPDATE paper_comparison_families SET body_json=? WHERE id=?').run('{}', family.id), /WORM/);
    assert.throws(() => h.db.prepare('DELETE FROM paper_comparison_families WHERE id=?').run(family.id), /Retain/);
    assert.throws(() => h.db.prepare("UPDATE paper_comparison_family_events SET kind='REFUSED'").run(), /WORM/);
    assert.throws(() => h.db.prepare('DELETE FROM paper_comparison_family_events').run(), /Retain/);
    h.db.pragma('ignore_check_constraints = OFF');
    assert.throws(() => h.db.prepare("INSERT INTO paper_comparison_family_events(id,family_id,comparison_id,kind,attempt_id,data_json,actor_id,created_at,request_id) VALUES ('x',?,?,'ATTEMPT',NULL,'{}','owner','t','r')").run(family.id, a.id), /CHECK/);
  } finally { h.close(); }
});

test('family: a change is a new revision that names the old one; both stay readable', async () => {
  const h = await harness(); try {
    const a = await h.reviewed(), b = await h.reviewed();
    const first = await h.families.create('owner', h.input([a, b]), 'fixture');
    await h.families.execute('owner', first.id, first.hash, 'fixture');
    await assert.rejects(h.families.create('owner', h.input([a], { supersedes: { id: first.id, hash: '0'.repeat(64) } }), 'fixture'), /exact version/);
    const second = await h.families.create('owner', h.input([a], { supersedes: { id: first.id, hash: first.hash }, rationale: 'Dropping b after seeing results; the earlier family remains on record.' }), 'fixture');
    assert.deepEqual(second.body.supersedes, { id: first.id, hash: first.hash });
    const old = await h.families.get('owner', first.id);
    assert.deepEqual(old.supersededBy.map(s => s.id), [second.id]);
    assert.equal(old.summary.denominator, 2, 'the superseded family keeps its full denominator and results');
    assert.deepEqual((await h.families.list('owner', h.paper.id)).map(f => f.id), [first.id, second.id]);
  } finally { h.close(); }
});

test('family summary: outcomes come only from the latest family event; an unreadable completed run is not a match', () => {
  assert.equal(memberOutcome([]).outcome, 'not_run');
  assert.equal(memberOutcome([{ kind: 'ATTEMPT', sequence: 1, runId: 'r', runStatus: 'RUNNING', verdict: null, reason: null }]).outcome, 'pending');
  assert.equal(memberOutcome([{ kind: 'ATTEMPT', sequence: 1, runId: 'r', runStatus: 'COMPLETED', verdict: null, reason: null }]).outcome, 'method_unclear');
  assert.equal(memberOutcome([
    { kind: 'ATTEMPT', sequence: 2, runId: 'r2', runStatus: 'COMPLETED', verdict: 'deviates', reason: 'outside_tolerance' },
    { kind: 'ATTEMPT', sequence: 1, runId: 'r1', runStatus: 'COMPLETED', verdict: 'reproduced', reason: 'within_tolerance' },
  ]).outcome, 'deviates', 'sorted by sequence, not by array order');
  const s = summarizeFamily([{ comparisonId: 'a', hash: 'h' }, { comparisonId: 'b', hash: 'h' }], new Map([['a', [{ kind: 'REFUSED' as const, sequence: 1, runId: null, runStatus: null, verdict: null, reason: 'revoked' }]]]));
  assert.equal(s.denominator, 2); assert.equal(s.counts.refused, 1); assert.equal(s.counts.not_run, 1);
  assert.equal(Object.values(s.counts).reduce((x, y) => x + y, 0), s.denominator, 'counts always add up to the denominator');
});

function unpack(bytes: Buffer) {
  const dir = mkdtempSync(path.join(tmpdir(), 'watchdog-family-pkg-'));
  for (const e of readZip(bytes)) { const f = path.join(dir, e.name); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, e.content); }
  return dir;
}
const verifyFamily = (dir: string, hash?: string) => spawnSync(process.execPath, [path.join(dir, 'verify-family.mjs'), dir, ...(hash ? [hash] : [])], { encoding: 'utf8' });

test('family export: a portable package verifies offline and its summary is recomputed from member packages', async () => {
  const h = await harness(); try {
    const match = await h.reviewed(), failing = await h.reviewed({ missingPolicy: 'fail' }), revoked = await h.reviewed();
    const family = await h.families.create('owner', h.input([match, failing, revoked]), 'fixture');
    await h.comparisons.revoke('owner', revoked.id, revoked.hash, 'fixture');
    await h.families.execute('owner', family.id, family.hash, 'fixture');
    const pkg = await h.families.export('owner', family.id);
    assert.deepEqual(pkg.manifest.members.map((m: any) => !!m.packageManifestHash), [true, false, false]);
    assert.match(pkg.manifest.members[1].reason, /failed/); assert.match(pkg.manifest.members[2].reason, /refused/);
    const again = await h.families.export('owner', family.id);
    assert.equal(again.manifestHash, pkg.manifestHash, 'identical state exports an identical manifest');
    const dir = unpack(pkg.bytes);
    try {
      const ok = verifyFamily(dir, pkg.manifestHash);
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stdout, /3 frozen comparisons — 1 reproduced, 1 failed, 1 refused/);
      assert.notEqual(verifyFamily(dir, '0'.repeat(64)).status, 0, 'a different independent hash is rejected');

      // Forgery with every hash recomputed: claim the failed member matched.
      const summary = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8'));
      summary.members[1].outcome = 'reproduced'; summary.counts.failed = 0; summary.counts.reproduced = 2;
      const text = `${JSON.stringify(summary, null, 2)}\n`; writeFileSync(path.join(dir, 'summary.json'), text);
      const manifest = JSON.parse(readFileSync(path.join(dir, 'family-manifest.json'), 'utf8'));
      manifest.identity.summaryHash = canonicalHash(summary);
      const entry = manifest.files.find((f: any) => f.path === 'summary.json');
      entry.bytes = Buffer.byteLength(text); entry.sha256 = createHash('sha256').update(text).digest('hex');
      writeFileSync(path.join(dir, 'family-manifest.json'), JSON.stringify(manifest));
      const forged = verifyFamily(dir);
      assert.notEqual(forged.status, 0); assert.match(forged.stderr, /does not follow from the events and member packages/);
    } finally { rmSync(dir, { recursive: true, force: true }); }

    const dir2 = unpack(pkg.bytes);
    try {
      writeFileSync(path.join(dir2, 'members/0/research/comparison.json'), '{}');
      const changed = verifyFamily(dir2);
      assert.notEqual(changed.status, 0); assert.match(changed.stderr, /Changed file/);
      writeFileSync(path.join(dir2, 'extra.txt'), 'x');
      assert.match(verifyFamily(dir2).stderr, /Changed file|Unlisted file/);
    } finally { rmSync(dir2, { recursive: true, force: true }); }
  } finally { h.close(); }
});

test('family verifier: its summary rules match the product rules exactly', () => {
  const kinds = [
    [], [{ kind: 'REFUSED', sequence: 1, runId: null, runStatus: null, verdict: null, reason: 'r' }],
    [{ kind: 'ATTEMPT', sequence: 1, runId: 'a', runStatus: 'RUNNING', verdict: null, reason: null }],
    [{ kind: 'ATTEMPT', sequence: 1, runId: 'a', runStatus: 'FAILED', verdict: null, reason: 'x' }],
    [{ kind: 'ATTEMPT', sequence: 1, runId: 'a', runStatus: 'COMPLETED', verdict: null, reason: null }],
    ...['reproduced', 'deviates', 'not_computable', 'method_unclear'].map(v => [{ kind: 'ATTEMPT', sequence: 2, runId: 'b', runStatus: 'COMPLETED', verdict: v, reason: 'q' }, { kind: 'REFUSED', sequence: 1, runId: null, runStatus: null, verdict: null, reason: 'old' }]),
  ] as any[];
  const members = kinds.map((_, i) => ({ comparisonId: `c${i}`, hash: 'h' }));
  const events = new Map(kinds.map((k, i) => [`c${i}`, k]));
  assert.deepEqual(verifierSummarize(members, events), summarizeFamily(members, events));
});
