import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { testDataset } from '../helpers/workbench';
import { readZip } from '../../backend/watchdog_api/utils/zip';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';

// Production bundle, real HTTP/API/storage/browser. All approvals below concern synthetic fixtures.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-comparison-ui-'));
const profile = JSON.parse(fs.readFileSync('config/paper-operation-ui.json', 'utf8')).comparison;
let server: ChildProcess, browser: Browser, page: Page, baseUrl: string;
let log = '';
before(async () => {
  baseUrl = `http://127.0.0.1:${6100 + Math.floor(Math.random() * 400)}`;
  server = spawn(process.execPath, ['dist/server.cjs'], { detached: true, stdio: 'pipe', env: { ...process.env,
    PORT: baseUrl.split(':').pop(), DB_PATH: path.join(scratch, 'watchdog.sqlite'), STORE_PATH: path.join(scratch, 'blobs'),
    NODE_ENV: 'production', WATCHDOG_DIAGNOSTICS_MODE: 'OFF', WATCHDOG_ALLOW_OPEN_INSTANCE: 'true', WATCHDOG_ALLOW_EPHEMERAL_STORAGE: 'true' } });
  server.stdout?.on('data', chunk => { log += chunk.toString(); }); server.stderr?.on('data', chunk => { log += chunk.toString(); });
  let ready = false;
  for (let i = 0; i < 150; i++) { try { if ((await fetch(`${baseUrl}/api/auth/me`)).ok) { ready = true; break; } } catch { /* starting */ } await new Promise(resolve => setTimeout(resolve, 200)); }
  assert.ok(ready, log);
  browser = await chromium.launch({ ...(process.env.WATCHDOG_TEST_CHROMIUM ? { executablePath: process.env.WATCHDOG_TEST_CHROMIUM } : {}) });
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true }); page.setDefaultTimeout(20_000);
});
after(async () => { await browser?.close(); if (server?.pid) try { process.kill(-server.pid, 'SIGKILL'); } catch { /* closed */ }
  fs.rmSync(scratch, { recursive: true, force: true }); });
const call = async (route: string, body?: unknown) => {
  const response = await fetch(baseUrl + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
};
const claimQuote = 'In this synthetic fixture Pearson r is 1 (dimensionless).';
async function fixture(key: string, fail = false) {
  const data = testDataset(); data.key = key;
  const { record } = await call('/api/workbench/datasets', data);
  await call(`/api/workbench/datasets/${record.id}/approve`, { expectedHash: record.contentHash, shareAggregate: false });
  const methodQuote = 'Pearson correlation compares the two fictional columns.', cohortQuote = 'Rows one, three and five are selected for this software test.';
  const { document } = await call('/api/research/papers', { title: key, source: `fixture:${key}`, text: `${methodQuote} ${cohortQuote} ${claimQuote}`, coverage: 'excerpt', language: 'en', geography: [] });
  const { operation } = await call('/api/research/operations', { source: { kind: 'manual_quote', documentId: document.id, documentHash: document.hash, quote: methodQuote },
    method: 'pearson', datasetId: record.id, datasetHash: record.contentHash,
    bindings: ['interest', 'mentions'].map((column, i) => ({ role: i ? 'b' : 'a', column, origin: 'synthetic_scenario', rationale: 'Fictional software inputs.', requirementId: null, substitution: null })),
    missingPolicy: fail ? 'fail' : 'exclude', scopeNote: 'Synthetic comparison; no independent replication.',
    cohort: { rowIds: ['row-1', 'row-3', 'row-5'], quote: cohortQuote, rationale: 'Exploratory software fixture with retained missingness.' } });
  await call(`/api/research/operations/${operation.id}/approve`, { expectedHash: operation.hash, methodHash: operation.method.hash });
  return operation;
}
async function openOperation(id: string) { await page.goto(`${baseUrl}/research`); await page.getByRole('button', { name: 'Analizy prac', exact: true }).click();
  await page.getByLabel('Zapisany plan', { exact: true }).selectOption(id); await page.getByTestId('paper-comparison').waitFor(); }
async function fillClaim() {
  await page.getByLabel(profile.quoteLabel, { exact: true }).fill(claimQuote);
  await page.getByLabel(profile.expectedLabel, { exact: true }).fill('1'); await page.getByLabel(profile.unitLabel, { exact: true }).fill('dimensionless');
  await page.getByLabel(profile.rationaleLabel, { exact: true }).fill('Manual interpretation of a retained synthetic source claim.');
  await page.getByLabel(profile.toleranceValueLabel, { exact: true }).fill('0.000001');
  await page.getByLabel(profile.toleranceRationaleLabel, { exact: true }).fill('Explicit software test tolerance chosen before execution.');
  await page.getByRole('button', { name: profile.saveLabel, exact: true }).click(); await page.getByTestId('paper-comparison-review').waitFor();
}
async function approve() { await page.getByLabel(profile.reviewLabel, { exact: true }).check(); await page.getByRole('button', { name: profile.approveLabel, exact: true }).click();
  await page.getByRole('button', { name: profile.executeLabel, exact: true }).waitFor(); }

test('E5.7d browser: human review, frozen fresh run, reload, portable export and immutable null revision', async () => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const operation = await fixture('comparison-browser-synthetic'); await openOperation(operation.id);
  assert.match(await page.getByTestId('paper-cohort-review').textContent() ?? '', /3 z 5/);
  assert.match(await page.getByTestId('paper-operation-review').textContent() ?? '', /synthetic_scenario/);
  assert.equal(await page.getByRole('button', { name: profile.saveLabel, exact: true }).isDisabled(), true);
  await fillClaim();
  assert.equal(await page.getByRole('button', { name: profile.approveLabel, exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: profile.executeLabel, exact: true }).count(), 0);
  await approve();
  const first = (await call(`/api/research/comparisons?operationId=${operation.id}`)).comparisons[0];
  assert.equal(first.attempts.length, 0); assert.ok(first.review);
  await page.getByRole('button', { name: profile.executeLabel, exact: true }).click(); await page.getByTestId('paper-comparison-result').waitFor();
  const completed = (await call(`/api/research/comparisons/${first.id}`)).comparison;
  assert.equal(completed.attempts.length, 1); assert.ok(completed.attempts[0].resultHash);
  await openOperation(operation.id);
  await page.getByTestId('paper-comparison-history').getByRole('button').filter({ hasText: first.id }).click();
  await page.getByRole('button', { name: profile.showResultLabel, exact: true }).click(); await page.getByTestId('paper-comparison-result').waitFor();
  assert.match(await page.getByTestId('paper-comparison-result').textContent() ?? '', /reproduced/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: profile.exportLabel, exact: true }).click()]);
  const entries = readZip(fs.readFileSync((await download.path())!)), exported = path.join(scratch, 'exported'); fs.mkdirSync(exported);
  for (const entry of entries) { const filename = path.join(exported, entry.name); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, entry.content); }
  const manifest = JSON.parse(entries.find(e => e.name === 'package-manifest.json')!.content.toString());
  const verified = spawnSync(process.execPath, [path.join(exported, 'verify.mjs'), exported, canonicalHash(manifest)], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(verified.status, 0, verified.stderr); assert.equal(JSON.parse(entries.find(e => e.name === 'dataset.json')!.content.toString()).rows.length, 5);
  await page.getByRole('button', { name: profile.reviseLabel, exact: true }).click();
  await page.getByLabel(profile.expectedMissingLabel, { exact: true }).check(); await page.getByLabel(profile.unitMissingLabel, { exact: true }).check();
  await page.getByRole('button', { name: profile.saveLabel, exact: true }).click(); await page.getByTestId('paper-comparison-review').waitFor();
  assert.equal(await page.getByRole('button', { name: profile.approveLabel, exact: true }).isDisabled(), true, 'new revision needs its own deliberate review');
  const revisions = (await call(`/api/research/comparisons?operationId=${operation.id}`)).comparisons;
  assert.equal(revisions.length, 2); const second = revisions.find((c: any) => c.id !== first.id);
  assert.equal(second.body.claim.expectedValue, null); assert.equal(second.body.claim.unit, null); assert.deepEqual(second.body.supersedes, { id: first.id, hash: first.hash }); assert.equal(second.review, null);
  assert.deepEqual((await call(`/api/research/comparisons/${first.id}`)).comparison.body.claim, first.body.claim);
  await page.getByTestId('paper-comparison-exposure').locator('summary').click();
  assert.match(await page.getByTestId('paper-comparison-exposure').textContent() ?? '', new RegExp(completed.attempts[0].runId));
  const width = await page.locator('main').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth })); assert.ok(width.scroll <= width.width + 1, JSON.stringify(width));
  assert.deepEqual(errors, []);
});

test('E5.7d browser: executor failure stays visible as a durable attempt after reload', async () => {
  const operation = await fixture('comparison-browser-failure', true); await openOperation(operation.id); await fillClaim(); await approve();
  await page.getByRole('button', { name: profile.executeLabel, exact: true }).click();
  await page.getByTestId('paper-comparison-attempt').waitFor();
  const comparison = (await call(`/api/research/comparisons?operationId=${operation.id}`)).comparisons[0];
  assert.equal(comparison.attempts.length, 1); assert.equal(comparison.attempts[0].resultHash, null);
  assert.match(comparison.attempts[0].status, /ERROR|FAILED|INTERRUPTED/);
  await openOperation(operation.id); await page.getByTestId('paper-comparison-history').getByRole('button').filter({ hasText: comparison.id }).click();
  assert.match(await page.getByTestId('paper-comparison-attempt').textContent() ?? '', new RegExp(comparison.attempts[0].runId));
  assert.equal(await page.getByRole('button', { name: profile.exportLabel, exact: true }).count(), 0);
});
