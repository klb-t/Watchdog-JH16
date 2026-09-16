import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import express from 'express';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { SettingsRepository } from '../../backend/watchdog_api/db/repositories/settings';
import { AutomationRepository } from '../../backend/watchdog_api/db/repositories/automation';
import { MethodSpecRepository } from '../../backend/watchdog_api/db/repositories/method_specs';
import { RunRepository } from '../../backend/watchdog_api/db/repositories/runs';
import { ObservationRepository, AnalysisResultRepository } from '../../backend/watchdog_api/db/repositories/data';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { UserVault } from '../../backend/watchdog_api/secrets/user_vault';
import { loadAssistantProfile } from '../../backend/watchdog_api/config/assistant';
import { loadAutomationProfile } from '../../backend/watchdog_api/config/automation';
import { normalizeModelCatalog, routeModel } from '../../backend/watchdog_api/llm/routing';
import { AssistantService } from '../../backend/watchdog_api/services/assistant';
import { ResearchPlans } from '../../backend/watchdog_api/services/research_plans';
import { PersonalSearch } from '../../backend/watchdog_api/services/personal_search';
import { RunOrchestrator } from '../../backend/watchdog_api/services/run_orchestrator';
import { buildSettingsRouter } from '../../backend/watchdog_api/api/settings_routes';
import { traceMiddleware, errorHandler } from '../../backend/watchdog_api/api/middleware';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';
import { redact } from '../../backend/watchdog_api/utils/redaction';
import { loadPersonalProviders } from '../../backend/watchdog_api/config/personal_providers';
import { ProfileGenerator } from '../../backend/watchdog_api/llm/profile_generator';

const CANARY = 'sk-or-v1-fixture-private-key-6842026';
const catalogBytes = () => Buffer.from(JSON.stringify({ data: Array.from({ length: 5 }, (_, i) => ({
  id: `fictional/model-${i}`, name: `Test model ${i}`, context_length: 64000, architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  pricing: { prompt: String((i + 1) / 1000000), completion: String(2 * (i + 1) / 1000000), request: '0' }, supported_parameters: ['temperature'],
})) }));

test('all 16 personal provider profiles execute their real protocol adapter with isolated credentials and bounded requests', async () => {
  const h = harness(); try {
    const config = loadPersonalProviders(); assert.equal(config.providers.length, 16);
    for (const p of config.providers) {
      h.vault.save(h.owner, p.id, `${CANARY}-${p.id}`); let calls = 0;
      const adapter = new ProfileGenerator(p, h.vault.resolve(h.owner, p.id), async (url, init) => {
        calls++; assert.equal(url, p.endpoint); const body = JSON.parse(init.body);
        assert.equal(body.model, 'fictional/model'); assert.equal(body[p.outputParameter], 1200); assert.equal(body.stream, false); assert.equal(body.tools, undefined);
        if (p.protocol === 'anthropic') { assert.equal(init.headers['x-api-key'], `${CANARY}-${p.id}`); assert.equal(init.headers.Authorization, undefined); assert.equal(body.system, 'source-grounded'); }
        else { assert.equal(init.headers.Authorization, `Bearer ${CANARY}-${p.id}`); assert.equal(body.messages[0].content, 'source-grounded'); }
        return { ok: true, status: 200, text: async () => JSON.stringify(p.protocol === 'anthropic' ? { model: body.model, content: [{ type: 'text', text: 'Test response' }], usage: { input_tokens: 10, output_tokens: 20 } } : { model: body.model, choices: [{ message: { content: 'Test response' } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }) };
      }, 'fictional/model', 1200);
      const result = await adapter.generate({ model: 'fictional/model', system: 'source-grounded', prompt: 'test', params: { model: 'evil', max_tokens: 99999, tools: [{ type: 'execute' }] } });
      assert.equal(result.text, 'Test response'); assert.equal(result.usage.promptTokens, 10); assert.equal(calls, 1);
      await assert.rejects(() => adapter.generate({ model: 'different', prompt: 'test', params: {} }), /reserved route/); assert.equal(calls, 1);
    }
  } finally { h.close(); }
});

test('direct provider catalogs require their own reviewed prices, remain owner-scoped and route different tasks to different keys', async () => {
  const h = harness(); try {
    h.enable(); h.vault.save(h.owner, 'anthropic', CANARY + '-anthropic'); h.vault.save(h.owner, 'openrouter', CANARY);
    const record = h.repo.get(h.owner, h.profile.defaults);
    h.repo.save(h.owner, { ...record.value, assistant: { ...record.value.assistant, taskProviders: { trip_report: 'anthropic' } } }, record.hash, h.profile.defaults);
    const s = new AssistantService(h.repo, h.vault, h.profile, async (url, init) => {
      assert.equal(String(url), 'https://api.anthropic.com/v1/messages'); assert.equal(new Headers(init?.headers).get('x-api-key'), CANARY + '-anthropic');
      return new Response(JSON.stringify({ model: 'fictional/direct', content: [{ type: 'text', text: 'Qualitative, proposed interpretation' }], usage: { input_tokens: 100, output_tokens: 20 } }));
    });
    await s.buildPersonalCatalog(h.owner, 'anthropic'); assert.equal(s.catalog(h.owner, 'trip_report')!.models.length, 0);
    await assert.rejects(() => s.propose(h.owner, 'trip_report', 'test'), /No model/);
    h.repo.saveModelCeiling(h.owner, { provider: 'anthropic', id: 'fictional/direct', contextTokens: 64000, maxOutputTokens: 8000, inputUsdPerMillion: 2, outputUsdPerMillion: 10, requestUsd: 0,
      source: 'https://example.org/fixture-price', observedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 3600000).toISOString() });
    await s.buildPersonalCatalog(h.owner, 'anthropic'); assert.equal(h.repo.catalog('anthropic', 'other'), null);
    const result = await s.propose(h.owner, 'trip_report', 'test'); assert.equal(result.providerKey, 'anthropic'); assert.equal(result.route.provider, 'anthropic');
    assert.equal(result.route.model.pricePolicy, 'owner-reviewed-ceiling'); assert.equal(h.repo.generations(h.owner)[0].status, 'ESTIMATED');
    assert.equal(s.provider(h.owner, 'query_expansion').id, 'openrouter');
  } finally { h.close(); }
});

test('task routing uses comparable benchmark evidence and operational statistics without treating unknown quality or another suite as measured', () => {
  const h = harness(); try {
    const c = normalizeModelCatalog(catalogBytes(), h.profile), settings = structuredClone(h.profile.defaults); settings.assistant.economy = 100;
    for (const [model, passed, suite] of [['fictional/model-0', 9, 'a'], ['fictional/model-1', 3, 'a'], ['fictional/model-2', 10, 'b']] as const)
      h.repo.saveBenchmark(h.owner, { provider: 'openrouter', model, task: 'method_proposal', suiteHash: suite.repeat(64), passed, total: 10,
        source: 'https://example.org/reviewed-fixture-benchmark', observedAt: new Date(Date.now() - (suite === 'b' ? 100000 : 0)).toISOString() });
    const evidence = h.repo.routingEvidence(h.owner, 'openrouter', 'method_proposal', 30);
    const route = routeModel('method_proposal', 'test', '', settings, c, h.profile, new Date(), evidence);
    assert.equal(route.model.id, 'fictional/model-0'); assert.match(route.reason, /benchmarks/);
    assert.equal(h.repo.routingEvidence('other', 'openrouter', 'method_proposal', 30).length, 0);
    assert.equal(h.repo.routingEvidence(h.owner, 'openrouter', 'narrative', 30).length, 0);
    assert.throws(() => h.repo.saveBenchmark(h.owner, { provider: 'openrouter', model: 'x', task: 'narrative', suiteHash: 'a'.repeat(64), passed: 11, total: 10, source: 'https://example.org', observedAt: new Date().toISOString() }));
  } finally { h.close(); }
});
function harness() {
  const dir = mkdtempSync(path.join(tmpdir(), 'watchdog-settings-')), db = new Database(path.join(dir, 'db.sqlite'));
  db.pragma('foreign_keys=ON'); runMigrations(db);
  const orm = drizzle(db), store = new LocalFileSystemStore(path.join(dir, 'store')), repo = new SettingsRepository(db, store), profile = loadAssistantProfile();
  const keyFile = path.join(dir, 'secrets/master.key'), vault = new UserVault(repo, keyFile, {}), automation = new AutomationRepository(db, store), sourceProfile = loadAutomationProfile();
  automation.archiveProfile(sourceProfile);
  const methods = new MethodSpecRepository(orm), orchestrator = new RunOrchestrator(orm, store);
  const plans = new ResearchPlans(repo, automation, profile, sourceProfile, orchestrator, methods, vault), owner = 'local-user';
  const enable = () => { const record = repo.get(owner, profile.defaults); return repo.save(owner, { ...record.value, assistant: { ...record.value.assistant, enabled: true } }, record.hash, profile.defaults); };
  return { dir, db, orm, repo, profile, vault, keyFile, store, automation, sourceProfile, methods, orchestrator, plans, owner, enable,
    close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('personal settings persist per owner, detect stale edits and keep language/geography and interface mode independent', () => {
  const h = harness(); try {
    const start = h.repo.get(h.owner, h.profile.defaults), other = h.repo.get('other', h.profile.defaults);
    const value = { ...start.value, mode: 'debug', research: { ...start.value.research, languages: ['pl'], geographies: ['NL'] } };
    const saved = h.repo.save(h.owner, value, start.hash, h.profile.defaults);
    assert.deepEqual(saved.value.research.languages, ['pl']); assert.deepEqual(saved.value.research.geographies, ['NL']);
    assert.equal(h.repo.get('other', h.profile.defaults).hash, other.hash);
    assert.throws(() => h.repo.save(h.owner, value, start.hash, h.profile.defaults), /changed/);
    assert.throws(() => h.db.prepare('UPDATE personal_settings_snapshots SET body_json=?').run('{}'), /WORM/);
    assert.equal((h.db.prepare("SELECT role_id FROM principal_roles WHERE principal_id='local-user'").get() as any).role_id, 'dev', 'display mode never writes role grants');
  } finally { h.close(); }
});

test('personal vault: AES-GCM, separate protected key, no plaintext DB/status/logs, owner isolation, tamper and key rotation', () => {
  const h = harness(); try {
    assert.equal(h.vault.status(h.owner, 'openrouter').status, 'absent');
    h.vault.save(h.owner, 'openrouter', CANARY); assert.equal(statSync(h.keyFile).mode & 0o777, 0o600);
    const envelope = h.repo.envelope(h.owner, 'openrouter')!;
    assert.ok(!envelope.envelope.includes(CANARY)); assert.equal(h.vault.resolve(h.owner, 'openrouter').use(s => s), CANARY);
    assert.equal(h.vault.resolve('another', 'openrouter').status, 'absent');
    const serialized = JSON.stringify({ handle: h.vault.resolve(h.owner, 'openrouter'), status: h.vault.status(h.owner, 'openrouter'), logs: redact({ message: `provider echoed ${CANARY}` }) });
    assert.ok(!serialized.includes(CANARY)); assert.ok(!readFileSync(path.join(h.dir, 'db.sqlite')).includes(Buffer.from(CANARY)));
    const broken = JSON.parse(envelope.envelope); broken.tag = Buffer.alloc(16).toString('base64');
    h.db.prepare('UPDATE user_secret_envelopes SET envelope_json=? WHERE id=?').run(JSON.stringify(broken), envelope.id);
    assert.equal(h.vault.resolve(h.owner, 'openrouter').status, 'invalid');
    h.vault.save(h.owner, 'openrouter', CANARY + '-rotated'); assert.equal(h.vault.resolve(h.owner, 'openrouter').use(s => s), CANARY + '-rotated');
    h.vault.remove('another', 'openrouter'); assert.equal(h.vault.status(h.owner, 'openrouter').status, 'present');
    h.vault.remove(h.owner, 'openrouter'); assert.equal(h.vault.status(h.owner, 'openrouter').status, 'absent');
  } finally { h.close(); }
});

test('dynamic routing: task-specific cost preference, conservative tier prices, pins, stale catalogs and context ceilings', () => {
  const h = harness(); try {
    const raw = JSON.parse(catalogBytes().toString()); raw.data[4].pricing.overrides = [{ prompt: '0.00002', completion: '0.00004', min_prompt_tokens: 300000 }];
    raw.data.push({ id: 'invalid/unknown-prices', context_length: 100000 });
    const c = normalizeModelCatalog(Buffer.from(JSON.stringify(raw)), h.profile), s = structuredClone(h.profile.defaults);
    assert.equal(c.rejected, 1); assert.equal(c.models[4].inputUsdPerToken, 0.00002);
    s.assistant.economy = 0; const cheap = routeModel('method_proposal', 'hello', '', s, c, h.profile);
    s.assistant.economy = 100; const dear = routeModel('method_proposal', 'hello', '', s, c, h.profile);
    assert.ok(dear.reserveMicroUsd > cheap.reserveMicroUsd);
    assert.notEqual(routeModel('query_expansion', 'hello', '', s, c, h.profile).model.id, dear.model.id);
    s.assistant.modelPins.method_proposal = 'fictional/missing'; assert.throws(() => routeModel('method_proposal', 'hello', '', s, c, h.profile), /Pinned/);
    s.assistant.modelPins.method_proposal = null;
    assert.throws(() => routeModel('method_proposal', 'x'.repeat(64000), '', s, c, h.profile), /No model/);
    assert.throws(() => routeModel('method_proposal', 'hello', '', s, c, h.profile, new Date(Date.now() + 25 * 3600000)), /stale/);
    assert.equal(cheap.settingsHash, canonicalHash({ ...s, assistant: { ...s.assistant, economy: 0 } }));
  } finally { h.close(); }
});

test('assistant actually routes requests and archives provenance; budget/credentials prevent calls and failures keep reservations', async () => {
  const h = harness(); try {
    let calls = 0, fail = false;
    const transport: typeof fetch = async (_url, init) => {
      calls++; const body = JSON.parse(String(init?.body)); assert.match(body.model, /^fictional\/model-/); assert.ok(body.max_tokens > 0);
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${CANARY}`); assert.equal(init?.redirect, 'error');
      if (fail) return new Response(JSON.stringify({ error: { message: CANARY } }), { status: 429 });
      return new Response(JSON.stringify({ id: 'fixture-id', model: body.model, choices: [{ message: { content: `A proposed research plan. ${CANARY}` } }], usage: { prompt_tokens: 100, completion_tokens: 200 } }));
    };
    const service = new AssistantService(h.repo, h.vault, h.profile, transport), raw = catalogBytes(); await h.repo.saveCatalog(normalizeModelCatalog(raw, h.profile), raw);
    await assert.rejects(() => service.propose(h.owner, 'method_proposal', 'test'), /Enable/); assert.equal(calls, 0);
    h.enable(); await assert.rejects(() => service.propose(h.owner, 'method_proposal', 'test'), /key/); assert.equal(calls, 0);
    h.vault.save(h.owner, 'openrouter', CANARY);
    const result = await service.propose(h.owner, 'method_proposal', 'propose a test'); assert.equal(result.approvalState, 'PROPOSED');
    assert.ok(!JSON.stringify(result).includes(CANARY)); assert.equal(result.nondeterministic, true);
    assert.equal(h.repo.generations('another').length, 0); assert.equal(h.repo.generations(h.owner)[0].status, 'ESTIMATED');
    fail = true; await assert.rejects(() => service.propose(h.owner, 'query_expansion', 'try once'), /reservation is retained/);
    const before = calls; assert.equal(h.repo.generations(h.owner)[0].status, 'FAILED_RESERVED');
    const s = h.repo.get(h.owner, h.profile.defaults); h.repo.save(h.owner, { ...s.value, assistant: { ...s.value.assistant, dailyBudgetUsd: 0 } }, s.hash, h.profile.defaults);
    await assert.rejects(() => service.propose(h.owner, 'query_expansion', 'no budget'), /budget exhausted/); assert.equal(calls, before);
    const dump = h.db.prepare('SELECT result_json FROM assistant_reservations').all(); assert.ok(!JSON.stringify(dump).includes(CANARY));
  } finally { h.close(); }
});

test('concurrent budget reservations cannot overspend the configured daily allowance', () => {
  const h = harness(); try {
    const catalog = normalizeModelCatalog(catalogBytes(), h.profile), settings = h.enable().value;
    const route = routeModel('query_expansion', 'test', '', settings, catalog, h.profile), limit = route.reserveMicroUsd / 1000000;
    h.repo.reserve(h.owner, route, limit);
    assert.throws(() => h.repo.reserve(h.owner, route, limit), /budget exhausted/);
    assert.doesNotThrow(() => h.repo.reserve('another', route, limit));
  } finally { h.close(); }
});

test('wizard launches one owned JH16 fixture run through the approved MethodSpec executor and preserves independent dimensions', async () => {
  const h = harness(); try {
    const settings = h.repo.get(h.owner, h.profile.defaults);
    const plan = h.plans.prepare(h.owner, { name: 'Study fixture', settingsHash: settings.hash, baseline: 'fixture', refreshMemory: false, scanPapers: false, dailyScan: false, paperScope: 'substances' });
    assert.deepEqual(plan.body.extensions.languages, ['en', 'pl']); assert.equal(plan.body.baseline.preset.language, 'en');
    assert.deepEqual(plan.body.extensions.geographies, []); assert.equal(plan.body.extensions.confirmation.automaticConfirmatoryClaims, false);
    assert.throws(() => h.plans.launch(h.owner, plan.id, plan.hash, null), /Review/);
    assert.throws(() => h.plans.launch('another', plan.id, plan.hash, plan.body.baseline.methodHash), /not found/);
    const launch = h.plans.launch(h.owner, plan.id, plan.hash, plan.body.baseline.methodHash);
    assert.deepEqual(h.plans.launch(h.owner, plan.id, plan.hash, plan.body.baseline.methodHash), launch, 'repeated click does not double-launch');
    const runs = new RunRepository(h.orm); let run;
    for (let n = 0; n < 100; n++) { run = runs.getRun(launch.runId); if (['COMPLETED', 'FAILED'].includes(run!.status)) break; await new Promise(r => setTimeout(r, 20)); }
    assert.equal(run!.status, 'COMPLETED', run!.error_details ?? '');
    assert.equal(run!.owner_principal_id, h.owner); assert.equal(new ObservationRepository(h.orm).getByRunId(launch.runId).length, 32);
    const values = new AnalysisResultRepository(h.orm).getByRunId(launch.runId); assert.equal(values.filter(r => r.metricKey === 'Pi').length, 16);
    const analysis = h.db.prepare('SELECT * FROM analysis_runs WHERE run_id=?').get(launch.runId) as any;
    assert.equal(analysis.method_spec_id, 'jh2016-faithful'); assert.ok(JSON.parse(analysis.input_hashes_json).length);
    const manifestRow = h.db.prepare('SELECT object_uri FROM manifests WHERE run_id=?').get(launch.runId) as any;
    const manifest = JSON.parse((await h.store.get(manifestRow.object_uri)).toString());
    assert.equal(manifest.analyses[0].method_spec_hash, plan.body.baseline.methodHash);
    assert.equal(manifest.analyses[0].approved_by, h.owner);
    assert.equal(h.repo.plans('another').length, 0); assert.throws(() => h.db.prepare('UPDATE research_plans SET body_json=?').run('{}'), /WORM/);
  } finally { h.close(); }
});

test('personal SERP uses only the owner key and a separate daily request counter', async () => {
  const h = harness(); try {
    let calls = 0; h.vault.save(h.owner, 'serpapi', CANARY);
    const s = h.repo.get(h.owner, h.profile.defaults); h.repo.save(h.owner, { ...s.value, searchDailyRequestLimit: 1 }, s.hash, h.profile.defaults);
    const search = new PersonalSearch(h.repo, h.vault, h.profile, async url => {
      calls++; assert.equal(new URL(String(url)).searchParams.get('api_key'), CANARY);
      return new Response(JSON.stringify({ search_information: { total_results: 1234 }, search_metadata: { raw_html_file: `https://example.org/${CANARY}` } }));
    });
    await assert.rejects(() => search.resolve('serp_result_count', 'another', true), /key/);
    const adapter = await search.resolve('serp_result_count', h.owner, true);
    const request = { renderedQuery: '"fictional"', dimension: 'popularity', entityId: 'fixture', language: 'en', queryExpansionMode: 'STRICT_CANONICAL' as const, presetId: 'test', presetVersion: '1' };
    const first = await adapter.fetch(request); assert.equal(calls, 1); assert.ok(!first.payload!.toString().includes(CANARY));
    await adapter.fetch(request); assert.equal(calls, 1, 'budget blocks network retries too');
  } finally { h.close(); }
});

test('credential API requires owner authorization, rejects cross-origin writes and never echoes malformed JSON key fragments', async () => {
  const h = harness(); let server: ReturnType<express.Express['listen']> | undefined;
  try {
    const service = new AssistantService(h.repo, h.vault, h.profile, async () => { throw new Error('No network in this test'); });
    const app = express(); let owner = h.owner, roles = ['dev']; app.use(express.json()); app.use(traceMiddleware);
    app.use((req, _res, next) => { req.principal = { id: owner, roles, email: null, identityProvenance: 'test' }; next(); });
    app.use('/api/settings', buildSettingsRouter(h.repo, service, h.vault, h.plans)); app.use(errorHandler);
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server!.once('listening', r));
    const url = `http://127.0.0.1:${(server.address() as any).port}/api/settings/credentials`, body = JSON.stringify({ provider: 'openrouter', apiKey: CANARY, consent: true });
    const call = (text: string, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: text });
    assert.equal((await call(body, { Origin: 'https://foreign.example' })).status, 403);
    const ok = await call(body); assert.equal(ok.status, 200); assert.ok(!(await ok.text()).includes(CANARY));
    const bad = await call(`{"apiKey":"${CANARY}" trailing}`); assert.equal(bad.status, 400); assert.ok(!(await bad.text()).includes(CANARY));
    owner = 'another'; assert.equal((await (await fetch(url.replace('/credentials', ''))).json()).credentials[0].status, 'absent');
    roles = ['responder']; assert.equal((await call(body)).status, 403);
  } finally { if (server) await new Promise<void>(r => server!.close(() => r())); h.close(); }
});
