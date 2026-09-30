import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ClinicalCase, ClinicalObservation, MissingReason } from '../../shared/clinical_demo';
import { validateClinicalCase } from '../../shared/clinical_demo_validation';
import { testClinicalCase } from '../helpers/clinical_demo';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';

const missingReasons: MissingReason[] = ['not_recorded', 'not_measured', 'unknown', 'not_applicable'];
const copy = <T>(value: T): T => structuredClone(value);

function pair(): ClinicalCase {
  const specimen = testClinicalCase();
  const first = specimen.observations[0];
  const second: ClinicalObservation = { ...copy(first), id: 'fixture:observation-case-test-second',
    value: { state: 'known', value: 19 }, contradicts: [], supersedes: null };
  specimen.observations.push(second);
  return specimen;
}

test('E6.4a fixture keeps mixtures, unknown composition and non-toxicological alternatives without patient data', () => {
  const input = testClinicalCase();
  const parsed = validateClinicalCase(input);
  assert.deepEqual(parsed, input);
  assert.equal(parsed.purpose, 'software-demonstration');
  assert.ok(parsed.exposures.some(item => item.certainty === 'known'));
  assert.ok(parsed.exposures.some(item => item.certainty === 'possible'));
  assert.ok(parsed.exposures.some(item => item.unknownComposition));
  const kinds = new Set(parsed.hypotheses.map(item => item.kind));
  for (const kind of ['substance', 'class', 'mixture', 'unknown_composition', 'comorbidity', 'non_toxicological']) {
    assert.ok(kinds.has(kind as ClinicalCase['hypotheses'][number]['kind']), `missing ${kind} alternative`);
  }
  const mixture = parsed.hypotheses.find(item => item.kind === 'mixture')!;
  assert.ok(mixture.entityIds.length >= 2, 'mixture retains both fictional components');
  assert.ok(parsed.medications.length > 0);
  assert.ok(parsed.comorbidityIds.length > 0);
});

test('E6.4a a known value with missing unit and clocks is valid, incomplete and lossless', () => {
  const specimen = testClinicalCase();
  const observation = specimen.observations[0];
  observation.value = { state: 'known', value: 0 };
  observation.unit = { state: 'missing', reason: 'unknown' };
  observation.eventTime = { state: 'missing', reason: 'not_recorded' };
  observation.measurementTime = { state: 'missing', reason: 'not_measured' };
  observation.mode = 'reported';
  const before = copy(specimen);
  const parsed = validateClinicalCase(specimen);
  assert.deepEqual(parsed, before);
  assert.deepEqual(specimen, before, 'validation must not mutate caller input');
  assert.deepEqual(parsed.observations[0].value, { state: 'known', value: 0 });
  assert.equal(parsed.observations[0].mode, 'reported');
});

test('E6.4a missing reasons and measured/reported provenance remain distinct in content hashes', () => {
  const hashes = new Set<string>();
  for (const reason of missingReasons) {
    const specimen = testClinicalCase();
    specimen.observations[0].value = { state: 'missing', reason };
    const parsed = validateClinicalCase(specimen);
    assert.deepEqual(parsed.observations[0].value, { state: 'missing', reason });
    hashes.add(canonicalHash(parsed));
  }
  assert.equal(hashes.size, missingReasons.length);
  const reported = testClinicalCase();
  reported.observations[0].mode = 'reported';
  const measured = copy(reported);
  measured.observations[0].mode = 'measured';
  assert.notEqual(canonicalHash(validateClinicalCase(reported)), canonicalHash(validateClinicalCase(measured)));
});

test('E6.4a every required missingness field must be explicit; null, undefined and omissions are rejected', () => {
  for (const key of ['value', 'unit', 'eventTime', 'measurementTime', 'sourceId', 'mode']) {
    for (const replacement of ['omit', 'undefined', 'null']) {
      const specimen: any = testClinicalCase();
      if (replacement === 'omit') delete specimen.observations[0][key];
      else specimen.observations[0][key] = replacement === 'null' ? null : undefined;
      assert.throws(() => validateClinicalCase(specimen), `${key}: ${replacement}`);
    }
  }
  const absentContext: any = testClinicalCase();
  delete absentContext.context.species;
  assert.throws(() => validateClinicalCase(absentContext));
});

test('E6.4a strict objects reject imported patient fields, unknown missing reasons and mixed union states', () => {
  const mutations: ((specimen: any) => void)[] = [
    specimen => { specimen.patientName = 'NOT A REAL PERSON'; },
    specimen => { specimen.context.age = 123; },
    specimen => { specimen.observations[0].interpretation = 'invented'; },
    specimen => { specimen.observations[0].value = { state: 'known', value: 1, reason: 'unknown' }; },
    specimen => { specimen.observations[0].value = { state: 'missing', reason: 'unknown', value: 1 }; },
    specimen => { specimen.observations[0].value = { state: 'missing', reason: 'guessed' }; },
    specimen => { specimen.observations[0].value = { state: 'estimated', value: 1 }; },
    specimen => { specimen.purpose = 'clinical-care'; },
  ];
  for (const mutate of mutations) {
    const specimen = testClinicalCase();
    mutate(specimen);
    assert.throws(() => validateClinicalCase(specimen));
  }
});

test('E6.4a rejects nonfinite/coerced values and malformed known timestamps without inventing replacements', () => {
  for (const value of [NaN, Infinity, -Infinity, '2', null, undefined]) {
    const specimen: any = testClinicalCase();
    specimen.observations[0].value = { state: 'known', value };
    assert.throws(() => validateClinicalCase(specimen), `value ${String(value)}`);
  }
  for (const value of ['yesterday', '', '2026-13-01T00:00:00Z', '2026-02-30T00:00:00Z']) {
    const specimen = testClinicalCase();
    specimen.observations[0].eventTime = { state: 'known', value };
    assert.throws(() => validateClinicalCase(specimen), value);
  }
});

test('E6.4a preserves concurrent contradictions and superseded history without latest-wins rewriting', () => {
  const specimen = pair();
  const [first] = specimen.observations;
  const second = specimen.observations.at(-1)!;
  first.contradicts = [second.id];
  second.contradicts = [first.id];
  const conflicted = validateClinicalCase(specimen);
  assert.deepEqual(conflicted.observations, specimen.observations);
  second.contradicts = [];
  first.contradicts = [];
  second.supersedes = first.id;
  const revised = validateClinicalCase(specimen);
  assert.deepEqual(revised.observations, specimen.observations);
  assert.ok(revised.observations.some(item => item.id === first.id));
  assert.equal(revised.observations.at(-1)!.supersedes, first.id);
});

test('E6.4a a measured correction can supersede a reported observation while retaining both evidence modes', () => {
  const specimen = pair();
  const first = specimen.observations[0], second = specimen.observations.at(-1)!;
  first.mode = 'reported';
  second.mode = 'measured';
  second.supersedes = first.id;
  const parsed = validateClinicalCase(specimen);
  assert.deepEqual(parsed.observations, specimen.observations);
  assert.equal(parsed.observations[0].mode, 'reported');
  assert.equal(parsed.observations.at(-1)!.mode, 'measured');
});

test('E6.4a a mixture can retain a known component and an unknown remainder without inventing its identity', () => {
  const specimen = testClinicalCase();
  const mixture = specimen.hypotheses.find(item => item.kind === 'mixture')!;
  const exposure = specimen.exposures.find(item => mixture.exposureIds.includes(item.id))!;
  mixture.entityIds = [mixture.entityIds[0]];
  exposure.substanceIds = [exposure.substanceIds[0]];
  exposure.unknownComposition = true;
  const parsed = validateClinicalCase(specimen);
  assert.deepEqual(parsed, specimen);
  assert.equal(parsed.hypotheses.find(item => item.id === mixture.id)!.entityIds.length, 1);
  assert.equal(parsed.exposures.find(item => item.id === exposure.id)!.unknownComposition, true);
  exposure.unknownComposition = false;
  assert.throws(() => validateClinicalCase(specimen), 'one known component alone must not manufacture a mixture');
});

test('E6.4a rejects dangling observation, source, exposure and hypothesis links', () => {
  const mutations: ((specimen: ClinicalCase) => void)[] = [
    specimen => { specimen.observations[0].sourceId = 'fixture:missing-source'; },
    specimen => { specimen.exposures[0].sourceId = 'fixture:missing-source'; },
    specimen => { specimen.medications[0].sourceId = 'fixture:missing-source'; },
    specimen => { specimen.appearances[0].sourceId = 'fixture:missing-source'; },
    specimen => { specimen.observations[0].contradicts = ['fixture:missing-observation']; },
    specimen => { specimen.observations[0].supersedes = 'fixture:missing-observation'; },
    specimen => { specimen.hypotheses[0].observationIds = ['fixture:missing-observation']; },
    specimen => { specimen.hypotheses[0].exposureIds = ['fixture:missing-exposure']; },
  ];
  for (const mutate of mutations) {
    const specimen = testClinicalCase();
    mutate(specimen);
    assert.throws(() => validateClinicalCase(specimen));
  }
});

test('E6.4a rejects duplicate IDs and self links instead of aliasing evidence', () => {
  for (const key of ['sourcePins', 'exposures', 'medications', 'observations', 'hypotheses', 'appearances'] as const) {
    const specimen: any = testClinicalCase();
    assert.ok(specimen[key].length > 0, `${key} fixture coverage`);
    specimen[key].push(copy(specimen[key][0]));
    assert.throws(() => validateClinicalCase(specimen), key);
  }
  for (const relation of ['contradicts', 'supersedes'] as const) {
    const specimen = testClinicalCase();
    const first = specimen.observations[0];
    if (relation === 'contradicts') first.contradicts = [first.id];
    else first.supersedes = first.id;
    assert.throws(() => validateClinicalCase(specimen), relation);
  }
  const collision = testClinicalCase();
  collision.appearances[0].id = collision.observations[0].id;
  assert.throws(() => validateClinicalCase(collision), 'record IDs cannot alias across categories');
});

test('E6.4a case source pins bind exact content into the case hash and reject omitted, malformed or duplicate pins', () => {
  const original = testClinicalCase();
  const modified = copy(original);
  modified.sourcePins[0].contentHash = original.sourcePins[0].contentHash === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64);
  assert.notEqual(canonicalHash(validateClinicalCase(original)), canonicalHash(validateClinicalCase(modified)));
  const mutations: ((specimen: any) => void)[] = [
    specimen => { delete specimen.sourcePins; },
    specimen => { specimen.sourcePins = undefined; },
    specimen => { specimen.sourcePins = null; },
    specimen => { specimen.sourcePins = []; },
    specimen => { specimen.sourcePins = ['fixture:source-a']; },
    specimen => { delete specimen.sourcePins[0].contentHash; },
    specimen => { delete specimen.sourcePins[0].referenceId; },
    specimen => { specimen.sourcePins[0].contentHash = 'not-a-sha256'; },
    specimen => { specimen.sourcePins[0].contentHash = 'a'.repeat(63); },
    specimen => { specimen.sourcePins[0].referenceId = 'arbitrary-patient-record'; },
    specimen => { specimen.sourcePins[0].unreviewedGuess = true; },
    specimen => { specimen.sourcePins.push(copy(specimen.sourcePins[0])); },
    specimen => { specimen.sourcePins.push({ referenceId: specimen.sourcePins[0].referenceId, contentHash: modified.sourcePins[0].contentHash }); },
    specimen => { specimen.sourceIds = specimen.sourcePins.map(pin => pin.referenceId); delete specimen.sourcePins; },
  ];
  for (const mutate of mutations) {
    const specimen = copy(original);
    mutate(specimen);
    assert.throws(() => validateClinicalCase(specimen));
  }
});

test('E6.4a later revisions require a prior content hash and arbitrary fixture imports remain closed', () => {
  const original = testClinicalCase();
  const revised = copy(original);
  revised.revision = 2;
  assert.throws(() => validateClinicalCase(revised));
  revised.previousCaseHash = canonicalHash(original);
  assert.deepEqual(validateClinicalCase(revised), revised);
  original.previousCaseHash = revised.previousCaseHash;
  assert.throws(() => validateClinicalCase(original));
  const arbitrary: any = testClinicalCase();
  arbitrary.fixtureId = 'fixture:arbitrary-history';
  assert.throws(() => validateClinicalCase(arbitrary));
});

test('E6.4a rejects supersession cycles and superseding a different quantity', () => {
  const cyclic = pair();
  const first = cyclic.observations[0], second = cyclic.observations.at(-1)!;
  first.supersedes = second.id;
  second.supersedes = first.id;
  assert.throws(() => validateClinicalCase(cyclic));
  const changedQuantity = pair();
  changedQuantity.observations.at(-1)!.quantityId = 'fixture:other-quantity';
  changedQuantity.observations.at(-1)!.supersedes = changedQuantity.observations[0].id;
  assert.throws(() => validateClinicalCase(changedQuantity));
});

test('E6.4a sample appearance is separate evidence and cannot silently establish exposure or composition', () => {
  const specimen = testClinicalCase();
  const original = copy(specimen);
  specimen.appearances[0].description = 'Fictional shape and color resembles A';
  const parsed = validateClinicalCase(specimen);
  assert.deepEqual(parsed.exposures, original.exposures);
  assert.deepEqual(parsed.medications, original.medications);
  assert.deepEqual(parsed.hypotheses, original.hypotheses);
  assert.ok(parsed.exposures.some(item => item.unknownComposition));
  const appearanceAsSource = copy(specimen);
  appearanceAsSource.exposures[0].sourceId = appearanceAsSource.appearances[0].id;
  assert.throws(() => validateClinicalCase(appearanceAsSource), 'appearance ID is not a source assertion');
});
