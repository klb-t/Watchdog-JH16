/**
 * Regressions found while running JH16 on live SerpApi data (2026-10-25,
 * docs/replication/JH16_2026-10-25/). Each test names the defect it guards.
 */
import { test, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { RunOrchestrator } from '../../backend/watchdog_api/services/run_orchestrator';
import { RunRepository } from '../../backend/watchdog_api/db/repositories/runs';
import { ObservationRepository } from '../../backend/watchdog_api/db/repositories/data';
import { ArtifactRepository } from '../../backend/watchdog_api/db/repositories/artifacts';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { SerpApiAdapter, RequestLimitReachedError } from '../../backend/watchdog_api/sources/serpapi';
import { FixtureSourceAdapter } from '../../backend/watchdog_api/sources/fixture_source';
import { loadSearchProviderConfig } from '../../backend/watchdog_api/sources/search_providers';
import { SecretStore, EnvSecretProvider } from '../../backend/watchdog_api/secrets';
import { evaluateJh16, loadJh16EvaluationConfig } from '../../backend/watchdog_api/services/jh16_evaluation';
import { jh16PlanItems, readJh16Preset } from '../../backend/watchdog_api/services/jh16_plan';
import { correlationPValueTwoSided } from '../../backend/watchdog_api/analytics/stats';
import { exportCsv, exportJson } from '../../backend/watchdog_api/services/export';
import { sourceRegistry } from '../../backend/watchdog_api/sources/registry';
import { NotImplementedError } from '../../backend/watchdog_api/utils/errors';
import type { Observation } from '../../backend/watchdog_api/domain/observation';

const STORE = path.join(process.cwd(), 'test_jh16_live_store');
let sqlite: Database.Database; let db: ReturnType<typeof drizzle>;
beforeEach(() => { sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON'); runMigrations(sqlite); db = drizzle(sqlite);
  fs.rmSync(STORE, { recursive: true, force: true }); });
afterEach(() => { sqlite.close(); fs.rmSync(STORE, { recursive: true, force: true }); });

const preset = readJh16Preset(), reference = JSON.parse(fs.readFileSync('config/reference/nutt-2010.json', 'utf-8'));
const paper = JSON.parse(fs.readFileSync('fixtures/jh2016/paper_reported.json', 'utf-8'));
const serpConfig = loadSearchProviderConfig().config.providers.find(p => p.provider_key === 'serpapi')!;
const credential = () => new SecretStore([new EnvSecretProvider({ SERPAPI_API_KEY: 'test-key-jh16-live-0001' })]).resolve(serpConfig.secret_ref);

/** A SerpApi-shaped body; counts per query come from the paper unless overridden. */
function serpBody(query: string, overrides: Record<string, unknown> = {}) {
  const s = paper.substances.find((x: any) => query.startsWith(`"${x.query_label}"`))!;
  const total = query.includes('"harm"') ? s.Ni_harm : s.Ni;
  return JSON.stringify({ search_metadata: { id: 'srp', status: 'Success', created_at: '2026-10-25 12:00:00 UTC' },
    search_parameters: { engine: 'google', q: query, google_domain: 'google.com', hl: 'en', safe: 'off', device: 'desktop' },
    search_information: { total_results: total, organic_results_state: 'Results for exact spelling' },
    organic_results: Array.from({ length: 9 }, (_, i) => ({ position: i + 1 })),
    serpapi_pagination: { other_pages: { 2: 'x', 3: 'x', 10: 'x' } }, ...overrides });
}

function liveConfig(extra: Record<string, unknown> = {}) {
  return { source_id: 'serp_result_count', source_params: {}, method_id: 'jh16_faithful', preset_id: preset.preset_id,
    preset_version: preset.preset_version, language: 'en', query_expansion_mode: 'STRICT_CANONICAL', plan: jh16PlanItems(preset),
    method_params: { reference_scores: reference.scores }, ...extra };
}

async function runWith(adapter: SerpApiAdapter | FixtureSourceAdapter, config: any) {
  const store = new LocalFileSystemStore(STORE), runs = new RunRepository(db);
  const id = runs.createRun({ runType: 'PIPELINE', config, presetId: config.preset_id, presetVersion: config.preset_version });
  await new RunOrchestrator(db, store, async () => adapter).executeRun(id);
  return { id, run: runs.getRun(id)!, store };
}

test('serp_generic, which answered every query with 42000, is no longer executable', () => {
  assert.strictEqual(sourceRegistry.getEntry('serp_generic')?.status, 'planned');
  assert.throws(() => sourceRegistry.getAdapter('serp_generic'), NotImplementedError);
});

test('the preset plan has all 32 queries with query_label, never canonical names', () => {
  const plan = jh16PlanItems(preset);
  assert.strictEqual(plan.length, 32);
  assert.ok(plan.some(p => p.entityId === 'gamma-hydroxybutyric acid' && p.renderedQuery === '"GHB" "harm" OR "harmful"'));
  assert.ok(!plan.some(p => p.renderedQuery.includes('lysergic')));
});

test('a rate-limited query is recorded as missing and the run continues; a quota stop skips the rest', async () => {
  let calls = 0;
  const adapter = new SerpApiAdapter(serpConfig, await credential(), async url => {
    calls++; const q = new URL(url).searchParams.get('q')!;
    if (q === '"alcohol"') return { ok: false, status: 429, text: async () => 'slow down' };
    if (q === '"heroin"') return { ok: false, status: 402, text: async () => 'Your account has run out of searches.' };
    return { ok: true, status: 200, text: async () => serpBody(q) };
  }, async () => {});
  const { id, run } = await runWith(adapter, liveConfig());
  assert.strictEqual(run.status, 'COMPLETED', run.error_code ?? '');
  const obs = new ObservationRepository(db).getByRunId(id);
  assert.strictEqual(obs.length, 32, 'every planned query leaves an observation');
  const reason = (e: string, r: string) => (obs.find(o => o.entityId === e && o.queryRole === r) as any).missingReason;
  assert.strictEqual(reason('alcohol', 'popularity'), 'RATE_LIMITED');
  assert.strictEqual(reason('heroin', 'popularity'), 'QUOTA_EXHAUSTED');
  assert.strictEqual(reason('methamphetamine', 'harm'), 'NOT_FETCHED', 'after an exhausted quota no further request is made');
  const fetched = obs.filter(o => !o.isMissing).length;
  assert.ok(calls < 32 + 3 * 2, 'retries are finite and nothing is fetched after the quota stop');
  const manifest = JSON.parse(fs.readFileSync(path.join(STORE, 'manifests', `${id}.json`), 'utf-8'));
  assert.ok(manifest.missing_observations.length === 32 - fetched);
  const evaluation = await readEvaluation(id);
  assert.strictEqual(evaluation.complete, false);
  assert.ok(evaluation.missing_entities.includes('alcohol') && evaluation.missing_entities.includes('methamphetamine'));
  assert.ok(evaluation.verdicts.every((v: any) => v.verdict === 'not_computable'));
  assert.strictEqual(evaluation.hypothesis_harm.reading, 'not_computable');
});

async function readEvaluation(runId: string) {
  const a = new ArtifactRepository(db).getArtifacts(runId).find(x => JSON.parse(x.metadata_json ?? '{}').role === 'jh16_evaluation')!;
  return JSON.parse((await new LocalFileSystemStore(STORE).get(a.object_uri)).toString('utf-8'));
}

test('paper counts through the live adapter reproduce the published comparison, as an independent-kind attempt', async () => {
  const adapter = new SerpApiAdapter(serpConfig, await credential(), async url => ({ ok: true, status: 200, text: async () => serpBody(new URL(url).searchParams.get('q')!) }), async () => {});
  const { id, run } = await runWith(adapter, liveConfig());
  assert.strictEqual(run.status, 'COMPLETED', run.error_code ?? '');
  assert.ok(run.git_commit === null || /^[a-f0-9]{7,40}(-dirty)?$/.test(run.git_commit), 'the code version is stamped when known');
  const ev = await readEvaluation(id);
  assert.strictEqual(ev.complete, true);
  assert.strictEqual(ev.attempt_kind, 'independent_attempt');
  assert.ok(Math.abs(ev.hi_vs_reference[0].value - 0.816161) < 1e-5);
  assert.ok(Math.abs(ev.hi_vs_reference[0].p_two_sided - 0.000115) < 2e-6);
  assert.ok(Math.abs(ev.hi_vs_reference[1].value - 0.560060) < 1e-5);
  assert.deepStrictEqual(ev.verdicts.map((v: any) => v.verdict), ['reproduced', 'reproduced']);
  assert.strictEqual(ev.hypothesis_harm.reading, 'supports');
  const events = sqlite.prepare('select provider_id, request_hash, metadata_json from fetch_events where run_id = ?').all(id) as any[];
  assert.ok(events.every(e => e.provider_id === 'serpapi' && /^[a-f0-9]{64}$/.test(e.request_hash)));
  const fields = JSON.parse(events[0].metadata_json).provider_fields;
  assert.strictEqual(fields.returned_records, 9, 'records on the page are kept apart from the estimate');
  assert.ok(fields.reported_count > 9);
});

test('the fixture source gives a pipeline self-check with the published statistics', async () => {
  const { id } = await runWith(new FixtureSourceAdapter(), liveConfig({ source_id: 'fixture_jh2016', source_params: { fixture_set: 'faithful_2014-06-20' } }));
  const ev = await readEvaluation(id);
  assert.strictEqual(ev.attempt_kind, 'pipeline_self_check');
  assert.ok(Math.abs(ev.pi_vs_published.value - 0.9993) < 1e-3);
});

test('a reachable-result count is flagged, never corrected, and Hi above 100 is flagged', async () => {
  const adapter = new SerpApiAdapter(serpConfig, await credential(), async url => {
    const q = new URL(url).searchParams.get('q')!;
    return { ok: true, status: 200, text: async () => q === '"heroin"'
      ? serpBody(q, { search_information: { total_results: 74 }, serpapi_pagination: { other_pages: { 2: 'x', 8: 'x' } } })
      : q === '"khat"' ? serpBody(q, { search_information: { total_results: 10 }, serpapi_pagination: undefined }) : serpBody(q) };
  }, async () => {});
  const { id } = await runWith(adapter, liveConfig());
  const heroin = new ObservationRepository(db).getByRunId(id).find(o => o.entityId === 'heroin' && o.queryRole === 'popularity')!;
  assert.strictEqual(heroin.isMissing === false && heroin.numericValue, 74, 'the provider value is stored as reported');
  assert.ok(heroin.qualityFlags.includes('PROVIDER_COUNT_EQUALS_REACHABLE_RESULTS'));
  const khat = new ObservationRepository(db).getByRunId(id).find(o => o.entityId === 'khat' && o.queryRole === 'popularity')!;
  assert.ok(khat.qualityFlags.includes('PROVIDER_COUNT_EQUALS_REACHABLE_RESULTS'), 'a single-page count is a reachable count too');
  const cocaine = new ObservationRepository(db).getByRunId(id).find(o => o.entityId === 'cocaine' && o.queryRole === 'popularity')!;
  assert.ok(!cocaine.qualityFlags.includes('PROVIDER_COUNT_EQUALS_REACHABLE_RESULTS'), 'an index estimate is not flagged');
  const ev = await readEvaluation(id), row = ev.entities.find((e: any) => e.entity_id === 'heroin');
  assert.ok(row.Hi > 100 && row.flags.includes('HI_ABOVE_100'));
  const sens = ev.exploratory.find((x: any) => x.id === 'without_reachable_result_counts');
  assert.deepStrictEqual(sens.excluded, ['heroin', 'khat']);
});

test('run-level provider parameters: allowed ones reach the request, others are refused', async () => {
  const urls: string[] = [];
  const adapter = new SerpApiAdapter(serpConfig, await credential(), async url => { urls.push(url); return { ok: true, status: 200, text: async () => serpBody(new URL(url).searchParams.get('q')!) }; }, async () => {});
  assert.strictEqual(adapter.validate_params({ locale: 'pl' }).valid, false, 'a parameter with no effect is not silently accepted');
  assert.strictEqual(adapter.validate_params({ provider_params: { num: '100' } }).valid, false);
  assert.strictEqual(adapter.validate_params({ provider_params: { gl: 'pl', google_domain: 'google.pl' } }).valid, true);
  const { run } = await runWith(adapter, liveConfig({ source_params: { provider_params: { gl: 'pl', google_domain: 'google.pl' } } }));
  assert.strictEqual(run.status, 'COMPLETED', run.error_code ?? '');
  assert.ok(urls.every(u => new URL(u).searchParams.get('gl') === 'pl' && new URL(u).searchParams.get('google_domain') === 'google.pl'));
  assert.ok(urls.every(u => new URL(u).searchParams.get('safe') === 'off'));
});

test('two-sided correlation p-values match tables', () => {
  assert.ok(Math.abs(correlationPValueTwoSided(2.976843 / Math.sqrt(2.976843 ** 2 + 14), 16)! - 0.01) < 1e-6);
  assert.ok(Math.abs(correlationPValueTwoSided(0.3, 30)! - 0.1072) < 1e-3);
  assert.strictEqual(correlationPValueTwoSided(1, 16), null);
  assert.strictEqual(correlationPValueTwoSided(0.5, 2), null);
});

test('the export carries the stored counts and the evaluation, not only Pi and Hi', () => {
  const obs: Observation[] = [{ seriesId: '', entityId: 'heroin', queryRole: 'popularity', queryText: '"heroin"', language: 'en', queryExpansionMode: 'STRICT_CANONICAL',
    retrievedAt: '2026-10-25T00:00:00Z', sourceId: 'serpapi', sourceAdapterVersion: '1', qualityFlags: ['PROVIDER_ESTIMATE'], isMissing: false, numericValue: 74 }];
  const ev = evaluateJh16(obs, [], loadJh16EvaluationConfig());
  const input = { runId: 'r', results: [], evaluation: ev as any, observations: [{ entity_id: 'heroin', query_role: 'popularity', query_text: '"heroin"', value_numeric: 74,
    is_missing: false, missing_reason: null, provider_id: 'serpapi', retrieved_at: '2026-10-25T00:00:00Z', quality_flags: ['PROVIDER_ESTIMATE'] }] };
  const csv = exportCsv(input), json = JSON.parse(exportJson(input));
  assert.match(csv, /# OBSERVATIONS/); assert.match(csv, /r,heroin,popularity,"""heroin""",74,false/);
  assert.match(csv, /H-harm,not_computable/);
  assert.strictEqual(json.observations[0].value_numeric, 74);
  assert.strictEqual(json.evaluation.complete, false);
});

test('the personal daily request limit is its own missing reason and stops the run without retries', async () => {
  let sent = 0, refused = 0;
  const adapter = new SerpApiAdapter(serpConfig, await credential(), async url => {
    if (sent >= 4) { refused++; throw new RequestLimitReachedError('WatchDog daily SERP request limit reached (4 per day, a personal setting); nothing was sent'); }
    sent++; return { ok: true, status: 200, text: async () => serpBody(new URL(url).searchParams.get('q')!) };
  }, async () => {});
  const { id, run } = await runWith(adapter, liveConfig());
  assert.strictEqual(run.status, 'COMPLETED');
  const reasons = new ObservationRepository(db).getByRunId(id).filter(o => o.isMissing).map(o => (o as any).missingReason);
  assert.strictEqual(refused, 1, 'one refusal stops the run; it is not retried');
  assert.strictEqual(reasons.filter(r => r === 'REQUEST_LIMIT_SETTING').length, 1);
  assert.strictEqual(reasons.filter(r => r === 'NOT_FETCHED').length, 32 - 4 - 1);
});
