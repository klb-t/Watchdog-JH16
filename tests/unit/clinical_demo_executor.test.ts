import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalHash, canonicalizeJson } from '../../backend/watchdog_api/domain/canonical';
import { executeClinicalDemo, readClinicalDemoArchive, replayClinicalDemoArchive } from '../../backend/watchdog_api/clinical_demo/executor';
import { buildExecutorManifest, CLINICAL_EXECUTOR_FILES, validateExecutorManifest } from '../../backend/watchdog_api/clinical_demo/executor_manifest';
import { known, missing, testClinicalCase, testClinicalObservation, testClinicalRule, testClinicalRuleReview,
  testClinicalSource, testClinicalSourceState } from '../helpers/clinical_demo';
import type { ClinicalCase, ClinicalRule, ClinicalRuleTrace } from '../../shared/clinical_demo';

const sourceBytes = () => Object.fromEntries(CLINICAL_EXECUTOR_FILES.map(path => [path, readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')]));
const manifest = () => buildExecutorManifest(sourceBytes(), process.version);
const input = (caseValue: ClinicalCase = testClinicalCase(), rule: ClinicalRule = testClinicalRule()) => ({
  case: caseValue, rules: [rule], sources: [testClinicalSourceState()], reviews: [testClinicalRuleReview(rule)], executorManifest: manifest(),
});
const run = (caseValue = testClinicalCase(), rule = testClinicalRule()) => executeClinicalDemo(input(caseValue, rule));
const first = (caseValue = testClinicalCase(), rule = testClinicalRule()) => run(caseValue, rule).trace.rules[0];
const codes = (trace: ClinicalRuleTrace) => [...trace.gaps, ...trace.dependencies.flatMap(dependency => dependency.gaps)].map(gap => gap.code);
const access = (request: ReturnType<typeof input>) => ({ caseHash: canonicalHash(request.case), caseReadable: true,
  readableReferenceHashes: request.sources.map(source => canonicalHash(source.document)), readableRuleHashes: request.rules.map(canonicalHash) });
const assertBlocked = (trace: ClinicalRuleTrace, reason?: string) => {
  assert.equal(trace.execution, 'blocked'); assert.equal(trace.outcome, 'undetermined');
  assert.ok(!trace.operations.some(operation => operation.operation === 'scalar_comparison'));
  if (reason) assert.ok(codes(trace).includes(reason), `Missing ${reason}; got ${codes(trace).join(', ')}`);
};
function reorderKeys(value: any): any {
  if (Array.isArray(value)) return value.map(reorderKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).reverse().map(key => [key, reorderKeys(value[key])]));
  return value;
}

// These are invented fixture comparisons, never medical efficacy/diagnosis tests.
test('E6.4b deterministic canonical bytes, exact replay, and explicit software-only scope', () => {
  const request = input(), before = canonicalizeJson(request);
  const a = executeClinicalDemo(request), b = executeClinicalDemo(reorderKeys(request));
  assert.equal(canonicalizeJson(a), canonicalizeJson(b));
  assert.equal(canonicalizeJson(request), before);
  assert.equal(a.traceHash, canonicalHash(a.trace));
  assert.equal(a.trace.caseHash, canonicalHash(request.case));
  assert.equal(a.trace.rules[0].ruleHash, canonicalHash(request.rules[0]));
  assert.deepEqual(a.trace.rules[0].references, request.rules[0].references);
  assert.equal(a.trace.executorHash, request.executorManifest.hash);
  assert.equal(a.trace.purpose, 'software-demonstration');
  assert.ok(a.trace.limitations.length > 0);
  assert.equal(a.trace.rules[0].outcome, 'supported');
  assert.ok(a.trace.rules[0].operations.length > 0);
  const replay = replayClinicalDemoArchive(a.archive, access(request), request.executorManifest);
  assert.equal(replay.mode, 'historical-verification');
  assert.equal(canonicalizeJson(replay.trace), canonicalizeJson(a.trace));
  assert.equal(replay.traceHash, a.traceHash);
});

test('E6.4b manifest hashes actual declared source bytes and rejects missing/tampered identity', () => {
  const bytes = sourceBytes(), original = buildExecutorManifest(bytes, process.version);
  for (const file of original.files) assert.equal(file.sha256, createHash('sha256').update(bytes[file.path]).digest('hex'));
  assert.deepEqual(validateExecutorManifest(original), original);
  const changedBytes = { ...bytes, [CLINICAL_EXECUTOR_FILES[0]]: `${bytes[CLINICAL_EXECUTOR_FILES[0]]}\n// fixture change\n` };
  assert.notEqual(buildExecutorManifest(changedBytes, process.version).hash, original.hash);
  const incomplete = { ...bytes }; delete incomplete[CLINICAL_EXECUTOR_FILES[0]];
  assert.throws(() => buildExecutorManifest(incomplete, process.version));
  assert.throws(() => validateExecutorManifest({ ...original, hash: '0'.repeat(64) }));
  const duplicate = structuredClone(original); duplicate.files[0] = { ...duplicate.files[1] };
  assert.throws(() => validateExecutorManifest(duplicate));
});

test('E6.4b case, rule, source and executor changes independently change pinned hashes', () => {
  const originalRequest = input(), original = executeClinicalDemo(originalRequest);
  const changedCase = testClinicalCase(); changedCase.observations[0].value = known(3);
  const changed = run(changedCase);
  assert.notEqual(changed.trace.caseHash, original.trace.caseHash); assert.notEqual(changed.traceHash, original.traceHash);
  const changedRule = testClinicalRule(); changedRule.predicate.value = 3;
  const changedRuleResult = run(testClinicalCase(), changedRule);
  assert.notEqual(changedRuleResult.trace.rules[0].ruleHash, original.trace.rules[0].ruleHash);
  const source = testClinicalSource({ revision: 2, statement: 'Revised invented software fixture source.' });
  const sourceRequest = input(); sourceRequest.sources = [testClinicalSourceState({ document: source })];
  sourceRequest.rules[0].references[0].contentHash = canonicalHash(source);
  sourceRequest.reviews = [testClinicalRuleReview(sourceRequest.rules[0])];
  const changedSource = executeClinicalDemo(sourceRequest);
  assert.notEqual(changedSource.trace.rules[0].references[0].contentHash, original.trace.rules[0].references[0].contentHash);
  assert.notEqual(changedSource.traceHash, original.traceHash);
  const bytes = sourceBytes(); bytes[CLINICAL_EXECUTOR_FILES[0]] += '\n// changed fixture build\n';
  const executorRequest = input(); executorRequest.executorManifest = buildExecutorManifest(bytes, process.version);
  assert.notEqual(executeClinicalDemo(executorRequest).trace.executorHash, original.trace.executorHash);
  assert.throws(() => replayClinicalDemoArchive(original.archive, access(originalRequest), executorRequest.executorManifest));
});

for (const [field, reason] of [['value', 'missing_value'], ['unit', 'missing_unit'], ['eventTime', 'missing_event_time'], ['measurementTime', 'missing_measurement_time']] as const) {
  test(`E6.4b missing ${field} stays undetermined with explicit cause`, () => {
    const fixture = testClinicalCase(); fixture.observations[0][field] = missing('not_recorded');
    const trace = first(fixture); assert.equal(trace.applicability, 'applicable'); assertBlocked(trace, reason);
  });
}
test('E6.4b all missing dependencies are retained together, including reference clock', () => {
  const fixture = testClinicalCase({ referenceTime: missing() });
  fixture.observations[0] = testClinicalObservation({ value: missing(), unit: missing(), eventTime: missing(), measurementTime: missing() });
  const trace = first(fixture); assertBlocked(trace);
  for (const code of ['missing_value', 'missing_unit', 'missing_event_time', 'missing_measurement_time', 'missing_reference_time'])
    assert.ok(codes(trace).includes(code), code);
});
test('E6.4b an unknown unit is never silently converted', () => {
  const fixture = testClinicalCase(); fixture.observations[0].unit = known('fixture:unknown-unit');
  assertBlocked(first(fixture), 'unit_mismatch');
});
test('E6.4b reference time is required for a bounded event window', () => {
  assertBlocked(first(testClinicalCase({ referenceTime: missing() })), 'missing_reference_time');
});
test('E6.4b time bounds and mode constraints are explicit dependencies', () => {
  const fixture = testClinicalCase(); fixture.observations[0].eventTime = known('2026-01-01T00:00:02Z');
  assertBlocked(first(fixture), 'event_window_mismatch');
  fixture.observations[0].eventTime = known('2026-01-01T00:00:01Z');
  assert.equal(first(fixture).outcome, 'supported');
  fixture.observations[0].mode = 'reported';
  assertBlocked(first(fixture), 'observation_mode_mismatch');
});
for (const dimension of ['species', 'population', 'setting'] as const) {
  test(`E6.4b mismatched or missing ${dimension} never contradicts a hypothesis`, () => {
    const fixture = testClinicalCase(); fixture.context[dimension] = known('fixture:other');
    const mismatch = first(fixture); assertBlocked(mismatch); assert.equal(mismatch.applicability, 'inapplicable');
    fixture.context[dimension] = missing();
    const unknown = first(fixture); assertBlocked(unknown); assert.equal(unknown.applicability, 'undetermined');
  });
}
test('E6.4b every declared dependency must be resolved, even when not the predicate operand', () => {
  const rule = testClinicalRule();
  rule.dependencies.push({ ...rule.dependencies[0], id: 'fixture:dependency-beta', quantityId: 'fixture:q-beta' });
  const trace = first(testClinicalCase(), rule);
  assertBlocked(trace, 'missing_observation'); assert.equal(trace.dependencies.length, 2);
});

test('E6.4b active conflicts remain explicit even for an ID-pinned observation', () => {
  const fixture = testClinicalCase(), original = fixture.observations[0];
  fixture.observations.push(testClinicalObservation({ id: 'fixture:observation-conflicting', value: known(-2), contradicts: [original.id] }));
  const rule = testClinicalRule(); rule.dependencies[0].observationId = original.id;
  const before = canonicalizeJson(fixture), result = run(fixture, rule);
  assertBlocked(result.trace.rules[0], 'observation_conflict');
  assert.equal(canonicalizeJson(fixture), before);
  assert.equal(fixture.observations.length, 2);
});
test('E6.4b multiple active unpinned observations never use an implicit latest-wins rule', () => {
  const fixture = testClinicalCase(); fixture.observations.push(testClinicalObservation({ id: 'fixture:observation-newer', measurementTime: known('2026-01-01T00:00:02Z') }));
  assertBlocked(first(fixture), 'observation_ambiguous');
});
test('E6.4b superseded input is rejected while both original and replacement survive archive/replay', () => {
  const fixture = testClinicalCase(), original = fixture.observations[0];
  fixture.observations.push(testClinicalObservation({ id: 'fixture:observation-replacement', supersedes: original.id, value: known(4) }));
  const before = canonicalizeJson(fixture), rule = testClinicalRule(); rule.dependencies[0].observationId = original.id;
  const result = run(fixture, rule); assertBlocked(result.trace.rules[0], 'observation_superseded');
  assert.equal(canonicalizeJson(fixture), before);
  const serialized = canonicalizeJson(result.archive);
  assert.ok(serialized.includes(original.id)); assert.ok(serialized.includes('fixture:observation-replacement'));
  assert.equal(first(fixture).outcome, 'supported');
});
test('E6.4b false comparison preserves every hypothesis and all mixture/unknown/alternative records', () => {
  const fixture = testClinicalCase(), before = canonicalizeJson(fixture); fixture.observations[0].value = known(0);
  const intended = canonicalizeJson(fixture), result = run(fixture);
  assert.equal(result.trace.rules[0].outcome, 'contradicted'); assert.equal(result.trace.rules[0].execution, 'evaluated');
  assert.equal(canonicalizeJson(fixture), intended); assert.notEqual(intended, before);
  assert.deepEqual(fixture.hypotheses.map(h => h.kind), ['substance', 'class', 'mixture', 'unknown_composition', 'comorbidity', 'non_toxicological']);
});

test('E6.4b approved source cannot substitute for a separate exact-hash rule review', () => {
  const request = input(); request.reviews = [];
  assertBlocked(executeClinicalDemo(request).trace.rules[0], 'rule_unapproved');
  request.reviews = [testClinicalRuleReview(request.rules[0])]; request.rules[0].predicate.value = 9;
  assertBlocked(executeClinicalDemo(request).trace.rules[0], 'rule_review_hash_mismatch');
});
for (const status of ['revoked', 'unreviewed'] as const) {
  test(`E6.4b ${status} rule or reference blocks new execution without rewriting history`, () => {
    const request = input(), historical = executeClinicalDemo(request), before = canonicalizeJson(historical);
    request.reviews[0].status = status;
    assertBlocked(executeClinicalDemo(request).trace.rules[0]);
    request.reviews[0].status = 'approved'; request.sources[0].status = status;
    assertBlocked(executeClinicalDemo(request).trace.rules[0]);
    assert.equal(canonicalizeJson(historical), before);
    assert.equal(replayClinicalDemoArchive(historical.archive, access(request), request.executorManifest).traceHash, historical.traceHash);
  });
}
test('E6.4b changed, missing, unapproved or unreadable reference blocks new execution', () => {
  for (const mutate of [
    (request: ReturnType<typeof input>) => { request.sources = []; },
    (request: ReturnType<typeof input>) => { request.sources[0].document.statement = 'Altered invented reference, with stale content hash.'; },
    (request: ReturnType<typeof input>) => { request.sources[0].approvedHash = null; },
    (request: ReturnType<typeof input>) => { request.sources[0].readable = false; },
    (request: ReturnType<typeof input>) => {
      request.sources[0] = testClinicalSourceState({ document: testClinicalSource({ revision: 2 }) });
    },
  ]) {
    const request = input(); mutate(request); assertBlocked(executeClinicalDemo(request).trace.rules[0]);
  }
});
test('E6.4b observation provenance remains a readable intact source even outside rule citations', () => {
  const request = input(), source = testClinicalSourceState({ document: testClinicalSource({ id: 'fixture:observation-source' }) });
  request.case.sourcePins.push({ referenceId: source.document.id, contentHash: canonicalHash(source.document) }); request.case.observations[0].sourceId = source.document.id;
  request.sources.push(source);
  assert.equal(executeClinicalDemo(request).trace.rules[0].outcome, 'supported');
  source.readable = false; assertBlocked(executeClinicalDemo(request).trace.rules[0], 'source_unreadable');
  source.readable = true; source.document.statement = 'Changed observation provenance without updating its hash.';
  assertBlocked(executeClinicalDemo(request).trace.rules[0], 'source_changed');
});

test('E6.4b reapproved observation source cannot silently replace the case-time source pin', () => {
  const request = input();
  const originalSource = testClinicalSourceState({ document: testClinicalSource({ id: 'fixture:observation-source' }) });
  request.case.sourcePins.push({ referenceId: originalSource.document.id, contentHash: canonicalHash(originalSource.document) });
  request.case.observations[0].sourceId = originalSource.document.id;
  request.sources.push(originalSource);
  const originalCaseHash = canonicalHash(request.case), original = executeClinicalDemo(request);
  assert.equal(original.trace.rules[0].outcome, 'supported');
  const changedSource = testClinicalSourceState({ document: {
    ...originalSource.document, revision: 2, statement: 'Revised and separately reapproved invented observation source.',
  } });
  request.sources[1] = changedSource;
  const blocked = executeClinicalDemo(request);
  assertBlocked(blocked.trace.rules[0], 'source_changed');
  assert.equal(blocked.trace.caseHash, originalCaseHash);
  assert.equal(canonicalHash(request.case), originalCaseHash);
  request.case = { ...request.case, revision: 2, previousCaseHash: originalCaseHash,
    sourcePins: request.case.sourcePins.map(pin => pin.referenceId === changedSource.document.id
      ? { ...pin, contentHash: canonicalHash(changedSource.document) } : pin),
  };
  const revised = executeClinicalDemo(request);
  assert.equal(revised.trace.rules[0].outcome, 'supported');
  assert.notEqual(revised.trace.caseHash, originalCaseHash);
  assert.equal(request.case.previousCaseHash, originalCaseHash);
  assert.equal(original.archive.input.case.sourcePins.find(pin => pin.referenceId === originalSource.document.id)?.contentHash,
    canonicalHash(originalSource.document));
});

test('E6.4b observation-only source revocation or missing exact approval blocks dependent computation', () => {
  for (const status of ['revoked', 'unreviewed', 'approved'] as const) {
    const request = input();
    const source = testClinicalSourceState({ document: testClinicalSource({ id: 'fixture:observation-source' }), status });
    if (status === 'approved') source.approvedHash = '0'.repeat(64);
    request.case.sourcePins.push({ referenceId: source.document.id, contentHash: canonicalHash(source.document) });
    request.case.observations[0].sourceId = source.document.id;
    request.sources.push(source);
    assertBlocked(executeClinicalDemo(request).trace.rules[0], 'source_unapproved');
  }
});

test('E6.4b revoked observation provenance makes the whole rule ineligible despite unrelated missing inputs', () => {
  const request = input();
  const source = testClinicalSourceState({ document: testClinicalSource({ id: 'fixture:observation-source' }), status: 'revoked' });
  request.case.sourcePins.push({ referenceId: source.document.id, contentHash: canonicalHash(source.document) });
  request.case.observations[0].sourceId = source.document.id;
  request.sources.push(source);
  request.rules[0].dependencies.push({ ...request.rules[0].dependencies[0], id: 'fixture:dependency-beta', quantityId: 'fixture:q-beta' });
  request.reviews = [testClinicalRuleReview(request.rules[0])];
  const blocked = executeClinicalDemo(request).trace.rules[0];
  assertBlocked(blocked, 'source_unapproved');
  assert.ok(codes(blocked).includes('missing_observation'));
  assert.equal(blocked.eligible, false);
  source.status = 'approved';
  const missingOnly = executeClinicalDemo(request).trace.rules[0];
  assertBlocked(missingOnly, 'missing_observation');
  assert.equal(missingOnly.eligible, true);
  const ordinaryMissing = testClinicalCase(); ordinaryMissing.observations[0].value = missing('not_measured');
  const valueGap = first(ordinaryMissing);
  assertBlocked(valueGap, 'missing_value');
  assert.equal(valueGap.eligible, true);
});

test('E6.4b historical read and replay require current case/source/rule rights', () => {
  const request = input(), result = executeClinicalDemo(request), readable = access(request);
  assert.equal(readClinicalDemoArchive(result.archive, readable).traceHash, result.traceHash);
  for (const restricted of [
    { ...readable, caseReadable: false }, { ...readable, caseHash: '0'.repeat(64) },
    { ...readable, readableReferenceHashes: [] }, { ...readable, readableRuleHashes: [] },
  ]) {
    assert.throws(() => readClinicalDemoArchive(result.archive, restricted));
    assert.throws(() => replayClinicalDemoArchive(result.archive, restricted, request.executorManifest));
  }
  const before = canonicalizeJson(result.archive), read = readClinicalDemoArchive(result.archive, readable);
  try { read.trace.limitations.push('External mutation attempt'); } catch { /* Frozen outputs are also valid. */ }
  assert.equal(canonicalizeJson(result.archive), before);
});
test('E6.4b corrupted archives and mismatched replay manifests are rejected', () => {
  const request = input(), result = executeClinicalDemo(request);
  const corrupt = structuredClone(result.archive) as any; corrupt.trace.rules[0].outcome = 'contradicted';
  assert.throws(() => readClinicalDemoArchive(corrupt, access(request)));
  assert.throws(() => replayClinicalDemoArchive(corrupt, access(request), request.executorManifest));
  const altered = structuredClone(request.executorManifest); altered.hash = '0'.repeat(64);
  assert.throws(() => replayClinicalDemoArchive(result.archive, access(request), altered));
});
test('E6.4b missing rules/edges and appearance never infer absent interaction or confirmed exposure', () => {
  const request = input(); request.rules = []; request.reviews = [];
  const before = canonicalizeJson(request.case), result = executeClinicalDemo(request);
  assert.deepEqual(result.trace.rules, []);
  assert.deepEqual([...result.trace.unresolvedHypothesisIds].sort(), request.case.hypotheses.map(h => h.id).sort());
  assert.equal(canonicalizeJson(request.case), before);
  assert.equal(request.case.exposures.find(e => e.id === 'fixture:exposure-mixture')?.certainty, 'possible');
  assert.equal(request.case.exposures.find(e => e.id === 'fixture:exposure-unknown')?.certainty, 'possible');
});
test('E6.4b rejects arbitrary case IDs, executable predicates and nonfinite inputs at its boundary', () => {
  for (const mutate of [
    (request: any) => { request.case.fixtureId = 'real-case'; },
    (request: any) => { request.case.purpose = 'clinical-care'; },
    (request: any) => { request.rules[0].predicate.operator = 'eval'; },
    (request: any) => { request.rules[0].predicate.value = Infinity; },
  ]) { const request = input(); mutate(request); assert.throws(() => executeClinicalDemo(request)); }
});
