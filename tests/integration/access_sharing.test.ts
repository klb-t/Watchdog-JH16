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
 * Owner's requirements of 2026-10-29, end to end over HTTP in accounts mode:
 * the pre-accounts owner keeps everything by claiming `local-user` (operator CLI),
 * a bearer guest reads only what is shared with it, sharing is read-only, and
 * revoking a share ends access at once. Runs come from the published JH16 fixture
 * (the paper's own counts), recomputed in-process before the server starts.
 */

let base = '', server: Server, smtp: Awaited<ReturnType<typeof startFakeSmtp>>, dir = '';
const OWNER = 'owner@lab.example';
let runId = '', blobId = '';

before(async () => {
  smtp = await startFakeSmtp();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-sharing-'));
  const env = { DB_PATH: path.join(dir, 'w.sqlite'), STORE_PATH: path.join(dir, 'store'), WATCHDOG_AUTH: 'accounts',
    SESSION_SIGNING_KEY: randomBytes(32).toString('hex'), WATCHDOG_GRANTS: JSON.stringify({ [OWNER]: 'developer' }),
    SMTP_URL: `smtp://127.0.0.1:${smtp.port}`, MAIL_FROM: 'WatchDog <noreply@lab.example>', WATCHDOG_PUBLIC_URL: 'http://localhost:4998', WATCHDOG_DIAGNOSTICS_MODE: 'OFF' };
  Object.assign(process.env, env);
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;

  // The installation as it was before accounts: one JH16 recomputation owned by local-user.
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
  sqlite.close();

  // The operator claims local-user for the owner's address, with the real CLI.
  const cli = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/watchdog_admin.ts', 'claim-local-user', OWNER], { env: { ...process.env }, encoding: 'utf-8' });
  assert.strictEqual(cli.status, 0, cli.stderr); assert.match(cli.stdout, /local-user now belongs to owner@lab\.example/);
  const again = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/watchdog_admin.ts', 'claim-local-user', 'someone@else.example'], { env: { ...process.env }, encoding: 'utf-8' });
  assert.notStrictEqual(again.status, 0); assert.match(again.stderr, /already claimed by owner@lab\.example/);

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
    return { status: response.status, body: parsed };
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
const owner = new Client(), guest = new Client();

test('claiming local-user: the owner signs in onto the existing principal and keeps the runs made before accounts', async () => {
  await signIn(owner, OWNER);
  const me = await owner.get('/api/auth/me');
  assert.strictEqual(me.body.principal.id, 'local-user');
  assert.ok((await owner.get('/api/runs')).body.runs.some((r: any) => r.id === runId));
  assert.strictEqual((await owner.get(`/api/runs/${runId}`)).status, 200);
});

test('a bearer guest sees nothing unshared; a share link gives read access to the run, its raw responses and Replications, never changes', async () => {
  const inv = await owner.post('/api/access/invitations', { kind: 'open_link', roles: ['viewer'], signs_in: true });
  assert.strictEqual((await guest.post('/api/auth/invitations/bearer', { token: inv.body.token })).status, 200);
  assert.strictEqual((await guest.get(`/api/runs/${runId}`)).status, 404, 'not shared yet');
  assert.strictEqual((await guest.get(`/api/artifacts/${blobId}`)).status, 404);
  assert.ok(!(await guest.get('/api/runs')).body.runs.some((r: any) => r.id === runId));

  const made = await owner.post('/api/run-shares', { run_ids: [runId], kind: 'link', note: 'Dla prof. H.', expires_in_days: 30 });
  assert.strictEqual(made.status, 201, JSON.stringify(made.body));
  assert.match(made.body.link_path, /^\/share#t=/);
  const token = made.body.link_token;
  assert.strictEqual((await guest.post('/api/run-shares/redeem', { token: 'x'.repeat(30) })).status, 404);
  const redeemed = await guest.post('/api/run-shares/redeem', { token });
  assert.deepStrictEqual([redeemed.status, redeemed.body.runIds], [200, [runId]]);

  assert.strictEqual((await guest.get(`/api/runs/${runId}`)).status, 200);
  assert.strictEqual((await guest.get(`/api/runs/${runId}/results`)).status, 200);
  assert.strictEqual((await guest.get(`/api/artifacts/${blobId}`)).status, 200, 'raw responses of a shared run');
  const listed = (await guest.get('/api/runs')).body.runs.find((r: any) => r.id === runId);
  assert.strictEqual(listed.shared_with_me, true);
  const rep = await guest.get('/api/replications/jh2016');
  const shown = rep.body.runs.find((r: any) => r.run_id === runId);
  assert.ok(shown && shown.shared === true && shown.evaluation?.complete === true, 'the shared run appears in Replications with its stored evaluation');

  assert.strictEqual((await guest.post(`/api/runs/${runId}/narrative/automatic`, { consent: true })).status, 404, 'a share never allows a change');
  assert.strictEqual((await guest.post('/api/run-shares', { run_ids: [runId], kind: 'link' })).status, 403, 'a viewer cannot pass it on');

  const list = await owner.get('/api/run-shares');
  const link = list.body.shares.find((s: any) => s.target_kind === 'link');
  const revoked = await owner.post(`/api/run-shares/${link.id}/revoke`, {});
  assert.strictEqual(revoked.status, 200);
  assert.strictEqual((await guest.get(`/api/runs/${runId}`)).status, 404, 'revoking the link ends what was redeemed from it');
  assert.strictEqual((await guest.post('/api/run-shares/redeem', { token })).status, 404);
});

test('sharing by address, and only the owner can share or revoke', async () => {
  const email = (await guest.get('/api/auth/me')).body.principal.email;
  const made = await owner.post('/api/run-shares', { run_ids: [runId], kind: 'email', target: email });
  assert.strictEqual(made.status, 201, JSON.stringify(made.body));
  assert.strictEqual((await guest.get(`/api/runs/${runId}`)).status, 200);
  assert.strictEqual((await guest.post(`/api/run-shares/${made.body.shares[0].id}/revoke`, {})).status, 404, 'not the guest\'s share');
  assert.strictEqual((await owner.post('/api/run-shares', { run_ids: ['no-such-run'], kind: 'email', target: email })).status, 404);
  await owner.post(`/api/run-shares/${made.body.shares[0].id}/revoke`, {});
  assert.strictEqual((await guest.get(`/api/runs/${runId}`)).status, 404);
  const Db = new Database(process.env.DB_PATH!);
  assert.throws(() => Db.prepare('DELETE FROM run_shares').run(), /Retain run share/);
  assert.throws(() => Db.prepare("UPDATE run_shares SET target = 'x'").run(), /WORM run share/);
  Db.close();
});
