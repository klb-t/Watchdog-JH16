import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  evaluateClaim, observedHiVsReference, observedPiRankingStability,
  ReplicationClaim, ATTEMPT_KIND_MEANING,
} from '../../backend/watchdog_api/services/replication';
import { AnalysisResultValue } from '../../backend/watchdog_api/domain/method_spec';

const load = (...p: string[]) => JSON.parse(fs.readFileSync(path.join(process.cwd(), ...p), 'utf-8'));

const floorClaim: ReplicationClaim = {
  claim_key: 'k', claim_type: 'rank_correlation', statistic: 'spearman',
  claimed_value_numeric: 1.0, tolerance_kind: 'rank_correlation_floor', tolerance_value: 0.60,
};

// -------------------------------------------------------------------------
// E1.20 — the verdict vocabulary and each tolerance kind.
// -------------------------------------------------------------------------

test('E1.20: every verdict uses the four-value vocabulary and none is "failed"', () => {
  const seen = new Set<string>();
  seen.add(evaluateClaim(floorClaim, 0.9).verdict);
  seen.add(evaluateClaim(floorClaim, 0.1).verdict);
  seen.add(evaluateClaim(floorClaim, null).verdict);
  seen.add(evaluateClaim({ ...floorClaim, tolerance_kind: 'nonsense' as any }, 0.5).verdict);

  assert.deepStrictEqual([...seen].sort(),
    ['deviates', 'method_unclear', 'not_computable', 'reproduced']);
  assert.ok(!seen.has('failed'), "'failed' is deliberately not in the vocabulary");
});

test('E1.20: insufficient data is not_computable, never a quiet pass', () => {
  const v = evaluateClaim(floorClaim, null);
  assert.strictEqual(v.verdict, 'not_computable');
  assert.strictEqual(v.within_tolerance, null);
  assert.notStrictEqual(v.verdict, 'reproduced');
  assert.notStrictEqual(v.verdict, 'deviates');
});

test('E1.20: each tolerance kind decides on its own terms', () => {
  // floor
  assert.strictEqual(evaluateClaim(floorClaim, 0.60).verdict, 'reproduced', 'the floor is inclusive');
  assert.strictEqual(evaluateClaim(floorClaim, 0.5999).verdict, 'deviates');

  // interval
  const interval: ReplicationClaim = { ...floorClaim, tolerance_kind: 'interval',
    tolerance_value: 0.70, interval_upper: 1.0, statistic: 'pearson' };
  assert.strictEqual(evaluateClaim(interval, 0.8162).verdict, 'reproduced');
  assert.strictEqual(evaluateClaim(interval, 0.69).verdict, 'deviates');

  // absolute
  const abs: ReplicationClaim = { ...floorClaim, tolerance_kind: 'absolute',
    claimed_value_numeric: 10, tolerance_value: 2 };
  assert.strictEqual(evaluateClaim(abs, 11.9).verdict, 'reproduced');
  assert.strictEqual(evaluateClaim(abs, 12.1).verdict, 'deviates');

  // relative
  const rel: ReplicationClaim = { ...floorClaim, tolerance_kind: 'relative',
    claimed_value_numeric: 100, tolerance_value: 0.5 };
  assert.strictEqual(evaluateClaim(rel, 149).verdict, 'reproduced');
  assert.strictEqual(evaluateClaim(rel, 151).verdict, 'deviates');
  assert.strictEqual(evaluateClaim({ ...rel, claimed_value_numeric: 0 }, 5).verdict, 'not_computable',
    'a relative tolerance against zero is undefined, not a pass');
});

// -------------------------------------------------------------------------
// The registered JH2016 target.
// -------------------------------------------------------------------------

test('E1.20: JH2016 is registered with pre-registered bands and a checkable record', () => {
  const target = load('config', 'replication', 'jh2016.json');

  assert.strictEqual(target.identifier, '10.2196/jmir.4033');
  assert.strictEqual(target.claims.length, 2);

  // The pre-registration record must name a real commit, so "the band predates
  // the verdict" is verifiable rather than asserted.
  assert.match(target._pre_registration.bands_proposed_in_commit, /^[0-9a-f]{40}$/);

  const pearsonClaim = target.claims.find((c: any) => c.claim_key === 'harm_index_vs_reference_pearson');
  assert.strictEqual(pearsonClaim.statistic, 'pearson',
    'the statistic is explicit in the data, not implied by the tolerance kind');
  assert.strictEqual(pearsonClaim.tolerance_value, 0.70);

  // Band 3 is absent on purpose, and the file says why.
  assert.ok(target._band_3_deliberately_absent?.reason?.length > 0);
  assert.ok(!target.claims.some((c: any) => c.claim_key.includes('point_value')));
});

test('E1.20: the registered Pearson claim matches what the paper actually reports', () => {
  const target = load('config', 'replication', 'jh2016.json');
  const paper = load('fixtures', 'jh2016', 'paper_reported.json');
  const claim = target.claims.find((c: any) => c.claim_key === 'harm_index_vs_reference_pearson');

  // Guards the correction that mattered: the paper's prose says "ranking", but
  // the number is Pearson. Registering it as a rank correlation would score
  // the paper's own data at 0.57 and record 'deviates'.
  const subs = [...paper.substances].sort((a: any, b: any) => a.canonical.localeCompare(b.canonical));
  const results: AnalysisResultValue[] = subs.map((s: any) => ({
    entityId: s.canonical, metricKey: 'Hi', valueNumeric: s.Hi_percent, unit: '%', isMissing: false }));
  const scores = Object.fromEntries(subs.map((s: any) => [s.canonical, s.nutt_2010_harm_score]));

  const p = observedHiVsReference(results, scores, 'pearson');
  const sp = observedHiVsReference(results, scores, 'spearman');

  assert.ok(Math.abs(p.value! - claim.claimed_value_numeric) < 0.001);
  assert.ok(Math.abs(p.value! * 100 - paper.reported_statistics.correlation_coefficient_percent) < 0.15);
  assert.ok(Math.abs(sp.value! * 100 - 81.6) > 10,
    'Spearman must NOT match — this is why the claim is registered as Pearson');

  // And the same data must clear the registered band.
  assert.strictEqual(evaluateClaim(claim, p.value).verdict, 'reproduced');
  assert.strictEqual(evaluateClaim({ ...claim, tolerance_kind: 'rank_correlation_floor' }, sp.value).verdict,
    'deviates', 'registering it as a rank correlation would fail against the paper itself');
});

test('E1.20: a missing Hi reduces n rather than being scored as zero', () => {
  const results: AnalysisResultValue[] = [
    { entityId: 'a', metricKey: 'Hi', valueNumeric: 10, unit: '%', isMissing: false },
    { entityId: 'b', metricKey: 'Hi', valueNumeric: 20, unit: '%', isMissing: false },
    { entityId: 'c', metricKey: 'Hi', valueNumeric: null, unit: '%', isMissing: true },
  ];
  const obs = observedHiVsReference(results, { a: 1, b: 2, c: 3 }, 'pearson');
  assert.strictEqual(obs.n, 2, 'the missing substance is excluded from the pairing, not zeroed');

  // With too few pairs the result is not computable, never a fabricated value.
  const tooFew = observedHiVsReference([results[0]], { a: 1 }, 'pearson');
  assert.strictEqual(tooFew.value, null);
  assert.strictEqual(evaluateClaim(floorClaim, tooFew.value).verdict, 'not_computable');
});

test('E1.20: the ranking claim compares against the published Pi ordering', () => {
  const published = { alcohol: 100, cannabis: 15.2, cocaine: 15.1, heroin: 12.0 };

  const same: AnalysisResultValue[] = Object.entries(published).map(([entityId, v]) =>
    ({ entityId, metricKey: 'Pi', valueNumeric: v, unit: '%', isMissing: false }));
  assert.strictEqual(observedPiRankingStability(same, published).value, 1);

  const reversed: AnalysisResultValue[] = Object.entries(published).map(([entityId, v], i, arr) =>
    ({ entityId, metricKey: 'Pi', valueNumeric: arr[arr.length - 1 - i][1], unit: '%', isMissing: false }));
  assert.strictEqual(observedPiRankingStability(reversed, published).value, -1);
});

// -------------------------------------------------------------------------
// The self-check / independent-attempt distinction.
// -------------------------------------------------------------------------

test('E1.20: a self-check states plainly that it is not evidence the finding holds today', () => {
  const meaning = ATTEMPT_KIND_MEANING.pipeline_self_check;
  assert.match(meaning, /NOT evidence/);
  assert.match(meaning, /paper's own published counts/);

  assert.notStrictEqual(ATTEMPT_KIND_MEANING.independent_attempt, meaning,
    'the two kinds must not carry the same caveat');
});
