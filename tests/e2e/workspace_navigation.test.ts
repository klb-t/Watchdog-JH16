import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { resolveChromium } from '../helpers/browser';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-navigation-'));
let server: ChildProcess, browser: Browser, page: Page, baseUrl: string;


before(async () => {
  baseUrl = `http://127.0.0.1:${4800 + Math.floor(Math.random() * 400)}`;
  server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(), detached: true, stdio: 'pipe', env: { ...process.env,
      PORT: baseUrl.split(':').pop(), DB_PATH: path.join(scratch, 'watchdog.sqlite'), STORE_PATH: path.join(scratch, 'blobs'),
      NODE_ENV: 'production', WATCHDOG_DIAGNOSTICS_MODE: 'OFF', WATCHDOG_ALLOW_OPEN_INSTANCE: 'true', WATCHDOG_ALLOW_EPHEMERAL_STORAGE: 'true' },
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${baseUrl}/api/auth/me`)).ok) break; } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal((await fetch(`${baseUrl}/api/auth/me`)).status, 200);
  browser = await chromium.launch({ executablePath: resolveChromium() });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
});

after(async () => {
  await browser?.close();
  if (server?.pid) { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* closed */ } }
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('seven main groups retain paper run deep links, contextual tools and a contained mobile layout', async () => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl);
  const main = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await main.locator('a').nth(6).waitFor();
  assert.deepEqual(await main.locator('a').allTextContents(),
    ['Pulpit', 'Dane i źródła', 'Analiza danych', 'Zbieranie cykliczne', 'Projekty badawcze', 'Prace i replikacje', 'Baza i wyszukiwanie']);
  await main.getByRole('link', { name: 'Prace i replikacje', exact: true }).click();
  await page.waitForSelector('[data-testid="research-page"]');
  const section = page.getByRole('navigation', { name: 'Section navigation', exact: true });
  await section.getByRole('link', { name: 'Uruchomienia i wyniki', exact: true }).click();
  await page.waitForURL(`${baseUrl}/runs`);
  assert.equal(await main.getByRole('link', { name: 'Prace i replikacje', exact: true }).getAttribute('aria-current'), 'page');
  await page.goto(`${baseUrl}/source-access`);
  await page.waitForSelector('[data-testid="source-access-page"]');
  assert.equal(await main.getByRole('link', { name: 'Dane i źródła', exact: true }).getAttribute('aria-current'), 'page');
  await section.getByRole('link', { name: 'Źródła pomiarów', exact: true }).click();
  await page.getByRole('heading', { name: 'Źródła pomiarów', exact: true }).waitFor();
  const plannedSource = page.locator('[data-source-status="planned"]').first();
  await plannedSource.waitFor(); assert.equal(await plannedSource.getByRole('button').isDisabled(), true);
  await main.getByRole('link', { name: 'Projekty badawcze', exact: true }).click();
  await page.waitForSelector('[data-testid="research-projects-page"]');
  await main.getByRole('link', { name: 'Baza i wyszukiwanie', exact: true }).click();
  await page.waitForSelector('[data-testid="unified-search-page"]');
  assert.equal(await main.getByRole('link', { name: 'Diagnostyka', exact: true }).count(), 0);
  await page.getByRole('navigation', { name: 'Account and tools', exact: true }).getByRole('link', { name: 'Ustawienia', exact: true }).click();
  await page.waitForURL(`${baseUrl}/setup`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl); await main.locator('a').nth(6).waitFor();
  const width = await page.locator('main').evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  assert.ok(width.scroll <= width.client + 1, JSON.stringify(width));
  const bodyWidth = await page.locator('body').evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  assert.ok(bodyWidth.scroll <= bodyWidth.client + 1, JSON.stringify(bodyWidth));
  assert.deepEqual(errors, []);
});

test('E7.7: language, persistent preset, real projects and keyboard palette preserve focus and routes', async()=>{
  await page.goto(baseUrl);
  await page.getByLabel('Język',{exact:true}).selectOption('en');
  await page.getByLabel('Workspace layout',{exact:true}).selectOption('claude');
  const trigger=page.getByTestId('open-command-palette');
  await trigger.focus(); await page.keyboard.press('Control+k');
  await page.getByTestId('command-input').fill('Research projects');
  await page.getByTestId('command-input').press('Enter');
  await page.waitForURL(`${baseUrl}/projects`);
  await page.getByTestId('research-projects-page').waitFor();
  await page.reload();
  assert.equal(await page.getByTestId('workspace-preset').inputValue(),'claude');
  await trigger.focus();await page.keyboard.press('Control+k');
  await page.getByTestId('command-input').press('Escape');
  assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
  await page.goto(`${baseUrl}/analysis`);await page.waitForURL(`${baseUrl}/workbench`);
  await page.goto(`${baseUrl}/search`);await page.getByTestId('unified-search-page').waitFor();
  const size=await page.locator('body').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
  assert.ok(size.scroll<=size.client+1);
});
