import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FixtureSourceAdapter } from '../../backend/watchdog_api/sources/fixture_source';
import { parseResultCount } from '../../backend/watchdog_api/sources/count_parser';
import { SourceRequest } from '../../backend/watchdog_api/sources/base';

const FAITHFUL = 'faithful_2014-06-20';
const EDGE = 'edge_cases';

function req(entityId: string, dimension: string, renderedQuery: string, fixtureSet: string): SourceRequest {
  return {
    renderedQuery, dimension, entityId,
    language: 'en', queryExpansionMode: 'STRICT_CANONICAL',
    presetId: 'jh2016-faithful', presetVersion: '1.0',
    params: { fixture_set: fixtureSet },
  };
}

// -------------------------------------------------------------------------
// E1.9 — the frozen fixture set.
// -------------------------------------------------------------------------

test('E1.9: the faithful set has all 32 queries — 16 substances x 2 dimensions', () => {
  const adapter = new FixtureSourceAdapter();
  const queries = adapter.listQueries(FAITHFUL);

  assert.strictEqual(queries.length, 32);
  assert.strictEqual(new Set(queries.map(q => q.entity_id)).size, 16,
    'the FAITHFUL substance set is exactly sixteen, no more and no fewer');
  assert.deepStrictEqual([...new Set(queries.map(q => q.dimension))].sort(), ['harm', 'popularity']);

  for (const q of queries) {
    const file = path.join(process.cwd(), 'fixtures', 'jh2016', FAITHFUL, q.file);
    assert.ok(fs.existsSync(file), `fixture file missing: ${q.file}`);
  }
});

test('E1.9: exact-query golden — all 32 rendered strings match the paper byte for byte', () => {
  // 03_JH2016_CONTRACT.md: a change to a query string must break the build.
  const paper = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), 'fixtures', 'jh2016', 'paper_reported.json'), 'utf-8'));
  const adapter = new FixtureSourceAdapter();
  const byKey = new Map(adapter.listQueries(FAITHFUL).map(q => [`${q.entity_id}:${q.dimension}`, q]));

  for (const s of paper.substances) {
    const label = s.query_label;
    assert.strictEqual(byKey.get(`${s.canonical}:popularity`)!.rendered_query, `"${label}"`);
    assert.strictEqual(byKey.get(`${s.canonical}:harm`)!.rendered_query, `"${label}" "harm" OR "harmful"`);
  }
});

test('E1.9: every faithful fixture normalizes to the count the paper published', async () => {
  const adapter = new FixtureSourceAdapter();
  const golden = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), 'fixtures', 'jh2016', FAITHFUL, 'golden.json'), 'utf-8'));
  const expected = new Map(golden.observations.map((o: any) => [`${o.entity_id}:${o.dimension}`, o.expected_count]));

  for (const q of adapter.listQueries(FAITHFUL)) {
    const raw = await adapter.fetch(req(q.entity_id, q.dimension, q.rendered_query, FAITHFUL));
    assert.strictEqual(raw.status, 'SUCCESS');

    const [obs] = adapter.normalize(raw);
    assert.strictEqual(obs.isMissing, false, `${q.entity_id}/${q.dimension} should have a count`);
    assert.strictEqual(obs.isMissing === false && obs.numericValue,
      expected.get(`${q.entity_id}:${q.dimension}`), `${q.entity_id}/${q.dimension}`);

    // The rendered query is stored exactly as sent — this is evidence, not a
    // debug convenience.
    assert.strictEqual(obs.queryText, q.rendered_query);
    // Counts reported as "About N" are estimates and must say so.
    assert.ok(obs.qualityFlags.includes('PROVIDER_ESTIMATE'));
  }
});

// -------------------------------------------------------------------------
// E1.9 — the four deliberate edge cases.
// -------------------------------------------------------------------------

test('E1.9 edge case: a missing count arrives as missing, never as zero', async () => {
  const adapter = new FixtureSourceAdapter();
  const raw = await adapter.fetch(req('missing_count', 'popularity', '"missingcount"', EDGE));
  const [obs] = adapter.normalize(raw);

  assert.strictEqual(obs.isMissing, true);
  assert.strictEqual(obs.numericValue, null);
  assert.notStrictEqual(obs.numericValue as unknown, 0);
  assert.ok(obs.isMissing === true && obs.missingReason, 'missingness carries a reason');
});

test('E1.9 edge case: a genuine zero Ni is a measurement, not missingness', async () => {
  const adapter = new FixtureSourceAdapter();
  const raw = await adapter.fetch(req('zero_ni', 'popularity', '"zeroni"', EDGE));
  const [obs] = adapter.normalize(raw);

  // The distinction this asserts is the whole point of the two fixtures:
  // "the provider said zero" and "I could not tell what it said" are
  // different facts and must not collapse into one.
  assert.strictEqual(obs.isMissing, false, 'zero is a real measured value');
  assert.strictEqual(obs.isMissing === false && obs.numericValue, 0);
});

test('E1.9 edge case: an unparseable count is missing and flagged, never guessed', async () => {
  const adapter = new FixtureSourceAdapter();
  const raw = await adapter.fetch(req('unparseable_count', 'popularity', '"unparseable"', EDGE));
  const [obs] = adapter.normalize(raw);

  assert.strictEqual(obs.isMissing, true);
  assert.strictEqual(obs.numericValue, null);
  assert.ok(obs.qualityFlags.includes('COUNT_PARSE_UNCERTAIN'));
});

test('E1.9 edge case: grouped digits parse to the exact integer', async () => {
  const adapter = new FixtureSourceAdapter();
  const raw = await adapter.fetch(req('grouped_digits', 'popularity', '"groupeddigits"', EDGE));
  const [obs] = adapter.normalize(raw);

  assert.strictEqual(obs.isMissing, false);
  assert.strictEqual(obs.isMissing === false && obs.numericValue, 1234567);
});

// -------------------------------------------------------------------------
// Count parsing — 03_JH2016_CONTRACT.md's "count parsing" required test.
// -------------------------------------------------------------------------

test('Count parsing: grouped digits, about-prefixes, zero, and refusals', () => {
  const ok = (raw: unknown) => {
    const r = parseResultCount(raw);
    assert.ok(r.ok, `expected a parse for ${JSON.stringify(raw)}`);
    return r as Extract<typeof r, { ok: true }>;
  };

  assert.strictEqual(ok('About 389,000,000 results (0.41 seconds)').count, 389_000_000);
  assert.strictEqual(ok('About 1,234,567 results').approximate, true);
  assert.strictEqual(ok('About 1,234,567 results').grouped, true);
  assert.strictEqual(ok('1234567 results').count, 1_234_567);
  assert.strictEqual(ok('1.234.567 results').count, 1_234_567, 'period grouping is used in many locales');
  assert.strictEqual(ok('0 results (0.30 seconds)').count, 0);
  assert.strictEqual(ok(42).count, 42);

  // The timing suffix must never be mistaken for the count.
  assert.strictEqual(ok('About 55 results (0.41 seconds)').count, 55);

  // Refusals, each of which must be missing rather than a guess.
  assert.strictEqual(parseResultCount('many results').ok, false);
  assert.strictEqual(parseResultCount(null).ok, false);
  assert.strictEqual(parseResultCount(undefined).ok, false);
  assert.strictEqual(parseResultCount('').ok, false);
  assert.strictEqual(parseResultCount(-5).ok, false);
  assert.strictEqual(parseResultCount(3.5).ok, false);

  const absent = parseResultCount(null);
  assert.strictEqual(absent.ok === false && absent.reason, 'ABSENT');
  const bad = parseResultCount('many results');
  assert.strictEqual(bad.ok === false && bad.reason, 'UNPARSEABLE');
});
