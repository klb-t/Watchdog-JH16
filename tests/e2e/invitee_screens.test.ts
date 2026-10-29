import { test, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { chromium, Browser, Page } from 'playwright';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { resolveChromium } from '../helpers/browser';
import { startFakeSmtp, mailText } from '../helpers/smtp';

/**
 * The screens an invited person meets, in a real browser at phone size with an
 * English browser (audit of 2026-10-29): the language chosen on an access screen
 * changes the whole page and carries into the workspace; the share page and the
 * pending-approval banner speak the reader's language with role labels; a
 * read-only guest is told what needs another role instead of being handed a form
 * that the server would refuse. One JH16 recomputation from the published
 * fixture (the paper's own counts) is the shared run.
 */

let server: ChildProcess, browser: Browser, base = '', dir = '';
let smtp: Awaited<ReturnType<typeof startFakeSmtp>>;
const OWNER = 'owner@lab.example';
const PHONE = { viewport: { width: 390, height: 844 }, locale: 'en-GB' };
let runId = '';

async function waitForServer(url: string, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { if ((await fetch(`${url}/api/auth/config`)).ok) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('server did not start');
}

before(async () => {
  smtp = await startFakeSmtp();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-invitee-e2e-'));
  const port = 3900 + Math.floor(Math.random() * 400);
  base = `http://localhost:${port}`;
  const env = {
    ...process.env, PORT: String(port), NODE_ENV: 'production',
    DB_PATH: path.join(dir, 'w.sqlite'), STORE_PATH: path.join(dir, 'store'),
    WATCHDOG_ALLOW_EPHEMERAL_STORAGE: 'true', WATCHDOG_DIAGNOSTICS_MODE: 'OFF',
    WATCHDOG_AUTH: 'accounts', SESSION_SIGNING_KEY: randomBytes(32).toString('hex'),
    WATCHDOG_GRANTS: JSON.stringify({ [OWNER]: 'developer' }),
    SMTP_URL: `smtp://127.0.0.1:${smtp.port}`, MAIL_FROM: 'WatchDog <noreply@lab.example>', WATCHDOG_PUBLIC_URL: base,
  };
  delete (env as any).GOOGLE_OAUTH_CLIENT_ID;
  // The installation before accounts: one run owned by local-user, then claimed by the owner.
  process.env.DB_PATH = env.DB_PATH;
  const { runMigrations } = await import('../../backend/watchdog_api/db/migrations');
  const { RunRepository } = await import('../../backend/watchdog_api/db/repositories/runs');
  const { RunOrchestrator } = await import('../../backend/watchdog_api/services/run_orchestrator');
  const { LocalFileSystemStore } = await import('../../backend/watchdog_api/storage/object_store');
  const { FixtureSourceAdapter } = await import('../../backend/watchdog_api/sources/fixture_source');
  const { readJh16Preset, jh16PlanItems } = await import('../../backend/watchdog_api/services/jh16_plan');
  const sqlite = new Database(env.DB_PATH); sqlite.pragma('foreign_keys = ON'); runMigrations(sqlite);
  const db = drizzle(sqlite), preset = readJh16Preset(), reference = JSON.parse(fs.readFileSync('config/reference/nutt-2010.json', 'utf-8'));
  runId = new RunRepository(db).createRun({ runType: 'PIPELINE', presetId: preset.preset_id, presetVersion: preset.preset_version, config: {
    method_id: 'jh16_faithful', preset_id: preset.preset_id, preset_version: preset.preset_version, language: 'en', query_expansion_mode: 'STRICT_CANONICAL',
    plan: jh16PlanItems(preset), method_params: { reference_scores: reference.scores }, source_id: 'fixture_jh2016', source_params: { fixture_set: 'faithful_2014-06-20' } } });
  await new RunOrchestrator(db, new LocalFileSystemStore(env.STORE_PATH), async () => new FixtureSourceAdapter()).executeRun(runId);
  sqlite.close();
  const cli = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/watchdog_admin.ts', 'claim-local-user', OWNER], { env, encoding: 'utf-8' });
  assert.strictEqual(cli.status, 0, cli.stderr);

  server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: process.cwd(), env, stdio: 'pipe', detached: true });
  await waitForServer(base);
  browser = await chromium.launch({ executablePath: resolveChromium() });
  fs.mkdirSync('test-artifacts', { recursive: true });
});

after(async () => {
  await browser?.close();
  if (server?.pid) { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* gone */ } }
  await smtp?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function newPhone(): Promise<Page> {
  const page = await (await browser.newContext(PHONE)).newPage();
  page.on('pageerror', e => { throw e; });
  return page;
}
async function noHorizontalScroll(page: Page) {
  const w = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(w.scroll <= w.client + 1, `the page scrolls sideways on a phone: ${JSON.stringify(w)}`);
}
const call = (page: Page, url: string, body?: unknown) => page.evaluate(async ([u, b]) => {
  const r = await fetch(u as string, b === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json() };
}, [url, body] as const);

let bearer = '', shareToken = '';

test('the language chosen on an access screen changes the page, not only the frame', async () => {
  const page = await newPhone();
  await page.goto(`${base}/privacy`);
  await page.locator('[data-testid="legal-privacy"]').waitFor();
  assert.strictEqual(await page.locator('h1').innerText(), 'Privacy policy', 'the browser language picks English');
  await page.locator('[data-testid="language-select"]').selectOption('pl');
  await page.locator('h1', { hasText: 'Polityka prywatności' }).waitFor();
  await page.goto(`${base}/login`);
  assert.match(await page.locator('h1').innerText(), /Zaloguj się/, 'the choice is remembered');
  await page.context().close();
});

test('the owner invites by a bearer link and shares a run by link', async () => {
  const owner = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await owner.goto(`${base}/login`);
  await owner.locator('[data-testid="email-input"]').fill(OWNER);
  await owner.locator('[data-testid="email-send"]').click();
  await owner.locator('[data-testid="code-input"]').waitFor();
  const mail = [...smtp.mails].reverse().find(m => m.to.includes(OWNER))!;
  await owner.locator('[data-testid="code-input"]').fill(/\b([A-Z2-9]{4}-[A-Z2-9]{4})\b/.exec(mailText(mail))![1]);
  await owner.locator('[data-testid="code-submit"]').click();
  await owner.waitForURL(u => !u.pathname.startsWith('/login'));
  const inv = await call(owner, '/api/access/invitations', { kind: 'open_link', roles: ['viewer', 'researcher'], signs_in: true, max_uses: 2 });
  assert.strictEqual(inv.status, 201, JSON.stringify(inv.body)); bearer = inv.body.token;
  const share = await call(owner, '/api/run-shares', { run_ids: [runId], kind: 'link' });
  assert.strictEqual(share.status, 201, JSON.stringify(share.body)); shareToken = share.body.link_token;
  await owner.context().close();
});

test('a guest on an English phone: invitation, banner and share page in English, with role labels', async () => {
  const g = await newPhone();
  await g.goto(`${base}/join#t=${bearer}`);
  const offer = await g.locator('[data-testid="join-bearer"]').innerText();
  assert.match(await g.locator('[data-testid="join-preview"]').innerText(), /^The operator of this installation invites you/, 'no placeholder name, no sign-in address');
  assert.match(offer, /with the role: results viewer; an administrator decides on the other roles \(researcher\)/);
  await g.locator('[data-testid="join-bearer-enter"]').click();
  await g.locator('[data-testid="join-accepted"]').waitFor();
  await g.goto(`${base}/`);
  assert.strictEqual(await g.locator('[data-testid="pending-approval"]').innerText(),
    "You have the role: results viewer. Waiting for an administrator's approval: researcher.");
  assert.strictEqual(await g.getByLabel('Language', { exact: true }).inputValue(), 'en', 'the workspace follows the same language');

  await g.goto(`${base}/share#t=${shareToken}`);
  const redeemed = await g.locator('[data-testid="share-redeemed"]').innerText();
  assert.match(redeemed, /You have read-only access to shared runs: 1\./);
  assert.ok(!/przebieg|Replikacje/.test(redeemed), redeemed);
  await noHorizontalScroll(g);
  await g.screenshot({ path: 'test-artifacts/invitee-1-share-en.png', fullPage: true });

  // A used share token is gone from storage; a wrong one says so in the reader's language.
  await g.goto(`${base}/`); // a full load: from /share to /share#t=… alone is only a fragment change
  await g.goto(`${base}/share#t=${'x'.repeat(32)}`);
  assert.strictEqual(await g.locator('[data-testid="share-error"]').innerText(), 'This share link is not valid, was withdrawn or has expired.');

  await g.goto(`${base}/replications/jh2016`);
  await g.locator('[data-testid="tab-protocol"]').click();
  await g.locator('[data-testid="protocol-readonly"]').waitFor();
  assert.strictEqual(await g.locator('[data-testid="protocol-form"]').count(), 0, 'no freeze form for a read-only guest');
  await noHorizontalScroll(g);
  await g.screenshot({ path: 'test-artifacts/invitee-2-protocol-readonly.png', fullPage: true });
  await g.goto(`${base}/study`);
  assert.strictEqual(await g.locator('[data-testid="access-denied"] h1').innerText(), 'View unavailable');
  await g.context().close();
});
