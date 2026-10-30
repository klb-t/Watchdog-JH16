import { test, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { startFakeSmtp, mailText } from '../helpers/smtp';

/**
 * What an invited person is told, over HTTP in accounts mode (audit of 2026-10-29):
 * the invitation names no placeholder and no sign-in address for the claimed
 * pre-accounts owner, the Replications list counts the runs shared with a guest
 * (the target page already lists them), and a run whose stored bytes cannot be
 * read answers without quoting server paths. Runs come from the published JH16
 * fixture (the paper's own counts), recomputed in-process before the server starts.
 */

let base = '', server: Server, smtp: Awaited<ReturnType<typeof startFakeSmtp>>, dir = '';
const OWNER = 'owner@lab.example';
let runId = '', blobId = '', blobFile = '';

before(async () => {
  smtp = await startFakeSmtp();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-invitee-'));
  const env = { DB_PATH: path.join(dir, 'w.sqlite'), STORE_PATH: path.join(dir, 'store'), WATCHDOG_AUTH: 'accounts',
    SESSION_SIGNING_KEY: randomBytes(32).toString('hex'), WATCHDOG_GRANTS: JSON.stringify({ [OWNER]: 'developer' }),
    SMTP_URL: `smtp://127.0.0.1:${smtp.port}`, MAIL_FROM: 'WatchDog <noreply@lab.example>', WATCHDOG_PUBLIC_URL: 'http://localhost:4997', WATCHDOG_DIAGNOSTICS_MODE: 'OFF' };
  Object.assign(process.env, env);
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;

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
  blobId = (sqlite.prepare('SELECT raw_blob_id FROM fetch_events WHERE run_id = ? AND raw_blob_id IS NOT NULL LIMIT 1').get(runId) as any).raw_blob_id;
  const uri = (sqlite.prepare('SELECT object_uri FROM raw_blobs WHERE id = ?').get(blobId) as any).object_uri as string;
  blobFile = uri.replace(/^file:\/\//, '');
  sqlite.close();

  const cli = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/watchdog_admin.ts', 'claim-local-user', OWNER], { env: { ...process.env }, encoding: 'utf-8' });
  assert.strictEqual(cli.status, 0, cli.stderr);

  const mod = await import('../../server');
  await mod.configureApp();
  server = mod.app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});

after(async () => { server?.close(); await smtp?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

class Client {
  cookie = '';
  async req(method: string, url: string, body?: unknown) {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Origin: base, ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const set = response.headers.get('set-cookie');
    if (set) { const pair = set.split(';')[0]; this.cookie = pair.endsWith('=') ? '' : pair; }
    const text = await response.text(); let parsed: any = text; try { parsed = JSON.parse(text); } catch { /* raw */ }
    return { status: response.status, body: parsed, trace: response.headers.get('x-trace-id') };
  }
  get(url: string) { return this.req('GET', url); }
  post(url: string, body: unknown = {}) { return this.req('POST', url, body); }
}
async function signIn(c: Client, email: string) {
  assert.strictEqual((await c.post('/api/auth/email/start', { email, language: 'en' })).status, 202);
  const mail = [...smtp.mails].reverse().find(m => m.to.includes(email))!;
  const code = /\b([A-Z2-9]{4}-[A-Z2-9]{4})\b/.exec(mailText(mail))![1];
  const v = await c.post('/api/auth/email/verify', { email, code }); assert.strictEqual(v.status, 200, JSON.stringify(v.body));
}
const owner = new Client(), guest = new Client(), anonymous = new Client();
let bearerToken = '';

test('an invitation from the claimed pre-accounts owner names neither the placeholder nor his sign-in address', async () => {
  await signIn(owner, OWNER);
  assert.strictEqual((await owner.get('/api/auth/me')).body.principal.id, 'local-user');
  const inv = await owner.post('/api/access/invitations', { kind: 'open_link', roles: ['viewer'], signs_in: true, max_uses: 3 });
  assert.strictEqual(inv.status, 201, JSON.stringify(inv.body)); bearerToken = inv.body.token;
  const preview = await anonymous.post('/api/auth/invitations/preview', { token: bearerToken });
  assert.strictEqual(preview.body.invitation.status, 'valid');
  assert.strictEqual(preview.body.invitation.inviter, null, 'the screen names the operator in the reader\'s language');
  assert.ok(!JSON.stringify(preview.body).includes(OWNER), 'the owner\'s sign-in address is not shown to a link holder');
  assert.ok(!JSON.stringify(preview.body).includes('pre-authentication'));

  // A name the owner gives himself is used.
  assert.strictEqual((await owner.post('/api/auth/profile', { display_name: 'Prof. Owner' })).status, 200);
  const named = await anonymous.post('/api/auth/invitations/preview', { token: bearerToken });
  assert.strictEqual(named.body.invitation.inviter, 'Prof. Owner');
});

test('the Replications list counts the runs shared with a guest, as the target page lists them', async () => {
  assert.strictEqual((await guest.post('/api/auth/invitations/bearer', { token: bearerToken })).status, 200);
  const count = async () => (await guest.get('/api/replications')).body.targets.find((t: any) => t.target_id === 'jh2016').runs;
  assert.strictEqual(await count(), 0, 'nothing shared yet');
  const made = await owner.post('/api/run-shares', { run_ids: [runId], kind: 'link' });
  assert.strictEqual((await guest.post('/api/run-shares/redeem', { token: made.body.link_token })).status, 200);
  const page = await guest.get('/api/replications/jh2016');
  assert.ok(page.body.runs.some((r: any) => r.run_id === runId && r.shared === true));
  assert.strictEqual(await count(), page.body.runs.length, 'list and target page agree');
  assert.strictEqual(await count(), 1);
});

test('stored bytes that cannot be read: a 500 with a reference, never the server path', async () => {
  assert.strictEqual((await guest.get(`/api/artifacts/${blobId}`)).status, 200);
  fs.renameSync(blobFile, `${blobFile}.moved`);
  try {
    const r = await guest.get(`/api/artifacts/${blobId}`);
    assert.strictEqual(r.status, 500);
    assert.strictEqual(r.body.error, 'STORAGE_ERROR');
    assert.ok(r.trace && r.body.message.includes(r.trace), 'the operator can find the full error by the trace id');
    assert.ok(!r.body.message.includes(dir) && !/ENOENT|\/store\//.test(r.body.message), r.body.message);
  } finally { fs.renameSync(`${blobFile}.moved`, blobFile); }
  assert.strictEqual((await guest.get(`/api/artifacts/${blobId}`)).status, 200);
});
