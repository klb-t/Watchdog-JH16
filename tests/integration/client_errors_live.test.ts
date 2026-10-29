import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { stripUrlQueries, isClientErrorPath } from '../../backend/watchdog_api/api/client_errors';

/**
 * POST /api/client-errors in accounts mode, from a page that is not signed in:
 * the one unauthenticated write. A real server process with small limits from
 * its settings (4 KB body, 6 reports per address per minute). Synthetic reports.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-client-errors-'));
const diagDir = path.join(root, 'diagnostics');
const signingKey = randomBytes(32).toString('hex');
let server: ChildProcess, base = '', host = '', log = '';

const today = () => new Date().toISOString().split('T')[0];
const stored = () => { const f = path.join(diagDir, today(), 'client-errors.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
const report = (extra: Record<string, unknown> = {}) => ({ kind: 'error', message: 'TypeError: sign-in failed', path: '/signin', at: new Date().toISOString(), ...extra });
const post = (body: unknown, headers: Record<string, string> = {}, p = '/api/client-errors') => fetch(`${base}${p}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

before(async () => {
  const port = 5200 + Math.floor(Math.random() * 400); host = `127.0.0.1:${port}`; base = `http://${host}`;
  server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { stdio: 'pipe', detached: true, env: { ...process.env, PORT: String(port),
    NODE_ENV: 'production', WATCHDOG_ALLOW_EPHEMERAL_STORAGE: 'true', DB_PATH: path.join(root, 'w.sqlite'), STORE_PATH: path.join(root, 'store'),
    WATCHDOG_AUTH: 'accounts', SESSION_SIGNING_KEY: signingKey, WATCHDOG_GRANTS: JSON.stringify({ 'owner@lab.example': 'developer' }),
    WATCHDOG_PUBLIC_URL: base, WATCHDOG_DIAGNOSTICS_MODE: 'NORMAL', WATCHDOG_DIAGNOSTICS_DIR: diagDir,
    WATCHDOG_CLIENT_ERRORS_MAX_BYTES: '4096', WATCHDOG_CLIENT_ERRORS_RATE_LIMIT: '6', WATCHDOG_CLIENT_ERRORS_RATE_WINDOW_SECONDS: '60' } });
  server.stdout?.on('data', c => { log += c; }); server.stderr?.on('data', c => { log += c; });
  for (let i = 0; i < 240; i++) { try { if ((await fetch(`${base}/api/auth/config`)).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 250)); }
});
after(() => { if (server?.pid) try { process.kill(-server.pid, 'SIGKILL'); } catch { /* gone */ } fs.rmSync(root, { recursive: true, force: true }); });

test('client errors: pure helpers strip URL queries and match only the one path', () => {
  assert.equal(stripUrlQueries('failed GET https://x.example/invite?token=abc#k at /signin?code=1 (app.js:1:2)'),
    'failed GET https://x.example/invite at /signin (app.js:1:2)');
  assert.ok(isClientErrorPath('/api/client-errors') && isClientErrorPath('/API/Client-Errors//'));
  assert.ok(!isClientErrorPath('/api/client-errors/x') && !isClientErrorPath('/api/client-errorsx'));
});

// Order matters: refusals by origin and content type are not counted by the limiter; the size refusal is.
test('client errors: a page that is not signed in can report; the report is stored and redacted', async () => {
  const r = await post(report({ message: `auth failed with ${signingKey} at ${base}/invite?token=bearer-secret`,
    stack: `at go (${base}/assets/app.js?v=1:1:2)`, path: '/signin?code=one-time#frag', apiPath: '/api/auth/email/verify?code=x', method: 'POST', status: 500 }));
  assert.equal(r.status, 204);
  await new Promise(r => setTimeout(r, 100));
  const rows = stored();
  assert.equal(rows.length, 1);
  const text = JSON.stringify(rows);
  assert.ok(!text.includes(signingKey), 'a registered secret value is redacted');
  assert.match(rows[0].message, /\[REDACTED\]/);
  for (const leaked of ['bearer-secret', 'one-time', 'frag', 'code=x', 'v=1']) assert.ok(!text.includes(leaked), `${leaked} is not stored`);
  assert.equal(rows[0].path, '/signin'); assert.equal(rows[0].apiPath, '/api/auth/email/verify');
  assert.equal(rows[0].actor_id, null, 'no principal');
  assert.ok(!log.includes(signingKey), 'nor printed');
});

test('client errors: a foreign Origin and a cross-site fetch are refused', async () => {
  assert.equal((await post(report(), { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(report(), { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post('{"kind":"error"}', { 'Content-Type': 'text/plain' })).status, 415, 'a simple cross-site form type is refused');
  assert.equal(stored().length, 1);
});

test('client errors: a body over the configured limit is refused, also through a trailing slash', async () => {
  const big = JSON.stringify(report({ message: 'x'.repeat(1900), stack: 'y'.repeat(3000) }));
  assert.ok(Buffer.byteLength(big) > 4096);
  const r = await post(big);
  assert.equal(r.status, 413); assert.equal((await r.json()).limit_bytes, 4096);
  assert.equal((await post(big, {}, '/api/client-errors/')).status, 413);
  assert.equal((await post(report({ extra: 1 }))).status, 400, 'unknown fields are refused');
  assert.equal(stored().length, 1);
});

test('client errors: no other route opens', async () => {
  assert.equal((await fetch(`${base}/api/client-errors`)).status, 401, 'GET stays behind sign-in');
  assert.equal((await post(report(), {}, '/api/client-errors/extra')).status, 401);
  assert.equal((await post({}, {}, '/api/runs')).status, 401);
});

test('client errors: the per-address rate limit trips', async () => {
  // 4 counted so far (1 stored, 2 over the size limit, 1 invalid) out of 6.
  const statuses: number[] = [];
  for (let i = 0; i < 4; i++) statuses.push((await post(report({ message: `burst ${i}` }))).status);
  assert.deepEqual(statuses, [204, 204, 429, 429]);
  const limited = await post(report());
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(stored().length, 3);
});
