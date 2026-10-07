import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {
  routesOf, apiEndpointsOf, capabilitiesOf, compareInventory, importClosure, numericalViolations,
  skipCiViolations, browserLaunchViolations, testSkipViolations, ledgerDuplicates, type Inventory,
} from '../../scripts/guard/checks';

/**
 * The principles guard must catch the mistakes that actually happened on this
 * project: code merged with [skip ci], features silently lost in a rewrite,
 * an edited migration, browser suites with private launchers, a task ID used
 * twice. Each case below is one of those, in miniature.
 */

const inv = (over: Partial<Inventory> = {}): Inventory => ({
  routes: ['/', 'login', 'runs'], api: ['GET /runs (routes.ts)'], capabilities: ['run.view'],
  migrations: { '001_initial.ts': 'aaa', '002_next.ts': 'bbb' }, ...over,
});

test('guard: inventory parsers read routes, endpoints and capabilities', () => {
  assert.deepEqual(routesOf('<Route path="login" element={<L/>} />\n<Route index element={<D/>}/>\n<Route key={a} path="runs/:id" />'), ['login', 'runs/:id']);
  assert.deepEqual(apiEndpointsOf('x/routes.ts', "router.get('/runs', h); apiRouter.post(\"/runs/:id/x\", h); fetch.get(url)"),
    ['GET /runs (routes.ts)', 'POST /runs/:id/x (routes.ts)']);
  assert.deepEqual(capabilitiesOf("export const CAPABILITIES = [\n 'run.view', 'run.create',\n] as const;"), ['run.create', 'run.view']);
});

test('guard: a feature that disappears fails unless its removal is approved with a reason', () => {
  const lost = compareInventory(inv(), inv({ routes: ['/', 'login'] }), []);
  assert.deepEqual(lost.removed, ['route runs']);
  const approved = compareInventory(inv(), inv({ routes: ['/', 'login'] }),
    [{ item: 'route runs', reason: 'merged into /history', approved_by: 'owner', date: '2026-10-03' }]);
  assert.deepEqual(approved.removed, []); assert.deepEqual(approved.approved, ['route runs']);
  const noReason = compareInventory(inv(), inv({ routes: ['/', 'login'] }), [{ item: 'route runs', reason: ' ', approved_by: 'owner', date: '' }]);
  assert.deepEqual(noReason.removed, ['route runs'], 'an approval without a reason is not an approval');
  assert.deepEqual(compareInventory(inv(), inv({ capabilities: ['run.view', 'run.export'] }), []).added, ['capability run.export']);
});

test('guard: an existing migration may never change, a new one may be added', () => {
  const edited = compareInventory(inv(), inv({ migrations: { '001_initial.ts': 'aaa', '002_next.ts': 'CHANGED' } }), []);
  assert.deepEqual(edited.changedMigrations, ['002_next.ts']);
  const appended = compareInventory(inv(), inv({ migrations: { '001_initial.ts': 'aaa', '002_next.ts': 'bbb', '003_more.ts': 'ccc' } }), []);
  assert.deepEqual(appended.changedMigrations, []); assert.deepEqual(appended.added, ['migration 003_more.ts']);
});

test('guard: a language model reachable from the numerical path is reported with its import chain', () => {
  const files: Record<string, string> = {
    'b/analysis/executor.ts': "import { mean } from './stats';\nimport type { X } from '../domain/types';",
    'b/analysis/stats.ts': "import { explain } from '../services/narrative';",
    'b/services/narrative.ts': "import { complete } from '../llm/client';",
    'b/llm/client.ts': 'export const complete = 1;',
    'b/domain/types.ts': 'export type X = 1;',
    'b/analysis/clean.ts': "export const ok = (xs: number[]) => xs.length;",
    'b/analysis/random.ts': 'export const r = () => Math.random();',
  };
  const read = (p: string) => files[p.split('\\').join('/')];
  const exists = (p: string) => p.split('\\').join('/') in files;
  const closure = importClosure(['b/analysis/executor.ts'], read, exists);
  assert.deepEqual([...closure.keys()].sort(), ['b/analysis/executor.ts', 'b/analysis/stats.ts', 'b/llm/client.ts', 'b/services/narrative.ts']);
  const v = numericalViolations(closure, ['b/llm', 'b/services/narrative.ts'], ['Math.random('], read);
  assert.equal(v.length, 2);
  assert.match(v.join('\n'), /b\/llm\/client\.ts is reachable from the numerical path: b\/analysis\/executor\.ts → b\/analysis\/stats\.ts → b\/services\/narrative\.ts → b\/llm\/client\.ts/);
  assert.deepEqual(numericalViolations(importClosure(['b/analysis/clean.ts'], read, exists), ['b/llm'], ['Math.random('], read), []);
  assert.match(numericalViolations(importClosure(['b/analysis/random.ts'], read, exists), [], ['Math.random('], read)[0], /Math\.random/);
});

test('guard: type-only imports are not runtime edges', () => {
  const files: Record<string, string> = {
    'b/analysis/x.ts': "import type { Model } from '../llm/client';\nexport type { Y } from '../llm/types';\nexport const f = 1;",
    'b/llm/client.ts': '', 'b/llm/types.ts': '',
  };
  const closure = importClosure(['b/analysis/x.ts'], p => files[p], p => p in files);
  assert.deepEqual([...closure.keys()], ['b/analysis/x.ts']);
});

test('guard: [skip ci] is allowed for documentation, not for code', () => {
  const docs = ['docs/', 'README.md'];
  assert.deepEqual(skipCiViolations([{ sha: 'a'.repeat(40), message: 'docs: notes [skip ci]', files: ['docs/x.md', 'README.md'] }], docs), []);
  const v = skipCiViolations([
    { sha: 'b'.repeat(40), message: 'Finish auth: 613 tests [skip ci]', files: ['docs/x.md', 'backend/a.ts'] },
    { sha: 'c'.repeat(40), message: 'feat: normal', files: ['backend/a.ts'] },
  ], docs);
  assert.deepEqual(v, ['bbbbbbb skips CI but changes 1 non-documentation file(s), e.g. backend/a.ts']);
});

test('guard: browser suites must use the shared launcher; tests may not be skipped', () => {
  const v = browserLaunchViolations({
    'tests/e2e/a.test.ts': "browser = await chromium.launch({ executablePath: resolveChromium() });",
    'tests/e2e/b.test.ts': 'browser = await chromium.launch();',
    'tests/e2e/c.test.ts': 'function resolveChromium() {}\nchromium.launch({ executablePath: resolveChromium() })',
  }, 'resolveChromium');
  assert.deepEqual(v, ['tests/e2e/b.test.ts launches Chromium without the shared resolveChromium()',
    'tests/e2e/c.test.ts defines its own resolveChromium() instead of importing tests/helpers/browser.ts']);
  assert.deepEqual(testSkipViolations({ 'tests/x.test.ts': "test.skip('flaky', ...)", 'tests/y.test.ts': 'ok' }, ['test.skip(']),
    ['tests/x.test.ts contains test.skip(']);
});

test('guard: a task ID with two meanings is reported; follow-up notes are not duplicates', () => {
  const ledger = '- [x] **E2.1 — OpenRouter**\n- [x] **E2.1 — Entity alignment**\n- [x] **E4.7 — Accounts**\n- [x] **E4.7 follow-up:** fixes';
  assert.deepEqual(ledgerDuplicates(ledger), ['E2.1']);
});

test('guard: the shipped policy names real paths and every manual rule is a known principle', () => {
  const policy = JSON.parse(fs.readFileSync('config/guard/policy.json', 'utf8'));
  for (const p of [...policy.numerical.roots, policy.inventory.frontend_routes_file, policy.inventory.capabilities_file,
    policy.inventory.migrations_dir, policy.ledger.file, policy.tests.browser_dir]) assert.ok(fs.existsSync(p), p);
  const principles = fs.readFileSync('docs/PRINCIPLES.md', 'utf8');
  for (const m of policy.manual) assert.match(principles, new RegExp(`\\| ${m.principle} \\|`), m.principle);
  assert.match(policy.baseline_commit, /^[0-9a-f]{40}$/);
});
