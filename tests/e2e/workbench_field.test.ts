import { test, before, after, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { readZip } from '../../backend/watchdog_api/utils/zip';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';
import { testDataset } from '../helpers/workbench';
import { testGeometry, regionDataset } from '../helpers/geography';
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
  const packageDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export research package (ZIP)', exact: true }).click();
  await (await packageDownload).saveAs(path.join(artifacts, 'research-package.zip'));
  const packageEntries = readZip(readFileSync(path.join(artifacts, 'research-package.zip')));
  const manifest = JSON.parse(packageEntries.find(e => e.name === 'package-manifest.json')!.content.toString());
  await page.getByText(new RegExp(`Research package exported.*${canonicalHash(manifest)}`)).waitFor();
  assert.equal(packageEntries.find(e => e.name === 'figure.svg')!.content.toString(), svg);
  const extracted = path.join(root, 'publication'); mkdirSync(extracted);
  for (const entry of packageEntries) { const file = path.join(extracted, entry.name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, entry.content); }
  const verification = execFileSync(process.execPath, [path.join(extracted, 'verify.mjs'), extracted, canonicalHash(manifest)], { encoding: 'utf8' });
  assert.match(verification, /Matches the independently supplied/);
  writeFileSync(path.join(artifacts, 'publication-verification.txt'), verification);
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

test('E5 browser: portable figure imports restore archived profiles after a reload', async () => {
  const entries = readZip(readFileSync(path.join(artifacts, 'research-package.zip')));
  const workspace = JSON.parse(entries.find(e => e.name === 'workspace.json')!.content.toString());
  workspace.profile.version = 'browser-historical-profile'; workspace.profile.palettes[0].colors[0] = '#996633';
  const { contentHash, ...document } = workspace.profile; workspace.profile.contentHash = canonicalHash(document);
  workspace.figure.profileHash = workspace.profile.contentHash; workspace.figure.name = 'Archived profile figure';
  await page.goto(base + '/workbench');
  await page.getByLabel(/Restore figure JSON or package workspace.json/).setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(workspace)) });
  await page.getByText(/Figure and historical profile restored against/).waitFor();
  await page.getByText(/Historical visualization profile restored/).waitFor();
  assert.ok(await page.locator('svg circle[fill="#996633"]').count() > 0);
  await page.getByRole('button', { name: 'Save figure and settings', exact: true }).click();
  await page.getByText(/Saved immutable figure/).waitFor(); await page.reload();
  const option = page.getByLabel('Saved figures and favourites', { exact: true }).locator('option').filter({ hasText: 'Archived profile figure' });
  await option.waitFor({ state: 'attached' });
  await page.getByLabel('Saved figures and favourites', { exact: true }).selectOption((await option.getAttribute('value'))!);
  await page.getByText(/Historical visualization profile restored/).waitFor();
  assert.equal(await page.getByLabel('View type', { exact: true }).inputValue(), 'scatter3d');
  assert.ok(await page.locator('svg circle[fill="#996633"]').count() > 0);
  const restored = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export research package (ZIP)', exact: true }).click();
  await (await restored).saveAs(path.join(artifacts, 'restored-research-package.zip'));
  const restoredEntries = readZip(readFileSync(path.join(artifacts, 'restored-research-package.zip')));
  assert.deepEqual(JSON.parse(restoredEntries.find(e => e.name === 'profile.json')!.content.toString()), workspace.profile);
});

test('E5 browser: reviewed regional boundaries, exact joins, time panels and portable map publication', async () => {
  await page.goto(base + '/workbench');
  await page.getByText('Import a versioned dataset · JSON or CSV', { exact: true }).click();
  await page.getByLabel('Mapped dataset JSON', { exact: true }).fill(JSON.stringify(regionDataset()));
  await page.getByRole('button', { name: 'Import JSON as proposed', exact: true }).click();
  await page.getByLabel(/I checked the source, column mapping/).check();
  await page.getByRole('button', { name: 'Approve this dataset mapping', exact: true }).click();
  await page.getByLabel('View type', { exact: true }).selectOption('choropleth');
  assert.equal(await page.getByLabel('Z channel', { exact: true }).count(), 0);
  await page.getByLabel('REGION channel', { exact: true }).selectOption('region');
  await page.getByLabel('COLOR channel', { exact: true }).selectOption('interest');
  await page.getByLabel('ALPHA channel', { exact: true }).selectOption('sentiment');
  await page.getByLabel('Palette', { exact: true }).selectOption('sequential');
  await page.getByText('Boundary layers · import, review and versions', { exact: true }).click();
  const boundaryDocument = testGeometry();
  await page.getByLabel('Source GeoJSON', { exact: true }).fill(boundaryDocument.rawInput!.text);
  await page.getByLabel('Identifier property', { exact: true }).fill('code');
  await page.getByLabel('Label property', { exact: true }).fill('name');
  await page.getByRole('button', { name: 'Prepare GeoJSON mapping', exact: true }).click();
  for (const key of ['key', 'name', 'description'] as const) await page.getByLabel(`Boundary ${key}`, { exact: true }).fill(boundaryDocument[key]);
  for (const key of ['url', 'title', 'publisher', 'license', 'retrievedAt', 'sourceRecordId'] as const) await page.getByLabel(`Boundary source ${key}`, { exact: true }).fill(boundaryDocument.source[key]);
  await page.getByRole('button', { name: 'Import GeoJSON mapping as proposed', exact: true }).click();
  await page.getByLabel(/I checked these exact boundary coordinates/).check();
  await page.getByLabel(/Share this reviewed boundary layer/).check();
  await page.getByRole('button', { name: 'Approve this boundary mapping', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke boundary approval', exact: true }).waitFor();
  const layerId = await page.getByLabel('Review boundary version', { exact: true }).inputValue();
  await page.getByLabel('Boundary layer', { exact: true }).selectOption(layerId);
  await page.getByRole('button', { name: 'Fit boundary layer', exact: true }).click();
  const region = (id: string) => page.locator(`svg [data-region-id="${id}"]`);
  assert.equal(await region('A').getAttribute('data-join-state'), 'value');
  assert.equal(await region('B').getAttribute('data-join-state'), 'missing');
  assert.equal(await region('C').getAttribute('data-join-state'), 'ambiguous');
  assert.equal(await region('E').getAttribute('data-join-state'), 'no_observation');
  await page.getByText('Explicit identifier mappings', { exact: true }).click();
  await page.getByLabel('Source region identifier', { exact: true }).selectOption('source-E');
  await page.getByLabel('Target boundary identifier', { exact: true }).selectOption('E');
  await page.getByRole('button', { name: 'Add explicit region mapping', exact: true }).click();
  assert.equal(await region('E').getAttribute('data-join-state'), 'value');
  await region('C').focus(); await region('C').press('Enter');
  const inspector = page.getByRole('region', { name: 'Region join inspection', exact: true });
  await inspector.getByRole('button', { name: 'Select region-row-2 for statistics', exact: true }).click();
  assert.equal(await region('C').getAttribute('data-join-state'), 'ambiguous', 'statistical selection cannot hide a conflicting source row');
  await region('C').focus(); await region('C').press('Shift+F10');
  await page.getByRole('dialog', { name: 'Context tools' }).getByRole('button', { name: 'Fit complete boundary layer', exact: true }).click();
  await page.getByRole('button', { name: 'Close tools', exact: true }).click();
  await page.getByLabel('Color classification', { exact: true }).selectOption('manual');
  await page.getByLabel('Manual class boundaries', { exact: true }).fill('0, 10, 20, 30, 40');
  await page.getByRole('button', { name: 'Apply class boundaries', exact: true }).click();
  await page.locator('svg[role=group]').screenshot({ path: path.join(artifacts, 'workbench-region-ambiguity.png') });
  await page.getByLabel('TIME channel', { exact: true }).selectOption('date');
  await page.getByLabel('Time frame', { exact: true }).selectOption('0');
  assert.equal(await region('C').getAttribute('data-join-state'), 'value');
  await page.getByLabel('Time frame', { exact: true }).selectOption('');
  await page.getByLabel('FACET channel', { exact: true }).selectOption('date');
  assert.equal(await region('C').count(), 2);
  for (const item of await region('C').all()) assert.equal(await item.getAttribute('data-join-state'), 'value');
  await page.getByLabel('labels', { exact: true }).check();
  await page.getByLabel('Saved figure name', { exact: true }).fill('Fictional regional publication');
  await page.getByRole('button', { name: 'Save figure and settings', exact: true }).click();
  await page.getByText(/Saved immutable figure/).waitFor();
  await page.reload();
  const option = page.getByLabel('Saved figures and favourites', { exact: true }).locator('option').filter({ hasText: 'Fictional regional publication' });
  await option.waitFor({ state: 'attached' }); const savedId = (await option.getAttribute('value'))!;
  await page.getByLabel('Saved figures and favourites', { exact: true }).selectOption(savedId);
  assert.equal(await page.getByLabel('Boundary layer', { exact: true }).inputValue(), layerId);
  assert.equal(await page.getByLabel('Color classification', { exact: true }).inputValue(), 'manual');
  await page.getByLabel('View type', { exact: true }).selectOption('scatter');
  await page.getByLabel('Reuse a favourite visual style', { exact: true }).selectOption(savedId);
  assert.equal(await page.getByLabel('Boundary layer', { exact: true }).inputValue(), layerId);
  await page.getByText('Publication style and camera', { exact: true }).click();
  assert.ok(Number(await page.getByLabel('Map zoom', { exact: true }).inputValue()) > 8);
  const exported = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export SVG', exact: true }).click();
  await (await exported).saveAs(path.join(artifacts, 'regional-publication.svg'));
  const svg = readFileSync(path.join(artifacts, 'regional-publication.svg'), 'utf8');
  const vector = await context.newPage(); await vector.setContent(svg);
  const size = await vector.locator('svg').evaluate(element => { const [,, width, height] = element.getAttribute('viewBox')!.split(' ').map(Number); return { width, height: Math.ceil(height) }; });
  await vector.setViewportSize(size); await vector.locator('svg').screenshot({ path: path.join(artifacts, 'regional-publication.png') }); await vector.close();
  const exportedPackage = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export research package (ZIP)', exact: true }).click();
  await (await exportedPackage).saveAs(path.join(artifacts, 'regional-research-package.zip'));
  const entries = readZip(readFileSync(path.join(artifacts, 'regional-research-package.zip'))), extracted = path.join(root, 'regional-publication'); mkdirSync(extracted);
  for (const entry of entries) { const filename = path.join(extracted, entry.name); mkdirSync(path.dirname(filename), { recursive: true }); writeFileSync(filename, entry.content); }
  const manifest = JSON.parse(entries.find(e => e.name === 'package-manifest.json')!.content.toString());
  writeFileSync(path.join(artifacts, 'regional-verification.txt'), execFileSync(process.execPath, [path.join(extracted, 'verify.mjs'), extracted, canonicalHash(manifest)], { encoding: 'utf8' }));
  const figure = JSON.parse(entries.find(e => e.name === 'figure.json')!.content.toString());
  assert.deepEqual(figure.geography.mappings, { 'source-E': 'E' }); assert.deepEqual(figure.geography.classification.breaks, [0, 10, 20, 30, 40]);
  assert.equal(entries.find(e => e.name === 'rendering/source.geojson')!.content.toString(), boundaryDocument.rawInput!.text);
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(artifacts, 'regional-workbench-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
  const mobileLayout = await page.locator('main').evaluate(main => {
    const bounds = main.getBoundingClientRect();
    const overflow = [...main.querySelectorAll('*')].filter((element): element is HTMLElement => element instanceof HTMLElement).filter(element => {
      if (!element.getClientRects().length || element.getBoundingClientRect().right <= bounds.right + 1) return false;
      for (let parent = element.parentElement; parent && parent !== main; parent = parent.parentElement)
        if (getComputedStyle(parent).overflowX !== 'visible') return false;
      return true;
    }).slice(0, 30).map(element => ({ tag: element.tagName, className: element.className, label: element.getAttribute('aria-label') ?? element.textContent?.slice(0, 100), width: element.getBoundingClientRect().width, right: element.getBoundingClientRect().right }));
    return { clientWidth: main.clientWidth, scrollWidth: main.scrollWidth, overflow };
  });
  writeFileSync(path.join(artifacts, 'regional-mobile-layout.json'), JSON.stringify(mobileLayout, null, 2));
  assert.ok(mobileLayout.scrollWidth <= mobileLayout.clientWidth + 1, `The actual scrolling workbench must fit mobile width: ${JSON.stringify(mobileLayout)}`);
  await page.getByLabel('Boundary layer', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, 'regional-controls-mobile.png') });
  await region('C').first().focus(); await region('C').first().press('Enter');
  await page.getByLabel('Evidence legend', { exact: true }).scrollIntoViewIfNeeded();
  assert.deepEqual(await page.getByLabel('Evidence legend', { exact: true }).locator('.evidence-badge').evaluateAll(elements => elements.map(element => getComputedStyle(element).opacity)), ['1', '1', '1']);
  await page.screenshot({ path: path.join(artifacts, 'regional-inspection-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByText('Boundary layers · import, review and versions', { exact: true }).click();
  await page.getByLabel('Review boundary version', { exact: true }).selectOption(layerId);
  await page.getByRole('button', { name: 'Revoke boundary approval', exact: true }).click();
  const rejected = page.waitForResponse(r => r.url().endsWith('/api/workbench/export'));
  await page.getByRole('button', { name: 'Export research package (ZIP)', exact: true }).click();
  assert.equal((await rejected).status(), 409);
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
