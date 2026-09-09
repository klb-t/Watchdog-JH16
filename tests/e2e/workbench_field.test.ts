import { test, before, after, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { testDataset } from '../helpers/workbench';
import { testSample, testAssertion } from '../helpers/field';

// Runs in CI's Chromium against the real production bundle and isolated storage.
// No clinical record or live source is approved by these tests.
const root = mkdtempSync(path.join(tmpdir(), 'watchdog-browser-'));
const artifacts = path.resolve('test-artifacts');
let browser: Browser, context: BrowserContext, page: Page, server: ChildProcess, base: string;
let serverLog = ''; const browserErrors: string[] = [];
before(async () => {
  mkdirSync(artifacts, { recursive: true });
  if (!existsSync('dist/server.cjs')) execFileSync('npm', ['run', 'build'], { timeout: 60_000, stdio: 'pipe' });
  const port = 4100 + Math.floor(Math.random() * 500); base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['dist/server.cjs'], { detached: true, stdio: 'pipe', env: { ...process.env,
    PORT: String(port), NODE_ENV: 'production', DB_PATH: path.join(root, 'db.sqlite'), STORE_PATH: path.join(root, 'store'),
    WATCHDOG_DIAGNOSTICS_DIR: path.join(root, 'diagnostics'), WATCHDOG_DIAGNOSTICS_MODE: 'TRACE',
    WATCHDOG_ALLOW_OPEN_INSTANCE: 'true', WATCHDOG_ALLOW_EPHEMERAL_STORAGE: 'true' } });
  server.stdout?.on('data', bytes => { serverLog += String(bytes); }); server.stderr?.on('data', bytes => { serverLog += String(bytes); });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/auth/me')).ok) { ready = true; break; } } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, serverLog);
  browser = await chromium.launch(); context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  page = await context.newPage(); page.setDefaultTimeout(15_000); page.on('pageerror', error => browserErrors.push(error.message));
});
afterEach(async t => {
  if (page) {
    const name = t.name.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 90);
    await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: true });
    writeFileSync(path.join(artifacts, `${name}.html`), await page.content());
  }
  await context?.setOffline(false);
});
after(async () => {
  writeFileSync(path.join(artifacts, 'browser-errors.json'), JSON.stringify(browserErrors, null, 2));
  writeFileSync(path.join(artifacts, 'server.log'), serverLog);
  await browser?.close(); if (server?.pid) try { process.kill(-server.pid, 'SIGKILL'); } catch { /* exited */ }
  rmSync(root, { recursive: true, force: true });
});

test('E6 browser: individual source review, live lookup, offline reload and audit synchronization', async () => {
  await page.goto(base + '/evidence');
  for (const document of [testSample(), testAssertion()]) {
    await page.getByLabel('Import a reference mapping (JSON)').fill(JSON.stringify(document));
    await page.getByRole('button', { name: 'Import as proposed', exact: true }).click();
    await page.getByLabel(/I checked this exact mapping/).check();
    await page.getByRole('button', { name: 'Approve this mapping', exact: true }).click();
    await page.getByRole('button', { name: 'Revoke this mapping', exact: true }).waitFor();
  }
  await page.goto(base + '/responder');
  await page.getByText(/2 approved references synchronized/).waitFor();
  await page.getByLabel('Pill name or logo', { exact: true }).fill('X');
  await page.getByLabel('Color', { exact: true }).selectOption('green');
  await page.getByLabel('Region', { exact: true }).selectOption('NL-NB');
  await page.getByRole('button', { name: 'Find references', exact: true }).click();
  await page.getByRole('heading', { name: 'Fictional Green X', exact: true }).waitFor();
  await page.locator('summary').filter({ hasText: 'Fictional A' }).click();
  await page.getByText('Fictional interaction used only to verify software behavior.', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifacts, 'responder-online.png'), fullPage: true });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true); await page.reload();
  await page.getByText(/Offline snapshot available/).waitFor();
  await page.getByLabel('Pill name or logo', { exact: true }).fill('X');
  await page.getByRole('button', { name: 'Find references', exact: true }).click();
  await page.getByRole('heading', { name: 'Fictional Green X', exact: true }).waitFor();
  await page.getByText(/Offline: 1 lookup audit events pending upload/).waitFor();
  await page.screenshot({ path: path.join(artifacts, 'responder-offline.png'), fullPage: true });
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Synchronize offline references', exact: true }).click();
  await page.getByText(/2 approved references synchronized/).waitFor();
  assert.equal(await page.getByText(/lookup audit events pending upload/).count(), 0);
});

test('E5 browser: regional figures, 3D camera, context tools, statistics, favourites and publication export', async () => {
  await page.goto(base + '/workbench');
  await page.getByText('Import a versioned dataset · JSON or CSV', { exact: true }).click();
  await page.getByLabel('Mapped dataset JSON', { exact: true }).fill(JSON.stringify(testDataset()));
  await page.getByRole('button', { name: 'Import JSON as proposed', exact: true }).click();
  await page.getByLabel(/I checked the source, column mapping/).check();
  await page.getByLabel(/Share this reviewed aggregate dataset/).check();
  await page.getByRole('button', { name: 'Approve this dataset mapping', exact: true }).click();
  await page.getByLabel('X channel', { exact: true }).selectOption('interest');
  await page.getByLabel('Y channel', { exact: true }).selectOption('mentions');
  await page.getByLabel('Z channel', { exact: true }).selectOption('sentiment');
  await page.getByLabel('COLOR channel', { exact: true }).selectOption('language');
  await page.getByLabel('ALPHA channel', { exact: true }).selectOption('sentiment');
  await page.getByLabel('View type', { exact: true }).selectOption('scatter3d');
  await page.getByText('Publication style and camera', { exact: true }).click();
  const point = page.locator('svg [data-row-id="row-1"]'); const initial = await point.locator('circle').getAttribute('cx');
  await page.getByLabel('Camera yaw', { exact: true }).focus(); await page.getByLabel('Camera yaw', { exact: true }).press('End');
  assert.notEqual(await point.locator('circle').getAttribute('cx'), initial);
  await point.focus(); await point.press('Shift+F10');
  await page.getByRole('dialog', { name: 'Context tools' }).getByRole('button', { name: 'Pearson correlation', exact: true }).click();
  await page.getByLabel(/I reviewed these exact inputs/).check();
  await page.getByRole('button', { name: 'Approve this analysis specification', exact: true }).click();
  await page.getByRole('button', { name: 'Run approved analysis', exact: true }).click();
  await page.getByRole('button', { name: 'Download analysis and provenance', exact: true }).waitFor();
  const analysisDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download analysis and provenance', exact: true }).click();
  const analysis = JSON.parse(readFileSync((await (await analysisDownload).path())!, 'utf8'));
  assert.equal(analysis.artifact.results[0].valueNumeric, 1); assert.equal(analysis.artifact.results[0].statisticMetadata.n, 4);
  await page.getByLabel('Saved figure name', { exact: true }).fill('Fictional publication figure');
  await page.getByRole('button', { name: 'Save figure and settings', exact: true }).click();
  await page.getByText(/Saved immutable figure/).waitFor();
  await page.locator('svg[role=group]').screenshot({ path: path.join(artifacts, 'workbench-3d.png') });
  await page.reload();
  await page.getByLabel('Saved figures and favourites', { exact: true }).locator('option').filter({ hasText: 'Fictional publication figure' }).waitFor({ state: 'attached' });
  const savedId = await page.getByLabel('Saved figures and favourites', { exact: true }).locator('option').last().getAttribute('value');
  assert.ok(savedId); await page.getByLabel('Saved figures and favourites', { exact: true }).selectOption(savedId);
  assert.equal(await page.getByLabel('View type', { exact: true }).inputValue(), 'scatter3d');
  await page.getByRole('button', { name: 'Download saved analysis and provenance', exact: true }).waitFor();
  const exported = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export SVG', exact: true }).click();
  const download = await exported; await download.saveAs(path.join(artifacts, 'publication-figure.svg'));
  const svg = readFileSync(path.join(artifacts, 'publication-figure.svg'), 'utf8');
  assert.match(svg, /Evidence tier: Raw observation/); assert.match(svg, /Source mapping: APPROVED/); assert.match(svg, /datasetHash/);
  // Render the actual exported vector independently of the application's scroll container.
  const exportPage = await context.newPage();
  await exportPage.setContent(svg);
  const dimensions = await exportPage.locator('svg').evaluate(element => {
    const [,, width, height] = element.getAttribute('viewBox')!.split(' ').map(Number);
    element.setAttribute('width', String(width)); element.setAttribute('height', String(height));
    return { width, height: Math.ceil(height) };
  });
  await exportPage.setViewportSize(dimensions);
  await exportPage.locator('svg').screenshot({ path: path.join(artifacts, 'publication-figure.png') });
  await exportPage.close();
  await page.getByLabel('X channel', { exact: true }).selectOption('longitude');
  await page.getByLabel('Y channel', { exact: true }).selectOption('latitude');
  await page.getByLabel('View type', { exact: true }).selectOption('map');
  await page.getByLabel('REGION channel', { exact: true }).selectOption('region');
  await page.getByText('Publication style and camera', { exact: true }).click();
  await page.getByLabel('Map zoom', { exact: true }).focus(); await page.getByLabel('Map zoom', { exact: true }).press('End');
  await page.getByLabel('centerLongitude', { exact: true }).fill('6'); await page.getByLabel('centerLatitude', { exact: true }).fill('52');
  await page.locator('svg[role=group]').screenshot({ path: path.join(artifacts, 'workbench-map.png') });
  await page.getByLabel('Filter column', { exact: true }).selectOption('language');
  await page.getByLabel('Value / from', { exact: true }).fill('nl'); await page.getByRole('button', { name: 'Add filter', exact: true }).click();
  assert.equal(await page.locator('svg [data-row-id]').count(), 3);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifacts, 'workbench-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'mobile page must not overflow horizontally');
  await page.setViewportSize({ width: 1440, height: 1050 });
});

test('E4 browser: developer can inspect a persisted trace and download diagnostic evidence', async () => {
  await page.goto(base + '/diagnostics');
  await page.getByLabel('Recorder mode', { exact: true }).selectOption('TRACE');
  await page.getByRole('button', { name: 'Refresh traces', exact: true }).click();
  const recorded = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recorded traces', exact: true }) });
  await recorded.getByRole('button').first().click();
  const zip = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download diagnostic ZIP', exact: true }).click();
  assert.ok((await zip).suggestedFilename().endsWith('.zip'));
  assert.deepEqual(browserErrors, []);
});
