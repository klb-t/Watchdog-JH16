import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { resolveChromium } from '../helpers/browser';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readZip } from '../../backend/watchdog_api/utils/zip';
import { defaultFigure } from '../../shared/workbench';
import { testDataset } from '../helpers/workbench';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-project-ui-'));
let server: ChildProcess, browser: Browser, page: Page, baseUrl: string;
before(async () => {
  baseUrl = `http://127.0.0.1:${5400 + Math.floor(Math.random() * 400)}`;
  server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(), detached: true, stdio: 'pipe', env: { ...process.env,
      PORT: baseUrl.split(':').pop(), DB_PATH: path.join(scratch, 'watchdog.sqlite'), STORE_PATH: path.join(scratch, 'blobs'),
      NODE_ENV: 'production', WATCHDOG_DIAGNOSTICS_MODE: 'OFF', WATCHDOG_ALLOW_OPEN_INSTANCE: 'true', WATCHDOG_ALLOW_EPHEMERAL_STORAGE: 'true' },
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) { try { if ((await fetch(`${baseUrl}/api/auth/me`)).ok) break; } catch { /* startup */ } await new Promise(resolve => setTimeout(resolve, 200)); }
  assert.equal((await fetch(`${baseUrl}/api/auth/me`)).status, 200);
  browser = await chromium.launch({ executablePath: resolveChromium() }); page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
});
after(async () => {
  await browser?.close(); if (server?.pid) { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* closed */ } }
  fs.rmSync(scratch, { recursive: true, force: true });
});
const call = async (route: string, body?: unknown) => {
  const response = await fetch(baseUrl + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
};

test('research project UI creates, reloads, revises and exports exact frozen paper snapshots with standalone verification', async () => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const { document } = await call('/api/research/papers', { title: 'Fictional project browser protocol', source: 'fixture:browser', text: 'Exact synthetic software test text.', coverage: 'excerpt', language: null, geography: [] });
  await page.goto(`${baseUrl}/projects`);
  await page.getByLabel('Nazwa zadania', { exact: true }).fill('Browser project fixture');
  await page.getByLabel('Pytanie badawcze', { exact: true }).fill('Does a frozen source survive this workflow?');
  await page.getByLabel('Cel, zakres i różnice wobec źródła', { exact: true }).fill('Synthetic test case.');
  await page.getByLabel('Wybierz swoją wersję', { exact: true }).selectOption(document.id);
  await page.getByRole('button', { name: 'Dołącz wybraną wersję', exact: true }).click();
  await page.getByRole('button', { name: 'Zapisz nową niezmienną wersję', exact: true }).click();
  await page.waitForURL(/\/projects\?id=/); const id = new URL(page.url()).searchParams.get('id')!;
  await page.getByRole('heading', { name: 'Aktualna wersja 1', exact: true }).waitFor();
  const first = (await call(`/api/projects/${id}`)).revision;
  assert.equal(first.body.links[0].expectedHash, document.hash); assert.equal(first.body.links[0].snapshot.body.text, document.body.text);
  await page.reload(); await page.getByRole('heading', { name: 'Aktualna wersja 1', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Nazwa zadania', { exact: true }).inputValue(), 'Browser project fixture');
  await page.getByLabel('Pytanie badawcze', { exact: true }).fill('Does the prior question remain in history?');
  await page.getByLabel('Stan zadania', { exact: true }).selectOption('ACTIVE');
  await page.getByLabel('Znaczenie deklarowane przez właściciela', { exact: true }).selectOption('reanalysis');
  await page.getByRole('button', { name: 'Zapisz nową niezmienną wersję', exact: true }).click();
  await page.getByRole('heading', { name: 'Aktualna wersja 2', exact: true }).waitFor();
  await page.getByText('Historia wersji (2)', { exact: true }).click();
  await page.getByRole('button', { name: /^Wersja 1 ·/ }).click();
  await page.getByRole('heading', { name: 'Zapisana wersja 1', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Pytanie badawcze', { exact: true }).inputValue(), first.body.question);
  assert.equal(await page.getByLabel('Pytanie badawcze', { exact: true }).isDisabled(), true);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Pobierz tę wersję z manifestem i plikami', exact: true }).click()]);
  const archivePath = await download.path(); assert.ok(archivePath); const bytes = fs.readFileSync(archivePath!);
  const response = await fetch(`${baseUrl}/api/projects/${id}/export?revision=${first.hash}`);
  assert.deepEqual(bytes, Buffer.from(await response.arrayBuffer()));
  const root = path.join(scratch, 'package'); fs.mkdirSync(root);
  for (const entry of readZip(bytes)) { const file = path.join(root, entry.name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, entry.content); }
  const verified = spawnSync(process.execPath, [path.join(root, 'verify.mjs'), root, response.headers.get('X-Package-Manifest-SHA256')!], { encoding: 'utf8', timeout: 10000 });
  assert.equal(verified.status, 0, verified.stderr); assert.match(verified.stdout, /independently supplied/);
  await page.goto(`${baseUrl}/projects`); await page.getByLabel('Nazwa zadania', { exact: true }).fill('Unsaved text');
  await page.getByRole('button', { name: 'Nowy pakiet', exact: true }).click(); assert.equal(await page.getByLabel('Nazwa zadania', { exact: true }).inputValue(), '');
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${baseUrl}/projects?id=${id}`);
  await page.getByRole('heading', { name: 'Aktualna wersja 2', exact: true }).waitFor();
  const width = await page.locator('main').evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  assert.ok(width.scroll <= width.client + 1, JSON.stringify(width)); assert.deepEqual(errors, []);
});

test('project source deep links restore exact saved figures and method selections', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { record: imported } = await call('/api/workbench/datasets', testDataset());
  const { record } = await call(`/api/workbench/datasets/${imported.id}/approve`, { expectedHash: imported.contentHash, shareAggregate: false });
  const profile = await call('/api/workbench/profile'), figure = defaultFigure(record, profile); figure.name = 'Exact project figure'; figure.channels.x = 'interest'; figure.channels.y = 'mentions';
  const { figure: saved } = await call('/api/workbench/figures', { spec: figure, favorite: true });
  const { method } = await call('/api/workbench/methods', { figure, method: 'pearson' });
  await page.goto(`${baseUrl}/workbench?figure=${saved.id}`);
  await page.getByText(`Restored exact figure ${saved.hash}.`, { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Saved figure name', { exact: true }).inputValue(), figure.name);
  await page.goto(`${baseUrl}/workbench?dataset=${record.id}&method=${method.id}`);
  await page.getByText(`Opened pinned method ${method.hash}.`, { exact: true }).waitFor();
  await page.getByRole('heading', { name: `${method.spec.name} · PROPOSED`, exact: true }).waitFor();
});
