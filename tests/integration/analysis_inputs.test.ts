import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import express from 'express';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { RunRepository } from '../../backend/watchdog_api/db/repositories/runs';
import { ObservationRepository, AnalysisResultRepository } from '../../backend/watchdog_api/db/repositories/data';
import { ArtifactRepository } from '../../backend/watchdog_api/db/repositories/artifacts';
import { MethodSpecRepository } from '../../backend/watchdog_api/db/repositories/method_specs';
import { AuditRepository } from '../../backend/watchdog_api/db/repositories/audit';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { RunOrchestrator } from '../../backend/watchdog_api/services/run_orchestrator';
import { captureAnalysisInput, freezeAnalysisInput, persistAnalysisWithInput, readAnalysisInput } from '../../backend/watchdog_api/services/analysis_inputs';
import { analyzerRegistry } from '../../backend/watchdog_api/analytics/registry';
import { TextGenerationRegistry } from '../../backend/watchdog_api/llm';
import { SettingsRepository } from '../../backend/watchdog_api/db/repositories/settings';
import { UserVault } from '../../backend/watchdog_api/secrets/user_vault';
import { loadAssistantProfile } from '../../backend/watchdog_api/config/assistant';
import { AssistantService } from '../../backend/watchdog_api/services/assistant';
import { hashNarrativePayload } from '../../backend/watchdog_api/services/narrative';
import { canonicalHash, canonicalizeJson } from '../../backend/watchdog_api/domain/canonical';
import { buildApiRouter } from '../../backend/watchdog_api/api/routes';
import { errorHandler } from '../../backend/watchdog_api/api/middleware';
import { tracer } from '../../backend/watchdog_api/utils/tracer';

const golden = JSON.parse(readFileSync('tests/fixtures/analysis-input-before.json', 'utf8'));
const spec = JSON.parse(readFileSync('config/methods/jh2016-faithful.methodspec.json', 'utf8'));

function harness() {
  const directory = mkdtempSync(path.join(tmpdir(), 'wd-consumed-input-'));
  const filename = path.join(directory, 'runs.sqlite');
  let sqlite = new Database(filename); sqlite.pragma('foreign_keys=ON'); runMigrations(sqlite);
  const local = new LocalFileSystemStore(path.join(directory, 'objects'));
  let actor = 'local-user', putFailure = false, getFailure = false, changeOwnerOnRead: string | null = null;
  let beforeManifestReturn: ((runId: string) => void) | null = null;
  let beforeNarrativeReturn: (() => void) | null = null;
  let providerCalls = 0, sourceResolutions = 0;
  const store = {
    async put(key: string, bytes: Buffer) {
      if (putFailure && key.startsWith('analysis-inputs/')) throw new Error('Synthetic input storage interruption');
      const uri = await local.put(key, bytes);
      if (key.startsWith('manifests/')) beforeManifestReturn?.(path.basename(key, '.json'));
      if (key.startsWith('narratives/')) beforeNarrativeReturn?.();
      return uri;
    },
    async get(uri: string) {
      if (getFailure && uri.includes('/analysis-inputs/')) throw new Error('Synthetic input storage unavailable');
      const bytes = await local.get(uri);
      if (changeOwnerOnRead && uri.includes('/analysis-inputs/'))
        sqlite.prepare('UPDATE runs SET owner_principal_id=? WHERE id=?').run('other', changeOwnerOnRead);
      return bytes;
    },
  };
  const repos = () => {
    const db = drizzle(sqlite);
    return { db, runs: new RunRepository(db), observations: new ObservationRepository(db),
      analyses: new AnalysisResultRepository(db), artifacts: new ArtifactRepository(db) };
  };
  const source = () => {
    const { runs, observations } = repos();
    const id = runs.createRun({ runType: 'ACQUISITION', config: { synthetic: true } });
    observations.insertMany(id, golden.source.map((row: any) => ({ ...row, seriesId: '' })));
    return id;
  };
  const execute = async (sourceId: string, reviewed = false, owner = 'local-user') => {
    const { db, runs } = repos();
    const methods = new MethodSpecRepository(db), id = methods.upsert(spec, { id: 'jh2016-faithful' });
    methods.approve(id, 'public-synthetic-reviewer', '2026-10-09T00:00:00Z', canonicalHash(spec));
    const config = reviewed ? { source_run_id: sourceId, method_spec_id: id, method_spec_hash: canonicalHash(spec) }
      : { source_run_id: sourceId, method_id: 'jh16_faithful', method_params: {
        reference_scores: { audit_entity: 7 }, future: { public_unknown_field: 'preserve exactly' } } };
    const runId = runs.createRun({ runType: 'ANALYSIS', config, ownerPrincipalId: owner });
    await new RunOrchestrator(db, store, async () => { ++sourceResolutions; throw new Error('Unexpected source resolution'); }).executeRun(runId);
    return runId;
  };
  let server: ReturnType<express.Express['listen']> | undefined;
  const start = async (assistantOverride?: AssistantService) => {
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.principal = { id: actor, roles: ['researcher'], email: null, identityProvenance: 'test' }; next(); });
    // A forbidden narrative path cannot even ask for a provider/generator.
    const assistant = { provider() { ++providerCalls; throw new Error('Unexpected provider selection'); },
      generator() { ++providerCalls; throw new Error('Unexpected provider dispatch'); } };
    app.use('/api', buildApiRouter(drizzle(sqlite), store, new AuditRepository(sqlite), assistantOverride ?? assistant as any)); app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', resolve));
  };
  const stop = async () => { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; };
  const call = async (runId: string, suffix: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${(server!.address() as any).port}/api/runs/${runId}${suffix}`,
      body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, text, value: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null };
  };
  tracer.setMode('OFF');
  return { directory, filename, local, store, repos, source, execute, start, call,
    get sqlite() { return sqlite; }, set actor(value: string) { actor = value; },
    set putFailure(value: boolean) { putFailure = value; }, set getFailure(value: boolean) { getFailure = value; },
    set changeOwnerOnRead(value: string | null) { changeOwnerOnRead = value; },
    set beforeManifestReturn(value: ((runId: string) => void) | null) { beforeManifestReturn = value; },
    set beforeNarrativeReturn(value: (() => void) | null) { beforeNarrativeReturn = value; },
    counts: () => ({ providerCalls, sourceResolutions }),
    async reopen() { await stop(); sqlite.close(); sqlite = new Database(filename); sqlite.pragma('foreign_keys=ON'); await start(); },
    async close() { await stop(); sqlite.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('A4-WD-002: both actual executors pin consumed source inputs through manifest HTTP disclosure and reopen', async () => {
  const h = harness();
  try {
    const sourceId = h.source();
    // The receipt pins the JSON-domain projection: optional undefined JS
    // properties have no field in the serialized observation contract.
    const beforeSource = JSON.parse(JSON.stringify(h.repos().observations.getByRunId(sourceId)));
    const ids = [await h.execute(sourceId), await h.execute(sourceId, true)];
    await h.start();
    const snapshots: { manifestBytes: Buffer; manifest: any; exported: any; narrativeHash: string }[] = [];
    for (const [index, id] of ids.entries()) {
      const { db, runs, analyses, artifacts } = h.repos();
      assert.equal(runs.getRun(id)!.status, 'COMPLETED', runs.getRun(id)!.error_details ?? '');
      assert.equal(canonicalizeJson(analyses.getByRunId(id)), golden.resultsCanonical[index], 'pre-fix numeric/missing result bytes');
      const row = analyses.listAnalysisRuns(id)[0], receipt = await readAnalysisInput(db, h.store, id, 'local-user');
      assert.equal(receipt.evidence.status, 'verified'); assert.equal(receipt.receipts.length, 1);
      const pinned = receipt.receipts[0].receipt;
      assert.deepEqual(pinned.observations, beforeSource); assert.equal(pinned.observation_ids.length, 2);
      assert.deepEqual(JSON.parse(row.input_series_ids_json!), [...new Set(beforeSource.map(value => value.seriesId))].sort());
      assert.equal(JSON.parse(row.input_series_ids_json!).includes('audit_entity'), false);
      assert.deepEqual(JSON.parse(row.input_hashes_json!), pinned.series.map(value => value.sha256));
      assert.equal(pinned.execution.executor_id, index ? 'typescript-inprocess' : 'jh16_faithful');
      if (!index) assert.deepEqual(pinned.execution.parameters!.future, { public_unknown_field: 'preserve exactly' });
      else { assert.deepEqual(pinned.execution.method_spec, spec); assert.equal(pinned.execution.approved_hash, canonicalHash(spec)); }
      const manifestRow = artifacts.getManifest(id)!, manifestBytes = await h.store.get(manifestRow.object_uri);
      const manifest = JSON.parse(manifestBytes.toString());
      assert.equal(canonicalHash(manifest), manifestRow.sha256);
      assert.deepEqual(manifest.missing_observations, [{ entity_id: 'audit_entity', query_role: 'harm', missing_reason: 'RATE_LIMITED' }]);
      assert.deepEqual(manifest.quality_flags, ['COUNT_PARSE_UNCERTAIN']);
      assert.equal(manifest.analyses[0].input_receipt.sha256, receipt.receipts[0].sha256);
      const exported = await h.call(id, '/export'); assert.equal(exported.status, 200);
      assert.deepEqual(exported.value.missing_observations, manifest.missing_observations);
      assert.deepEqual(exported.value.quality_flags, manifest.quality_flags);
      assert.equal(exported.value.input_evidence.status, 'verified');
      const csv = await h.call(id, '/export?format=csv'); assert.equal(csv.status, 200);
      assert.match(csv.text, /RATE_LIMITED/); assert.match(csv.text, /COUNT_PARSE_UNCERTAIN/);
      const charts = await h.call(id, '/charts'); assert.equal(charts.status, 200);
      assert.deepEqual(charts.value.quality_flags, ['COUNT_PARSE_UNCERTAIN']);
      assert.equal(charts.value.charts.length, index ? 2 : 3);
      if (!index) assert.equal(charts.value.charts[2].points[0].y, 7, 'actual consumed reference, not current global scores');
      const narrative = await h.call(id, '/narrative'); assert.equal(narrative.status, 200);
      const expectedHash = hashNarrativePayload({ presetId: runs.getRun(id)!.preset_id,
        results: analyses.getByRunId(id).map(value => ({ metricKey: value.metricKey, entityId: value.entityId, valueNumeric: value.valueNumeric, unit: value.unit })),
        missingCount: 1, qualityFlags: ['COUNT_PARSE_UNCERTAIN'] });
      assert.equal(narrative.value.narrative.inputPayloadHash, expectedHash);
      snapshots.push({ manifestBytes, manifest: manifestRow, exported: exported.value, narrativeHash: expectedHash });
    }
    // Synthetic out-of-band mutation: historical disclosure must retain what
    // was consumed, without claiming that these changed rows were its input.
    h.sqlite.prepare("UPDATE observations SET is_missing=0,numeric_value=25,missing_reason=NULL,quality_flags_json='[]' WHERE run_id=? AND is_missing=1").run(sourceId);
    assert.equal(h.repos().observations.getByRunId(sourceId).some(value => value.isMissing), false);
    await h.reopen();
    for (const [index, id] of ids.entries()) {
      assert.deepEqual((await h.call(id, '/export')).value, snapshots[index].exported);
      assert.equal((await h.call(id, '/narrative')).value.narrative.inputPayloadHash, snapshots[index].narrativeHash);
      assert.deepEqual(await h.store.get(snapshots[index].manifest.object_uri), snapshots[index].manifestBytes);
    }
    h.sqlite.prepare('UPDATE runs SET owner_principal_id=? WHERE id=?').run('other', sourceId);
    assert.equal((await h.call(ids[0], '/export')).value.input_evidence.status, 'unavailable');
    assert.equal((await h.call(ids[0], '/narrative/automatic', { consent: true })).status, 409);
    h.sqlite.prepare('UPDATE runs SET owner_principal_id=? WHERE id=?').run('local-user', sourceId);
    h.changeOwnerOnRead = ids[0];
    assert.equal((await h.call(ids[0], '/export')).status, 404, 'late ownership check after object read');
    h.changeOwnerOnRead = null;
    h.sqlite.prepare('UPDATE runs SET owner_principal_id=? WHERE id=?').run('local-user', ids[0]);
    // Retained owned historical input stays available even without source rows.
    h.sqlite.prepare('DELETE FROM observations WHERE run_id=?').run(sourceId);
    h.sqlite.prepare('DELETE FROM runs WHERE id=?').run(sourceId);
    await h.reopen();
    for (const [index, id] of ids.entries()) {
      const exported = (await h.call(id, '/export')).value;
      assert.equal(exported.input_evidence.status, 'verified');
      assert.equal(exported.input_evidence.receipts[0].source_availability, 'unavailable');
      assert.deepEqual(exported.missing_observations, snapshots[index].exported.missing_observations);
      assert.equal((await h.call(id, '/narrative')).value.narrative.inputPayloadHash, snapshots[index].narrativeHash);
      assert.deepEqual(await h.store.get(snapshots[index].manifest.object_uri), snapshots[index].manifestBytes);
    }
    h.actor = 'other'; assert.equal((await h.call(ids[0], '/export')).status, 404);
    assert.deepEqual(h.counts(), { providerCalls: 0, sourceResolutions: 0 });
  } finally { await h.close(); }
});

test('A4-WD-002: absent corrupt and legacy input evidence stays unknown while stored numeric outputs remain exportable', async () => {
  const h = harness();
  try {
    const id = await h.execute(h.source()); await h.start();
    const { runs, analyses, artifacts } = h.repos();
    const beforeResults = analyses.getByRunId(id);
    const inputArtifact = artifacts.getArtifacts(id).find(row => row.kind === 'normalized')!;
    const inputBytes = await h.local.get(inputArtifact.object_uri);
    const expectUnknown = async (runId: string) => {
      const exported = await h.call(runId, '/export'); assert.equal(exported.status, 200);
      assert.equal(exported.value.input_evidence.status, 'unavailable');
      assert.equal(exported.value.missing_observations, null); assert.equal(exported.value.quality_flags, null);
      assert.ok(exported.value.results.length > 0);
      const csv = await h.call(runId, '/export?format=csv'); assert.equal(csv.status, 200); assert.match(csv.text, /unavailable/);
      const results = await h.call(runId, '/results'); assert.equal(results.status, 200);
      assert.equal(results.value.observations, null); assert.ok(results.value.analysis_results.length > 0);
      const charts = await h.call(runId, '/charts'); assert.equal(charts.status, 200);
      assert.equal(charts.value.quality_flags, null); assert.equal(charts.value.charts.length, 2);
      assert.deepEqual(charts.value.charts[0].legendFlags, ['INPUT_EVIDENCE_UNAVAILABLE']);
      for (const [suffix, body] of [['/narrative', undefined], ['/narrative', {}], ['/narrative/generate', {}], ['/narrative/automatic', { consent: true }]] as const) {
        const result = await h.call(runId, suffix, body); assert.equal(result.status, 409);
        assert.equal(result.value.error, 'input_evidence_unavailable');
      }
      assert.equal(h.counts().providerCalls, 0);
    };
    h.getFailure = true; await expectUnknown(id); h.getFailure = false;
    writeFileSync(inputArtifact.object_uri.replace('file://', ''), Buffer.from('{}'));
    await expectUnknown(id);
    writeFileSync(inputArtifact.object_uri.replace('file://', ''), inputBytes);
    assert.equal((await h.call(id, '/export')).value.input_evidence.status, 'verified');
    assert.deepEqual(analyses.getByRunId(id), beforeResults);
    const legacy = runs.createRun({ runType: 'ANALYSIS', config: { historical_public_fixture: true } });
    analyses.insertMany(analyses.createAnalysisRun(legacy), beforeResults);
    await expectUnknown(legacy);
    const historical = { generated: true, content: 'Public historical artifact remains unchanged', approvalState: 'PROPOSED' };
    const sha256 = canonicalHash(historical), bytes = Buffer.from(canonicalizeJson(historical));
    const uri = await h.local.put(`narratives/${sha256}.json`, bytes);
    const artifactId = artifacts.recordArtifact({ runId: legacy, kind: 'narrative', objectUri: uri, sha256 });
    await h.reopen();
    await expectUnknown(legacy);
    const history = await h.call(legacy, `/narratives/${artifactId}`);
    assert.equal(history.status, 200); assert.deepEqual(history.value.narrative, historical);
    assert.deepEqual(await h.local.get(uri), bytes);
    assert.deepEqual(h.counts(), { providerCalls: 0, sourceResolutions: 0 });
  } finally { await h.close(); }
});

test('A4-WD-002: source authorization and input persistence failures cannot publish results or a manifest', async () => {
  const h = harness();
  try {
    const sourceId = h.source(), sourceRows = h.repos().observations.getByRunId(sourceId);
    const denied = await h.execute(sourceId, false, 'other');
    h.putFailure = true; const interrupted = await h.execute(sourceId); h.putFailure = false;
    h.sqlite.exec("CREATE TRIGGER synthetic_results_failure BEFORE INSERT ON analysis_results BEGIN SELECT RAISE(FAIL,'synthetic result transaction failure'); END");
    const failedTransaction = await h.execute(sourceId);
    h.sqlite.exec('DROP TRIGGER synthetic_results_failure');
    for (const id of [denied, interrupted, failedTransaction]) {
      const { runs, analyses, artifacts } = h.repos();
      assert.equal(runs.getRun(id)!.status, 'FAILED');
      assert.deepEqual(analyses.listAnalysisRuns(id), []); assert.deepEqual(analyses.getByRunId(id), []);
      assert.deepEqual(artifacts.getArtifacts(id), []); assert.equal(artifacts.getManifest(id), undefined);
    }
    assert.deepEqual(h.repos().observations.getByRunId(sourceId), sourceRows);
    assert.equal(readdirSync(path.join(h.directory, 'objects', 'analysis-inputs')).length, 1,
      'put succeeded before failed DB transaction: retained object is unregistered, not completed output');
    await h.reopen();
    for (const id of [denied, interrupted, failedTransaction]) {
      assert.equal(h.repos().runs.getRun(id)!.status, 'FAILED');
      assert.deepEqual(h.repos().analyses.getByRunId(id), []);
    }
    assert.deepEqual(h.counts(), { providerCalls: 0, sourceResolutions: 0 });
  } finally { await h.close(); }
});

test('A4-WD-002: all consumed sources are rechecked after the last awaited receipt read', async () => {
  const h = harness();
  try {
    const sources = [h.source(), h.source()], { db, runs } = h.repos();
    const runId = runs.createRun({ runType: 'ANALYSIS', config: { public_multiple_analysis_fixture: true } });
    runs.advanceTo(runId, 'ANALYZING', ['VALIDATING', 'QUEUED', 'RUNNING', 'NORMALIZING', 'ANALYZING']);
    const analyzer = analyzerRegistry.get('jh16_faithful');
    const parameters = { reference_scores: { audit_entity: 7 } };
    for (const sourceId of sources) {
      const captured = captureAnalysisInput(db, h.store, runId, sourceId);
      const frozen = freezeAnalysisInput(captured, { method_id: analyzer.analyzer_id, method_spec_id: null,
        method_spec_hash: null, parameters, approval_state: 'APPROVED', approved_by: null, approved_hash: null,
        executor_id: analyzer.analyzer_id, executor_version: analyzer.analyzer_version });
      const results = analyzer.analyze(captured.observations, { method_id: analyzer.analyzer_id,
        method_version: analyzer.analyzer_version, parameters });
      await persistAnalysisWithInput(db, h.store, frozen, results);
    }
    const before = await readAnalysisInput(db, h.store, runId, 'local-user');
    assert.equal(before.evidence.status, 'verified'); assert.equal(before.receipts.length, 2);
    let firstSource: string | undefined, reads = 0;
    const interleavedStore = { put: h.store.put, async get(uri: string) {
      const bytes = await h.store.get(uri);
      if (++reads === 1) firstSource = JSON.parse(bytes.toString()).source_run.id;
      else h.sqlite.prepare('UPDATE runs SET owner_principal_id=? WHERE id=?').run('other', firstSource!);
      return bytes;
    } };
    const denied = await readAnalysisInput(db, interleavedStore, runId, 'local-user');
    assert.equal(reads, 2);
    assert.equal(denied.evidence.status, 'unavailable');
    assert.equal(denied.evidence.reason, 'input_integrity_or_access_unavailable');
    assert.equal(denied.observations, null); assert.deepEqual(denied.receipts, []);
    assert.equal(h.repos().analyses.listAnalysisRuns(runId).length, 2, 'read refusal does not mutate historical analyses');
    assert.deepEqual(h.counts(), { providerCalls: 0, sourceResolutions: 0 });
  } finally { await h.close(); }
});

test('A4-WD-002: provider readiness awaits cannot authorize a newly foreign input or run', async t => {
  const h = harness();
  try {
    const sourceId = h.source(), runId = await h.execute(sourceId); await h.start();
    let dispatches = 0, mutations = 0;
    let changedId = sourceId;
    let boundary: 'availability' | 'defaultParams' | 'get' = 'availability';
    const mutate = (current: typeof boundary) => {
      if (boundary === current) {
        ++mutations;
        h.sqlite.prepare('UPDATE runs SET owner_principal_id=? WHERE id=?').run('other', changedId);
      }
    };
    t.mock.method(TextGenerationRegistry.prototype, 'availability', async (providerKey: string) => {
      mutate('availability');
      return { providerKey, displayName: 'Public controlled generator', status: 'implemented' as const,
        credentialStatus: 'present' as const, remediation: '', defaultModel: 'synthetic', allowedModels: ['synthetic'] };
    });
    t.mock.method(TextGenerationRegistry.prototype, 'defaultParams', async () => { mutate('defaultParams'); return {}; });
    t.mock.method(TextGenerationRegistry.prototype, 'get', async () => {
      mutate('get');
      return { providerKey: 'openrouter', async generate() { ++dispatches; throw new Error('Unauthorized dispatch'); } };
    });
    const beforeArtifacts = h.repos().artifacts.getArtifacts(runId);
    for (changedId of [sourceId, runId]) {
      for (boundary of ['availability', 'defaultParams', 'get'] as const) {
        const response = await h.call(runId, '/narrative/generate', { provider: 'openrouter', model: 'synthetic' });
        assert.equal(response.status, changedId === runId ? 404 : 409);
        if (changedId === sourceId) assert.equal(response.value.input_evidence.reason, 'input_access_changed');
        assert.equal(dispatches, 0);
        assert.deepEqual(h.repos().artifacts.getArtifacts(runId), beforeArtifacts);
        h.sqlite.prepare('UPDATE runs SET owner_principal_id=? WHERE id=?').run('local-user', changedId);
      }
    }
    assert.equal(mutations, 6);
    // Even deterministic local generation has an awaited archive boundary.
    h.beforeNarrativeReturn = () => h.sqlite.prepare('UPDATE runs SET owner_principal_id=? WHERE id=?').run('other', sourceId);
    assert.equal((await h.call(runId, '/narrative', {})).status, 404);
    assert.deepEqual(h.repos().artifacts.getArtifacts(runId), beforeArtifacts);
    assert.equal(dispatches, 0);
    assert.deepEqual(h.counts(), { providerCalls: 0, sourceResolutions: 0 });
  } finally { t.mock.restoreAll(); await h.close(); }
});

test('A4-WD-002: manifest publication rechecks source access and terminal lifecycle after storage', async () => {
  const h = harness();
  try {
    const sourceId = h.source();
    h.beforeManifestReturn = () => h.sqlite.prepare('UPDATE runs SET owner_principal_id=? WHERE id=?').run('other', sourceId);
    const changedOwner = await h.execute(sourceId);
    assert.equal(h.repos().runs.getRun(changedOwner)!.status, 'FAILED');
    assert.equal(h.repos().artifacts.getManifest(changedOwner), undefined);
    assert.ok(h.repos().analyses.getByRunId(changedOwner).length > 0,
      'completed deterministic analysis is retained when later manifest publication fails');
    h.sqlite.prepare('UPDATE runs SET owner_principal_id=? WHERE id=?').run('local-user', sourceId);
    h.beforeManifestReturn = runId => h.repos().runs.updateStatus(runId, 'CANCELLED');
    const cancelled = await h.execute(sourceId);
    assert.equal(h.repos().runs.getRun(cancelled)!.status, 'CANCELLED');
    assert.equal(h.repos().artifacts.getManifest(cancelled), undefined);
    h.beforeManifestReturn = null;
    const completed = await h.execute(sourceId);
    const manifest = h.repos().artifacts.getManifest(completed)!;
    const bytes = await h.store.get(manifest.object_uri);
    assert.equal(h.repos().runs.getRun(completed)!.status, 'COMPLETED');
    await new RunOrchestrator(h.repos().db, h.store).executeRun(completed);
    assert.deepEqual(h.repos().artifacts.getManifest(completed), manifest);
    assert.deepEqual(await h.store.get(manifest.object_uri), bytes, 'terminal re-execution cannot replace finalized manifest');
    await h.reopen();
    assert.equal(h.repos().runs.getRun(changedOwner)!.status, 'FAILED');
    assert.equal(h.repos().runs.getRun(cancelled)!.status, 'CANCELLED');
    assert.equal(h.repos().artifacts.getManifest(changedOwner), undefined);
    assert.equal(h.repos().artifacts.getManifest(cancelled), undefined);
    assert.deepEqual(h.repos().artifacts.getManifest(completed), manifest);
    assert.deepEqual(h.counts(), { providerCalls: 0, sourceResolutions: 0 });
  } finally { await h.close(); }
});

test('A4-WD-002: actual personal assistant rechecks source permissions after catalog readiness before reserving or dispatching', async () => {
  for (const changedScope of ['source', 'analysis'] as const) {
    const h = harness();
    try {
      const sourceId = h.source(), runId = await h.execute(sourceId);
      const owner = 'local-user', profile = loadAssistantProfile();
      const repo = new SettingsRepository(h.sqlite, h.store), initial = repo.get(owner, profile.defaults);
      repo.save(owner, { ...initial.value, assistant: { ...initial.value.assistant, enabled: true } }, initial.hash, profile.defaults);
      const vault = new UserVault(repo, path.join(h.directory, 'master.key'), {});
      vault.save(owner, 'openrouter', 'synthetic-public-catalog-authorization-fixture');
      const changedId = changedScope === 'source' ? sourceId : runId;
      let catalogReads = 0, modelDispatches = 0;
      const transport: typeof fetch = async (_url, options) => {
        if (!options?.body) {
          ++catalogReads;
          // Real ensureCatalog -> refreshCatalog -> transport await, before
          // routing/reservation. Only this controlled transport sees the URL.
          h.sqlite.prepare('UPDATE runs SET owner_principal_id=? WHERE id=?').run('other', changedId);
          return new Response(JSON.stringify({ data: [{ id: 'synthetic/input-evidence', name: 'Public fixture', context_length: 64000,
            architecture: { input_modalities: ['text'], output_modalities: ['text'] },
            pricing: { prompt: '0.000001', completion: '0.000002', request: '0' }, supported_parameters: ['temperature'] }] }));
        }
        ++modelDispatches;
        const body = JSON.parse(String(options.body));
        const prompt = body.messages.find((row: any) => row.role === 'user').content as string;
        return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content: prompt.slice(prompt.indexOf('\n\n') + 2) } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 } }));
      };
      const assistant = new AssistantService(repo, vault, profile, transport);
      await h.start(assistant);
      assert.equal(assistant.catalog(owner, 'narrative'), null);
      const beforeArtifacts = h.repos().artifacts.getArtifacts(runId), beforeManifest = h.repos().artifacts.getManifest(runId);
      const denied = await h.call(runId, '/narrative/automatic', { consent: true });
      assert.equal(denied.status, 409);
      assert.equal(denied.value.input_evidence.reason, 'input_access_changed');
      assert.equal(catalogReads, 1, 'catalog discovery did occur in the actual service');
      assert.equal(modelDispatches, 0); assert.deepEqual(repo.generations(owner), []);
      assert.equal(repo.budget(owner).calls, 0, 'no reservation before the final source authorization');
      assert.deepEqual(h.repos().artifacts.getArtifacts(runId), beforeArtifacts);
      assert.deepEqual(h.repos().artifacts.getManifest(runId), beforeManifest);
      // An explicit new request after restoring access uses the same real
      // service and checked catalog; no automatic retry or substitute ledger.
      h.sqlite.prepare('UPDATE runs SET owner_principal_id=? WHERE id=?').run(owner, changedId);
      const allowed = await h.call(runId, '/narrative/automatic', { consent: true });
      assert.equal(allowed.status, 200); assert.equal(catalogReads, 1); assert.equal(modelDispatches, 1);
      assert.equal(repo.generations(owner).length, 1); assert.equal(repo.budget(owner).calls, 1);
      assert.equal(repo.generations(owner)[0].status, 'ESTIMATED');
      const generation = repo.generations(owner)[0];
      await h.reopen();
      assert.deepEqual(new SettingsRepository(h.sqlite, h.store).generations(owner), [generation]);
      assert.deepEqual(h.repos().artifacts.getManifest(runId), beforeManifest);
      assert.equal(modelDispatches, 1); assert.equal(catalogReads, 1);
      assert.deepEqual(h.counts(), { providerCalls: 0, sourceResolutions: 0 });
    } finally { await h.close(); }
  }
});
