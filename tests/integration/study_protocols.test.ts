/**
 * E5.7b: frozen study protocols, data roles and comparison families.
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
import { listReplicationTargets, collectRuns, buildManuscript } from '../../backend/watchdog_api/services/replication_dossier';
import { adjustPValues, dataRole, evaluateProtocol, ProtocolError } from '../../backend/watchdog_api/services/study_protocols';
import { StudyProtocolRepository } from '../../backend/watchdog_api/db/repositories/study_protocols';

const STORE = path.join(process.cwd(), 'test_study_protocols_store');
let sqlite: Database.Database; let db: ReturnType<typeof drizzle>;
beforeEach(() => { sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON'); runMigrations(sqlite); db = drizzle(sqlite); fs.rmSync(STORE, { recursive: true, force: true }); });
afterEach(() => { sqlite.close(); fs.rmSync(STORE, { recursive: true, force: true }); });

const preset = readJh16Preset(), reference = JSON.parse(fs.readFileSync('config/reference/nutt-2010.json', 'utf-8'));
const paper = JSON.parse(fs.readFileSync('fixtures/jh2016/paper_reported.json', 'utf-8'));
const base = { method_id: 'jh16_faithful', preset_id: preset.preset_id, preset_version: preset.preset_version, language: 'en', query_expansion_mode: 'STRICT_CANONICAL',
  plan: jh16PlanItems(preset), method_params: { reference_scores: reference.scores } };
const target = () => listReplicationTargets().find(t => t.target.target_id === 'jh2016')!;
const input = (over: any = {}) => ({ name: 'confirm', primary: ['harm_index_vs_reference_pearson'], family: ['harm_index_vs_reference_pearson', 'popularity_ranking_stability'],
  multiplicity: 'holm', alpha: 0.01, rationale: 'pre-registered family', expectedDossierHash: target().hashes.dossier, ...over });

async function liveRun(extra: any) {
  const serp = loadSearchProviderConfig().config.providers.find(p => p.provider_key === 'serpapi')!;
  const cred = await new SecretStore([new EnvSecretProvider({ SERPAPI_API_KEY: 'protocol-test-key-0001' })]).resolve(serp.secret_ref);
  const adapter = new SerpApiAdapter(serp, cred, async url => { const q = new URL(url).searchParams.get('q')!, s = paper.substances.find((x: any) => q.startsWith(`"${x.query_label}"`));
    return { ok: true, status: 200, text: async () => JSON.stringify({ search_information: { total_results: q.includes('"harm"') ? s.Ni_harm : s.Ni } }) }; }, async () => {});
  const runs = new RunRepository(db), config = { ...base, source_id: 'serp_result_count', source_params: {}, ...extra };
  const id = runs.createRun({ runType: 'PIPELINE', config, presetId: config.preset_id, presetVersion: config.preset_version, ownerPrincipalId: 'owner' });
  await new RunOrchestrator(db, new LocalFileSystemStore(STORE), async () => adapter).executeRun(id);
  return id;
}

test('Holm and Bonferroni adjust a family as published', () => {
  assert.deepStrictEqual(adjustPValues([0.01, 0.04, 0.03], 'holm').map(p => Number(p!.toFixed(10))), [0.03, 0.06, 0.06]);
  assert.deepStrictEqual(adjustPValues([0.01, 0.04, null], 'bonferroni'), [0.02, 0.08, null]);
  assert.deepStrictEqual(adjustPValues([0.2, 0.9], 'holm'), [0.4, 0.9]);
  assert.deepStrictEqual(adjustPValues([0.01], 'none'), [0.01]);
});

test('freezing validates the family against the target and the reviewed description', () => {
  const repo = new StudyProtocolRepository(db);
  assert.throws(() => repo.freeze('owner', target(), input({ family: ['made_up'] })), ProtocolError);
  assert.throws(() => repo.freeze('owner', target(), input({ primary: ['popularity_ranking_stability'], family: ['harm_index_vs_reference_pearson'] })), /members of the comparison family/);
  assert.throws(() => repo.freeze('owner', target(), input({ expectedDossierHash: '0'.repeat(64) })), /changed/);
  const p = repo.freeze('owner', target(), input());
  assert.strictEqual(repo.list('owner', 'jh2016')[0].content_hash, p.content_hash);
  assert.throws(() => sqlite.prepare('UPDATE study_protocols SET body_json = ?').run('{}'), /WORM/);
  assert.deepStrictEqual(repo.list('someone-else', 'jh2016'), []);
});

test('only a new faithful run after the freeze that cites the protocol is confirmation data; its family is adjusted', async () => {
  const before = await liveRun({});
  await new Promise(r => setTimeout(r, 5));
  const repo = new StudyProtocolRepository(db), p = repo.freeze('owner', target(), input());
  await new Promise(r => setTimeout(r, 5));
  const good = await liveRun({ data_role: 'confirmation', protocol_id: p.id, protocol_hash: p.content_hash });
  const badHash = await liveRun({ data_role: 'confirmation', protocol_id: p.id, protocol_hash: 'f'.repeat(64) });
  const hist = new RunRepository(db).createRun({ runType: 'PIPELINE', config: { ...base, source_id: 'fixture_jh2016', source_params: { fixture_set: 'faithful_2014-06-20' }, data_role: 'confirmation', protocol_id: p.id, protocol_hash: p.content_hash }, presetId: preset.preset_id, ownerPrincipalId: 'owner' });
  await new RunOrchestrator(db, new LocalFileSystemStore(STORE), async () => new FixtureSourceAdapter()).executeRun(hist);
  const runs = await collectRuns(db, new LocalFileSystemStore(STORE), 'owner', target().dossier);
  const role = (id: string) => dataRole(runs.find(r => r.run_id === id)!, [p]);
  assert.strictEqual(role(before).role, 'exploratory');
  assert.strictEqual(role(good).role, 'confirmation');
  assert.match(role(badHash).reason!, /hash/);
  assert.match(role(hist).reason!, /new measurement/, 'the paper\'s own counts cannot confirm');
  const ev = evaluateProtocol(p, runs);
  assert.deepStrictEqual(ev.confirmation_runs.map(r => r.run_id), [good]);
  const [harm, pop] = ev.confirmation_runs[0].endpoints;
  assert.strictEqual(harm.verdict, 'reproduced');
  // Holm, family of two: the smaller p is doubled, the larger is max(itself, the doubled smaller).
  const [lo, hi] = [harm, pop].sort((a, b) => a.p_raw! - b.p_raw!);
  assert.strictEqual(lo.p_adjusted, Math.min(1, 2 * lo.p_raw!));
  assert.strictEqual(hi.p_adjusted, Math.max(Math.min(1, 2 * lo.p_raw!), hi.p_raw!));
  assert.strictEqual(harm.significant, true);
  const m = buildManuscript(target(), runs, paper, null, '2026-10-26T00:00:00Z', [{ ...p, evaluation: ev }]);
  const section = m.sections.find(s => s.id === 'protocol')!;
  assert.ok(section && section.blocks.some(b => b.type === 'table' && b.sources?.some(x => 'run_id' in x && x.run_id === good)));
});

// ---- E5.7b-2: prioritised hypotheses and several comparison families ----

const HARM = 'harm_index_vs_reference_pearson', POP = 'popularity_ranking_stability';
const families = (over: any = {}) => ({ name: 'prioritised', primary: [HARM], alpha: 0.01, rationale: 'harm first, popularity only if harm holds',
  expectedDossierHash: target().hashes.dossier, families: [{ label: 'Główna', endpoints: [HARM], multiplicity: 'holm' }, { label: 'Wtórna', endpoints: [POP], multiplicity: 'holm' }], gating: 'serial', ...over });
/** A stored-evaluation summary shaped like collectRuns output: only the fields a protocol reads. */
const summary = (p: any, pHarm: number | null, pPop: number | null, complete = true): any => ({ run_id: `r-${pHarm}-${pPop}`, created_at: '2999-01-01T00:00:00Z', status: 'COMPLETED', provenance: 'new_fetch',
  role_config: { data_role: 'confirmation', protocol_id: p.id, protocol_hash: p.content_hash, source_id: 'serp_result_count' },
  evaluation: { complete, verdicts: [], hi_vs_reference: [{ statistic: 'pearson', p_two_sided: pHarm }], pi_vs_published: { p_two_sided: pPop } } });

test('fixed sequence: running maximum in the declared order; a missing p-value stops the sequence', () => {
  assert.deepStrictEqual(adjustPValues([0.001, 0.02, 0.004], 'fixed_sequence'), [0.001, 0.02, 0.02]);
  assert.deepStrictEqual(adjustPValues([0.001, null, 0.003], 'fixed_sequence'), [0.001, null, null]);
});

test('families keep the declared order and are validated; the single-family form refuses a fixed sequence', () => {
  const repo = new StudyProtocolRepository(db);
  const p = repo.freeze('owner', target(), families({ families: [{ label: 'Jedna', endpoints: [POP, HARM], multiplicity: 'fixed_sequence' }] }));
  assert.deepStrictEqual(p.body.families!.map(f => [f.id, f.endpoints.map(e => e.claim_key)]), [['F1', [POP, HARM]]], 'priority order is not sorted away');
  assert.strictEqual(p.body.multiplicity, 'fixed_sequence');
  assert.strictEqual(repo.list('owner', 'jh2016')[0].content_hash, p.content_hash);
  assert.throws(() => repo.freeze('owner', target(), families({ families: [{ label: 'A', endpoints: [HARM], multiplicity: 'holm' }, { label: 'B', endpoints: [HARM], multiplicity: 'holm' }] })), /more than one place/);
  assert.throws(() => repo.freeze('owner', target(), families({ gating: 'whatever' })), /Unknown gating/);
  assert.throws(() => repo.freeze('owner', target(), families({ families: [{ label: 'A', endpoints: [HARM], multiplicity: 'magic' }] })), /Unknown multiplicity/);
  assert.throws(() => repo.freeze('owner', target(), families({ family: [HARM] })), /not both/);
  assert.throws(() => repo.freeze('owner', target(), families({ primary: [POP], families: [{ label: 'A', endpoints: [HARM], multiplicity: 'holm' }] })), /members of a comparison family/);
  assert.throws(() => repo.freeze('owner', target(), input({ multiplicity: 'fixed_sequence' })), /explicit order/);
});

test('serial gating: the second family is tested only when the first is fully rejected; independent families are not gated', () => {
  const repo = new StudyProtocolRepository(db);
  const serial = repo.freeze('owner', target(), families());
  const open = evaluateProtocol(serial, [summary(serial, 0.001, 0.004)]).confirmation_runs[0].endpoints;
  assert.deepStrictEqual(open.map(e => [e.family_id, e.priority, e.tested, e.significant]), [['F1', 1, true, true], ['F2', 1, true, true]]);
  const closed = evaluateProtocol(serial, [summary(serial, 0.5, 0.004)]).confirmation_runs[0].endpoints;
  assert.deepStrictEqual(closed.map(e => [e.tested, e.significant, e.p_adjusted]), [[true, false, 0.5], [false, null, null]]);
  assert.match(closed[1].not_tested_reason!, /gate closed: family F1/);
  assert.strictEqual(closed[1].p_raw, 0.004, 'the raw value stays visible even when it is not tested');
  const independent = repo.freeze('owner', target(), families({ gating: 'independent' }));
  assert.strictEqual(evaluateProtocol(independent, [summary(independent, 0.5, 0.004)]).confirmation_runs[0].endpoints[1].significant, true);
  const seq = repo.freeze('owner', target(), families({ families: [{ label: 'S', endpoints: [HARM, POP], multiplicity: 'fixed_sequence' }] }));
  const stopped = evaluateProtocol(seq, [summary(seq, null, 0.001)]).confirmation_runs[0].endpoints;
  assert.deepStrictEqual(stopped.map(e => e.not_tested_reason), ['p-value not available', 'sequence stopped at an earlier hypothesis']);
  const m = buildManuscript(target(), [], paper, null, '2026-10-26T00:00:00Z', [{ ...serial, evaluation: evaluateProtocol(serial, [summary(serial, 0.5, 0.004)]) }]);
  const text = JSON.stringify(m.sections.find(s => s.id === 'protocol'));
  assert.match(text, /bramkowanie szeregowe/); assert.match(text, /nietestowane: bramka zamknięta/);
});

test('a protocol frozen in the single-family form evaluates as before', () => {
  const p = new StudyProtocolRepository(db).freeze('owner', target(), input());
  assert.strictEqual(p.body.families, undefined);
  const [harm, pop] = evaluateProtocol(p, [summary(p, 0.004, 0.2)]).confirmation_runs[0].endpoints;
  assert.deepStrictEqual([harm.p_adjusted, pop.p_adjusted, harm.significant, pop.significant, harm.tested, pop.tested], [0.008, 0.2, true, false, true, true]);
  assert.deepStrictEqual([harm.priority, pop.priority], [null, null], 'a sorted family declares no priority');
});
