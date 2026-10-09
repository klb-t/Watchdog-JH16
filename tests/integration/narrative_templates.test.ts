import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { RunRepository } from '../../backend/watchdog_api/db/repositories/runs';
import { ArtifactRepository } from '../../backend/watchdog_api/db/repositories/artifacts';
import { AuditRepository } from '../../backend/watchdog_api/db/repositories/audit';
import { SettingsRepository } from '../../backend/watchdog_api/db/repositories/settings';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { buildApiRouter } from '../../backend/watchdog_api/api/routes';
import { errorHandler } from '../../backend/watchdog_api/api/middleware';
import { loadAssistantProfile } from '../../backend/watchdog_api/config/assistant';
import { UserVault } from '../../backend/watchdog_api/secrets/user_vault';
import { AssistantService } from '../../backend/watchdog_api/services/assistant';
import { normalizeModelCatalog } from '../../backend/watchdog_api/llm/routing';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';

// Public synthetic source; only in-process controlled provider transport is used.
test('WD-001: real API selects, validates and archives exact recipes; reopened store and provider ledger retain provenance', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wd-narrative-api-'));
  const filename = path.join(directory, 'store.sqlite');
  let sqlite = new Database(filename); sqlite.pragma('foreign_keys=ON'); runMigrations(sqlite);
  const store = new LocalFileSystemStore(path.join(directory, 'objects'));
  const owner = 'local-user', profile = loadAssistantProfile(), canary = 'synthetic-narrative-credential-private';
  let actor = owner, bodies: any[] = [], failProvider = false, failArchive = false, changeOwner = false;
  const transport: typeof fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body)); bodies.push(body);
    if (failProvider) return new Response('{}', { status: 503 });
    const user = body.messages.find((row: any) => row.role === 'user').content as string;
    return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content: user.slice(user.indexOf('\n\n') + 2) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
  };
  const guardedStore = { get: store.get.bind(store), put: async (key: string, bytes: Buffer) => {
    if (failArchive && key.startsWith('narratives/')) throw new Error('Synthetic storage interruption');
    const uri = await store.put(key, bytes);
    if (changeOwner && key.startsWith('narratives/')) sqlite.prepare('UPDATE runs SET owner_principal_id=? WHERE id=?').run('other', runId);
    return uri;
  } };
  let repo = new SettingsRepository(sqlite, store);
  const first = repo.get(owner, profile.defaults);
  repo.save(owner, { ...first.value, assistant: { ...first.value.assistant, enabled: true } }, first.hash, profile.defaults);
  new UserVault(repo, path.join(directory, 'master.key'), {}).save(owner, 'openrouter', canary);
  const raw = Buffer.from(JSON.stringify({ data: [{ id: 'synthetic/narrative', name: 'Synthetic narrative', context_length: 64000,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0.000001', completion: '0.000002', request: '0' }, supported_parameters: ['temperature'] }] }));
  await repo.saveCatalog(normalizeModelCatalog(raw, profile), raw);
  const runId = new RunRepository(drizzle(sqlite)).createRun({ runType: 'ANALYSIS', config: { fixture: true }, ownerPrincipalId: owner });
  new ArtifactRepository(drizzle(sqlite)).finalizeManifest(runId, 'synthetic:existing-manifest', 'a'.repeat(64));
  const start = async () => {
    repo = new SettingsRepository(sqlite, store);
    const service = new AssistantService(repo, new UserVault(repo, path.join(directory, 'master.key'), {}), profile, transport);
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.principal = { id: actor, roles: ['researcher'], email: null, identityProvenance: 'test' }; next(); });
    app.use('/api', buildApiRouter(drizzle(sqlite), guardedStore, new AuditRepository(sqlite), service)); app.use(errorHandler);
    const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    return server;
  };
  let server = await start();
  const call = async (suffix: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/runs/${runId}${suffix}`,
      body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, value: await response.json() };
  };
  const stop = () => new Promise<void>(resolve => server.close(() => resolve()));
  try {
    const artifacts = () => new ArtifactRepository(drizzle(sqlite)).getArtifacts(runId);
    const preview = await call('/narrative'); assert.equal(preview.status, 200);
    assert.equal(preview.value.narrative.templateId, 'jh2016-summary'); assert.equal(artifacts().length, 0);
    const plPreview = await call('/narrative?templateId=summary-pl&templateVersion=1.0');
    assert.equal(plPreview.value.narrative.producedBy.recipe.locale, 'pl'); assert.equal(artifacts().length, 0);
    for (const suffix of ['/narrative', '/narrative/generate', '/narrative/automatic']) {
      const body = { templateId: 'missing', templateVersion: '1.0', ...(suffix.endsWith('automatic') ? { consent: true } : {}) };
      assert.equal((await call(suffix, body)).status, 400);
      assert.equal((await call(suffix, { ...body, extra: true })).status, 400);
      assert.equal((await call(suffix, [])).status, 400);
    }
    assert.equal(bodies.length, 0); assert.equal(repo.generations(owner).length, 0); assert.equal(artifacts().length, 0);
    assert.equal((await call('/narrative/automatic', { consent: false })).status, 400);
    const saved = await call('/narrative', { templateId: 'summary-pl', templateVersion: '1.0' });
    assert.equal(saved.status, 200); assert.equal(saved.value.narrative.approvalState, 'PROPOSED');
    const artifact = artifacts()[0]; assert.equal(artifact.sha256, canonicalHash(saved.value.narrative));
    assert.deepEqual(JSON.parse((await store.get(artifact.object_uri)).toString()), saved.value.narrative);
    const beforeArchiveFailure = artifacts().length; failArchive = true;
    assert.equal((await call('/narrative', {})).status, 500); assert.equal(artifacts().length, beforeArchiveFailure);
    failArchive = false; changeOwner = true;
    assert.equal((await call('/narrative', {})).status, 404);
    assert.equal(artifacts().length, beforeArchiveFailure, 'ownership change during storage cannot register or return a proposal');
    changeOwner = false; sqlite.prepare('UPDATE runs SET owner_principal_id=? WHERE id=?').run(owner, runId);
    const generated = await call('/narrative/automatic', { consent: true, templateId: 'summary-pl', templateVersion: '1.0' });
    assert.equal(generated.status, 200); assert.equal(bodies.length, 1); assert.equal(bodies[0].temperature, 0);
    assert.equal(generated.value.narrative.producedBy.generation.requestBodyHash, canonicalHash(bodies[0]));
    assert.deepEqual(repo.generations(owner)[0].result.generation, generated.value.narrative.producedBy.generation);
    assert.equal(JSON.stringify(generated.value).includes(canary), false);
    failProvider = true;
    const beforeFailure = artifacts().length;
    assert.notEqual((await call('/narrative/automatic', { consent: true })).status, 200);
    assert.equal(bodies.length, 2); assert.equal(artifacts().length, beforeFailure);
    assert.equal(repo.generations(owner).some(row => row.result.retryAutomatically === false), true);
    assert.equal(new ArtifactRepository(drizzle(sqlite)).getManifest(runId)!.sha256, 'a'.repeat(64));
    await stop(); sqlite.close(); sqlite = new Database(filename); sqlite.pragma('foreign_keys=ON');
    server = await start();
    const restored = await call(`/narratives/${saved.value.artifact.artifactId}`);
    assert.equal(restored.status, 200); assert.deepEqual(restored.value, saved.value);
    assert.equal(repo.generations(owner).length, 2);
    actor = 'other'; assert.equal((await call(`/narratives/${saved.value.artifact.artifactId}`)).status, 404);
    assert.equal((await call('/narrative', {})).status, 404); assert.equal(bodies.length, 2);
  } finally { await stop(); sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
});
