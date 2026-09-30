import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { ResearchRepository } from '../../backend/watchdog_api/db/repositories/research';
import { PaperOperationsRepository } from '../../backend/watchdog_api/db/repositories/paper_operations';
import { PaperComparisonsRepository } from '../../backend/watchdog_api/db/repositories/paper_comparisons';
import { PrincipalRepository } from '../../backend/watchdog_api/db/repositories/principals';
import { WorkbenchRepository } from '../../backend/watchdog_api/db/repositories/workbench';
import { WorkbenchService } from '../../backend/watchdog_api/workbench/service';
import { PaperOperationService } from '../../backend/watchdog_api/services/paper_operations';
import { PaperComparisonService } from '../../backend/watchdog_api/services/paper_comparisons';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { loadWorkbenchProfile } from '../../backend/watchdog_api/config/workbench';
import { canonicalHash, canonicalizeJson } from '../../backend/watchdog_api/domain/canonical';
import { readZip } from '../../backend/watchdog_api/utils/zip';
import type { PaperOperationInput } from '../../shared/paper_operation';
import { testDataset } from '../helpers/workbench';

const fixtureClaim = JSON.parse(readFileSync('fixtures/research_comparison/claim.json', 'utf8'));
const methodQuote = 'Pearson correlation compared scores and counts.';
const cohortQuote = 'Rows one, three and five formed the cohort.';

/** A real SQLite file and preserved local blob store let restart tests reopen all state. */
async function harness(owner = 'owner') {
  const dir = mkdtempSync(path.join(tmpdir(), 'watchdog-comparison-'));
  const databaseFile = path.join(dir, 'research.sqlite');
  const connect = () => {
    const db = new Database(databaseFile); db.pragma('foreign_keys = ON'); runMigrations(db);
    const store = new LocalFileSystemStore(path.join(dir, 'store'));
    const wb = new WorkbenchRepository(db, store), workbench = new WorkbenchService(wb, loadWorkbenchProfile());
    const research = new ResearchRepository(db), operationRepo = new PaperOperationsRepository(db);
    const operations = new PaperOperationService(operationRepo, research, workbench);
    const repo = new PaperComparisonsRepository(db), service = new PaperComparisonService(repo, operations);
    return { db, store, wb, workbench, research, operationRepo, operations, repo, service };
  };
  const h = { dir, databaseFile, ...connect(), restart() { this.db.close(); Object.assign(this, connect()); }, close() { this.db.close(); rmSync(dir, { recursive: true, force: true }); } };
  const paper = h.research.saveDocument(owner, { title: 'Fictional comparison software fixture', source: 'https://example.org/comparison-fixture',
    text: `🧪 ${methodQuote} ${fixtureClaim.quote} ${cohortQuote}`, coverage: 'excerpt', language: 'en', geography: [] });
  const dataset = await h.wb.importDataset(testDataset(), owner, 'fixture');
  await h.wb.approveDataset(dataset.id, owner, dataset.contentHash, true, 'fixture');
  const operationInput: PaperOperationInput = { source: { kind: 'manual_quote', documentId: paper.id, documentHash: paper.hash, quote: methodQuote },
    method: 'pearson', datasetId: dataset.id, datasetHash: dataset.contentHash,
    bindings: [{ role: 'a', column: 'interest', rationale: 'Synthetic proportional test values.', origin: 'synthetic_scenario', requirementId: null, substitution: null },
      { role: 'b', column: 'mentions', rationale: 'Synthetic proportional test values.', origin: 'synthetic_scenario', requirementId: null, substitution: null }],
    missingPolicy: 'exclude', scopeNote: 'Software fixture. No empirical or clinical validity is claimed.' };
  const prepare = async (overrides: Partial<PaperOperationInput> = {}) => {
    const operation = await h.operations.prepare(owner, { ...operationInput, ...overrides }, 'fixture');
    await h.operations.approve(owner, operation.id, operation.hash, operation.method.hash, 'fixture');
    const input = { operationId: operation.id, operationHash: operation.hash, claim: structuredClone(fixtureClaim), supersedes: null };
    return { operation, input, comparison: await h.service.propose(owner, input, 'fixture') };
  };
  return Object.assign(h, { paper, dataset, operationInput, prepare });
}

test('paper comparison: separate exact review gates a fresh run; foreign/stale identities and old-run injection are rejected', async () => {
  const h = await harness(); try {
    const { operation, input, comparison } = await h.prepare();
    const oldRun = await h.operations.execute('owner', operation.id, operation.hash, 'fixture');
    await assert.rejects(h.service.execute('owner', comparison.id, comparison.hash, 'fixture'), /review|approv/i);
    await assert.rejects(h.service.approve('owner', comparison.id, '0'.repeat(64), 'fixture'), /stale|hash|version/i);
    await assert.rejects(h.service.approve('stranger', comparison.id, comparison.hash, 'fixture'), /owned|not found|owner/i);
    await assert.rejects(h.service.propose('stranger', input, 'fixture'), /owned|not found|owner/i);
    await assert.rejects(h.service.propose('owner', { ...input, runId: oldRun.runId }, 'fixture'));
    await h.service.approve('owner', comparison.id, comparison.hash, 'fixture');
    const result = await h.service.execute('owner', comparison.id, comparison.hash, 'fixture');
    assert.notEqual(result.runId, oldRun.runId);
    assert.equal(result.paperComparison.comparison.hash, comparison.hash);
    assert.equal(result.paperComparison.core.verdict, 'reproduced');
    assert.equal(result.paperBinding.body.meaning, 'SIMULATION_NOT_EMPIRICAL_EVIDENCE');
    assert.equal(result.paperComparison.attempt.runId, result.runId);
    assert.ok(canonicalizeJson(result.paperComparison.freeze.data.priorExposure).includes(oldRun.runId), 'Freeze must disclose ordinary runs created after the proposal.');
    await assert.rejects(h.service.result('owner', comparison.id, oldRun.runId), /attempt|comparison|owned|not found/i);
    await assert.rejects(h.service.result('stranger', comparison.id, result.runId), /owned|not found|owner/i);
  } finally { h.close(); }
});

test('paper comparison: revisions preserve prior runs and old claim bytes; successor requires its own review', async () => {
  const h = await harness(); try {
    const { input, comparison } = await h.prepare();
    await h.service.approve('owner', comparison.id, comparison.hash, 'fixture');
    const first = await h.service.execute('owner', comparison.id, comparison.hash, 'fixture');
    const oldBytes = canonicalizeJson((await h.service.get('owner', comparison.id)).body);
    const next = await h.service.propose('owner', { ...input, claim: { ...input.claim, expectedValue: 0.5 }, supersedes: { id: comparison.id, hash: comparison.hash } }, 'fixture');
    assert.notEqual(next.id, comparison.id); assert.notEqual(next.hash, comparison.hash);
    assert.equal(canonicalizeJson((await h.service.get('owner', comparison.id)).body), oldBytes);
    assert.ok(canonicalizeJson(next.body).includes(first.runId), 'Server prior-exposure snapshot must retain the prior run identity.');
    assert.ok(canonicalizeJson(next.body).includes(comparison.hash), 'Predecessor hash must survive.');
    await assert.rejects(h.service.execute('owner', next.id, next.hash, 'fixture'), /review|approv/i);
    await assert.rejects(h.service.propose('owner', { ...input, supersedes: { id: comparison.id, hash: 'f'.repeat(64) } }, 'fixture'), /stale|hash|version|predecessor/i);
    await h.service.approve('owner', next.id, next.hash, 'fixture');
    const second = await h.service.execute('owner', next.id, next.hash, 'fixture');
    assert.equal(second.paperComparison.core.verdict, 'deviates');
    assert.equal((await h.service.get('owner', comparison.id)).attempts[0].runId, first.runId);
    h.restart();
    assert.equal(canonicalizeJson((await h.service.get('owner', comparison.id)).body), oldBytes);
    assert.equal((await h.service.get('owner', next.id)).attempts[0].runId, second.runId);
  } finally { h.close(); }
});

test('paper comparison: repeated execution separates deterministic core from distinct event and run identities', async () => {
  const h = await harness(); try {
    const { comparison } = await h.prepare(); await h.service.approve('owner', comparison.id, comparison.hash, 'fixture');
    const first = await h.service.execute('owner', comparison.id, comparison.hash, 'fixture');
    const second = await h.service.execute('owner', comparison.id, comparison.hash, 'fixture');
    assert.notEqual(first.runId, second.runId);
    assert.notEqual(first.paperComparison.attempt.id, second.paperComparison.attempt.id);
    assert.equal(canonicalizeJson(first.paperComparison.core), canonicalizeJson(second.paperComparison.core));
    assert.equal(first.paperComparison.coreHash, second.paperComparison.coreHash);
    assert.equal(first.paperComparison.coreHash, canonicalHash(first.paperComparison.core));
    const attempts = (await h.service.get('owner', comparison.id)).attempts;
    assert.equal(attempts.length, 2); assert.ok(attempts.every(a => a.status === 'COMPLETED'));
    assert.equal(new Set(attempts.map(a => a.sequence)).size, 2);
  } finally { h.close(); }
});

test('paper comparison: executor failure is retained across real database close/reopen; retry appends an attempt', async () => {
  const h = await harness(); try {
    const { comparison } = await h.prepare({ missingPolicy: 'fail' });
    await h.service.approve('owner', comparison.id, comparison.hash, 'fixture');
    await assert.rejects(h.service.execute('owner', comparison.id, comparison.hash, 'fixture'), /missing/i);
    const failed = (await h.service.get('owner', comparison.id)).attempts;
    assert.equal(failed.length, 1); assert.equal(failed[0].status, 'FAILED'); assert.ok(failed[0].runId);
    h.restart();
    assert.equal((await h.service.get('owner', comparison.id)).attempts[0].runId, failed[0].runId);
    await assert.rejects(h.service.execute('owner', comparison.id, comparison.hash, 'fixture'), /missing/i);
    const retried = (await h.service.get('owner', comparison.id)).attempts;
    assert.equal(retried.length, 2); assert.ok(retried.every(a => a.status === 'FAILED'));
    assert.equal(new Set(retried.map(a => a.runId)).size, 2);
  } finally { h.close(); }
});

test('paper comparison: explicit cohort retains null input, population scope and simulation labels', async () => {
  const h = await harness(); try {
    const { operation, comparison } = await h.prepare({ cohort: { rowIds: ['row-5', 'row-1', 'row-3'], quote: cohortQuote, rationale: 'Explicit software fixture selection, including a missing measurement.' } });
    await h.service.approve('owner', comparison.id, comparison.hash, 'fixture');
    const result = await h.service.execute('owner', comparison.id, comparison.hash, 'fixture');
    assert.deepEqual(result.inputs[0].entityIds, ['row-1', 'row-3', 'row-5']);
    assert.deepEqual(result.inputs[0].values, [10, 30, null]);
    assert.equal(result.artifact.results[0].statisticMetadata?.n, 2);
    assert.equal(result.paperBinding.hash, operation.hash);
    assert.equal(result.paperBinding.body.scope, 'selected_operation_explicit_cohort');
    assert.equal(result.paperBinding.body.replicability, 'NOT_YET_ESTABLISHED');
    assert.equal(result.paperBinding.body.meaning, 'SIMULATION_NOT_EMPIRICAL_EVIDENCE');
    assert.equal(result.paperComparison.core.verdict, 'reproduced');
  } finally { h.close(); }
});

test('paper comparison: revocation blocks historical reads and reapproval creates a distinct review receipt', async () => {
  const h = await harness(); try {
    const { comparison } = await h.prepare(); await h.service.approve('owner', comparison.id, comparison.hash, 'fixture');
    const result = await h.service.execute('owner', comparison.id, comparison.hash, 'fixture');
    const review = result.paperComparison.review;
    await h.service.revoke('owner', comparison.id, comparison.hash, 'fixture');
    await assert.rejects(h.service.result('owner', comparison.id, result.runId), /review|approv|revok/i);
    await h.service.approve('owner', comparison.id, comparison.hash, 'fixture');
    assert.notEqual((await h.service.get('owner', comparison.id)).review.id, review.id);
    await assert.rejects(h.service.result('owner', comparison.id, result.runId), /review|approv|revok/i);
    const newer = await h.service.execute('owner', comparison.id, comparison.hash, 'fixture');
    assert.notEqual(newer.paperComparison.review.id, review.id);
  } finally { h.close(); }
});

for (const revoke of ['comparison', 'dataset', 'method'] as const) test(`paper comparison: ${revoke} revoke/reapprove during manifest I/O invalidates the exact in-flight receipt`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T22:00:00Z').getTime() });
  const h = await harness(); try {
    const { operation, comparison } = await h.prepare(); await h.service.approve('owner', comparison.id, comparison.hash, 'fixture');
    const put = h.store.put.bind(h.store); let interrupted = false;
    h.store.put = async (key, bytes) => {
      const uri = await put(key, bytes);
      if (!interrupted && key.includes('/manifest-')) {
        interrupted = true;
        if (revoke === 'comparison') {
          await h.service.revoke('owner', comparison.id, comparison.hash, 'concurrent-revoke');
          await h.service.approve('owner', comparison.id, comparison.hash, 'concurrent-reapprove');
        } else if (revoke === 'dataset') {
          await h.wb.revokeDataset(h.dataset.id, 'owner', 'concurrent-revoke');
          await h.wb.approveDataset(h.dataset.id, 'owner', h.dataset.contentHash, true, 'concurrent-reapprove');
        } else {
          h.db.prepare('UPDATE method_specs SET approved_hash=NULL WHERE id=?').run(operation.method.id);
          h.wb.approveMethod(operation.method.id, 'owner', operation.method.hash, 'concurrent-reapprove');
        }
      }
      return uri;
    };
    await assert.rejects(h.service.execute('owner', comparison.id, comparison.hash, 'fixture'), /review|approv|receipt|revok|replac/i);
    assert.equal(interrupted, true);
    assert.equal((await h.service.get('owner', comparison.id)).attempts[0].status, 'FAILED');
    assert.equal((h.db.prepare('SELECT count(*) n FROM artifacts').get() as any).n, 0);
    h.restart(); assert.equal((await h.service.get('owner', comparison.id)).attempts[0].status, 'FAILED');
  } finally { h.close(); }
});

test('paper comparison: interrupted reservation is atomic, visible after restart and ordered without clock resolution', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T22:00:00Z').getTime() });
  const h = await harness(); try {
    const { operation, comparison } = await h.prepare(); await h.service.approve('owner', comparison.id, comparison.hash, 'fixture');
    const ref = h.repo.freeze('owner', comparison.id, comparison.hash, 'fixture');
    const config = { methodId: operation.method.id, methodHash: operation.method.hash, datasetHash: h.dataset.contentHash, selection: operation.method.selection };
    const runId = h.wb.createRun('owner', config, ref, 'fixture');
    const original = h.repo.forRun('owner', runId)!;
    assert.equal(original.review.createdAt, original.freeze.createdAt);
    assert.equal(original.freeze.createdAt, original.attempt.createdAt);
    assert.ok(original.review.sequence < original.freeze.sequence);
    assert.ok(original.freeze.sequence < original.attempt.sequence);
    const count = () => (h.db.prepare('SELECT count(*) n FROM runs').get() as any).n;
    assert.equal(count(), 1);
    assert.throws(() => h.wb.createRun('owner', config, ref, 'reuse-freeze'), /UNIQUE|freeze|attempt/i);
    assert.equal(count(), 1, 'Failed attempt reservation must roll back the new run.');
    assert.equal(h.repo.attempts('owner', comparison.id).length, 1);
    // Crash boundary: close the file without executing/finalizing the reserved run.
    h.restart();
    const interrupted = (await h.service.get('owner', comparison.id)).attempts[0];
    assert.equal(interrupted.runId, runId); assert.equal(interrupted.status, 'CREATED'); assert.equal(interrupted.resultHash, null);
    assert.equal(h.repo.forRun('owner', runId)!.attempt.id, original.attempt.id);
    const retry = await h.service.execute('owner', comparison.id, comparison.hash, 'fixture-retry');
    assert.notEqual(retry.runId, runId);
    const attempts = (await h.service.get('owner', comparison.id)).attempts;
    assert.equal(attempts.length, 2); assert.equal(attempts[0].status, 'CREATED'); assert.equal(attempts[1].status, 'COMPLETED');
    assert.throws(() => h.db.prepare('UPDATE paper_comparisons SET body_json=? WHERE id=?').run('{}', comparison.id), /WORM/i);
    assert.throws(() => h.db.prepare('UPDATE paper_comparison_events SET data_json=? WHERE id=?').run('{}', original.freeze.id), /WORM/i);
    assert.throws(() => h.db.prepare('DELETE FROM paper_comparison_attempts WHERE id=?').run(original.attempt.id), /Retain/i);
  } finally { h.close(); }
});

test('paper comparison: loss of a second owner shared dataset blocks access after I/O', async () => {
  const h = await harness(); try {
    const shared = await h.wb.importDataset(testDataset(), 'data-owner', 'fixture');
    await h.wb.approveDataset(shared.id, 'data-owner', shared.contentHash, true, 'fixture');
    const { comparison } = await h.prepare({ datasetId: shared.id, datasetHash: shared.contentHash });
    await h.service.approve('owner', comparison.id, comparison.hash, 'fixture');
    const result = await h.service.execute('owner', comparison.id, comparison.hash, 'fixture');
    const get = h.store.get.bind(h.store); let revoked = false;
    h.store.get = async uri => {
      const bytes = await get(uri);
      if (!revoked && uri.includes('/manifest-')) {
        revoked = true;
        h.db.prepare("UPDATE datasets SET visibility='private' WHERE id=?").run(shared.id);
      }
      return bytes;
    };
    await assert.rejects(h.service.result('owner', comparison.id, result.runId), /dataset|approv|access|revok/i);
    assert.equal(revoked, true);
    assert.ok(await h.wb.getDataset(shared.id, 'data-owner'));
    assert.equal(await h.wb.getDataset(shared.id, 'owner'), null);
  } finally { h.close(); }
});

test('paper comparison: late dataset revoke/reapprove during the final read cannot expose stale approved output', async () => {
  const h = await harness(); try {
    const { comparison } = await h.prepare(); await h.service.approve('owner', comparison.id, comparison.hash, 'fixture');
    const result = await h.service.execute('owner', comparison.id, comparison.hash, 'fixture');
    const get = h.store.get.bind(h.store); let sawManifest = false, changed = false;
    h.store.get = async uri => {
      const bytes = await get(uri);
      if (uri.includes('/manifest-')) sawManifest = true;
      else if (sawManifest && !changed && uri.includes('/raw/')) {
        changed = true;
        await h.wb.revokeDataset(h.dataset.id, 'owner', 'late-revoke');
        await h.wb.approveDataset(h.dataset.id, 'owner', h.dataset.contentHash, true, 'late-reapprove');
      }
      return bytes;
    };
    await assert.rejects(h.service.result('owner', comparison.id, result.runId), /approv|receipt|revok|replac|chang/i);
    assert.equal(changed, true);
  } finally { h.close(); }
});

test('paper comparison: server prior exposure enumerates more than the legacy 100-run summary', async () => {
  const h = await harness(); try {
    const { comparison, input } = await h.prepare({ missingPolicy: 'fail' });
    await h.service.approve('owner', comparison.id, comparison.hash, 'fixture');
    // Intentional executor failures are cheap and count as known prior exposure attempts.
    for (let i = 0; i < 101; i++) await assert.rejects(h.service.execute('owner', comparison.id, comparison.hash, `fixture-${i}`), /missing/i);
    const all = (await h.service.get('owner', comparison.id)).attempts;
    assert.equal(all.length, 101);
    const next = await h.service.propose('owner', { ...input, supersedes: { id: comparison.id, hash: comparison.hash } }, 'fixture');
    assert.equal(next.body.priorExposure.operationRuns.length, 101);
    const exposure = canonicalizeJson(next.body);
    for (const attempt of all) assert.ok(exposure.includes(attempt.runId), `Prior attempt ${attempt.runId} was omitted.`);
    h.restart(); assert.equal((await h.service.get('owner', comparison.id)).attempts.length, 101);
  } finally { h.close(); }
});

test('paper comparison: local-account adoption preserves archived bytes and grants the new owner access', async () => {
  const h = await harness('local-user'); try {
    const { operation, comparison } = await h.prepare();
    await h.service.approve('local-user', comparison.id, comparison.hash, 'fixture');
    const result = await h.service.execute('local-user', comparison.id, comparison.hash, 'fixture');
    const before = await h.operations.export('local-user', operation.id, result.runId);
    const principals = new PrincipalRepository(h.db);
    principals.upsertOnSignIn({ id: 'account-owner', email: null, displayName: 'Fictional account', role: 'researcher', identityProvenance: 'fixture', at: new Date().toISOString() });
    const moved = principals.migrateLocalUserRows('account-owner');
    assert.equal(moved.paper_comparisons, 1);
    await assert.rejects(h.service.get('local-user', comparison.id), /owned|not found|owner/i);
    assert.equal((await h.service.get('account-owner', comparison.id)).hash, comparison.hash);
    const historical = await h.service.result('account-owner', comparison.id, result.runId);
    assert.equal(historical.result.paperComparison.review.actorId, 'local-user');
    assert.deepEqual(historical.result.paperComparison, result.paperComparison);
    const after = await h.operations.export('account-owner', operation.id, result.runId);
    const beforeResult = readZip(before.bytes).find(e => e.name === 'analysis/result.json')!.content;
    const afterResult = readZip(after.bytes).find(e => e.name === 'analysis/result.json')!.content;
    assert.deepEqual(afterResult, beforeResult, 'Ownership adoption must not rewrite historical result bytes.');
    const resumed = await h.service.execute('account-owner', comparison.id, comparison.hash, 'post-adoption-fixture');
    assert.notEqual(resumed.runId, result.runId);
    assert.equal(resumed.paperComparison.review.actorId, 'local-user');
    assert.equal(resumed.paperComparison.attempt.actorId, 'account-owner');
    assert.equal((await h.service.result('account-owner', comparison.id, result.runId)).result.hash, historical.result.hash);
    const resumedPackage = await h.operations.export('account-owner', operation.id, resumed.runId), target = path.join(h.dir, 'adopted');
    for (const e of readZip(resumedPackage.bytes)) { const file = path.join(target, e.name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, e.content); }
    const verified = spawnSync(process.execPath, [path.join(target, 'verify.mjs'), target, resumedPackage.manifestHash], { encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stdout + verified.stderr);
    h.restart(); assert.equal((await h.service.get('account-owner', comparison.id)).attempts[0].runId, result.runId);
  } finally { h.close(); }
});

test('paper comparison export: portable verifier rejects changed bytes and internally rehashed false verdicts; legacy remains readable', async () => {
  const h = await harness(); try {
    const { operation, comparison } = await h.prepare(); await h.service.approve('owner', comparison.id, comparison.hash, 'fixture');
    const result = await h.service.execute('owner', comparison.id, comparison.hash, 'fixture');
    const pkg = await h.operations.export('owner', operation.id, result.runId), entries = readZip(pkg.bytes);
    const target = path.join(h.dir, 'export');
    const entry = (name: string) => { const found = entries.find(e => e.name === name); assert.ok(found, `${name} must be exported`); return found; };
    const json = (name: string) => JSON.parse(entry(name).content.toString());
    const put = (name: string, value: unknown) => { entry(name).content = Buffer.from(canonicalizeJson(value)); };
    const write = () => { for (const e of entries) { const file = path.join(target, e.name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, e.content); } };
    const verify = (hash: string) => spawnSync(process.execPath, [path.join(target, 'verify.mjs'), target, hash], { encoding: 'utf8' });
    assert.equal(json('package-manifest.json').version, 'watchdog-research-package-2');
    assert.equal(json('research/comparison.json').comparison.hash, comparison.hash);
    assert.equal(json('dataset.json').rows.length, 5);
    assert.match(entry('COMPARISON.md').content.toString(), /does not recompute|not recompute/i);
    write(); const good = verify(pkg.manifestHash); assert.equal(good.status, 0, good.stdout + good.stderr);
    const again = await h.operations.export('owner', operation.id, result.runId);
    assert.deepEqual(pkg.bytes, again.bytes, 'Repeated immutable-attempt export must be byte identical.');
    writeFileSync(path.join(target, 'research/comparison.json'), '{}');
    const bytesChanged = verify(pkg.manifestHash); assert.notEqual(bytesChanged.status, 0);
    write();
    // Repair all content hashes after each independent semantic edit. These
    // cases must fail even when the caller supplies the replacement manifest hash.
    const originals = entries.map(e => ({ ...e, content: Buffer.from(e.content) }));
    const mutations: [string, (value: any) => void][] = [
      ['false verdict', value => { value.core.verdict = 'deviates'; value.core.withinTolerance = false; }],
      ['false rationale', value => { value.core.rationale = 'A fabricated description inconsistent with the deterministic evaluator.'; }],
      ['unit substitution', value => { value.core.observedUnit = 'percent'; }],
      ['reversed freeze chronology', value => { value.freeze.sequence = value.review.sequence; }],
      ['wrong source anchor', value => { value.comparison.body.source.anchor.startUtf16++; }],
    ];
    for (const [label, mutate] of mutations) {
      for (const original of originals) entry(original.name).content = Buffer.from(original.content);
      let altered = json('research/comparison.json'); mutate(altered);
      const oldHash = altered.comparison.hash, newHash = canonicalHash(altered.comparison.body);
      // Propagate a changed comparison identity into its receipt/config references.
      altered = JSON.parse(JSON.stringify(altered).replaceAll(oldHash, newHash));
      altered.run.effectiveConfigHash = canonicalHash(altered.run.effectiveConfig);
      altered.coreHash = canonicalHash(altered.core); put('research/comparison.json', altered);
      const analysis = json('analysis/result.json'); analysis.paperComparison = altered; put('analysis/result.json', analysis);
      const resultHash = canonicalHash(analysis), figure = json('figure.json'); figure.analysis.resultHash = resultHash; put('figure.json', figure);
      const workspace = json('workspace.json'); workspace.figure = figure; put('workspace.json', workspace);
      const manifest = json('analysis/manifest.json'); manifest.outputs[0].sha256 = resultHash; put('analysis/manifest.json', manifest);
      const outer = json('package-manifest.json'); outer.identity.resultHash = resultHash; outer.identity.figureHash = canonicalHash(figure);
      outer.identity.analysisManifestHash = canonicalHash(manifest); outer.identity.comparisonCoreHash = altered.coreHash; outer.identity.comparisonHash = altered.comparison.hash;
      outer.files = outer.files.map((item: any) => { const e = entry(item.path); return { ...item, bytes: e.content.length, sha256: createHash('sha256').update(e.content).digest('hex') }; });
      put('package-manifest.json', outer); write();
      const changed = verify(canonicalHash(outer));
      assert.notEqual(changed.status, 0, `${label} unexpectedly verified`); assert.match(changed.stderr, /comparison|arithmetic|verdict|core|source|anchor|chronology/i, label);
    }
    // The established no-comparison package remains format 1 and verifies.
    const oldRun = await h.operations.execute('owner', operation.id, operation.hash, 'legacy-fixture');
    const legacy = await h.operations.export('owner', operation.id, oldRun.runId);
    const oldEntries = readZip(legacy.bytes), oldTarget = path.join(h.dir, 'legacy');
    assert.equal(JSON.parse(oldEntries.find(e => e.name === 'package-manifest.json')!.content.toString()).version, 'watchdog-research-package-1');
    for (const e of oldEntries) { const file = path.join(oldTarget, e.name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, e.content); }
    const oldVerified = spawnSync(process.execPath, [path.join(oldTarget, 'verify.mjs'), oldTarget, legacy.manifestHash], { encoding: 'utf8' });
    assert.equal(oldVerified.status, 0, oldVerified.stdout + oldVerified.stderr);
  } finally { h.close(); }
});
