import { test } from 'node:test';
import * as assert from 'node:assert';
import { JH16Analyzer } from '../../backend/watchdog_api/analytics/jh16';
import { calculateRatio, normalizeMax, pearson, spearman } from '../../backend/watchdog_api/analytics/stats';
import { canonicalizeJson } from '../../backend/watchdog_api/domain/canonical';
import { analyzerRegistry } from '../../backend/watchdog_api/analytics/registry';
import { Observation } from '../../backend/watchdog_api/domain/observation';

function obs(entityId: string, queryRole: string, value: number | null): Observation {
  const base = {
    seriesId: `${entityId}:${queryRole}`,
    entityId,
    queryRole,
    queryText: '',
    retrievedAt: '2026-01-01T00:00:00.000Z',
    sourceId: 'fixture',
    sourceAdapterVersion: '2.0.0',
    language: 'en-GB',
    queryExpansionMode: 'STRICT_CANONICAL',
    qualityFlags: [] as const,
  };
  return value === null
    ? { ...base, isMissing: true, numericValue: null, missingReason: 'PARSE_FAILED' }
    : { ...base, isMissing: false, numericValue: value };
}

test('Generic Stats: normalizeMax', () => {
  const result = normalizeMax([100, 50, 0, -1], true);
  assert.strictEqual(result[0], 100);
  assert.strictEqual(result[1], 50);
  assert.strictEqual(result[2], 0);
  assert.ok(Number.isNaN(result[3]));

  assert.throws(() => normalizeMax([-1, -2]), /No valid positive values found/);
});

test('Generic Stats: calculateRatio', () => {
  assert.strictEqual(calculateRatio(50, 100, true), 50);
  assert.strictEqual(calculateRatio(50, 100, false), 0.5);
  assert.strictEqual(calculateRatio(50, 0, true), null);
});

test('Generic Stats: Pearson and Spearman Correlation', () => {
  const x = [1, 2, 3, 4, 5];
  const y = [2, 4, 6, 8, 10];
  assert.ok(Math.abs(pearson(x, y)! - 1) < 0.0001);
  assert.ok(Math.abs(spearman(x, y)! - 1) < 0.0001);

  const y_inv = [10, 8, 6, 4, 2];
  assert.ok(Math.abs(pearson(x, y_inv)! - (-1)) < 0.0001);
  assert.ok(Math.abs(spearman(x, y_inv)! - (-1)) < 0.0001);
});

test('JH16 Analyzer execution', () => {
  const analyzer = new JH16Analyzer();
  const inputs: Observation[] = [
    obs('alcohol', 'popularity', 1000),
    obs('alcohol', 'harm', 50),
    obs('cannabis', 'popularity', 500),
    obs('cannabis', 'harm', 10),
    obs('heroin', 'popularity', 100),
    obs('heroin', 'harm', 20),
  ];

  const config = {
    method_id: 'jh16',
    method_version: '1.0',
    parameters: { reference_scores: { alcohol: 72, cannabis: 20, heroin: 55 } }
  };

  const results = analyzer.analyze(inputs, config);

  // Pi = Ni / max(Ni) * 100; max is alcohol at 1000.
  assert.strictEqual(results.find(r => r.entityId === 'alcohol' && r.metricKey === 'Pi')?.valueNumeric, 100);
  assert.strictEqual(results.find(r => r.entityId === 'cannabis' && r.metricKey === 'Pi')?.valueNumeric, 50);
  assert.strictEqual(results.find(r => r.entityId === 'heroin' && r.metricKey === 'Pi')?.valueNumeric, 10);

  // Hi = Ni_harm / Ni * 100
  assert.strictEqual(results.find(r => r.entityId === 'alcohol' && r.metricKey === 'Hi')?.valueNumeric, 5);
  assert.strictEqual(results.find(r => r.entityId === 'cannabis' && r.metricKey === 'Hi')?.valueNumeric, 2);
  assert.strictEqual(results.find(r => r.entityId === 'heroin' && r.metricKey === 'Hi')?.valueNumeric, 20);

  assert.ok(results.find(r => r.metricKey === 'pearson_pi_ref') !== undefined);
  assert.ok(results.find(r => r.metricKey === 'spearman_hi_ref') !== undefined);
});

test('JH16: a missing count stays missing and never becomes zero', () => {
  const analyzer = new JH16Analyzer();
  const inputs: Observation[] = [
    obs('alcohol', 'popularity', 1000),
    obs('alcohol', 'harm', 50),
    obs('cannabis', 'popularity', 500),
    obs('cannabis', 'harm', null),      // missing harm count
  ];
  const results = analyzer.analyze(inputs, {
    method_id: 'jh16', method_version: '1.0',
    parameters: { reference_scores: { alcohol: 72, cannabis: 20 } }
  });

  const hiCannabis = results.find(r => r.entityId === 'cannabis' && r.metricKey === 'Hi');
  assert.ok(hiCannabis, 'an Hi row must still exist for the substance');
  assert.strictEqual(hiCannabis!.valueNumeric, null, 'missing Ni_harm must yield null Hi, never 0');
  assert.strictEqual(hiCannabis!.isMissing, true);
});

test('JH16: zero Ni leaves Hi undefined and does not crash', () => {
  const analyzer = new JH16Analyzer();
  const inputs: Observation[] = [
    obs('alcohol', 'popularity', 1000),
    obs('alcohol', 'harm', 50),
    obs('khat', 'popularity', 0),     // zero popularity count
    obs('khat', 'harm', 5),
  ];
  const results = analyzer.analyze(inputs, {
    method_id: 'jh16', method_version: '1.0',
    parameters: { reference_scores: { alcohol: 72, khat: 9 } }
  });

  const hiKhat = results.find(r => r.entityId === 'khat' && r.metricKey === 'Hi');
  assert.strictEqual(hiKhat!.valueNumeric, null, 'Ni <= 0 makes Hi undefined, never Infinity or 0');
  assert.strictEqual(hiKhat!.isMissing, true);
});

// -------------------------------------------------------------------------
// The published result, from the paper's own tables. This is the check that
// the pipeline computes what the paper computed, on the paper's own inputs.
// -------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';

test('JH2016 published data: Hi reproduces from the paper Ni and Ni_harm', () => {
  const paper = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'fixtures', 'jh2016', 'paper_reported.json'), 'utf-8')
  );

  assert.strictEqual(paper.substances.length, 16, 'the FAITHFUL set is exactly sixteen');

  for (const s of paper.substances) {
    const computed = calculateRatio(s.Ni_harm, s.Ni, true)!;
    assert.ok(
      Math.abs(computed - s.Hi_percent) < 0.06,
      `${s.canonical}: computed Hi ${computed.toFixed(2)}% vs published ${s.Hi_percent}%`
    );
  }
});

test('JH2016 published data: the reported 81.6% is Pearson, not Spearman', () => {
  const paper = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'fixtures', 'jh2016', 'paper_reported.json'), 'utf-8')
  );
  const subs = [...paper.substances].sort((a: any, b: any) => a.canonical.localeCompare(b.canonical));
  const hi = subs.map((s: any) => s.Hi_percent);
  const scores = subs.map((s: any) => s.nutt_2010_harm_score);

  const r = pearson(hi, scores)!;
  const rho = spearman(hi, scores)!;

  // The paper's prose says "harm score ranking", which reads as a rank
  // correlation. It is not: only Pearson reproduces the reported figure.
  assert.ok(Math.abs(r * 100 - 81.6) < 0.15,
    `Pearson should reproduce the published 81.6%, got ${(r * 100).toFixed(2)}%`);
  assert.ok(Math.abs(rho * 100 - 81.6) > 10,
    `Spearman should NOT match the published figure, got ${(rho * 100).toFixed(2)}%`);

  assert.strictEqual(paper.reported_statistics.statistic_determined_by_recomputation, 'pearson');
});


// A4-WD-003: same input cardinality as the existing reviewed MethodSpec route.
test('JH16: ambiguous consumed roles fail before missing filtering, even when equal or missing', () => {
  const analyzer = new JH16Analyzer();
  const spec = { method_id: analyzer.analyzer_id, method_version: analyzer.analyzer_version,
    parameters: { reference_scores: { candidate: 7, anchor: 3 } } };
  for (const role of ['popularity', 'harm']) {
    for (const pair of [[100, 200], [100, 100], [100, null], [null, null]]) {
      const inputs = [obs('anchor', 'popularity', 300), obs('anchor', 'harm', 10),
        obs('candidate', role, pair[0]), obs('candidate', role, pair[1])];
      for (const rows of [inputs, [...inputs].reverse()]) {
        const before = JSON.stringify(rows);
        assert.throws(() => analyzer.validate_inputs(rows, spec), /Ambiguous JH16 input/);
        assert.throws(() => analyzer.analyze(rows, spec), /Ambiguous JH16 input/);
        assert.strictEqual(JSON.stringify(rows), before, 'validation never mutates or deduplicates source observations');
      }
    }
  }
});

test('JH16: unique mixed inputs keep exact baseline results, correlations and input order independence', () => {
  const fixture = JSON.parse(fs.readFileSync('tests/fixtures/jh16-unique-before.json', 'utf8'));
  const analyzer = new JH16Analyzer();
  const inputBytes = JSON.stringify(fixture.inputs);
  for (const rows of [fixture.inputs, [...fixture.inputs].reverse()])
    assert.strictEqual(canonicalizeJson(analyzer.analyze(rows, fixture.spec)), fixture.resultsCanonical);
  assert.strictEqual(JSON.stringify(fixture.inputs), inputBytes);
  assert.strictEqual(analyzer.analyzer_version, '1.1.1');
  assert.strictEqual(analyzerRegistry.get('jh16_faithful').analyzer_version, '1.1.1');
});

test('JH16: distinct entities/roles remain valid and unconsumed roles are not newly constrained', () => {
  const analyzer = new JH16Analyzer();
  const spec = { method_id: analyzer.analyzer_id, method_version: analyzer.analyzer_version,
    parameters: { reference_scores: { 'entity:popularity': 7, ['__proto__']: 2 } } };
  const rows = [obs('entity:popularity', 'popularity', 100), obs('entity:popularity', 'harm', 25),
    obs('__proto__', 'popularity', 50), obs('__proto__', 'harm', 10)];
  const expected = analyzer.analyze(rows, spec);
  const withUnconsumed = [...rows, obs('entity:popularity', 'custom', 1), obs('entity:popularity', 'custom', null)];
  assert.deepStrictEqual(analyzer.analyze(withUnconsumed, spec), expected);
});
