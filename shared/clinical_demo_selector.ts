import type { ClinicalGap, ClinicalReferencePin, ObservationMode } from './clinical_demo';
import { validateSyntheticTestProfile } from './clinical_demo_profile';
import { canonicalHash } from '../backend/watchdog_api/domain/canonical';
import { executeClinicalDemo, type ClinicalExecutionInput } from '../backend/watchdog_api/clinical_demo/executor';

export interface ClinicalSelectionGap extends ClinicalGap {
  ruleId: string;
  ruleHash: string;
  testId: string | null;
}
export interface ClinicalMeasurementProposal {
  testId: string;
  profileId: string;
  profileHash: string;
  ruleId: string;
  ruleHash: string;
  dependencyId: string;
  quantityId: string;
  unit: string;
  mode: ObservationMode;
  references: ClinicalReferencePin[];
  profileSourceIds: string[];
  reason: string;
  assumptions: string[];
  prospectiveEventTime: string;
  prospectiveMeasurementTime: string;
}
export interface ClinicalMeasurementSelection {
  purpose: 'software-demonstration';
  profileHash: string;
  caseHash: string;
  traceHash: string;
  proposals: ClinicalMeasurementProposal[];
  gaps: ClinicalSelectionGap[];
  limitations: string[];
}

/** Source-run fixture module, not browser-ready or an authentication authority.
 * Recompute using the trusted harness's CURRENT source/review state: accepting a raw
 * trace or historical archive here would incorrectly revive an old approval.
 * A future service must obtain that state itself; profile declarations grant no rights. */
export function selectClinicalMeasurements(currentInput: ClinicalExecutionInput, rawProfile: unknown): ClinicalMeasurementSelection {
  const profile = validateSyntheticTestProfile(rawProfile);
  const execution = executeClinicalDemo(currentInput);
  const record = execution.archive.input.case;
  const profileHash = canonicalHash(profile);
  const proposals: ClinicalMeasurementProposal[] = [];
  const gaps: ClinicalSelectionGap[] = [];
  const tests = [...profile.tests].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const rule of execution.trace.rules) {
    const append = (code: string, detail: string, dependencyId: string | null = null,
      testId: string | null = null, observationIds: string[] = []) => gaps.push({
      ruleId: rule.ruleId, ruleHash: rule.ruleHash, dependencyId, testId, code, detail, observationIds: [...observationIds],
    });
    // A proposal has not filled any missing measurement: retain the complete trace gaps.
    for (const original of rule.gaps) append(original.code, original.detail, original.dependencyId, null, original.observationIds);
    if (!rule.eligible) continue;
    if (rule.dependencies.some(item => item.gaps.some(itemGap =>
      itemGap.code === 'observation_conflict' || itemGap.code === 'observation_ambiguous'))) {
      append('conflict_blocks_selection', 'This first slice conservatively withholds every proposal for a conflicted or ambiguous rule. Independent missing dependencies remain gaps.');
      continue;
    }
    for (const item of rule.dependencies) {
      const dependency = item.dependency;
      if (!item.gaps.length) continue;
      const missingValueIds = new Set(item.gaps.filter(itemGap => itemGap.code === 'missing_value').flatMap(itemGap => itemGap.observationIds));
      if (record.observations.some(observation => missingValueIds.has(observation.id)
        && observation.value.state === 'missing' && observation.value.reason === 'not_applicable')) {
        append('value_not_applicable', 'The recorded missing value is explicitly not applicable; absence alone cannot justify a future measurement.', dependency.id);
        continue;
      }
      if (item.gaps.some(itemGap => itemGap.code !== 'missing_observation' && itemGap.code !== 'missing_value')) {
        append('dependency_not_prospectively_repairable', 'A future test cannot repair historical metadata, timing, provenance or other non-measurement gaps.', dependency.id);
        continue;
      }
      if (dependency.observationId !== null) {
        append('pinned_observation_not_replaceable', 'The dependency pins an observation ID; a future observation cannot replace it implicitly.', dependency.id);
        continue;
      }
      if (record.referenceTime.state !== 'known') {
        append('missing_decision_time', 'Prospective acquisition requires the explicit case.referenceTime demonstration decision clock.', dependency.id);
        continue;
      }
      const candidates = tests.filter(test => test.quantityId === dependency.quantityId);
      if (!candidates.length) {
        append('no_profile_test', 'No test in this profile declares the required quantity.', dependency.id);
        continue;
      }
      for (const test of candidates) {
        const reasons: { code: string; detail: string }[] = [];
        if (!test.available) reasons.push({ code: 'test_unavailable', detail: 'The profile declares this test unavailable; the dependency remains a gap.' });
        if (test.unit !== dependency.unit) reasons.push({ code: 'profile_unit_mismatch', detail: 'Test and dependency units differ; no conversion is performed.' });
        const modes = test.allowedModes.filter(mode => dependency.allowedModes.includes(mode)).sort();
        if (!modes.length) reasons.push({ code: 'profile_mode_mismatch', detail: 'No observation mode is allowed by both the test and dependency.' });
        for (const dimension of ['species', 'population', 'setting'] as const) {
          const value = record.context[dimension];
          if (value.state !== 'known' || !test.applicability[dimension].includes(value.value))
            reasons.push({ code: 'profile_context_mismatch', detail: `Test applicability does not include the known ${dimension}.` });
        }
        if (dependency.eventWindow && (test.timing.eventOffsetMs < dependency.eventWindow.minOffsetMs
          || test.timing.eventOffsetMs > dependency.eventWindow.maxOffsetMs))
          reasons.push({ code: 'prospective_time_outside_window', detail: 'The prospective event cannot satisfy this dependency window; no historical time is backfilled.' });
        const anchor = Date.parse(record.referenceTime.value);
        const eventMs = anchor + test.timing.eventOffsetMs;
        const measurementMs = anchor + test.timing.measurementOffsetMs;
        // The case contract accepts second-precision ISO timestamps with four-digit years.
        // Date itself accepts a broader range, so merely checking Date's range is insufficient.
        if (![eventMs, measurementMs].every(value => Number.isSafeInteger(value)
          && value >= -62167219200000 && value <= 253402300799000))
          reasons.push({ code: 'prospective_time_unrepresentable', detail: 'The prospective timestamps exceed the supported exact timestamp range.' });
        if (eventMs % 1000 !== 0 || measurementMs % 1000 !== 0)
          reasons.push({ code: 'prospective_time_precision_mismatch', detail: 'Prospective timestamps must satisfy the case contract second precision; no time is silently rounded.' });
        if (reasons.length) {
          for (const reason of reasons) append(reason.code, reason.detail, dependency.id, test.id);
          continue;
        }
        proposals.push({
          testId: test.id, profileId: profile.id, profileHash, ruleId: rule.ruleId, ruleHash: rule.ruleHash,
          dependencyId: dependency.id, quantityId: dependency.quantityId, unit: dependency.unit, mode: modes[0],
          references: rule.references.map(reference => ({ ...reference })), profileSourceIds: [...test.sourceIds],
          reason: `Missing measurable dependency ${dependency.id}: ${item.gaps.map(itemGap => itemGap.code).join(', ')}.`,
          assumptions: [
            'case.referenceTime is the explicitly supplied fictional decision clock; no system clock is consulted.',
            'The profile declares fictional prospective availability; no measurement occurred and no test order is created.',
            'Re-evaluation requires an explicit revised case and deliberate observation selection or supersession; existing observations and gaps remain unchanged.',
            'Profile sources describe this fixture only and confer no approval, ownership or read permission.',
            ...test.limitations,
          ],
          prospectiveEventTime: new Date(eventMs).toISOString().replace('.000Z', 'Z'),
          prospectiveMeasurementTime: new Date(measurementMs).toISOString().replace('.000Z', 'Z'),
        });
      }
    }
  }
  return { purpose: 'software-demonstration', profileHash, caseHash: execution.trace.caseHash,
    traceHash: execution.traceHash, proposals, gaps,
    limitations: [
      'Synthetic dependency demonstration only; no clinical interpretation, probability, ranking, treatment or device action.',
      'Output ordering is stable by identifiers and does not express urgency or preference.',
      'A rule with any conflict or ambiguity is conservatively excluded from all proposals in this first slice.',
      'Only trusted harness-supplied current approvals are checked; this pure module is not an authorization service.',
    ],
  };
}
