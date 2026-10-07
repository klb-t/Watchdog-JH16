import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { pruneDiagnostics, retentionFromEnv } from '../../backend/watchdog_api/diag/retention';

/**
 * What a live installation records when something goes wrong, end to end in a
 * real server process: every API request with its status and error message,
 * full stacks, step-by-step TRACE events, browser-reported failures, crashes
 * at start-up — and the VM reader (`watchdogctl errors|trace|diag-summary`)
 * that finds them by trace ID. The diagnostics directory sits where the VM
 * bind-mounts it, under a fake root.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-diag-live-'));
const diagDir = path.join(root, 'var/lib/watchdog/diagnostics');
let server: ChildProcess, base = '', log = '';

const env = (extra: Record<string, string> = {}) => ({ ...process.env, NODE_ENV: 'production', WATCHDOG_ALLOW_OPEN_INSTANCE: 'true',
  WATCHDOG_ALLOW_EPHEMERAL_STORAGE: 'true', DB_PATH: path.join(root, 'w.sqlite'), STORE_PATH: path.join(root, 'store'),
  WATCHDOG_DIAGNOSTICS_MODE: 'TRACE', WATCHDOG_DIAGNOSTICS_DIR: diagDir, ...extra });
const today = () => new Date().toISOString().split('T')[0];
const lines = (name: string) => { const f = path.join(diagDir, today(), name); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
const reader = (...args: string[]) => spawnSync('python3', ['scripts/watchdog_diag.py', ...args], { env: { ...process.env, WATCHDOG_ROOT: root }, encoding: 'utf8' });

before(async () => {
  const port = 4400 + Math.floor(Math.random() * 400); base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { env: env({ PORT: String(port) }), stdio: 'pipe', detached: true });
  server.stdout?.on('data', c => { log += c; }); server.stderr?.on('data', c => { log += c; });
  for (let i = 0; i < 240; i++) { try { if ((await fetch(`${base}/api/auth/config`)).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 250)); }
});
after(() => { if (server?.pid) try { process.kill(-server.pid, 'SIGKILL'); } catch { /* gone */ } fs.rmSync(root, { recursive: true, force: true }); });

test('diagnostics: every API request is recorded with status, duration and the error a route helper sent', async () => {
  const missing = await fetch(`${base}/api/research/comparison-families/does-not-exist`);
  const body = await missing.json(), trace = missing.headers.get('x-trace-id')!;
  assert.equal(missing.status, 404);
  assert.equal(body.trace_id, trace, 'error bodies carry the trace ID a person can quote');
  await new Promise(r => setTimeout(r, 100));
  const entry = lines('requests.jsonl').find(r => r.trace_id === trace);
  assert.ok(entry, 'the request is in requests.jsonl');
  assert.equal(entry.status, 404); assert.equal(entry.method, 'GET'); assert.ok(Number.isInteger(entry.duration_ms));
  assert.match(entry.error.message, /comparison family not found/i);
  assert.match(log, new RegExp(`\\[HTTP\\] 404 GET /api/research/comparison-families/does-not-exist \\d+ms trace=${trace}`));
  const events = fs.readFileSync(path.join(diagDir, today(), trace, 'events.jsonl'), 'utf8');
  assert.match(events, /REQUEST_COMPLETE/); assert.match(events, /SPAN_START/);
});

test('diagnostics: an unexpected server error keeps its full stack in server-errors.jsonl', async () => {
  const bad = await fetch(`${base}/api/research/comparison-families`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const trace = bad.headers.get('x-trace-id')!;
  assert.equal(bad.status, 400);
  await new Promise(r => setTimeout(r, 100));
  const error = lines('server-errors.jsonl').find(e => e.trace_id === trace);
  assert.ok(error, 'the error envelope is written');
  assert.equal(error.exception_type, 'ZodError'); assert.ok(error.stack_trace?.includes('at '), 'with a stack trace');
});

test('diagnostics: browsers can report failures — small, same-origin, rate-limited, without query strings', async () => {
  const post = (b: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/client-errors`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof b === 'string' ? b : JSON.stringify(b) });
  const report = { kind: 'error', message: 'TypeError: x is undefined', stack: 'at Workbench (app.js:1:2)', path: '/workbench?token=secret-value', at: new Date().toISOString() };
  assert.equal((await post(report)).status, 204);
  assert.equal((await post({ ...report, extra: 1 })).status, 400, 'unknown fields are refused');
  assert.equal((await post(report, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post(JSON.stringify({ ...report, message: 'x'.repeat(20_000) }))).status, 413, 'reports over 16 KB are refused');
  await new Promise(r => setTimeout(r, 100));
  const stored = lines('client-errors.jsonl');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].path, '/workbench'); assert.ok(!JSON.stringify(stored).includes('secret-value'), 'the query string is dropped');
  assert.match(log, /\[CLIENT\] error \/workbench: TypeError: x is undefined/);
  let limited = 0;
  for (let i = 0; i < 35; i++) if ((await post({ ...report, message: `burst ${i}` })).status === 429) limited++;
  assert.ok(limited > 0, 'a flood is rate limited');
});

test('diagnostics: the VM reader lists failures, follows one trace and summarises the day', async () => {
  const errors = reader('errors', '100');
  assert.equal(errors.status, 0, errors.stderr);
  assert.match(errors.stdout, /http +[0-9a-f-]{36} +404 GET \/api\/research\/comparison-families\/does-not-exist/);
  assert.match(errors.stdout, /server .*ZodError/); assert.match(errors.stdout, /browser .*error on \/workbench/);
  const trace = /http +([0-9a-f-]{36}) +404/.exec(errors.stdout)![1];
  const followed = reader('trace', trace);
  assert.equal(followed.status, 0, followed.stderr);
  assert.match(followed.stdout, /\[requests\.jsonl\]/); assert.match(followed.stdout, /REQUEST_COMPLETE/);
  assert.notEqual(reader('trace', 'not-a-uuid').status, 0);
  const summary = reader('summary');
  assert.match(summary.stdout, /API requests, \d+ failed \(5xx\/aborted\), \d+ refused \(4xx\)/);
  assert.match(summary.stdout, /browser errors \d+/);
});

test('diagnostics: a server that refuses to start writes the reason to process-errors.jsonl and still exits non-zero', () => {
  const crashDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-diag-crash-'));
  try {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'server.ts'], { encoding: 'utf8', timeout: 60_000,
      env: env({ PORT: '0', WATCHDOG_ALLOW_EPHEMERAL_STORAGE: '', DB_PATH: path.join(crashDir, 'w.sqlite'), STORE_PATH: path.join(crashDir, 's'), WATCHDOG_DIAGNOSTICS_DIR: path.join(crashDir, 'diag') }) });
    assert.notEqual(r.status, 0);
    const file = path.join(crashDir, 'diag', today(), 'process-errors.jsonl');
    assert.ok(fs.existsSync(file), `crash recorded (${r.stderr.slice(-300)})`);
    assert.match(fs.readFileSync(file, 'utf8'), /would not survive a restart/);
  } finally { fs.rmSync(crashDir, { recursive: true, force: true }); }
});

test('diagnostics retention: old days go first, then oldest days above the size cap; today always stays', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-retention-'));
  try {
    const mk = (day: string, bytes: number) => { fs.mkdirSync(path.join(dir, day), { recursive: true }); fs.writeFileSync(path.join(dir, day, 'requests.jsonl'), 'x'.repeat(bytes)); };
    mk('2026-09-01', 10); mk('2026-10-01', 600); mk('2026-10-02', 600); mk('2026-10-04', 600);
    fs.writeFileSync(path.join(dir, 'not-a-day.txt'), 'keep');
    const r = pruneDiagnostics(dir, { days: 14, maxBytes: 1300, now: new Date('2026-10-04T12:00:00Z') });
    assert.deepEqual(r.removed, ['2026-09-01', '2026-10-01']);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-10-02', '2026-10-04', 'not-a-day.txt']);
    const tiny = pruneDiagnostics(dir, { days: 14, maxBytes: 1, now: new Date('2026-10-04T12:00:00Z') });
    assert.ok(fs.existsSync(path.join(dir, '2026-10-04')), 'today survives even over the cap'); assert.deepEqual(tiny.removed, ['2026-10-02']);
    assert.throws(() => retentionFromEnv({ WATCHDOG_DIAGNOSTICS_RETENTION_DAYS: '0' }), /RETENTION_DAYS/);
    assert.deepEqual(retentionFromEnv({}), { days: 14, maxBytes: 2048 * 1024 * 1024 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
