import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { resolveChromium } from '../helpers/browser';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { testDataset } from '../helpers/workbench';
import { readZip } from '../../backend/watchdog_api/utils/zip';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';

// E5.7b.1 in the production bundle, real HTTP/storage/browser, phone width. Synthetic fixtures only.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-family-ui-'));
const profile = JSON.parse(fs.readFileSync('config/paper-operation-ui.json', 'utf8')).family;
let server: ChildProcess, browser: Browser, page: Page, baseUrl: string;
let log = '';
before(async () => {
  baseUrl = `http://127.0.0.1:${6500 + Math.floor(Math.random() * 400)}`;
  server = spawn(process.execPath, ['dist/server.cjs'], { detached: true, stdio: 'pipe', env: { ...process.env,
    PORT: baseUrl.split(':').pop(), DB_PATH: path.join(scratch, 'watchdog.sqlite'), STORE_PATH: path.join(scratch, 'blobs'),
    NODE_ENV: 'production', WATCHDOG_DIAGNOSTICS_MODE: 'OFF', WATCHDOG_ALLOW_OPEN_INSTANCE: 'true', WATCHDOG_ALLOW_EPHEMERAL_STORAGE: 'true' } });
  server.stdout?.on('data', chunk => { log += chunk.toString(); }); server.stderr?.on('data', chunk => { log += chunk.toString(); });
  let ready = false;
  for (let i = 0; i < 150; i++) { try { if ((await fetch(`${baseUrl}/api/auth/me`)).ok) { ready = true; break; } } catch { /* starting */ } await new Promise(resolve => setTimeout(resolve, 200)); }
  assert.ok(ready, log);
  browser = await chromium.launch({ executablePath: resolveChromium() });
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

async function reviewedComparison(operation: any, failing = false) {
  const { comparison } = await call('/api/research/comparisons', { operationId: operation.id, operationHash: operation.hash, supersedes: null,
    claim: { quote: claimQuote, expectedValue: 1, unit: 'dimensionless', statistic: 'pearson', rationale: 'Synthetic fixture claim.',
      tolerance: { kind: 'absolute', value: 0.000001, rationale: 'Software test tolerance chosen before execution.' } } });
  await call(`/api/research/comparisons/${comparison.id}/approve`, { expectedHash: comparison.hash });
  return comparison;
}

test('E5.7b.1 browser: a family is frozen from reviewed comparisons and reports every member against its denominator', async () => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const operation = await fixture('family-fixture');
  const comparison = await reviewedComparison(operation);
  await page.goto(`${baseUrl}/research`); await page.getByRole('button', { name: 'Analizy prac', exact: true }).click();
  await page.getByLabel('Zapisany plan', { exact: true }).selectOption(operation.id);
  const section = page.getByTestId('comparison-families'); await section.waitFor();
  await section.getByTestId(`family-member-${comparison.id}`).check();
  await section.getByLabel(profile.titleLabel, { exact: true }).fill('All fixture claims');
  await section.getByLabel(profile.rationaleLabel, { exact: true }).fill('Every reviewed claim, fixed before running.');
  await section.getByTestId('family-create').click();
  await section.getByRole('status').filter({ hasText: profile.createdNotice }).waitFor();
  const card = section.getByTestId('family-card').first();
  await card.getByTestId('family-summary').filter({ hasText: `1 ${profile.outcomes.not_run}` }).waitFor();
  await card.getByTestId('family-execute').click();
  await card.getByTestId('family-summary').filter({ hasText: `1 ${profile.outcomes.reproduced}` }).waitFor();
  assert.match(await card.getByTestId('family-summary').innerText(), new RegExp(`^1 ${profile.denominatorLabel}`));
  assert.equal(await card.getByTestId('family-outcome').getAttribute('data-outcome'), 'reproduced');
  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(width.scroll <= width.client + 1, `no sideways scrolling on a phone: ${JSON.stringify(width)}`);
  fs.mkdirSync('test-artifacts', { recursive: true });
  await card.screenshot({ path: 'test-artifacts/comparison-family-phone.png' });
  const stored = await call(`/api/research/comparison-families?documentId=${encodeURIComponent(operation.body.document.id)}`);
  assert.equal(stored.families.length, 1); assert.equal(stored.families[0].summary.denominator, 1);
  assert.deepEqual(errors, []);
});
