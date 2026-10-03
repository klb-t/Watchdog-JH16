import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { resolveChromium } from '../helpers/browser';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import Database from 'better-sqlite3';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { WorkbenchRepository } from '../../backend/watchdog_api/db/repositories/workbench';
import { ResearchRepository } from '../../backend/watchdog_api/db/repositories/research';
import { AutomationRepository } from '../../backend/watchdog_api/db/repositories/automation';
import { FieldReferenceRepository } from '../../backend/watchdog_api/db/repositories/field_reference';
import { approve } from '../../backend/watchdog_api/domain/approval';
import { testDataset } from '../helpers/workbench';
import { testSample } from '../helpers/field';
import { sourceSnapshot } from '../fixtures/source_history';

let browser: Browser, server: ChildProcess, base: string, directory: string;
let datasetId: string, paperId: string, referenceId: string, substanceId: string;
const paperTitle = 'Fictional paper 100%_X', paperText = 'Fictional source text retained in the owned document. Not a scientific measurement.';

before(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'watchdog-search-browser-'));
  const dbPath = path.join(directory, 'db.sqlite'), storePath = path.join(directory, 'store');
  const db = new Database(dbPath); db.pragma('foreign_keys = ON'); runMigrations(db);
  const store = new LocalFileSystemStore(storePath), datasets = new WorkbenchRepository(db, store), research = new ResearchRepository(db), automation = new AutomationRepository(db, store);
  try {
    const record = await datasets.importDataset({ ...testDataset(), name: 'Fictional search dataset' }, 'local-user', 'fixture');
    await datasets.approveDataset(record.id, 'local-user', record.contentHash, false, 'fixture'); datasetId = record.id;
    await datasets.importDataset({ ...testDataset(), name: 'OTHER_OWNER_PRIVATE_DATASET_92844' }, 'other-owner', 'fixture');
    paperId = research.saveDocument('local-user', { title: paperTitle, source: 'fixture:search', text: paperText, coverage: 'excerpt', language: 'en', geography: [] }).id;
    research.saveDocument('other-owner', { title: 'OTHER_OWNER_PRIVATE_PAPER_92844', source: 'fixture:private', text: 'PRIVATE_SOURCE_TEXT_92844', coverage: 'excerpt', language: 'en', geography: [] });
    const field = new FieldReferenceRepository(db, store); field.registerRegions([{ id: 'NL', name: 'Netherlands', parentId: null }]);
    const sample = await field.importDocument(testSample({ name: 'Fictional search sample' }), 'local-user', 'fixture');
    field.saveApproval(approve({ id: sample.id, kind: 'reference_mapping', content: sample.document }, 'local-user', '2026-09-30T00:00:00Z'), sample.contentHash, 'fixture'); referenceId = sample.id;
    const source = await sourceSnapshot(db, automation, { InChIKey: 'FICTIONAL-SEARCH-KEY' }, { name: 'Fictional searchable compound' }); substanceId = source.id;
    automation.activity(source.id, { targetId: 'FIXTURE123', targetName: 'Fictional searchable receptor', measure: 'Ki', assayType: 'B', activityId: 9999991,
      organism: 'Homo sapiens', flags: ['FICTIONAL_TEST_DATA'], value: null, unit: null, relation: null, assayId: 'fixture-assay', assayDescription: 'Fictional measurement fixture' }, source.receipt);
  } finally { db.close(); }
  const socket = createServer(); await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as { port: number }).port; await new Promise<void>(resolve => socket.close(() => resolve()));
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: process.cwd(), detached: true, stdio: 'pipe',
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, STORE_PATH: storePath, NODE_ENV: 'production', WATCHDOG_DIAGNOSTICS_MODE: 'OFF',
      WATCHDOG_ALLOW_OPEN_INSTANCE: 'true', WATCHDOG_ALLOW_EPHEMERAL_STORAGE: 'true' } });
  let logs = ''; server.stdout?.on('data', data => { logs += data.toString(); }); server.stderr?.on('data', data => { logs += data.toString(); });
  const deadline = Date.now() + 60_000; let ready = false;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/search?kind=paper`)).ok) { ready = true; break; } } catch { /* startup */ }
    if (server.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, `Search server did not start: ${logs}`);
  browser = await chromium.launch({ executablePath: resolveChromium() });
});

after(async () => {
  await browser?.close();
  if (server?.pid) { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* exited */ } }
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test('unified browser search opens exact owned paper/dataset versions and excludes other owners', async () => {
  const page = await browser.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${base}/search?q=100%25_&kind=paper`);
    await page.getByTestId('unified-search-page').waitFor();
    await page.getByRole('link', { name: paperTitle, exact: true }).waitFor();
    assert.ok(!(await page.locator('body').innerText()).includes('OTHER_OWNER_PRIVATE'));
    assert.ok(!(await page.locator('body').innerText()).includes(paperText));
    await page.getByRole('link', { name: paperTitle, exact: true }).click();
    await page.getByTestId('research-linked-paper').waitFor();
    assert.ok((await page.getByTestId('research-linked-paper').innerText()).includes(paperText));
    assert.ok(page.url().includes(`document=${paperId}`));
    await page.goto(`${base}/search?kind=dataset`);
    await page.getByRole('link', { name: 'Fictional search dataset', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Fictional search dataset', exact: true }).click();
    await page.getByRole('heading', { name: 'Visual workbench', exact: true }).waitFor();
    await page.waitForFunction(id => (document.querySelector('select[aria-label="Dataset"]') as HTMLSelectElement | null)?.value === id, datasetId);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('unified browser search keeps filters, source-memory target links and mobile results usable', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(`${base}/search?kind=all`); await page.getByRole('link', { name: paperTitle, exact: true }).waitFor();
    await page.getByLabel('Rodzaj', { exact: true }).selectOption('target');
    await page.getByRole('link', { name: 'Fictional searchable receptor', exact: true }).waitFor();
    assert.ok(!(await page.locator('body').innerText()).includes('OTHER_OWNER_PRIVATE'));
    const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(layout.scroll <= layout.width, `Search overflows mobile viewport: ${JSON.stringify(layout)}`);
    await page.getByRole('link', { name: 'Fictional searchable receptor', exact: true }).click();
    await page.getByTestId('substance-memory-page').waitFor();
    await page.getByRole('heading', { name: 'Fictional searchable compound', exact: true }).waitFor();
    assert.ok(page.url().includes(`substance=${encodeURIComponent(substanceId)}`));
    assert.equal(await page.getByLabel('Cel lub opis doświadczenia', { exact: true }).inputValue(), 'FIXTURE123');
    assert.ok((await page.locator('body').innerText()).includes('Fictional searchable receptor'));
    await page.goto(`${base}/search?kind=sample`);
    await page.getByRole('link', { name: 'Fictional search sample', exact: true }).click();
    await page.getByText(referenceId, { exact: false }).first().waitFor();
    assert.ok(page.url().includes(`reference=${referenceId}`));
    await page.goto(`${base}/search?kind=unsupported`);
    await page.getByRole('alert').filter({ hasText: 'Nieprawidłowy rodzaj' }).waitFor();
  } finally { await page.close(); }
});
