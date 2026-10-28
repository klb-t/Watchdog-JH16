/**
 * Requests from a pasted text (config/requests/text-requests.json). The quote is
 * Prof. Hoffmann's real message; publisher and Crossref responses here are
 * synthetic test inputs shaped like the real ones.
 */
import { test, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { TextRequestRepository } from '../../backend/watchdog_api/db/repositories/text_requests';
import { analyzeText, TextRequests, type Fetcher } from '../../backend/watchdog_api/services/text_requests';

const QUOTE = `zacząć można od bardzo prostych prac np takich jak w artykule

https://www.jmir.org/2016/2/e38/

gdzie zaproponowaliśmy sposób oceny popularności i szkodliwości różnych substancji - możliwy byłby update co do rozwoju sytuacji w kolejnych okresach oraz próba sprawdzenia sytuacji w poszczególnych krajach (obszarach językowych)

pozdrawiam serdecznie`;

const STORE = path.join(process.cwd(), 'test_text_requests_store');
let sqlite: Database.Database; let db: ReturnType<typeof drizzle>;
beforeEach(() => { sqlite = new Database(':memory:'); runMigrations(sqlite); db = drizzle(sqlite); fs.rmSync(STORE, { recursive: true, force: true }); });
afterEach(() => { sqlite.close(); fs.rmSync(STORE, { recursive: true, force: true }); });

const crossrefYear = { message: { items: [
  { DOI: '10.2196/jmir.4000', title: ['Another paper'], resource: { primary: { URL: 'http://www.jmir.org/2016/2/e37/' } } },
  { DOI: '10.2196/jmir.4033', title: ['Can Google Searches Predict the Popularity and Harm of Psychoactive Agents?'], resource: { primary: { URL: 'http://www.jmir.org/2016/2/e38/' } } }] } };
function fetcher(log: string[], pages: Record<string, { status: number; type: string; body: string }> = {}): Fetcher {
  return async (url, init) => {
    log.push(`${url} UA=${init.headers['User-Agent']}`);
    const page = Object.entries(pages).find(([k]) => url.startsWith(k))?.[1];
    if (page) return { status: page.status, url, contentType: page.type, body: Buffer.from(page.body) };
    if (url.startsWith('https://www.jmir.org/')) return { status: 202, url, contentType: 'text/html', body: Buffer.alloc(0) };
    if (url.includes('filter=issn:1438-8871')) return { status: 200, url, contentType: 'application/json', body: Buffer.from(JSON.stringify(crossrefYear)) };
    if (url.startsWith('https://api.crossref.org/works/')) return { status: 200, url, contentType: 'application/json', body: Buffer.from(JSON.stringify({ message: { title: ['An unregistered paper'] } })) };
    return { status: 404, url, contentType: 'text/plain', body: Buffer.from('not found') };
  };
}
const deps = (log: string[], extra: any = {}) => ({ fetcher: fetcher(log, extra.pages), store: new LocalFileSystemStore(STORE), ...(extra.root ? { root: extra.root } : {}), ...(extra.modelTransport ? { modelTransport: extra.modelTransport } : {}) });

test('the quote: the work is resolved through open metadata, intents are quoted, the plan comes from the dossier', async () => {
  const log: string[] = [], a = await analyzeText(QUOTE, deps(log));
  assert.deepStrictEqual(a.identifiers, [{ kind: 'url', value: 'https://www.jmir.org/2016/2/e38/' }]);
  assert.match(a.retrievals[0].note!, /empty body .* not worked around/); assert.ok(log.every(l => /UA=WatchDog research platform/.test(l)), 'honestly identified, never a browser');
  assert.deepStrictEqual(a.works.map(w => w.doi), ['10.2196/jmir.4033']); assert.match(a.works[0].via, /registered landing page equals/);
  assert.strictEqual(a.target?.target_id, 'jh2016');
  assert.deepStrictEqual(a.intents.map(i => [i.id, i.source]), [['replicate', 'rule'], ['period_update', 'rule'], ['regional', 'rule']]);
  assert.match(a.intents[0].fragment, /^zacząć można od bardzo prostych prac/);
  assert.ok(a.intents.every(i => QUOTE.includes(i.fragment)), 'every intent quotes the text');
  assert.deepStrictEqual(a.literal.map(x => [x.id, x.requests]), [['jh16_recompute', 0], ['jh16_new_period', 32]]);
  assert.deepStrictEqual(a.proposals.map(x => [x.id, x.requests, !!x.unavailable]), [['jh16_trends', 16, false], ['jh16_countries_gl', 160, false], ['jh16_language_areas', null, true], ['jh16_repeat', null, true]]);
  assert.deepStrictEqual(a.questions.map(q => q.id), ['substances', 'countries', 'periods', 'original_data']);
  assert.strictEqual(a.model.status, 'disabled'); assert.strictEqual(a.cost.literal_requests, 32); assert.strictEqual(a.intake, null);
  assert.strictEqual((await analyzeText(QUOTE, deps([]))).plan_hash, a.plan_hash, 'the plan hash does not depend on volatile page bytes');
});

test('sending starts the literal part within the daily spending cap; proposals need acceptance; answers do not block', async () => {
  const repo = new TextRequestRepository(db), launched: any[] = []; let today = 0;
  const service = new TextRequests(repo, deps([]), {
    jh16Plan: (_o, launch) => { launched.push(launch.baseline + (launch.trendsRegions ? `+trends${launch.trendsRegions.length}` : '')); return { runIds: [`run-${launched.length}`] }; },
    measurement: () => ({ runIds: ['m'] }), intake: () => ({ documentId: 'd' }), searchesToday: () => today });
  const a = await service.preview(QUOTE);
  await assert.rejects(() => service.submit('owner', QUOTE, '0'.repeat(64)), /plan changed/);
  const r = await service.submit('owner', QUOTE, a.plan_hash);
  assert.deepStrictEqual(launched, ['fixture', 'live_serp']);
  assert.deepStrictEqual(r.events.map(e => [e.kind, e.body.action]), [['launched', 'jh16_recompute'], ['launched', 'jh16_new_period']]);
  assert.throws(() => service.accept('owner', r.id, 'jh16_language_areas'), /przetłumaczonych/);
  service.accept('owner', r.id, 'jh16_trends'); assert.strictEqual(launched[2], 'none+trends4');
  assert.throws(() => service.accept('owner', r.id, 'jh16_trends'), /Already started/);
  const answered = service.answer('owner', r.id, 'countries', 'Polska, Niemcy');
  assert.strictEqual(answered.events.slice(-1)[0].body.answer, 'Polska, Niemcy');
  assert.throws(() => sqlite.prepare('UPDATE text_requests SET body_json = ?').run('{}'), /WORM/);
  assert.throws(() => sqlite.prepare('DELETE FROM text_request_events').run(), /Retain/);
  today = 70; launched.length = 0;
  const capped = await service.submit('owner', QUOTE, a.plan_hash);
  assert.deepStrictEqual(capped.events.map(e => [e.kind, e.body.action]), [['launched', 'jh16_recompute'], ['deferred', 'jh16_new_period']], '70 searches today ≈ 0.98 EUR: the 32-request measurement waits');
  assert.match(capped.events[1].body.reason, /daily cap/);
  service.accept('owner', capped.id, 'jh16_new_period'); assert.deepStrictEqual(launched, ['fixture', 'live_serp']);
});

test('a work outside the register goes to paper intake with what could be fetched', async () => {
  const repo = new TextRequestRepository(db), intakes: any[] = [];
  const html = '<html><head><title>Some study</title><meta name="citation_doi" content="10.1234/abc.567"><meta name="citation_title" content="Some study"></head><body><h1>Methods</h1><p>We counted things.</p></body></html>';
  const service = new TextRequests(repo, deps([], { pages: { 'https://example.org/paper': { status: 200, type: 'text/html; charset=utf-8', body: html } } }), {
    jh16Plan: () => { throw new Error('must not run'); }, measurement: () => { throw new Error('must not run'); }, intake: (_o, d) => { intakes.push(d); return { documentId: 'doc-1' }; }, searchesToday: () => 0 });
  const text = 'Proszę powtórzyć analizę jak w artykule https://example.org/paper';
  const a = await service.preview(text);
  assert.strictEqual(a.target, null); assert.deepStrictEqual(a.works.map(w => w.doi), ['10.1234/abc.567']);
  assert.deepStrictEqual(a.intake && [a.intake.title, a.intake.source, a.intake.coverage], ['Some study', 'doi:10.1234/abc.567', 'full_text']);
  assert.deepStrictEqual(a.literal, []);
  const r = await service.submit('owner', text, a.plan_hash);
  assert.strictEqual(intakes[0].coverage, 'full_text'); assert.match(intakes[0].text, /We counted things/);
  assert.deepStrictEqual(r.events.map(e => [e.kind, e.body.action, e.body.documentId]), [['launched', 'intake', 'doc-1']]);
  const onlyDoi = await analyzeText('See doi 10.5555/xyz.1 please replicate it.', deps([]));
  assert.deepStrictEqual(onlyDoi.intake && [onlyDoi.intake.source, onlyDoi.intake.coverage], ['doi:10.5555/xyz.1', 'identifier_only']);
});

test('the optional model reading keeps only proposals that quote the text verbatim', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'textreq-'));
  fs.cpSync('config', path.join(root, 'config'), { recursive: true }); fs.cpSync('fixtures', path.join(root, 'fixtures'), { recursive: true });
  const cfgPath = path.join(root, 'config/requests/text-requests.json'), cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.model_supplement.enabled = true; cfg.intents = cfg.intents.filter((i: any) => i.id !== 'regional').concat([{ id: 'regional', label: 'Kraje lub obszary językowe', patterns: ['(?!)'] }]);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  const transport = async (url: string) => {
    if (url.endsWith('/token')) return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'ya29.test-token-for-request-reading-0000000', expires_in: 60 }) };
    if (url.endsWith('/project-id')) return { ok: true, status: 200, text: async () => 'p' };
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      intents: [{ id: 'regional', quote: 'w poszczególnych krajach (obszarach językowych)' }, { id: 'regional', quote: 'in every country of the world' }, { id: 'invented', quote: 'zacząć można' }],
      method_notes: [{ statement: 'Hi = Ni_harm / Ni', quote: 'not in the text at all' }] }) }] } }], usageMetadata: {} }) };
  };
  const a = await analyzeText(QUOTE, deps([], { root, modelTransport: transport }));
  const regional = a.intents.find(i => i.id === 'regional')!;
  assert.strictEqual(regional.source, 'model'); assert.strictEqual(regional.fragment, 'w poszczególnych krajach (obszarach językowych)');
  assert.strictEqual(a.intents.filter(i => i.id === 'regional').length, 1); assert.ok(!a.intents.some(i => (i.id as string) === 'invented'));
  assert.deepStrictEqual(a.model.notes, [], 'a method note without a verbatim quote is discarded');
  assert.strictEqual(a.model.status, 'used');
  fs.rmSync(root, { recursive: true, force: true });
});
