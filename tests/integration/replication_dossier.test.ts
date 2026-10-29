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

// ---------------------------------------------------------------- what a reader of the JH16 dossier sees (2026-10-29)

test('the manuscript says where a recomputation\'s numbers come from, defines the verdicts, names later incomplete runs and evidence that is not stored here', async () => {
  const target = listReplicationTargets().find(t => t.target.target_id === 'jh2016')!;
  const serp = loadSearchProviderConfig().config.providers.find(p => p.provider_key === 'serpapi')!;
  const cred = await new SecretStore([new EnvSecretProvider({ SERPAPI_API_KEY: 'dossier-test-key-0002' })]).resolve(serp.secret_ref);
  // Recorded-shape transport over the paper's own counts; `dropKhatHarm` returns 0 for one query, which the adapter stores as missing.
  const live = (dropKhatHarm: boolean) => new SerpApiAdapter(serp, cred, async url => {
    const q = new URL(url).searchParams.get('q')!, s = paper.substances.find((x: any) => q.startsWith(`"${x.query_label}"`));
    const harm = q.includes('"harm"');
    return { ok: true, status: 200, text: async () => JSON.stringify({ search_information: { total_results: dropKhatHarm && harm && s.query_label === 'khat' ? 0 : harm ? s.Ni_harm : s.Ni } }) };
  }, async () => {});
  await run({ ...base, source_id: 'fixture_jh2016', source_params: { fixture_set: 'faithful_2014-06-20' } }, new FixtureSourceAdapter());
  const fresh = await run({ ...base, source_id: 'serp_result_count', source_params: {} }, live(false));
  const recompute = await run({ source_run_id: fresh, method_id: 'jh16_faithful', method_params: { reference_scores: reference.scores } }, null);
  await new Promise(r => setTimeout(r, 5));
  const later = await run({ ...base, source_id: 'serp_result_count', source_params: {} }, live(true));
  const runs = await collectRuns(db, new LocalFileSystemStore(STORE), 'owner-a', target.dossier);
  const rec = runs.find(r => r.run_id === recompute)!;
  assert.strictEqual(rec.own_fetches, 0, 'a recomputation fetched nothing itself');
  assert.strictEqual(rec.fetches, 32);
  assert.strictEqual(runs.find(r => r.run_id === later)!.evaluation.complete, false);

  const m = buildManuscript(target, runs, paper, 'abc1234', '2026-10-29T00:00:00.000Z');
  const blocks = (id: string) => m.sections.find(s => s.id === id)!.blocks;
  const table = (id: string, i = 0) => blocks(id).filter(b => b.type === 'table')[i] as any;
  const s8 = (id: string) => id.slice(0, 8);

  const appendix = table('appendix').rows.find((r: any[]) => r[0] === recompute);
  assert.strictEqual(appendix[4], `0 (liczby z przebiegu ${s8(fresh)}: 32)`, 'the appendix does not credit a recomputation with fetches it did not make');
  assert.ok(String(table('data').rows.find((r: any[]) => r[0] === s8(recompute))[3]).startsWith(`dane z ${s8(fresh)}: `));

  const summary = blocks('summary').filter(b => b.type === 'p').map(b => (b as any).text).join('\n');
  assert.match(summary, new RegExp(`Późniejsze nowe pomiary bez werdyktu \\(niekompletne dane\\): ${s8(later)} \\([0-9-]{10}, braki: khat\\)`));
  assert.ok(blocks('summary').some(b => b.sources?.some(x => 'run_id' in x && x.run_id === later)), 'the later run is cited');

  const method = blocks('method_replication');
  const criteria = (method.find(b => b.type === 'list' && b.items.some(i => i.startsWith('Kryterium'))) as any).items.join('\n');
  assert.match(criteria, /pearson, przedział \[0,7; 1\]/);
  assert.match(criteria, /spearman, dolny próg ≥ 0,6/);
  assert.ok(method.some(b => b.type === 'p' && b.text.includes('„reproduced” — wartość mieści się w paśmie ustalonym przed danymi')), 'the verdict words are defined for the reader');

  const perSubstance = table('results', 1);
  const alcohol = perSubstance.rows.find((r: any[]) => r[0] === 'alcohol');
  assert.strictEqual(alcohol[3], '27,51'); assert.strictEqual(alcohol[4], '27,5');
  for (const r of perSubstance.rows) assert.ok(!/HI_ABOVE_100|PROVIDER_COUNT/.test(String(r[6])), 'flags are shown in words');

  const region = table('discrepancies').rows.find((r: any[]) => r[0] === 'Region Google');
  assert.match(region[3], /brak kompletnych przebiegów tego rodzaju w tej instalacji/, 'evidence that is not stored here is not implied');
  const conclusions = (blocks('conclusions')[0] as any).items.join('\n');
  assert.match(conclusions, new RegExp(`Odczyt nowego pomiaru ${s8(fresh)} według reguły ustalonej przed danymi: dane `));
  const md = manuscriptMarkdown(m);
  for (const bad of ['undefined', 'NaN', '[object Object]']) assert.ok(!md.includes(bad), `markdown contains ${bad}`);
});

test('diagnosis evidence by kind of run counts only complete runs; the evidence graph keeps the gap until one exists', async () => {
  const { buildEvidenceGraph } = await import('../../backend/watchdog_api/services/evidence_graph');
  const { diagnosisEvidenceRuns } = await import('../../backend/watchdog_api/services/replication_dossier');
  const target = listReplicationTargets().find(t => t.target.target_id === 'jh2016')!;
  const regionIdx = target.dossier.diagnosis.findIndex((d: any) => d.cause === 'Region Google');
  // Hand-built summaries (test inputs only): the graph reads provenance, status and completeness, no statistic.
  const variant = (id: string, complete: boolean): any => ({ run_id: id, created_at: '2026-10-29T00:00:00Z', status: 'COMPLETED', git_commit: null, provenance: 'enhanced_variant',
    provenance_label: 'wariant', variant: 'gl-us', source_run_id: null, acquired_utc: null, fetches: 32, own_fetches: 32, compare_run_id: null, manifest_sha256: null,
    effective_config_hash: null, preset: 'jh2016-serp-extension', role_config: { data_role: null, protocol_id: null, protocol_hash: null, source_id: null },
    evaluation: { complete, verdicts: [], missing_entities: complete ? [] : ['khat'] }, calibration: null });
  const regionGap = (runs: any[]) => buildEvidenceGraph(target, runs, [], buildManuscript(target, [], paper, null, '2026-10-29T00:00:00Z')).gaps
    .some(g => g.problem === "a diagnosis marked 'excluded' names no evidence");
  assert.ok(regionGap([]));
  assert.deepStrictEqual(diagnosisEvidenceRuns(target.dossier, [variant('aaaaaaaa-partial', false)])[regionIdx], []);
  assert.ok(regionGap([variant('aaaaaaaa-partial', false)]), 'a partial variant run is not evidence');
  assert.deepStrictEqual(diagnosisEvidenceRuns(target.dossier, [variant('bbbbbbbb-full', true)])[regionIdx], ['bbbbbbbb-full']);
  assert.ok(!regionGap([variant('bbbbbbbb-full', true)]), 'a complete variant run closes the gap');
});

test('the probable cause "Zmiana sposobu szacowania" names its consistency evidence and stays labelled a hypothesis (decision 2026-10-29, option C)', async () => {
  const { buildEvidenceGraph } = await import('../../backend/watchdog_api/services/evidence_graph');
  const target = listReplicationTargets().find(t => t.target.target_id === 'jh2016')!;
  const cause = target.dossier.diagnosis.find((d: any) => d.cause.startsWith('Zmiana sposobu szacowania'));
  assert.strictEqual(cause.status, 'probable', 'the status is not raised to shown');
  assert.deepStrictEqual(cause.evidence.map((e: any) => e.path), ['docs/history/evidence/2026-10-29-jh16-gaps/estimator_consistency.json']);
  const m = buildManuscript(target, [], paper, null, '2026-10-29T00:00:00Z');
  const g = buildEvidenceGraph(target, [], [], m);
  assert.ok(!g.gaps.some(x => x.problem.includes("'probable'")), 'the probable cause is no longer a gap');
  const node = g.nodes.find(n => n.kind === 'cause' && n.label === cause.cause)!;
  assert.match(node.detail!, /hipoteza zgodna z danymi, nie wykazana/);
  assert.ok(g.edges.some(e => e.from === 'file:docs/history/evidence/2026-10-29-jh16-gaps/estimator_consistency.json' && e.to === node.id && e.kind === 'supports'));
  const row = (m.sections.find(s => s.id === 'discrepancies')!.blocks[0] as any).rows.find((r: any[]) => r[0] === cause.cause);
  assert.strictEqual(row[2], 'prawdopodobna (hipoteza zgodna z danymi, nie wykazana)');
  assert.ok(!/wykazana\b(?!\))/.test(row[1].replace('nie wykazana', '')), 'the test text never calls it shown');
  const summary = m.sections.find(s => s.id === 'summary')!.blocks.map(b => (b as any).text ?? '').join(' ');
  assert.ok(!summary.includes('Zmiana sposobu szacowania'), 'a probable cause is not listed among the shown causes');
});

test('every file a dossier links to exists, and links point at one pinned commit', () => {
  for (const t of listReplicationTargets().filter(x => x.dossier)) {
    assert.match(t.dossier.evidence_base_url, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/blob\/[0-9a-f]{40}\/$/, `${t.target.target_id}: base URL is a commit, not a branch that can move or vanish`);
    const paths = new Set<string>([t.dossier.protocol.document]);
    const walk = (o: any): void => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (k === 'path' && typeof v === 'string') paths.add(v); else walk(v); } };
    walk(t.dossier);
    for (const p of paths) assert.ok(fs.existsSync(p), `${t.target.target_id}: ${p} is linked but missing`);
  }
});
