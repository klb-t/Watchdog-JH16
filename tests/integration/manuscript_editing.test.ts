/**
 * Optional language editing of a replication manuscript (config/manuscript/editing.json).
 * The Vertex transport is a stub shaped like the metadata server and generateContent.
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import { editManuscript, verifyUnit, applyEdition, protectedTokens } from '../../backend/watchdog_api/services/manuscript_editing';
import { manuscriptMarkdown, type Manuscript } from '../../backend/watchdog_api/services/replication_dossier';
import { redact } from '../../backend/watchdog_api/utils/redaction';

const M: Manuscript = { title: 'T', target_id: 'jh2016', dossier_version: 'v', input_hash: 'a'.repeat(64), generated_at: '2026-10-26T00:00:00Z', code_version: 'abc1234',
  sections: [{ id: 'summary', title: 'Streszczenie', blocks: [
    { type: 'p', text: 'Nowy pomiar (2026-10-25) daje Pearson -0,104 (p 0,7015), werdykt deviates.', sources: [{ run_id: '2e701755-e83a-42dd-a39d-b3d247d9eed2' }] },
    { type: 'p', text: 'Przeliczenie danych z publikacji daje Pearson 0,816.', sources: [{ run_id: 'a0d88a49' }] },
    { type: 'list', items: ['Pierwsza uwaga bez liczb.', 'Druga uwaga: przebieg 2e701755.'] },
    { type: 'table', columns: ['A'], rows: [[1.5]], sources: [{ run_id: 'x' }] }] }] };

const TOKEN = 'ya29.test-access-token-should-never-leak-000000';
function stub(reply: (sent: any[]) => any[], log: string[] = []) {
  return async (url: string, init: any) => {
    log.push(url);
    if (url.endsWith('/token')) return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: TOKEN, expires_in: 3600 }) };
    if (url.endsWith('/project-id')) return { ok: true, status: 200, text: async () => 'test-project' };
    assert.strictEqual(init.headers.Authorization, `Bearer ${TOKEN}`);
    const sent = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);
    assert.ok(!JSON.stringify(sent).includes('"rows"'), 'tables are never sent');
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply(sent)) }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 800 } }) };
  };
}

test('protected tokens: wording may change, numbers, ids and dates may not', () => {
  assert.ok(verifyUnit('Pearson wynosi -0,104 (p 0,7015).', 'Współczynnik Pearsona wynosi −0,104 (p 0,7015).').ok);
  assert.strictEqual(verifyUnit('Pearson 0,816.', 'Pearson 0,82.').ok, false);
  assert.strictEqual(verifyUnit('Pearson 0,816.', 'Pearson 0.816.').ok, false, 'decimal separator is part of the recorded number');
  assert.strictEqual(verifyUnit('przebieg 2e701755', 'przebieg 2e70175').ok, false);
  assert.strictEqual(verifyUnit('Uwaga.', 'Uwaga, dodany fakt: 16 substancji.').ok, false, 'no new numbers');
  assert.deepStrictEqual(protectedTokens('81,6 % i 81,6%'), ['81,6%', '81,6%']);
});

test('editing keeps verified sentences, rejects changed or missing ones, and never touches tables or sources', async () => {
  const urls: string[] = [];
  const e = await editManuscript(M, { spentTodayUsd: 0, transport: stub(sent => sent.filter((u: any) => u.id !== 'summary.2.1').map((u: any) =>
    u.id === 'summary.0' ? { id: u.id, text: 'W nowym pomiarze (2026-10-25) współczynnik Pearsona wynosi -0,104 (p 0,7015); werdykt: deviates.' }
    : u.id === 'summary.1' ? { id: u.id, text: 'Przeliczenie daje Pearson 0,82.' } : u), urls) });
  assert.match(urls[2], /aiplatform\.googleapis\.com\/v1\/projects\/test-project\/locations\/global\/publishers\/google\/models\/gemini-3\.5-flash:generateContent/);
  const status = Object.fromEntries(e.units.map(u => [u.id, u.status]));
  assert.deepStrictEqual(status, { 'summary.0': 'edited', 'summary.1': 'rejected', 'summary.2.0': 'unchanged', 'summary.2.1': 'rejected' });
  assert.ok(Math.abs(e.estimated_cost_usd - (1000 * 1.5 + 800 * 9) / 1e6) < 1e-12);
  const out = applyEdition(M, e);
  assert.match((out.sections[0].blocks[0] as any).text, /współczynnik Pearsona/);
  assert.strictEqual((out.sections[0].blocks[1] as any).text, M.sections[0].blocks[1].type === 'p' ? (M.sections[0].blocks[1] as any).text : '', 'a rejected unit keeps the original');
  assert.deepStrictEqual(out.sections[0].blocks[3], M.sections[0].blocks[3]);
  assert.deepStrictEqual(out.sections[0].blocks.map(b => b.sources), M.sections[0].blocks.map(b => b.sources), 'every sentence keeps its data link');
  assert.match(manuscriptMarkdown(out), /redakcja językowa: vertex:gemini-3\.5-flash, zmienione zdania 1, odrzucone 2/);
  assert.ok(!redact(`token ${TOKEN}`).includes(TOKEN), 'the access token is registered for redaction');
});

test('the daily budget is checked before anything is sent', async () => {
  const urls: string[] = [];
  await assert.rejects(() => editManuscript(M, { spentTodayUsd: 0.9999, transport: stub(s => s, urls) }), /daily budget/);
  assert.deepStrictEqual(urls, []);
});
