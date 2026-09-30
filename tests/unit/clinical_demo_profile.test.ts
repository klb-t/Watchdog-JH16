import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLINICAL_DEMO_VERSION } from '../../shared/clinical_demo';
import { validateSyntheticTestProfile, type SyntheticTestProfile } from '../../shared/clinical_demo_profile';
import { selectClinicalMeasurements } from '../../shared/clinical_demo_selector';
import { executeClinicalDemo, type ClinicalExecutionInput } from '../../backend/watchdog_api/clinical_demo/executor';
import { buildExecutorManifest, CLINICAL_EXECUTOR_FILES } from '../../backend/watchdog_api/clinical_demo/executor_manifest';
import { canonicalHash, canonicalizeJson } from '../../backend/watchdog_api/domain/canonical';
import { known, missing, testClinicalCase, testClinicalCaseB, testClinicalObservation, testClinicalRule,
  testClinicalRuleReview, testClinicalSource, testClinicalSourceState } from '../helpers/clinical_demo';

const manifest = () => buildExecutorManifest(Object.fromEntries(CLINICAL_EXECUTOR_FILES.map(path =>
  [path, readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')])), process.version);
function input(): ClinicalExecutionInput {
  const rule = testClinicalRule();
  return { case: testClinicalCaseB(), rules: [rule], sources: [testClinicalSourceState()],
    reviews: [testClinicalRuleReview(rule)], executorManifest: manifest() };
}
function profile(): SyntheticTestProfile {
  return { schemaVersion: CLINICAL_DEMO_VERSION, purpose: 'software-demonstration', id: 'fixture:profile-a', revision: 1,
    tests: [{ id: 'fixture:test-alpha', quantityId: 'fixture:q-alpha', unit: 'fixture:u-alpha', available: true,
      allowedModes: ['measured'], applicability: { species: ['fixture:species-a'], population: ['fixture:population-a'], setting: ['fixture:setting-a'] },
      timing: { eventOffsetMs: 0, measurementOffsetMs: 1000 }, sourceIds: ['fixture:profile-source-a'],
      limitations: ['Invented availability; no order created.'] }] };
}
function review(request: ClinicalExecutionInput): void {
  request.reviews = request.rules.map(rule => testClinicalRuleReview(rule));
}
function withoutObservations(request: ClinicalExecutionInput): void {
  request.case.observations = [];
  for (const hypothesis of request.case.hypotheses) hypothesis.observationIds = [];
}
const gapCodes = (result: ReturnType<typeof selectClinicalMeasurements>) => result.gaps.map(gap => gap.code);

test('E6.5a exact missing-value dependency yields a source-linked synthetic proposal while retaining the original gap', () => {
  const request = input(), available = profile(), result = selectClinicalMeasurements(request, available);
  assert.equal(result.caseHash, canonicalHash(request.case));
  assert.equal(result.profileHash, canonicalHash(available));
  assert.equal(result.traceHash, executeClinicalDemo(request).traceHash);
  assert.equal(result.proposals.length, 1);
  const proposal = result.proposals[0], rule = request.rules[0];
  assert.equal(proposal.testId, available.tests[0].id);
  assert.equal(proposal.dependencyId, rule.dependencies[0].id);
  assert.equal(proposal.ruleId, rule.id);
  assert.equal(proposal.ruleHash, canonicalHash(rule));
  assert.deepEqual(proposal.references, rule.references);
  assert.deepEqual(proposal.profileSourceIds, available.tests[0].sourceIds);
  assert.ok(proposal.reason.length > 0);
  assert.ok(proposal.assumptions.length > 0);
  assert.ok(gapCodes(result).includes('missing_value'));
  assert.ok(result.limitations.length > 0);
});

test('E6.5a absent observations can yield proposals only for explicitly declared missing dependencies', () => {
  const request = input(); withoutObservations(request);
  const available = profile();
  available.tests.push({ ...structuredClone(available.tests[0]), id: 'fixture:unrelated-test', quantityId: 'fixture:unrelated-quantity' });
  const result = selectClinicalMeasurements(request, available);
  assert.deepEqual(result.proposals.map(item => item.testId), ['fixture:test-alpha']);
  assert.ok(gapCodes(result).includes('missing_observation'));
  request.rules = []; request.reviews = [];
  assert.deepEqual(selectClinicalMeasurements(request, available).proposals, []);
});

test('E6.5a changing test availability changes only profile/proposals, without changing case, trace or approvals', () => {
  const request = input(), before = canonicalizeJson(request), available = profile();
  const restricted = structuredClone(available); restricted.revision = 2; restricted.tests[0].available = false;
  const a = selectClinicalMeasurements(request, available), b = selectClinicalMeasurements(request, restricted);
  assert.equal(a.proposals.length, 1); assert.equal(b.proposals.length, 0);
  assert.notEqual(a.profileHash, b.profileHash);
  assert.equal(a.caseHash, b.caseHash); assert.equal(a.traceHash, b.traceHash);
  assert.equal(canonicalizeJson(request), before);
  assert.ok(gapCodes(b).includes('missing_value'));
});

test('E6.5a exact quantity, unit, mode, availability, applicability and prospective timing constrain candidate tests', () => {
  const mutations: ((value: SyntheticTestProfile) => void)[] = [
    value => { value.tests[0].available = false; },
    value => { value.tests[0].quantityId = 'fixture:wrong-quantity'; },
    value => { value.tests[0].unit = 'fixture:unknown-unit'; },
    value => { value.tests[0].allowedModes = ['reported']; },
    value => { value.tests[0].applicability.species = ['fixture:other-species']; },
    value => { value.tests[0].applicability.population = ['fixture:other-population']; },
    value => { value.tests[0].applicability.setting = ['fixture:other-setting']; },
    value => { value.tests[0].timing = { eventOffsetMs: 2000, measurementOffsetMs: 3000 }; },
  ];
  for (const mutate of mutations) {
    const available = profile(); mutate(available);
    const result = selectClinicalMeasurements(input(), available);
    assert.equal(result.proposals.length, 0, canonicalizeJson(available));
    assert.ok(gapCodes(result).includes('missing_value'));
  }
});

test('E6.5a a satisfied dependency or contradicted predicate creates no measurement request', () => {
  const request = input(); request.case = testClinicalCase();
  assert.deepEqual(selectClinicalMeasurements(request, profile()).proposals, []);
  request.case.observations[0].value = known(0);
  assert.equal(executeClinicalDemo(request).trace.rules[0].outcome, 'contradicted');
  assert.deepEqual(selectClinicalMeasurements(request, profile()).proposals, []);
});

test('E6.5a explicit not-applicable missingness is not treated as an unmeasured value', () => {
  const request = input();
  request.case.observations[0].value = missing('not_applicable');
  const result = selectClinicalMeasurements(request, profile());
  assert.deepEqual(result.proposals, []);
  assert.ok(gapCodes(result).includes('missing_value'));
  assert.ok(gapCodes(result).includes('value_not_applicable'));
  for (const reason of ['not_measured', 'not_recorded', 'unknown'] as const) {
    request.case.observations[0].value = missing(reason);
    assert.equal(selectClinicalMeasurements(request, profile()).proposals.length, 1, reason);
  }
});

test('E6.5a missing metadata, mismatched units and historical clocks never become fresh measurements', () => {
  const mutations: ((request: ClinicalExecutionInput) => void)[] = [
    request => { request.case.observations[0].unit = missing('unknown'); },
    request => { request.case.observations[0].eventTime = missing('not_recorded'); },
    request => { request.case.observations[0].measurementTime = missing('not_recorded'); },
    request => { request.case.referenceTime = missing('not_recorded'); },
    request => { request.case.observations[0].unit = known('fixture:other-unit'); },
    request => { request.case.observations[0].mode = 'reported'; },
    request => { request.case.observations[0].eventTime = known('2025-12-31T00:00:00Z'); },
  ];
  for (const mutate of mutations) {
    const request = input(); mutate(request);
    const result = selectClinicalMeasurements(request, profile());
    assert.deepEqual(result.proposals, []);
    const trace = executeClinicalDemo(request).trace;
    for (const gap of trace.rules[0].gaps) assert.ok(gapCodes(result).includes(gap.code), `lost ${gap.code}`);
  }
});

test('E6.5a historical-only windows and fixed observation identities cannot be repaired by a future test', () => {
  const historical = input(); withoutObservations(historical);
  historical.rules[0].dependencies[0].eventWindow = { minOffsetMs: -2000, maxOffsetMs: -1000 }; review(historical);
  assert.deepEqual(selectClinicalMeasurements(historical, profile()).proposals, []);
  const fixed = input(); fixed.rules[0].dependencies[0].observationId = fixed.case.observations[0].id; review(fixed);
  assert.deepEqual(selectClinicalMeasurements(fixed, profile()).proposals, []);
  withoutObservations(fixed);
  assert.deepEqual(selectClinicalMeasurements(fixed, profile()).proposals, []);
});

test('E6.5a unresolved conflicts and ambiguity block other otherwise missing inputs for the whole rule', () => {
  for (const conflict of [true, false]) {
    const request = input(); request.case = testClinicalCase();
    request.case.observations.push(testClinicalObservation({ id: 'fixture:conflicting-observation',
      contradicts: conflict ? [request.case.observations[0].id] : [] }));
    request.rules[0].dependencies.push({ ...request.rules[0].dependencies[0], id: 'fixture:dependency-beta', quantityId: 'fixture:q-beta' });
    review(request);
    const available = profile(); available.tests[0].quantityId = 'fixture:q-beta';
    const result = selectClinicalMeasurements(request, available);
    assert.deepEqual(result.proposals, []);
    assert.ok(gapCodes(result).includes('missing_observation'));
    assert.ok(gapCodes(result).includes(conflict ? 'observation_conflict' : 'observation_ambiguous'));
  }
});

test('E6.5a superseded observations remain gaps and cannot be silently replaced', () => {
  const request = input(), original = request.case.observations[0];
  request.case.observations.push(testClinicalObservation({ id: 'fixture:replacement', supersedes: original.id }));
  request.rules[0].dependencies[0].observationId = original.id; review(request);
  const result = selectClinicalMeasurements(request, profile());
  assert.deepEqual(result.proposals, []);
  assert.ok(gapCodes(result).includes('observation_superseded'));
});

test('E6.5a rule and source changes, revocation and unreadability are rechecked before selection', () => {
  const mutations: ((request: ClinicalExecutionInput) => void)[] = [
    request => { request.reviews[0].status = 'revoked'; },
    request => { request.reviews = []; },
    request => { request.rules[0].predicate.value = 17; },
    request => { request.sources[0].status = 'revoked'; },
    request => { request.sources[0].readable = false; },
    request => { request.sources[0].approvedHash = null; },
    request => { request.sources = []; },
    request => { request.sources[0] = testClinicalSourceState({ document: testClinicalSource({ revision: 2 }) }); },
    request => { request.case.context.species = known('fixture:other-species'); },
    request => { request.case.context.setting = missing('unknown'); },
  ];
  for (const mutate of mutations) {
    const request = input(), original = selectClinicalMeasurements(request, profile());
    assert.equal(original.proposals.length, 1);
    mutate(request);
    const result = selectClinicalMeasurements(request, profile());
    assert.deepEqual(result.proposals, []);
    assert.ok(result.gaps.length > 0);
    assert.notEqual(result.traceHash, original.traceHash);
  }
});

test('E6.5a observation-only provenance blocks selection even when unrelated input is missing', () => {
  const request = input(); request.case = testClinicalCase();
  const source = testClinicalSourceState({ document: testClinicalSource({ id: 'fixture:observation-source' }), status: 'revoked' });
  request.sources.push(source);
  request.case.sourcePins.push({ referenceId: source.document.id, contentHash: source.contentHash });
  request.case.observations[0].sourceId = source.document.id;
  request.rules[0].dependencies.push({ ...request.rules[0].dependencies[0], id: 'fixture:dependency-beta', quantityId: 'fixture:q-beta' }); review(request);
  const available = profile(); available.tests[0].quantityId = 'fixture:q-beta';
  const result = selectClinicalMeasurements(request, available);
  assert.deepEqual(result.proposals, []);
  assert.ok(gapCodes(result).includes('source_unapproved'));
  assert.ok(gapCodes(result).includes('missing_observation'));
});

test('E6.5a stale traces are not accepted as authority and every original trace gap is retained with rule identity', () => {
  const request = input(), old = executeClinicalDemo(request);
  // @ts-expect-error Exercise runtime rejection of stale trace data as execution input.
  assert.throws(() => selectClinicalMeasurements(old.trace, profile()));
  // @ts-expect-error An archive is deliberately not the current execution-input contract.
  assert.throws(() => selectClinicalMeasurements(old.archive, profile()));
  // @ts-expect-error Unknown trace fields must also fail at the runtime boundary.
  assert.throws(() => selectClinicalMeasurements({ ...request, trace: old.trace }, profile()));
  request.case.observations[0].unit = missing();
  request.case.observations[0].measurementTime = missing();
  const result = selectClinicalMeasurements(request, profile()), fresh = executeClinicalDemo(request);
  assert.equal(result.traceHash, fresh.traceHash);
  for (const rule of fresh.trace.rules) for (const gap of rule.gaps) {
    assert.ok(result.gaps.some(item => item.ruleId === rule.ruleId && item.ruleHash === rule.ruleHash && item.code === gap.code
      && item.dependencyId === gap.dependencyId && item.detail === gap.detail
      && canonicalizeJson(item.observationIds) === canonicalizeJson(gap.observationIds)), `lost full ${gap.code}`);
  }
});

test('E6.5a deterministic selection neither mutates inputs nor creates observations, orders or permissions', () => {
  const request = input(), available = profile(), before = canonicalizeJson({ request, available });
  const a = selectClinicalMeasurements(request, available), b = selectClinicalMeasurements(request, available);
  assert.equal(canonicalizeJson(a), canonicalizeJson(b));
  assert.equal(canonicalizeJson({ request, available }), before);
  assert.equal(request.case.observations[0].value.state, 'missing');
  assert.ok(!('orders' in a)); assert.ok(!('permissions' in a));
});

test('E6.5a strict profiles reject nonfinite, unsafe, negative or reversed prospective timing and unbounded data', () => {
  const mutations: ((value: any) => void)[] = [
    value => { value.purpose = 'clinical-care'; },
    value => { value.patientRecord = {}; },
    value => { value.tests[0].quantityId = 'real-measurement'; },
    value => { value.tests[0].timing.eventOffsetMs = -1; },
    value => { value.tests[0].timing.eventOffsetMs = NaN; },
    value => { value.tests[0].timing.measurementOffsetMs = Infinity; },
    value => { value.tests[0].timing.measurementOffsetMs = Number.MAX_SAFE_INTEGER + 1; },
    value => { value.tests[0].timing = { eventOffsetMs: 2000, measurementOffsetMs: 1000 }; },
    value => { value.tests[0].timing = { eventOffsetMs: 0.5, measurementOffsetMs: 1000 }; },
    value => { value.tests[0].timing.eventTime = '2026-02-30T00:00:00Z'; },
    value => { delete value.tests[0].timing; },
    value => { value.tests[0].available = 'true'; },
    value => { value.tests[0].allowedModes = []; },
    value => { value.tests[0].allowedModes = ['inferred']; },
    value => { value.tests[0].sourceIds = []; },
    value => { value.tests[0].limitations = ['x'.repeat(10001)]; },
    value => { value.tests.push(structuredClone(value.tests[0])); },
    value => { value.tests = Array.from({ length: 10001 }, (_, i) => ({ ...value.tests[0], id: `fixture:test-${i}` })); },
  ];
  for (const mutate of mutations) {
    const available = profile(); mutate(available);
    assert.throws(() => validateSyntheticTestProfile(available));
    assert.throws(() => selectClinicalMeasurements(input(), available));
  }
});

test('E6.5a unrepresentable future instants and impossible case dates never yield a proposal', () => {
  const request = input(), available = profile();
  available.tests[0].timing = { eventOffsetMs: Number.MAX_SAFE_INTEGER, measurementOffsetMs: Number.MAX_SAFE_INTEGER };
  const result = selectClinicalMeasurements(request, available);
  assert.deepEqual(result.proposals, []);
  assert.ok(gapCodes(result).includes('prospective_time_unrepresentable'));
  request.case.referenceTime = known('2026-02-30T00:00:00Z');
  assert.throws(() => selectClinicalMeasurements(request, profile()));
});

test('E6.5a prospective times preserve schema precision and year bounds rather than rounding or overflowing', () => {
  const request = input(), available = profile();
  available.tests[0].timing = { eventOffsetMs: 1, measurementOffsetMs: 1000 };
  const subsecond = selectClinicalMeasurements(request, available);
  assert.deepEqual(subsecond.proposals, []);
  assert.ok(gapCodes(subsecond).includes('prospective_time_precision_mismatch'));
  withoutObservations(request);
  request.case.referenceTime = known('9999-12-31T23:59:59Z');
  const overflow = selectClinicalMeasurements(request, profile());
  assert.deepEqual(overflow.proposals, []);
  assert.ok(gapCodes(overflow).includes('prospective_time_unrepresentable'));
});

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const cli = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/demo_clinical.ts', ...args],
  { cwd: repoRoot, encoding: 'utf8', timeout: 30_000, maxBuffer: 4_000_000 });

test('E6.5a source-run CLI completes fixture to trace to gaps/profile, deterministic export and revocation replay', () => {
  const first = cli('fixture:case-b', 'available'), repeated = cli('fixture:case-b', 'available');
  assert.equal(first.status, 0, first.stderr); assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(first.stdout, repeated.stdout);
  const report = JSON.parse(first.stdout);
  assert.equal(report.purpose, 'software-demonstration');
  assert.match(report.label, /FICTIONAL SOFTWARE DEMONSTRATION/);
  assert.equal(report.execution.trace.rules[0].outcome, 'undetermined');
  assert.equal(report.selection.proposals.length, 1);
  assert.ok(report.selection.gaps.some(gap => gap.code === 'missing_value'));
  assert.equal(report.historicalReplay.traceHash, report.execution.traceHash);
  assert.equal(report.revocationProbe.trace.rules[0].execution, 'blocked');
  assert.equal(report.revocationProbe.trace.rules[0].eligible, false);
  assert.equal(report.revocationProbe.earlierTraceUnchanged, true);
  assert.equal(report.revocationProbe.historicalReplayAfterRevocation.traceHash, report.execution.traceHash);
  const { reportHash, ...content } = report;
  assert.equal(reportHash, canonicalHash(content));
  const restricted = cli('fixture:case-b', 'unavailable');
  assert.equal(restricted.status, 0, restricted.stderr);
  const restrictedReport = JSON.parse(restricted.stdout);
  assert.equal(restrictedReport.selection.proposals.length, 0);
  assert.equal(restrictedReport.selection.caseHash, report.selection.caseHash);
  assert.equal(restrictedReport.selection.traceHash, report.selection.traceHash);
  assert.notEqual(restrictedReport.selection.profileHash, report.selection.profileHash);
  const complete = cli('fixture:case-a', 'available');
  assert.equal(complete.status, 0, complete.stderr);
  const completeReport = JSON.parse(complete.stdout);
  assert.equal(completeReport.execution.trace.rules[0].outcome, 'supported');
  assert.equal(completeReport.selection.proposals.length, 0);
});

test('E6.5a CLI refuses case paths, arbitrary JSON, extra arguments and unknown profiles', () => {
  for (const args of [
    ['/tmp/patient.json'], ['{"fixtureId":"fixture:case-a"}'], ['fixture:case-b', '{"tests":[]}'],
    ['fixture:case-b', 'unknown'], ['fixture:case-b', 'available', 'extra'],
  ]) {
    const result = cli(...args);
    assert.notEqual(result.status, 0, `unexpected acceptance: ${args.join(' ')}`);
    assert.equal(result.stdout, '');
  }
});
