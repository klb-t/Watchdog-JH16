import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { buildAuthRouter, requireCapability } from '../../backend/watchdog_api/api/auth_routes';
import { PrincipalRepository } from '../../backend/watchdog_api/db/repositories/principals';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { capabilitiesFor } from '../../shared/authorization';

test('E4.2: /me exposes the union of peer profiles and the HTTP gates enforce it', async () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const app = express();
  let roles = ['researcher', 'responder'];
  app.use((req, _res, next) => {
    req.principal = { id: 'test-person', email: null, roles, identityProvenance: 'test' };
    next();
  });
  app.use('/auth', buildAuthRouter({ principals: new PrincipalRepository(db), secureCookies: false,
    identity: { mode: 'local', config: { mode: 'local', audience: null, grants: {}, reason: 'test' },
      codec: null, verifier: null, resolve: async () => null } }));
  app.get('/field', requireCapability('responder.lookup'), (_req, res) => res.json({ ok: true }));
  app.post('/grants', requireCapability('principal.manage'), (_req, res) => res.json({ ok: true }));
  app.use((e: any, _req: any, res: any, _next: any) => res.status(403).json({ code: e.code }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const me = await (await fetch(`${base}/auth/me`)).json();
    assert.deepEqual(me.capabilities, capabilitiesFor(roles));
    for (const role of ['responder', 'institutional', 'law_enforcement', 'admin', 'developer', 'dev']) {
      roles = [role];
      assert.equal((await fetch(`${base}/field`)).status, 200);
    }
    roles = ['researcher'];
    assert.equal((await fetch(`${base}/field`)).status, 403);
    roles = ['admin'];
    assert.equal((await fetch(`${base}/grants`, { method: 'POST' })).status, 403);
    roles = ['developer'];
    assert.equal((await fetch(`${base}/grants`, { method: 'POST' })).status, 200);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});

test('E4.2: persistence retains peer profiles without inventing a highest role', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const repo = new PrincipalRepository(db);
  repo.upsertOnSignIn({ id: 'r', email: null, displayName: null, role: 'researcher',
    identityProvenance: 'test', at: '2026-09-08T00:00:00Z' });
  db.prepare('INSERT INTO principal_roles VALUES (?, ?)').run('r', 'responder');
  assert.deepEqual(repo.get('r')!.roles, ['researcher', 'responder']);
  assert.equal(repo.get('r')!.role, null);
  db.close();
});
