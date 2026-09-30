import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluatePaperComparison } from '../../backend/watchdog_api/services/paper_comparisons';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';
import type { AnalysisResultValue } from '../../backend/watchdog_api/domain/method_spec';

// These values exercise software semantics only, never empirical or clinical validity.
const fixture = JSON.parse(readFileSync('fixtures/research_comparison/claim.json', 'utf8'));
const scalar = (overrides: Partial<AnalysisResultValue> = {}): AnalysisResultValue => ({ metricKey: 'pearson', valueNumeric: 1, unit: 'dimensionless', isMissing: false, ...overrides });
const claim = (overrides: Record<string, unknown> = {}) => ({ ...structuredClone(fixture), ...overrides });

test('paper comparison core: inclusive absolute and relative arithmetic retains exact scalar and unit', () => {
  const exact = evaluatePaperComparison(claim(), [scalar()]);
  assert.equal(exact.verdict, 'reproduced');
  assert.equal(exact.observedValue, 1); assert.equal(exact.observedUnit, 'dimensionless');
  assert.equal(exact.deviation, 0); assert.equal(exact.withinTolerance, true);
  const tolerance = { kind: 'absolute', value: 0.25, rationale: 'Binary-exact software boundary.' };
  assert.equal(evaluatePaperComparison(claim({ tolerance }), [scalar({ valueNumeric: 0.75 })]).verdict, 'reproduced');
  assert.equal(evaluatePaperComparison(claim({ tolerance }), [scalar({ valueNumeric: 0.5 })]).verdict, 'deviates');
  const relative = claim({ tolerance: { ...tolerance, kind: 'relative' } });
  assert.equal(evaluatePaperComparison(relative, [scalar({ valueNumeric: 0.75 })]).deviation, -0.25);
  assert.equal(evaluatePaperComparison(relative, [scalar({ valueNumeric: 0.75 })]).verdict, 'reproduced');
});

test('paper comparison core: missing scalar and absent expected value are explicit, never zero', () => {
  for (const results of [[], [scalar({ valueNumeric: null, isMissing: true })], [scalar({ isMissing: true })]]) {
    const actual = evaluatePaperComparison(claim(), results);
    assert.equal(actual.verdict, 'not_computable'); assert.equal(actual.withinTolerance, null);
  }
  assert.equal(evaluatePaperComparison(claim({ expectedValue: null }), [scalar()]).verdict, 'method_unclear');
  assert.equal(evaluatePaperComparison(claim({ expectedValue: null, tolerance: { ...fixture.tolerance, kind: 'relative' } }), [scalar()]).verdict, 'not_computable');
  assert.equal(evaluatePaperComparison(claim({ expectedValue: 0, tolerance: { ...fixture.tolerance, kind: 'relative' } }), [scalar({ valueNumeric: 0 })]).verdict, 'not_computable');
});

test('paper comparison core: declared tolerances never assert preregistration after prior exposure', () => {
  for (const kind of ['absolute', 'relative'] as const) {
    for (const valueNumeric of [1, 0.5]) {
      const result = evaluatePaperComparison(claim({
        rationale: 'A revised comparison after observing the first result.',
        tolerance: { kind, value: 0.1, rationale: 'Tolerance chosen after prior exposure.' },
      }), [scalar({ valueNumeric })]);
      assert.equal(result.verdict, valueNumeric === 1 ? 'reproduced' : 'deviates');
      assert.match(result.rationale, /declared tolerance/);
      assert.doesNotMatch(result.rationale, /pre[- ]?register/i);
    }
  }
});

test('paper comparison core: exact metric, cardinality and scalar shape block ambiguous selection', () => {
  assert.equal(evaluatePaperComparison(claim(), [scalar({ metricKey: 'pearson.extra' })]).verdict, 'not_computable');
  assert.equal(evaluatePaperComparison(claim(), [scalar(), scalar()]).verdict, 'method_unclear');
  assert.equal(evaluatePaperComparison(claim(), [scalar({ entityId: 'row-1' })]).verdict, 'method_unclear');
  const unique = evaluatePaperComparison(claim(), [scalar({ metricKey: 'spearman', valueNumeric: -1 }), scalar()]);
  assert.equal(unique.observedValue, 1); assert.equal(unique.verdict, 'reproduced');
});

test('paper comparison core: units are required and never silently converted', () => {
  for (const unit of [undefined, 'percent', 'fraction', 'index']) {
    const result = evaluatePaperComparison(claim(), [scalar({ unit })]);
    assert.equal(result.verdict, 'method_unclear'); assert.equal(result.withinTolerance, null);
  }
  assert.equal(evaluatePaperComparison(claim({ unit: null }), [scalar()]).verdict, 'method_unclear');
  // Equal but invalid correlation units still cannot claim dimensionless agreement.
  assert.equal(evaluatePaperComparison(claim({ unit: 'percent' }), [scalar({ unit: 'percent' })]).verdict, 'method_unclear');
  const describe = claim({ statistic: 'describe.mean', unit: 'index', expectedValue: 25 });
  assert.equal(evaluatePaperComparison(describe, [scalar({ metricKey: 'describe.mean', unit: 'index', valueNumeric: 25 })]).verdict, 'reproduced');
});

test('paper comparison core: nonfinite input and unsupported/count selectors reject before canonical hashing', () => {
  for (const n of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => evaluatePaperComparison(claim({ expectedValue: n }), [scalar()]));
    assert.throws(() => evaluatePaperComparison(claim({ tolerance: { ...fixture.tolerance, value: n } }), [scalar()]));
    assert.throws(() => evaluatePaperComparison(claim(), [scalar({ valueNumeric: n })]));
  }
  assert.throws(() => evaluatePaperComparison(claim({ tolerance: { ...fixture.tolerance, value: -1 } }), [scalar()]));
  assert.throws(() => evaluatePaperComparison(claim({ expectedValue: -Number.MAX_VALUE }), [scalar({ valueNumeric: Number.MAX_VALUE })]), /overflow|finite/i);
  for (const statistic of ['describe.count', 'describe.valid_count', 'describe.missing_count', 'unknown']) {
    assert.throws(() => evaluatePaperComparison(claim({ statistic }), [scalar()]));
  }
});

test('paper comparison core: ambiguity takes precedence consistently and evaluation is deterministic', () => {
  const results = [scalar({ isMissing: true, unit: undefined }), scalar({ valueNumeric: null, isMissing: true })];
  const first = evaluatePaperComparison(claim(), results);
  assert.equal(first.verdict, 'method_unclear');
  assert.equal(canonicalHash(first), canonicalHash(evaluatePaperComparison(claim(), structuredClone(results))));
  assert.ok(first.reason); assert.ok(first.rationale);
});
