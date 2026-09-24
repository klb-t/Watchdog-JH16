import { test, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import { chromium, Browser, Page } from 'playwright';
import { resolveChromium } from '../helpers/browser';
import { startFakeSmtp, mailText } from '../helpers/smtp';

/**
 * E4.5 in a real browser, at phone size, in Polish: the owner signs in,
 * invites someone by address, that person accepts from the link; a stranger
 * signs in, lands on the application form, is approved, gets in, and loses
 * access again the moment it is revoked.
 *
 * Screenshots go to test-artifacts/, which CI uploads.
 */

let server: ChildProcess;
let browser: Browser;
let base = '';
let dir = '';
let smtp: Awaited<ReturnType<typeof startFakeSmtp>>;
const OWNER = 'owner@lab.example';
const PHONE = { viewport: { width: 390, height: 844 }, locale: 'pl-PL' };

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-access-e2e-'));
  const port = 3500 + Math.floor(Math.random() * 400);
  // localhost rather than 127.0.0.1: production cookies are Secure, and
  // browsers treat http://localhost as a secure context.
  base = `http://localhost:${port}`;
  server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env, PORT: String(port), NODE_ENV: 'production',
      DB_PATH: path.join(dir, 'w.sqlite'), STORE_PATH: path.join(dir, 'store'),
      WATCHDOG_ALLOW_EPHEMERAL_STORAGE: 'true', WATCHDOG_DIAGNOSTICS_MODE: 'OFF',
      WATCHDOG_AUTH: 'accounts', SESSION_SIGNING_KEY: randomBytes(32).toString('hex'),
      WATCHDOG_GRANTS: JSON.stringify({ [OWNER]: 'developer' }),
      SMTP_URL: `smtp://127.0.0.1:${smtp.port}`, MAIL_FROM: 'WatchDog <noreply@lab.example>',
      WATCHDOG_PUBLIC_URL: base,
    },
    stdio: 'pipe', detached: true,
  });
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

function codeFor(email: string): string {
  const mail = [...smtp.mails].reverse().find(m => m.to.includes(email));
  const code = mail && /\b([A-Z2-9]{4}-[A-Z2-9]{4})\b/.exec(mailText(mail))?.[1];
  assert.ok(code, `a code was mailed to ${email}`);
  return code;
}

async function signInByCode(page: Page, email: string) {
  const sent = smtp.mails.length;
  await page.locator('[data-testid="email-input"]').fill(email);
  await page.locator('[data-testid="email-send"]').click();
  await page.locator('[data-testid="code-input"]').waitFor();
  assert.ok(smtp.mails.length > sent, 'the code was actually delivered to the mail server');
  await page.locator('[data-testid="code-input"]').fill(codeFor(email));
  await page.locator('[data-testid="code-submit"]').click();
}

async function newPhone(): Promise<Page> {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  page.on('pageerror', e => { throw e; });
  return page;
}

async function noHorizontalScroll(page: Page) {
  const w = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(w.scroll <= w.client + 1, `the page scrolls sideways on a phone: ${JSON.stringify(w)}`);
}

let owner: Page;
let invitationLink = '';

test('E4.5 browser: an anonymous visitor sees only the sign-in screen', async () => {
  owner = await newPhone();
  await owner.goto(`${base}/runs`);
  await owner.waitForURL(/\/login\?next=%2Fruns/);
  await owner.locator('[data-testid="sign-in-panel"]').waitFor();
  assert.strictEqual(await owner.locator('nav[aria-label="Main navigation"]').count(), 0, 'no application chrome before sign-in');
  assert.match(await owner.locator('h1').innerText(), /Zaloguj się/, 'the browser language picks Polish');
  await noHorizontalScroll(owner);
  await owner.screenshot({ path: 'test-artifacts/access-1-login.png', fullPage: true });
});

test('E4.5 browser: the owner signs in by emailed code and lands where they were going', async () => {
  await signInByCode(owner, OWNER);
  await owner.waitForURL(`${base}/runs`);
  await owner.locator('a[href="/access"]').waitFor();
});

test('E4.5 browser: the owner invites someone by address and gets a link to hand over', async () => {
  await owner.goto(`${base}/access`);
  await owner.locator('[data-testid="invite-form"]').waitFor();
  await owner.locator('[data-testid="profile-name"]').fill('Marcin Właściciel');
  await owner.locator('[data-testid="profile-save"]').click();
  await owner.getByRole('status').filter({ hasText: 'Zapisano' }).waitFor();
  await owner.locator('[data-testid="invite-email"]').fill('bob@uni.example');
  await owner.locator('[data-testid="invite-roles"] input[data-role="researcher"]').check();
  await owner.locator('[data-testid="invite-create"]').click();
  await owner.locator('[data-testid="fresh-invitation"]').waitFor();
  invitationLink = await owner.locator('[data-testid="invite-link"]').inputValue();
  assert.match(invitationLink, new RegExp(`^${base}/join#t=`));
  await owner.locator('[data-testid="fresh-invitation"] summary').click();
  const draft = await owner.locator('[data-testid="invite-draft"]').innerText();
  assert.match(draft, /bob@uni\.example/);
  assert.match(draft, /Marcin Właściciel zaprasza Cię/, 'invitations are signed with a name, not an address');
  await noHorizontalScroll(owner);
  await owner.screenshot({ path: 'test-artifacts/access-2-invitation.png', fullPage: true });
});

test('E4.5 browser: the invited person opens the link, signs in, and is in', async () => {
  const bob = await newPhone();
  await bob.goto(invitationLink);
  await bob.locator('[data-testid="join-preview"]').waitFor();
  assert.match(await bob.locator('[data-testid="join-preview"]').innerText(), /Marcin Właściciel zaprasza Cię/);
  assert.ok(!bob.url().includes('#t='), 'the token is wiped from the address bar at once');
  await bob.screenshot({ path: 'test-artifacts/access-3-join.png', fullPage: true });
  await signInByCode(bob, 'bob@uni.example');
  await bob.locator('[data-testid="join-accepted"]').waitFor();
  await bob.locator('[data-testid="join-accepted"] a').click();
  await bob.waitForURL(`${base}/`);
  assert.strictEqual(await bob.locator('a[href="/access"]').count(), 0, 'a researcher does not see People & access');
});

let stranger: Page;

test('E4.5 browser: a stranger who signs in can only apply', async () => {
  stranger = await newPhone();
  await stranger.goto(`${base}/`);
  await stranger.waitForURL(/\/login/);
  await signInByCode(stranger, 'stranger@elsewhere.example');
  await stranger.waitForURL(`${base}/apply`);
  await stranger.locator('[data-testid="apply-name"]').fill('Jan Testowy');
  await stranger.locator('[data-testid="apply-reason"]').fill('Chcę zobaczyć replikację JH2016 i sprawdzić moje dane.');
  await stranger.locator('[data-testid="apply-submit"]').click();
  await stranger.locator('[data-testid="application-pending"]').waitFor();
  await noHorizontalScroll(stranger);
  await stranger.screenshot({ path: 'test-artifacts/access-4-apply.png', fullPage: true });

  await stranger.goto(`${base}/research`);
  await stranger.waitForURL(`${base}/apply`);
});

test('E4.5 browser: approval lets the stranger in; revocation takes them straight back out', async () => {
  await owner.goto(`${base}/access`);
  await owner.locator('[data-testid="tab-applications"]').click();
  const card = owner.locator('[data-testid="application-stranger@elsewhere.example"]');
  await card.waitFor();
  await card.locator('input[data-role="viewer"]').check();
  await owner.screenshot({ path: 'test-artifacts/access-5-requests.png', fullPage: true });
  await card.locator('[data-testid="approve"]').click();
  await card.waitFor({ state: 'detached' });

  await stranger.goto(`${base}/runs`);
  await stranger.locator('nav[aria-label="Main navigation"]').waitFor();
  assert.strictEqual(new URL(stranger.url()).pathname, '/runs', 'admitted — no longer sent to /apply');

  await owner.locator('[data-testid="tab-members"]').click();
  const member = owner.locator('[data-testid="member-stranger@elsewhere.example"]');
  await member.waitFor();
  owner.once('dialog', d => void d.accept());
  await member.locator('[data-testid="member-revoke"]').click();
  await owner.waitForFunction(() => !document.querySelector('[data-testid="member-stranger@elsewhere.example"]'));
  await owner.screenshot({ path: 'test-artifacts/access-6-members.png', fullPage: true });

  await stranger.goto(`${base}/runs`);
  await stranger.waitForURL(`${base}/apply`);
});
