/**
 * A second replication target through the general path (config/replication/cr2014*):
 * Trends interest by region → reference correlation → stored evaluation → dossier,
 * protocol and manuscript. The Trends responses here are synthetic test inputs
 * built from the reference values; no real measurement is involved.
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
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { GoogleTrendsAdapter, loadTrendsProviderConfig, TRENDS_BY_REGION_CONFIG_PATH } from '../../backend/watchdog_api/sources/google_trends';
import { SecretStore, EnvSecretProvider } from '../../backend/watchdog_api/secrets';
import { listReplicationTargets, collectRuns, buildManuscript, primaryRuns } from '../../backend/watchdog_api/services/replication_dossier';
import { measurementPlan, ReplicationMeasurements } from '../../backend/watchdog_api/services/replication_measurements';
import { StudyProtocolRepository } from '../../backend/watchdog_api/db/repositories/study_protocols';
import { dataRole, evaluateProtocol } from '../../backend/watchdog_api/services/study_protocols';
import { pearson } from '../../backend/watchdog_api/analytics/stats';

const STORE = path.join(process.cwd(), 'test_replication_general_store');
let sqlite: Database.Database; let db: ReturnType<typeof drizzle>;
beforeEach(() => { sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON'); runMigrations(sqlite); db = drizzle(sqlite); fs.rmSync(STORE, { recursive: true, force: true }); });
afterEach(() => { sqlite.close(); fs.rmSync(STORE, { recursive: true, force: true }); });

const target = () => listReplicationTargets().find(t => t.target.target_id === 'cr2014')!;
const reference: Record<string, number> = JSON.parse(fs.readFileSync('config/reference/yrbss-2011-hs-current-cigar.json', 'utf8')).scores;
// Synthetic interest values: a fixed function of the reference, so the expected r is known.
const synthetic = (drop: string[] = []) => Object.entries(reference).filter(([g]) => !drop.includes(g))
  .map(([geo, v], i) => ({ geo, location: geo, max_value_index: 0, value: '', extracted_value: Math.round(40 + v * 3 + ((i * 7) % 11)) }));

async function measure(regions: any[], extra: any = {}) {
  const provider = loadTrendsProviderConfig(TRENDS_BY_REGION_CONFIG_PATH).provider;
  const cred = await new SecretStore([new EnvSecretProvider({ SERPAPI_API_KEY: 'general-target-test-key-0001' })]).resolve(provider.secret_ref);
  const urls: string[] = [];
  const adapter = new GoogleTrendsAdapter(provider, cred, async url => { urls.push(url); return { ok: true, status: 200, text: async () => JSON.stringify({ interest_by_region: regions }) }; }, async () => {});
  const p = measurementPlan(target())!;
  const config = { source_id: p.source_id, source_params: { provider_params: p.provider_params }, language: 'en', query_expansion_mode: 'STRICT_CANONICAL', plan: p.plan,
    method_id: p.method_id, method_params: p.method_params, preset_id: p.preset.preset_id, preset_version: p.preset.preset_version, replication_target_id: 'cr2014', ...extra };
  const id = new RunRepository(db).createRun({ runType: 'PIPELINE', config, presetId: config.preset_id, presetVersion: config.preset_version, ownerPrincipalId: 'owner' });
  await new RunOrchestrator(db, new LocalFileSystemStore(STORE), async () => adapter).executeRun(id);
  return { id, urls };
}

test('interest by region: one query, the paper\'s terms joined with +, one observation per state', async () => {
  const { id, urls } = await measure(synthetic());
  assert.strictEqual(urls.length, 1);
  const u = new URL(urls[0]);
  assert.strictEqual(u.searchParams.get('data_type'), 'GEO_MAP_0'); assert.strictEqual(u.searchParams.get('region'), 'REGION');
  assert.strictEqual(u.searchParams.get('date'), '2011-01-01 2011-12-31'); assert.strictEqual(u.searchParams.get('geo'), 'US');
  assert.strictEqual(u.searchParams.get('q'), 'cigars+cigar+cigarillo+cigarillos+Black and Mild+Black and Milds+Swisher Sweet+Swisher Sweets');
  const obs = new ObservationRepository(db).getByRunId(id).sort((a, b) => a.entityId.localeCompare(b.entityId));
  assert.strictEqual(obs.length, 36); assert.strictEqual(obs[0].entityId, 'US-AK'); assert.strictEqual(obs[0].observedAt, '2011-01-01'); assert.strictEqual(obs[0].queryRole, 'cigar');
  assert.ok(obs.every(o => o.qualityFlags.includes('RELATIVE_INTEREST_NOT_A_COUNT')));
});

test('the run carries a stored evaluation against the pre-registered band and reading rule', async () => {
  const { id } = await measure(synthetic());
  const runs = await collectRuns(db, new LocalFileSystemStore(STORE), 'owner', target().dossier);
  const r = runs.find(x => x.run_id === id)!;
  assert.strictEqual(r.status, 'COMPLETED'); assert.strictEqual(r.provenance, 'new_fetch'); assert.strictEqual(r.evaluation.complete, true);
  const c = r.evaluation.comparisons[0], xs = synthetic().map(x => x.extracted_value), ys = Object.values(reference);
  assert.strictEqual(c.n, 36); assert.ok(Math.abs(c.value - pearson(xs, ys)) < 1e-12, 'the stored r is the deterministic Pearson of the stored pairs');
  assert.strictEqual(r.evaluation.verdicts[0].verdict, c.value >= 0.07 && c.value <= 0.64 ? 'reproduced' : 'deviates');
  assert.strictEqual(r.evaluation.readings[0].reading, 'supports');
  assert.deepStrictEqual(r.evaluation.exploratory[0].excluded, ['US-RI', 'US-UT']); assert.strictEqual(r.evaluation.exploratory[0].n, 34);
  assert.deepStrictEqual(primaryRuns(runs).map(x => x.run_id), [id]);
});

test('a state missing from the response is a missing pair, so verdicts are not computable', async () => {
  const { id } = await measure(synthetic(['US-WY']));
  const r = (await collectRuns(db, new LocalFileSystemStore(STORE), 'owner', target().dossier)).find(x => x.run_id === id)!;
  assert.strictEqual(r.evaluation.complete, false);
  assert.deepStrictEqual(r.evaluation.comparisons[0].missing_entities, ['US-WY']);
  assert.strictEqual(r.evaluation.verdicts[0].verdict, 'not_computable');
  assert.strictEqual(r.evaluation.readings[0].reading, 'not_computable');
});

test('protocol, data role and manuscript work for the second target without JH16 fields', async () => {
  const protocols = new StudyProtocolRepository(db);
  const p = protocols.freeze('owner', target(), { name: 'cr2014 confirm', primary: ['cigar_youth_pearson'], families: [{ label: 'Główna', endpoints: ['cigar_youth_pearson'], multiplicity: 'holm' }],
    alpha: 0.05, rationale: 'one pre-registered endpoint', expectedDossierHash: target().hashes.dossier });
  await new Promise(r => setTimeout(r, 5));
  const { id } = await measure(synthetic(), { data_role: 'confirmation', protocol_id: p.id, protocol_hash: p.content_hash });
  const runs = await collectRuns(db, new LocalFileSystemStore(STORE), 'owner', target().dossier);
  assert.strictEqual(dataRole(runs.find(r => r.run_id === id)!, [p]).role, 'confirmation');
  const ev = evaluateProtocol(p, runs).confirmation_runs[0].endpoints[0];
  assert.strictEqual(ev.p_raw, runs[0].evaluation.comparisons[0].p_two_sided); assert.strictEqual(ev.tested, true);
  const published = JSON.parse(fs.readFileSync('fixtures/cr2014/paper_reported.json', 'utf8'));
  const m = buildManuscript(target(), runs, published, null, '2026-10-26T00:00:00Z', [{ ...p, evaluation: evaluateProtocol(p, runs) }]);
  assert.deepStrictEqual(m.sections.map(s => s.id), ['summary', 'introduction', 'method_original', 'method_replication', 'not_replicated', 'data', 'results', 'comparison', 'protocol', 'discrepancies', 'limitations', 'conclusions', 'appendix']);
  const text = JSON.stringify(m);
  assert.match(text, /praca podała r = 0,390 \(n = 36, p = 0,0180\)/); assert.ok(!/undefined|NaN|Hi %|Nutt/.test(text));
  assert.ok(m.sections.find(s => s.id === 'results')!.blocks.every(b => b.type !== 'table' || b.sources?.length), 'every result table names its source');
});

test('launching a measurement checks the key, the limit, the preset hash and the protocol before anything is sent', () => {
  const t = target(), p = measurementPlan(t)!, submitted: any[] = [];
  let key = true, today = 0;
  const service = new ReplicationMeasurements({ get: () => ({ value: { searchDailyRequestLimit: 3 } }), searchesToday: () => today } as any,
    { resolve: () => ({ isPresent: key }) } as any, { defaults: {} } as any, { submitJob: (type: string, config: any, owner: string) => { submitted.push({ type, config, owner }); return 'run-1'; } } as any,
    (_o, id) => id === 'other' ? { id: 'other', target_id: 'jh2016', content_hash: 'x' } as any : null);
  assert.throws(() => service.launch('owner', t, { expectedPresetHash: '0'.repeat(64), dataRole: 'exploratory' }), /preset changed/);
  key = false; assert.match(service.describe('owner', t)!.blocked!, /personal serpapi key/);
  key = true; today = 3; assert.throws(() => service.launch('owner', t, { expectedPresetHash: p.preset_hash, dataRole: 'exploratory' }), /leaves 0 today/);
  today = 0; assert.throws(() => service.launch('owner', t, { expectedPresetHash: p.preset_hash, dataRole: 'confirmation', protocolId: 'other' }), /frozen for this target/);
  assert.deepStrictEqual(submitted, []);
  assert.deepStrictEqual(service.launch('owner', t, { expectedPresetHash: p.preset_hash, dataRole: 'exploratory' }), { runId: 'run-1', requests: 1 });
  const c = submitted[0].config;
  assert.strictEqual(c.source_id, 'trends_interest_by_region'); assert.strictEqual(c.personal_credentials, true); assert.strictEqual(c.replication_target_id, 'cr2014');
  assert.strictEqual(c.approved_preset_hash, p.preset_hash); assert.strictEqual(c.method_params.comparisons[0].reference['US-SC'], 18.3121);
});

test('a query longer than the provider accepts is refused before it is sent', async () => {
  const provider = loadTrendsProviderConfig(TRENDS_BY_REGION_CONFIG_PATH).provider, urls: string[] = [];
  const cred = await new SecretStore([new EnvSecretProvider({ SERPAPI_API_KEY: 'general-target-test-key-0001' })]).resolve(provider.secret_ref);
  const adapter = new GoogleTrendsAdapter(provider, cred, async url => { urls.push(url); return { ok: true, status: 200, text: async () => '{}' }; }, async () => {});
  const raw = await adapter.fetch({ renderedQuery: 'x'.repeat(101), dimension: 'cigar', entityId: 'cigar', language: 'en', queryExpansionMode: 'STRICT_CANONICAL', presetId: 'p', presetVersion: '1',
    params: { provider_params: { date: '2011-01-01 2011-12-31', geo: 'US', region: 'REGION' }, term_entities: {} } });
  assert.strictEqual(raw.status, 'FETCH_FAILED'); assert.match(String(raw.metadata.detail), /at most 100; nothing was sent/); assert.deepStrictEqual(urls, []);
  assert.ok(measurementPlan(target())!.plan[0].renderedQuery.length <= 100, 'the shipped preset (v2) fits the limit');
});

test('evidence graph: hypothesis → claim ← protocol, run → claim with its verdict, files and manuscript citations; gaps are named', async () => {
  const { buildEvidenceGraph } = await import('../../backend/watchdog_api/services/evidence_graph');
  const published = JSON.parse(fs.readFileSync('fixtures/cr2014/paper_reported.json', 'utf8'));
  const empty = buildEvidenceGraph(target(), [], [], buildManuscript(target(), [], published, null, '2026-10-26T00:00:00Z'));
  assert.deepStrictEqual(empty.gaps.map(g => g.node), ['claim:cigar_youth_pearson']);
  const protocols = new StudyProtocolRepository(db);
  const p = protocols.freeze('owner', target(), { name: 'g', primary: ['cigar_youth_pearson'], families: [{ label: 'A', endpoints: ['cigar_youth_pearson'], multiplicity: 'holm' }],
    alpha: 0.05, rationale: 'graph test', expectedDossierHash: target().hashes.dossier });
  await new Promise(r => setTimeout(r, 5));
  const { id } = await measure(synthetic(), { data_role: 'confirmation', protocol_id: p.id, protocol_hash: p.content_hash });
  const runs = await collectRuns(db, new LocalFileSystemStore(STORE), 'owner', target().dossier), list = [{ ...p, evaluation: evaluateProtocol(p, runs) }];
  const build = () => buildEvidenceGraph(target(), runs, list, buildManuscript(target(), runs, published, null, '2026-10-26T00:00:00Z', list));
  const g = build(), has = (from: string, to: string, kind: string) => g.edges.some(e => e.from === from && e.to === to && e.kind === kind);
  assert.ok(has('hypothesis:H-cigar-youth', 'claim:cigar_youth_pearson', 'tested_by'));
  assert.ok(has(`protocol:${p.id}`, 'claim:cigar_youth_pearson', 'fixes'));
  assert.ok(has('file:docs/replication/CR2014_2026-10-26/PROTOCOL.md', 'claim:cigar_youth_pearson', 'fixes'));
  assert.ok(g.edges.some(e => e.from === `run:${id}` && e.to === 'claim:cigar_youth_pearson' && e.kind === 'evaluates' && ['reproduced', 'deviates'].includes(e.label!)));
  assert.ok(has(`run:${id}`, `protocol:${p.id}`, 'confirms'));
  assert.ok(has(`run:${id}`, 'section:results', 'cited_in'));
  assert.ok(has('file:fixtures/cr2014/paper_reported.json', `run:${id}`, 'uses'));
  assert.deepStrictEqual(g.gaps, [], 'the claim now has a complete run; every diagnosis names evidence');
  assert.strictEqual(build().graph_hash, g.graph_hash, 'deterministic');
});

test('evidence graph of JH16 with no runs: both claims are gaps, the graph still builds', async () => {
  const { buildEvidenceGraph } = await import('../../backend/watchdog_api/services/evidence_graph');
  const jh = listReplicationTargets().find(t => t.target.target_id === 'jh2016')!;
  const g = buildEvidenceGraph(jh, [], [], buildManuscript(jh, [], null, null, '2026-10-26T00:00:00Z'));
  assert.deepStrictEqual(g.gaps.filter(x => x.node.startsWith('claim:')).map(x => x.node), ['claim:harm_index_vs_reference_pearson', 'claim:popularity_ranking_stability']);
  assert.ok(g.nodes.some(n => n.kind === 'cause'));
});
