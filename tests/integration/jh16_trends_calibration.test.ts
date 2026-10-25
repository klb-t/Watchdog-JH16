/**
 * Google Trends as a WatchDog source and the exploratory JH16 calibration run
 * through the orchestrator (docs/replication/JH16_2026-10-25/CALIBRATION.md).
 * Response bodies are synthetic, shaped like SerpApi's google_trends output.
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
import { ObservationRepository, AnalysisResultRepository } from '../../backend/watchdog_api/db/repositories/data';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { GoogleTrendsAdapter, loadTrendsProviderConfig } from '../../backend/watchdog_api/sources/google_trends';
import { SecretStore, EnvSecretProvider } from '../../backend/watchdog_api/secrets';
import { buildTrendsCalibrationConfigs, readTrendsCalibration } from '../../backend/watchdog_api/services/jh16_trends';
import { spearman } from '../../backend/watchdog_api/analytics/stats';

const STORE = path.join(process.cwd(), 'test_jh16_trends_store');
let sqlite: Database.Database; let db: ReturnType<typeof drizzle>;
beforeEach(() => { sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON'); runMigrations(sqlite); db = drizzle(sqlite); fs.rmSync(STORE, { recursive: true, force: true }); });
afterEach(() => { sqlite.close(); fs.rmSync(STORE, { recursive: true, force: true }); });

const provider = loadTrendsProviderConfig().provider;
const credential = () => new SecretStore([new EnvSecretProvider({ SERPAPI_API_KEY: 'test-key-trends-000001' })]).resolve(provider.secret_ref);
// The real window: every month from 2012-01 to 2026-10 (178), which also exceeds SQLite's per-statement variable limit in one insert.
const MONTHS = Array.from({ length: 178 }, (_, i) => `${2012 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`);
/** Interest on one common scale; each group's response is divided by its own factor, as Trends would rescale it. */
const TRUE: Record<string, number> = { alcohol: 400, cannabis: 120, cocaine: 60, heroin: 50, LSD: 45, ecstasy: 40, GHB: 20, methadone: 12, butane: 10, khat: 9, amphetamine: 8,
  methamphetamine: 7, ketamine: 6, buprenorphine: 3, benzodiazepines: 2, mephedrone: 1 };
const GROUP_DIVISOR: Record<string, number> = { 'cocaine,alcohol,heroin,cannabis,LSD': 4, 'cocaine,ecstasy,GHB,methadone,butane': 0.6, 'cocaine,khat,amphetamine,methamphetamine,ketamine': 0.6,
  'methadone,mephedrone,benzodiazepines,buprenorphine,khat': 0.12 };
function body(q: string, drop?: string) {
  const terms = q.split(','), d = GROUP_DIVISOR[q];
  return JSON.stringify({ search_metadata: { id: 't', status: 'Success' }, interest_over_time: { timeline_data: MONTHS.map((m, i) => ({
    date: m, timestamp: String(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1, 1) / 1000), ...(i === MONTHS.length - 1 ? { partial_data: true } : {}),
    values: terms.filter(t => t !== drop).map(t => ({ query: t, extracted_value: Math.round(TRUE[t] * (m.startsWith('2026') || m.startsWith('2025') ? 2 : 1) / d) })) })) } });
}

test('Trends observations carry the period, the entity and the not-a-count flag; an absent term is missing', async () => {
  const adapter = new GoogleTrendsAdapter(provider, await credential(), async url => ({ ok: true, status: 200, text: async () => body(new URL(url).searchParams.get('q')!, 'LSD') }), async () => {});
  const params = adapter.validate_params({ provider_params: { date: '2012-01-01 2026-10-24', geo: 'PL' }, term_entities: { LSD: 'lysergic acid diethylamide' } });
  assert.ok(params.valid);
  assert.strictEqual(adapter.validate_params({ provider_params: { date: 'x', num: '5' } }).valid, false);
  const req = { renderedQuery: 'cocaine,alcohol,heroin,cannabis,LSD', dimension: 'interest:G1', entityId: 'G1', language: 'en', queryExpansionMode: 'STRICT_CANONICAL' as const,
    presetId: 'jh2016-trends', presetVersion: 'v', params: params.normalized_params };
  const raw = await adapter.fetch(req);
  assert.match(raw.metadata!.request_url, /geo=PL/); assert.match(raw.metadata!.request_url, /api_key=%5BREDACTED%5D/);
  const obs = adapter.normalize(raw);
  const cocaine = obs.filter(o => o.queryText === 'cocaine');
  assert.strictEqual(cocaine.length, MONTHS.length);
  assert.ok(cocaine.some(o => o.observedAt === '2014-06-01'));
  assert.ok(cocaine.every(o => o.qualityFlags.includes('RELATIVE_INTEREST_NOT_A_COUNT')));
  assert.ok(cocaine[MONTHS.length - 1].qualityFlags.includes('TRENDS_PARTIAL_PERIOD'));
  const lsd = obs.filter(o => o.queryText === 'LSD');
  assert.ok(lsd.length === 1 && lsd[0].isMissing && lsd[0].entityId === 'lysergic acid diethylamide', 'a term the provider did not return is missing, not zero');
});

test('the calibration run goes through the orchestrator; groups are chained onto one scale through anchors', async () => {
  const urls: string[] = [];
  const adapter = new GoogleTrendsAdapter(provider, await credential(), async url => { urls.push(url); return { ok: true, status: 200, text: async () => body(new URL(url).searchParams.get('q')!) }; }, async () => {});
  const compared = { runId: 'cmp', pi: { alcohol: 100, cannabis: 19, cocaine: 7, heroin: 4, 'lysergic acid diethylamide': 6, ecstasy: 8, 'gamma-hydroxybutyric acid': 1.2,
    methadone: 0.8, butane: 0.001, khat: 1.9, amphetamine: 0.9, methamphetamine: 1.5, ketamine: 1.6, buprenorphine: 1.2, benzodiazepines: 0.7, mephedrone: 0.1 },
    flags: { butane: ['PROVIDER_COUNT_EQUALS_REACHABLE_RESULTS'] } };
  const [config] = buildTrendsCalibrationConfigs(['PL'], compared, { personal: false });
  const runs = new RunRepository(db), id = runs.createRun({ runType: 'PIPELINE', config, presetId: config.preset_id, presetVersion: config.preset_version });
  await new RunOrchestrator(db, new LocalFileSystemStore(STORE), async () => adapter).executeRun(id);
  const run = runs.getRun(id)!;
  assert.strictEqual(run.status, 'COMPLETED', run.error_code ?? '');
  assert.strictEqual(urls.length, readTrendsCalibration().calibration.groups.length);
  assert.ok(urls.every(u => new URL(u).searchParams.get('geo') === 'PL' && new URL(u).searchParams.get('date') === '2012-01-01 2026-10-24'));
  const obs = new ObservationRepository(db).getByRunId(id);
  assert.ok(obs.some(o => o.observedAt === '2014-06-01'), 'the period survives storage');
  const results = new AnalysisResultRepository(db).getByRunId(id), get = (k: string, e?: string) => results.find(r => r.metricKey === k && (e ? r.entityId === e : !r.entityId))!;
  assert.ok(Math.abs(get('scale_G2').valueNumeric! - 0.6 / 4) / (0.6 / 4) < 0.02, 'G2 is rescaled to G1 through cocaine');
  assert.ok(Math.abs(get('scale_G4').valueNumeric! - 0.12 / 4) / (0.12 / 4) < 0.05, 'G4 is rescaled through methadone already on G1 scale');
  // Recovered June 2014 interest has the true order, so A1 equals Spearman of the true values against published Pi.
  const pub = config.method_params.published_pi as Record<string, number>, labels = config.source_params.term_entities as Record<string, string>;
  const expected = spearman(Object.keys(labels).map(l => TRUE[l]), Object.keys(labels).map(l => pub[labels[l]]));
  assert.ok(Math.abs(get('A1_spearman').valueNumeric! - expected!) < 1e-9);
  assert.strictEqual(get('A3b_n').valueNumeric, 15, 'the flagged compared value is excluded');
  assert.deepStrictEqual(get('A3b_spearman').statisticMetadata?.excluded, ['butane']);
  assert.ok(get('trends_jun2014', 'alcohol').valueNumeric! > get('trends_jun2014', 'mephedrone').valueNumeric!);
});

test('without a compared run, the comparisons that need it are not computable rather than invented', async () => {
  const adapter = new GoogleTrendsAdapter(provider, await credential(), async url => ({ ok: true, status: 200, text: async () => body(new URL(url).searchParams.get('q')!) }), async () => {});
  const [config] = buildTrendsCalibrationConfigs(['WORLD'], null, { personal: false });
  const runs = new RunRepository(db), id = runs.createRun({ runType: 'PIPELINE', config });
  await new RunOrchestrator(db, new LocalFileSystemStore(STORE), async () => adapter).executeRun(id);
  const results = new AnalysisResultRepository(db).getByRunId(id);
  assert.strictEqual(results.find(r => r.metricKey === 'A3_spearman')!.isMissing, true);
  assert.strictEqual(results.find(r => r.metricKey === 'A1_spearman')!.isMissing, false);
});
