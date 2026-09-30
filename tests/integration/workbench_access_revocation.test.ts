import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { WorkbenchRepository } from '../../backend/watchdog_api/db/repositories/workbench';
import type { ObjectStore } from '../../backend/watchdog_api/storage/object_store';
import { WorkbenchService } from '../../backend/watchdog_api/workbench/service';
import { loadWorkbenchProfile } from '../../backend/watchdog_api/config/workbench';
import { buildWorkbenchRouter } from '../../backend/watchdog_api/api/workbench_routes';
import { errorHandler } from '../../backend/watchdog_api/api/middleware';
import { defaultFigure } from '../../shared/workbench';
import { testDataset } from '../helpers/workbench';

async function harness() {
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db);
  const blobs = new Map<string, Buffer>();
  let nextRead: (() => Promise<void>) | undefined;
  const store: ObjectStore = {
    async put(key, bytes) { blobs.set(key, Buffer.from(bytes)); return key; },
    async get(uri) {
      const bytes = blobs.get(uri); assert.ok(bytes);
      const action = nextRead; nextRead = undefined;
      if (action) await action();
      return Buffer.from(bytes);
    },
  };
  const repo = new WorkbenchRepository(db, store), service = new WorkbenchService(repo, loadWorkbenchProfile());
  const app = express(); app.use(express.json());
  let actor = 'owner', roles = ['researcher'];
  app.use((req, _res, next) => { req.principal = { id: actor, roles, email: null, identityProvenance: 'test' }; next(); });
  app.use('/workbench', buildWorkbenchRouter(repo, service)); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/workbench`;
  return {
    repo, service,
    call: (route: string, body?: unknown) => fetch(base + route, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
    principal: (id: string, assignedRoles = ['researcher']) => { actor = id; roles = assignedRoles; },
    duringNextRead: (action: () => Promise<void>) => { nextRead = action; },
    close: async () => { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); },
  };
}

test('dataset review capability cannot reveal another owner’s revoked shared data through the API', async () => {
  const h = await harness();
  try {
    const imported = await h.repo.importDataset(testDataset(), 'owner', 'test');
    const record = (await h.repo.approveDataset(imported.id, 'owner', imported.contentHash, true, 'test'))!;
    h.principal('other-researcher');
    assert.equal((await (await h.call('/datasets')).json()).records.length, 1);
    // This researcher owns the prepared method, but does not own its shared source.
    const figure = defaultFigure(record, h.service.profile); figure.channels.y = 'interest';
    const method = await h.service.prepare('other-researcher', figure, 'describe', 'test');
    assert.equal((await h.call(`/methods/${method!.id}`)).status, 200);
    h.principal('owner');
    assert.equal((await h.call(`/datasets/${record.id}/revoke`, {})).status, 200);

    for (const role of ['researcher', 'admin', 'developer', 'institutional']) {
      h.principal('other-researcher', [role]);
      const response = await h.call('/datasets'); assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).records, [], role);
    }
    h.principal('other-researcher');
    assert.equal((await h.call(`/methods/${method!.id}`)).status, 404, 'owned method does not bypass source revocation');
    assert.equal(await h.repo.getDataset(record.id, 'other-researcher', true), null);

    h.principal('owner');
    const owned = (await (await h.call('/datasets')).json()).records;
    assert.equal(owned.length, 1); assert.equal(owned[0].approvalState, 'PROPOSED');
    assert.deepEqual(owned[0].document, record.document, 'owner can still inspect source bytes for review');
    h.principal('owner', ['institutional']);
    assert.deepEqual((await (await h.call('/datasets')).json()).records, [], 'owner still needs review capability');

    h.principal('owner');
    assert.equal((await h.call(`/datasets/${record.id}/approve`, { expectedHash: record.contentHash, shareAggregate: true })).status, 200);
    h.principal('other-researcher');
    assert.equal((await (await h.call('/datasets')).json()).records.length, 1, 'explicit approval restores shared access');
    assert.equal((await h.call(`/methods/${method!.id}`)).status, 200);
  } finally { await h.close(); }
});

test('revoking shared approval during source I/O blocks an in-flight researcher API read', async () => {
  const h = await harness();
  try {
    const imported = await h.repo.importDataset(testDataset(), 'owner', 'test');
    await h.repo.approveDataset(imported.id, 'owner', imported.contentHash, true, 'test');
    h.principal('other-researcher');
    h.duringNextRead(() => h.repo.revokeDataset(imported.id, 'owner', 'concurrent-revoke'));
    const response = await h.call('/datasets'); assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).records, [], 'live approval must win over pre-I/O visibility');
    assert.equal((await h.repo.getDataset(imported.id, 'owner', true))?.approvalState, 'PROPOSED');
    assert.equal(await h.repo.getDataset(imported.id, 'other-researcher', true), null);
  } finally { await h.close(); }
});
