import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import Database from 'better-sqlite3';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { PrincipalRepository } from '../../backend/watchdog_api/db/repositories/principals';
import { SessionCodec, SESSION_COOKIE_NAME, principalIdFor } from '../../backend/watchdog_api/identity';

test('Private installation: real server isolates applicants and immediately enforces changed grants', { timeout: 60000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'watchdog-admission-boundary-'));
  const dbPath = join(root, 'watchdog.sqlite'), sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON'); runMigrations(sqlite);
  const principals = new PrincipalRepository(sqlite), key = randomBytes(32).toString('hex');
  const codec = new SessionCodec(key), at = new Date().toISOString();
  const owner = { sub: 'boundary-owner', email: 'owner@example.test' };
  const applicant = { sub: 'boundary-applicant', email: 'applicant@example.test' };
  for (const identity of [owner, applicant]) principals.recordIdentity({
    id: principalIdFor(identity.sub), email: identity.email, displayName: null, at,
  });
  principals.syncRoles(principalIdFor(owner.sub), ['developer']);
  const port = await new Promise<number>((resolve, reject) => {
    const socket = createServer(); socket.on('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      if (!address || typeof address === 'string') return reject(new Error('No test port'));
      socket.close(() => resolve(address.port));
    });
  });
  const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'production', PORT: String(port),
      DB_PATH: dbPath, STORE_PATH: join(root, 'store'), WATCHDOG_VAULT_KEY_FILE: join(root, 'vault.key'),
      GOOGLE_OAUTH_CLIENT_ID: 'boundary-test-audience', WATCHDOG_GRANTS: JSON.stringify({ [owner.email]: 'developer' }),
      SESSION_SIGNING_KEY: key, WATCHDOG_ALLOW_EPHEMERAL_STORAGE: 'true', WATCHDOG_DIAGNOSTICS_MODE: 'OFF' },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  let output = ''; server.stdout?.on('data', chunk => { output += chunk; }); server.stderr?.on('data', chunk => { output += chunk; });
  const url = `http://127.0.0.1:${port}`;
  const cookie = (identity: typeof owner, role: 'developer' | null) => `${SESSION_COOKIE_NAME}=${codec.sign({
    ...identity, role, exp: Date.now() + 3600000, ...(role ? {} : { scope: 'admission' as const }),
  })}`;
  const ownerCookie = cookie(owner, 'developer'), admissionCookie = cookie(applicant, null);
  const request = (path: string, session?: string, body?: unknown) => fetch(`${url}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...(session ? { Cookie: session } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    const deadline = Date.now() + 30000;
    while (true) {
      try { if ((await request('/api/auth/config')).ok) break; } catch { /* startup */ }
      if (Date.now() >= deadline) throw new Error(`Server did not start: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    for (const path of ['/api/sources', '/api/settings', '/api/automation/schedules', '/api/search?q=']) {
      assert.equal((await request(path)).status, 401, `Anonymous boundary: ${path}`);
      assert.equal((await request(path, admissionCookie)).status, 401, `Applicant boundary: ${path}`);
    }
    assert.equal((await request('/api/auth/admission/request', admissionCookie, { reason: 'Research access for a test study.' })).status, 200);
    const status = await (await request('/api/auth/admission/status', admissionCookie)).json();
    assert.equal(status.status, 'pending'); assert.equal(status.email, applicant.email);
    assert.equal((await request('/api/auth/admission/admin', admissionCookie)).status, 401);
    assert.equal((await request('/api/sources', ownerCookie)).status, 200);
    assert.equal((await request('/api/auth/admission/grants', ownerCookie, { email: applicant.email, roles: ['viewer'], active: true })).status, 200);
    const activated = await request('/api/auth/admission/activate', admissionCookie, {});
    assert.equal(activated.status, 200);
    const activatedCookie = activated.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await request('/api/sources', activatedCookie)).status, 200);
    assert.equal((await request('/api/auth/admission/grants', ownerCookie, { email: applicant.email, roles: ['responder'], active: true })).status, 200);
    const me = await (await request('/api/auth/me', activatedCookie)).json();
    assert.deepEqual(me.principal.roles, ['responder']);
    assert.equal((await request('/api/sources', activatedCookie)).status, 403);
    assert.equal((await request('/api/auth/admission/grants', ownerCookie, { email: applicant.email, roles: [], active: false })).status, 200);
    assert.equal((await request('/api/auth/me', activatedCookie)).status, 401);
    assert.equal((await request('/api/search?q=', activatedCookie)).status, 401);
    assert.equal((await request('/api/auth/admission/grants', ownerCookie, { email: owner.email, roles: [], active: false })).status, 409);
  } finally {
    if (server.pid) { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* exited */ } }
    sqlite.close(); rmSync(root, { recursive: true, force: true });
  }
});
