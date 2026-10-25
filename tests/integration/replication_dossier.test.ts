/**
 * Replications as an in-app object and the manuscript built from stored runs
 * (docs/replication/JH16_2026-10-25/). Counts come from the frozen paper
 * fixture through the real orchestrator; the "new fetch" run replays them
 * through the live SerpApi adapter with a recorded-shape transport.
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
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { FixtureSourceAdapter } from '../../backend/watchdog_api/sources/fixture_source';
import { SerpApiAdapter } from '../../backend/watchdog_api/sources/serpapi';
import { loadSearchProviderConfig } from '../../backend/watchdog_api/sources/search_providers';
import { SecretStore, EnvSecretProvider } from '../../backend/watchdog_api/secrets';
import { jh16PlanItems, readJh16Preset } from '../../backend/watchdog_api/services/jh16_plan';
import { listReplicationTargets, collectRuns, buildManuscript, manuscriptMarkdown, manuscriptHtml, primaryRuns } from '../../backend/watchdog_api/services/replication_dossier';

const STORE = path.join(process.cwd(), 'test_replication_dossier_store');
let sqlite: Database.Database; let db: ReturnType<typeof drizzle>;
beforeEach(() => { sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON'); runMigrations(sqlite); db = drizzle(sqlite); fs.rmSync(STORE, { recursive: true, force: true }); });
afterEach(() => { sqlite.close(); fs.rmSync(STORE, { recursive: true, force: true }); });

const preset = readJh16Preset(), reference = JSON.parse(fs.readFileSync('config/reference/nutt-2010.json', 'utf-8'));
const paper = JSON.parse(fs.readFileSync('fixtures/jh2016/paper_reported.json', 'utf-8'));
const base = { method_id: 'jh16_faithful', preset_id: preset.preset_id, preset_version: preset.preset_version, language: 'en', query_expansion_mode: 'STRICT_CANONICAL',
  plan: jh16PlanItems(preset), method_params: { reference_scores: reference.scores } };

async function run(config: any, adapter: any, owner = 'owner-a') {
  const runs = new RunRepository(db), id = runs.createRun({ runType: config.source_run_id ? 'ANALYSIS' : 'PIPELINE', config, presetId: config.preset_id, presetVersion: config.preset_version, ownerPrincipalId: owner });
  await new RunOrchestrator(db, new LocalFileSystemStore(STORE), async () => adapter).executeRun(id);
  return id;
}

test('a registered target lists its runs with the provenance of their numbers and yields a sourced manuscript', async () => {
  const target = listReplicationTargets().find(t => t.target.target_id === 'jh2016')!;
  assert.ok(target.dossier && target.interpretation, 'JH16 has a dossier and interpretation rules');
  const hist = await run({ ...base, source_id: 'fixture_jh2016', source_params: { fixture_set: 'faithful_2014-06-20' } }, new FixtureSourceAdapter());
  const serp = loadSearchProviderConfig().config.providers.find(p => p.provider_key === 'serpapi')!;
  const cred = await new SecretStore([new EnvSecretProvider({ SERPAPI_API_KEY: 'dossier-test-key-0001' })]).resolve(serp.secret_ref);
  const fresh = await run({ ...base, source_id: 'serp_result_count', source_params: {} }, new SerpApiAdapter(serp, cred, async url => {
    const q = new URL(url).searchParams.get('q')!, s = paper.substances.find((x: any) => q.startsWith(`"${x.query_label}"`));
    return { ok: true, status: 200, text: async () => JSON.stringify({ search_information: { total_results: q.includes('"harm"') ? s.Ni_harm : s.Ni } }) };
  }, async () => {}));
  const recompute = await run({ source_run_id: fresh, method_id: 'jh16_faithful', method_params: { reference_scores: reference.scores } }, null);
  await run({ ...base, source_id: 'fixture_jh2016', source_params: { fixture_set: 'faithful_2014-06-20' } }, new FixtureSourceAdapter(), 'owner-b');

  const runs = await collectRuns(db, new LocalFileSystemStore(STORE), 'owner-a', target.dossier);
  assert.deepStrictEqual(runs.map(r => r.run_id).sort(), [hist, fresh, recompute].sort(), 'only this owner\'s matching runs');
  const kind = (id: string) => runs.find(r => r.run_id === id)!.provenance;
  assert.strictEqual(kind(hist), 'recomputation_of_published_data');
  assert.strictEqual(kind(fresh), 'new_fetch');
  assert.strictEqual(kind(recompute), 'recomputation_of_stored_data');
  assert.ok(runs.find(r => r.run_id === recompute)!.fetches === 32, 'a recomputation reports the fetches of the run its counts come from');
  assert.deepStrictEqual(primaryRuns(runs).map(r => r.provenance).sort(), ['new_fetch', 'recomputation_of_published_data', 'recomputation_of_stored_data']);

  const m = buildManuscript(target, runs, paper, 'abc1234', '2026-10-25T00:00:00.000Z');
  assert.deepStrictEqual(m.sections.map(s => s.id), ['summary', 'introduction', 'method_original', 'method_replication', 'data', 'results', 'comparison', 'discrepancies', 'limitations', 'conclusions', 'appendix']);
  const summary = m.sections.find(s => s.id === 'summary')!.blocks;
  assert.ok(summary.some(b => b.type === 'p' && b.text.includes('0,816') && b.sources?.some(x => 'run_id' in x && x.run_id === hist)), 'every number names its run');
  const md = manuscriptMarkdown(m), html = manuscriptHtml(m);
  for (const bad of ['undefined', 'NaN', '[object Object]']) { assert.ok(!md.includes(bad), `markdown contains ${bad}`); assert.ok(!html.includes(bad), `html contains ${bad}`); }
  assert.match(md, /Źródło: przebieg/);
  assert.match(html, /^<!doctype html>/);
  assert.strictEqual(buildManuscript(target, runs, paper, 'abc1234', '2026-10-25T00:00:00.000Z').input_hash, m.input_hash, 'same stored results, same manuscript input');
});

test('without runs the manuscript still forms and says the new data are missing', async () => {
  const target = listReplicationTargets().find(t => t.target.target_id === 'jh2016')!;
  const m = buildManuscript(target, [], paper, null);
  const text = manuscriptMarkdown(m);
  assert.match(text, /Nie ma jeszcze ukończonego, kompletnego nowego pomiaru/);
  assert.ok(!text.includes('undefined'));
});
