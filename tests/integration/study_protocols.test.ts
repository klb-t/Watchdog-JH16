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
