import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { resolveChromium } from '../helpers/browser';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// A failure in someone's browser must leave a record on the server (production bundle, phone width).
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-client-diag-'));
const diagDir = path.join(scratch, 'diag');
let server: ChildProcess, browser: Browser, base = '';
before(async () => {
  const port = 6900 + Math.floor(Math.random() * 300); base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['dist/server.cjs'], { detached: true, stdio: 'ignore', env: { ...process.env, PORT: String(port), NODE_ENV: 'production',
    DB_PATH: path.join(scratch, 'w.sqlite'), STORE_PATH: path.join(scratch, 'store'), WATCHDOG_ALLOW_OPEN_INSTANCE: 'true', WATCHDOG_ALLOW_EPHEMERAL_STORAGE: 'true',
    WATCHDOG_DIAGNOSTICS_MODE: 'NORMAL', WATCHDOG_DIAGNOSTICS_DIR: diagDir } });
  for (let i = 0; i < 150; i++) { try { if ((await fetch(`${base}/api/auth/config`)).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 200)); }
  browser = await chromium.launch({ executablePath: resolveChromium() });
});
after(async () => { await browser?.close(); if (server?.pid) try { process.kill(-server.pid, 'SIGKILL'); } catch { /* gone */ } fs.rmSync(scratch, { recursive: true, force: true }); });

test('client diagnostics: uncaught errors and rejected promises in the browser reach the server log', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${base}/workbench?invite=should-not-be-stored`); await page.locator('nav[aria-label="Main navigation"]').waitFor();
  await page.evaluate(() => {
    setTimeout(() => { throw new Error('e2e uncaught failure'); }, 0);
    void Promise.reject(new Error('e2e rejected promise'));
  });
  const file = path.join(diagDir, new Date().toISOString().split('T')[0], 'client-errors.jsonl');
  let text = '';
  for (let i = 0; i < 50 && !(text.includes('e2e uncaught failure') && text.includes('e2e rejected promise')); i++) {
    await new Promise(r => setTimeout(r, 100)); text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  }
  const records = text.trim().split('\n').map(l => JSON.parse(l));
  const uncaught = records.find(r => r.message.includes('e2e uncaught failure')), rejected = records.find(r => r.message.includes('e2e rejected promise'));
  assert.ok(uncaught && rejected, text);
  assert.equal(uncaught.kind, 'error'); assert.equal(rejected.kind, 'unhandledrejection');
  assert.equal(uncaught.path, '/workbench'); assert.ok(!text.includes('should-not-be-stored'), 'no query strings');
  assert.ok(uncaught.stack, 'with the browser stack');
  await page.close();
});
