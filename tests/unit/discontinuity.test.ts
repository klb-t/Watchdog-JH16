import { test } from 'node:test';
import * as assert from 'node:assert';
import {
  detectDiscontinuities, annotateWithDiscontinuities, seriesKeyOf,
} from '../../backend/watchdog_api/services/discontinuity';
import { Observation } from '../../backend/watchdog_api/domain/observation';

let clock = 0;
function obs(over: Partial<Observation> = {}): Observation {
  clock++;
  return {
    seriesId: 's1', entityId: 'mephedrone', queryRole: 'popularity',
    queryText: '"mephedrone"', language: 'en-GB', queryExpansionMode: 'STRICT_CANONICAL',
    retrievedAt: `2026-08-19T10:${String(clock).padStart(2, '0')}:00.000Z`,
    sourceId: 'serp_result_count', sourceAdapterVersion: '1.0.0', providerId: 'serpapi',
    isMissing: false, numericValue: 100, qualityFlags: [],
    ...over,
  } as Observation;
}
const reset = () => { clock = 0; };

// -------------------------------------------------------------------------
// E3.3 — a vendor swap mid-series is detected; a stable series is not flagged.
// -------------------------------------------------------------------------

test('E3.3: a provider change mid-series is flagged, with both sides named', () => {
  reset();
  const r = detectDiscontinuities([
    obs(), obs(), obs({ providerId: 'serper' }), obs({ providerId: 'serper' }),
  ]);

  assert.deepStrictEqual(r.flags, ['PROVIDER_DISCONTINUITY']);
  assert.strictEqual(r.records.length, 1, 'one transition, not one per subsequent point');
  assert.strictEqual(r.records[0].from, 'serpapi');
  assert.strictEqual(r.records[0].to, 'serper');
  assert.strictEqual(r.records[0].attribute, 'provider_id');
  assert.match(r.records[0].detail, /different counts for the same query/);
});

test('E3.3: a single-provider series raises nothing', () => {
  reset();
  const r = detectDiscontinuities([obs(), obs(), obs()]);
  assert.deepStrictEqual(r.records, []);
  assert.deepStrictEqual(r.flags, []);
  assert.strictEqual(r.coverage['s1'], 1);
});

test('E3.3: an adapter version change is an instrument change even with one vendor', () => {
  reset();
  const r = detectDiscontinuities([obs(), obs({ sourceAdapterVersion: '2.0.0' })]);
  assert.deepStrictEqual(r.flags, ['PROVIDER_DISCONTINUITY']);
  assert.strictEqual(r.records[0].attribute, 'source_adapter_version');
});

// -------------------------------------------------------------------------
// D15 — the rest of the query plan's identity, kept separate.
// -------------------------------------------------------------------------

test('E3.3: language and expansion-mode changes flag separately from a vendor change', () => {
  reset();
  const lang = detectDiscontinuities([obs(), obs({ language: 'nl-NL' })]);
  assert.deepStrictEqual(lang.flags, ['QUERY_PLAN_DISCONTINUITY']);

  reset();
  const mode = detectDiscontinuities([obs(), obs({ queryExpansionMode: 'EXPERIMENTAL_SLANG_EXPANSION' })]);
  assert.deepStrictEqual(mode.flags, ['QUERY_PLAN_DISCONTINUITY']);
  assert.match(mode.records[0].detail, /different measurement plan/);

  reset();
  const both = detectDiscontinuities([obs(), obs({ providerId: 'serper', language: 'nl-NL' })]);
  assert.deepStrictEqual([...both.flags].sort(),
    ['PROVIDER_DISCONTINUITY', 'QUERY_PLAN_DISCONTINUITY'],
    'the remedies differ, so the flags must not be collapsed into one');
});

// -------------------------------------------------------------------------
// Unknown is neither a change nor continuity.
// -------------------------------------------------------------------------

test('E3.3: unknown plan data is excluded from the check and reported as reduced coverage', () => {
  reset();
  const r = detectDiscontinuities([
    obs({ language: 'unknown', queryExpansionMode: 'unknown' }),
    obs(),
  ]);

  assert.deepStrictEqual(r.records, [], 'no evidence of change means no flag');
  assert.ok(r.coverage['s1'] < 1,
    'and no evidence of continuity either — a clean result over unknown rows must not look clean');
  assert.strictEqual(r.coverage['s1'], 0.5, '2 of 4 watched attributes were comparable');
});

test('E3.3: a one-point series is fully covered, not zero-covered', () => {
  reset();
  assert.strictEqual(detectDiscontinuities([obs()]).coverage['s1'], 1);
});

// -------------------------------------------------------------------------
// Missing observations are part of the series.
// -------------------------------------------------------------------------

test('E3.3: a vendor swap during an outage is still detected', () => {
  reset();
  const r = detectDiscontinuities([
    obs(),
    obs({ isMissing: true, numericValue: null, missingReason: 'RATE_LIMITED' } as Partial<Observation>),
    obs({ providerId: 'serper' }),
  ]);
  assert.deepStrictEqual(r.flags, ['PROVIDER_DISCONTINUITY'],
    'a present-values-only check would miss exactly this case');
});

// -------------------------------------------------------------------------
// Series isolation, annotation, determinism.
// -------------------------------------------------------------------------

test('E3.3: two series with different providers are not a discontinuity', () => {
  reset();
  const r = detectDiscontinuities([
    obs({ seriesId: 'a' }), obs({ seriesId: 'a' }),
    obs({ seriesId: 'b', providerId: 'serper' }), obs({ seriesId: 'b', providerId: 'serper' }),
  ]);
  assert.deepStrictEqual(r.records, [],
    'different series may legitimately use different vendors; only a change within one is a break');
});

test('E3.3: observations without a series id fall back to entity and role', () => {
  reset();
  const o = obs({ seriesId: '' });
  assert.strictEqual(seriesKeyOf(o), 'mephedrone::popularity');
  const r = detectDiscontinuities([o, obs({ seriesId: '', providerId: 'serper' })]);
  assert.strictEqual(r.records.length, 1);
});

test('E3.3: both sides of a transition are annotated, not only the new one', () => {
  reset();
  const input = [obs(), obs({ providerId: 'serper' }), obs({ seriesId: 'other' })];
  const annotated = annotateWithDiscontinuities(input, detectDiscontinuities(input));

  assert.ok(annotated[0].qualityFlags.includes('PROVIDER_DISCONTINUITY'),
    'the earlier points came from a different instrument, and that is the half a reader trusts');
  assert.ok(annotated[1].qualityFlags.includes('PROVIDER_DISCONTINUITY'));
  assert.ok(!annotated[2].qualityFlags.includes('PROVIDER_DISCONTINUITY'),
    'an unaffected series must not be marked');

  // Annotation preserves the measurement itself.
  assert.strictEqual(annotated[0].numericValue, 100);
  assert.strictEqual(annotated[0].isMissing, false);
});

test('E3.3: annotation does not duplicate a flag that is already present', () => {
  reset();
  const input = [obs({ qualityFlags: ['PROVIDER_DISCONTINUITY'] }), obs({ providerId: 'serper' })];
  const annotated = annotateWithDiscontinuities(input, detectDiscontinuities(input));
  assert.strictEqual(
    annotated[0].qualityFlags.filter(f => f === 'PROVIDER_DISCONTINUITY').length, 1);
});

test('E3.3: the report is deterministic under input reordering and timestamp collision', () => {
  reset();
  const a = obs({ retrievedAt: '2026-08-19T10:00:00.000Z' });
  const b = obs({ retrievedAt: '2026-08-19T10:00:00.000Z', providerId: 'serper' });
  const c = obs({ retrievedAt: '2026-08-19T10:00:01.000Z', providerId: 'serper' });

  const first = detectDiscontinuities([a, b, c]);
  const second = detectDiscontinuities([c, a, b]);
  assert.deepStrictEqual(JSON.stringify(first), JSON.stringify(second),
    'a batch of fetches inside one millisecond must not shuffle the record between runs');
});
