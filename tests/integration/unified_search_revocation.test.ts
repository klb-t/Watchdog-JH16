import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { WorkbenchRepository } from '../../backend/watchdog_api/db/repositories/workbench';
import { SearchRepository } from '../../backend/watchdog_api/db/repositories/search';
import type { ObjectStore } from '../../backend/watchdog_api/storage/object_store';
import { buildSearchRouter } from '../../backend/watchdog_api/api/search_routes';
import { errorHandler } from '../../backend/watchdog_api/api/middleware';
import { sourceRegistry } from '../../backend/watchdog_api/sources/registry';
import type { SearchResponse } from '../../shared/search';
import { testDataset } from '../helpers/workbench';

test('unified search observes shared-data revocation while provider status resolution is pending', async () => {
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db);
  const blobs = new Map<string, Buffer>();
  const store: ObjectStore = {
    async put(key, bytes) { blobs.set(key, Buffer.from(bytes)); return key; },
    async get(uri) { const bytes = blobs.get(uri); assert.ok(bytes); return Buffer.from(bytes); },
  };
  const datasets = new WorkbenchRepository(db, store);
  const app = express();
  app.use((req, _res, next) => { req.principal = { id: 'other-researcher', roles: ['researcher'], email: null, identityProvenance: 'test' }; next(); });
  app.use('/search', buildSearchRouter(new SearchRepository(db, store))); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/search`;
  const source = sourceRegistry.getEntry('serp_result_count')!, originalStatus = source.liveStatus;
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  let pending: Promise<SearchResponse> | undefined;
  try {
    const dataset = await datasets.importDataset(testDataset(), 'owner', 'test');
    await datasets.approveDataset(dataset.id, 'owner', dataset.contentHash, true, 'test');
    source.liveStatus = async () => { entered(); await resume; return { status: 'blocked', remediation: 'Controlled software fixture' }; };
    const before = await (await fetch(base + '?kind=dataset')).json() as SearchResponse;
    assert.equal(before.total, 1, 'dataset-only searches do not wait on irrelevant provider status');

    pending = fetch(base + '?kind=all').then(async response => {
      assert.equal(response.status, 200); return await response.json() as SearchResponse;
    });
    await waiting;
    await datasets.revokeDataset(dataset.id, 'owner', 'concurrent-revoke');
    release();
    const response = await pending;
    assert.equal(response.results.filter(hit => hit.kind === 'dataset').length, 0);
    assert.equal(response.total, response.results.length, 'count excludes the revoked dataset as well');
    assert.equal(response.total, sourceRegistry.listSources().length, 'only the accessible registry entries remain');
    assert.ok(!JSON.stringify(response).includes(dataset.id), 'no source ID or hash survives in the response');
    assert.equal((await (await fetch(base + '?kind=dataset')).json()).total, 0);
  } finally {
    release(); await pending?.catch(() => undefined); source.liveStatus = originalStatus;
    await new Promise<void>(resolve => server.close(() => resolve())); db.close();
  }
});
