import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';
import { CLINICAL_DEMO_VERSION, type ClinicalCase, type ClinicalObservation, type ClinicalRule,
  type ClinicalSource, type ClinicalSourceState, type ClinicalRuleReview, type KnownOrMissing } from '../../shared/clinical_demo';

export const known = <T>(value: T): KnownOrMissing<T> => ({ state: 'known', value });
export const missing = (reason: 'not_recorded' | 'not_measured' | 'unknown' | 'not_applicable' = 'not_recorded'): KnownOrMissing<never> => ({ state: 'missing', reason });
export const testClinicalSource = (changes: Partial<ClinicalSource> = {}): ClinicalSource => ({
  schemaVersion: CLINICAL_DEMO_VERSION, id: 'fixture:source-a', revision: 1,
  purpose: 'software-demonstration', statement: 'Invented source for deterministic software tests. No medical content.', ...changes,
});
export const testClinicalSourceState = (changes: Partial<ClinicalSourceState> = {}): ClinicalSourceState => {
  const document = changes.document ?? testClinicalSource();
  const contentHash = canonicalHash(document);
  return { document, contentHash, approvedHash: contentHash, status: 'approved', readable: true, ...changes };
};
export const testClinicalObservation = (changes: Partial<ClinicalObservation> = {}): ClinicalObservation => ({
  id: 'fixture:observation-alpha', quantityId: 'fixture:q-alpha', value: known(2), unit: known('fixture:u-alpha'),
  eventTime: known('2026-01-01T00:00:00Z'), measurementTime: known('2026-01-01T00:00:01Z'),
  mode: 'measured', sourceId: 'fixture:source-a', contradicts: [], supersedes: null, ...changes,
});
export const testClinicalCase = (changes: Partial<ClinicalCase> = {}): ClinicalCase => ({
  schemaVersion: CLINICAL_DEMO_VERSION, fixtureId: 'fixture:case-a', purpose: 'software-demonstration',
  revision: 1, previousCaseHash: null, referenceTime: known('2026-01-01T00:00:00Z'),
  context: { species: known('fixture:species-a'), population: known('fixture:population-a'), setting: known('fixture:setting-a') },
  sourcePins: [{ referenceId: 'fixture:source-a', contentHash: canonicalHash(testClinicalSource()) }],
  exposures: [
    { id: 'fixture:exposure-a', certainty: 'known', substanceIds: ['fixture:substance-a'], classIds: ['fixture:class-a'],
      unknownComposition: false, route: known('fixture:route-a'), eventTime: known('2026-01-01T00:00:00Z'), sourceId: 'fixture:source-a' },
    { id: 'fixture:exposure-mixture', certainty: 'possible', substanceIds: ['fixture:substance-a', 'fixture:substance-b'], classIds: [],
      unknownComposition: false, route: missing('unknown'), eventTime: missing('unknown'), sourceId: 'fixture:source-a' },
    { id: 'fixture:exposure-unknown', certainty: 'possible', substanceIds: [], classIds: [],
      unknownComposition: true, route: missing('unknown'), eventTime: missing('unknown'), sourceId: 'fixture:source-a' },
  ],
  medications: [{ id: 'fixture:medication-b', certainty: 'possible', substanceIds: ['fixture:substance-b'], classIds: [],
    unknownComposition: false, route: missing('unknown'), eventTime: missing('not_recorded'), sourceId: 'fixture:source-a' }],
  comorbidityIds: ['fixture:condition-a'],
  observations: [testClinicalObservation()],
  hypotheses: [
    { id: 'fixture:hypothesis-a', kind: 'substance', entityIds: ['fixture:substance-a'], exposureIds: ['fixture:exposure-a'], observationIds: ['fixture:observation-alpha'] },
    { id: 'fixture:hypothesis-class', kind: 'class', entityIds: ['fixture:class-a'], exposureIds: ['fixture:exposure-a'], observationIds: [] },
    { id: 'fixture:hypothesis-mixture', kind: 'mixture', entityIds: ['fixture:substance-a', 'fixture:substance-b'], exposureIds: ['fixture:exposure-mixture'], observationIds: [] },
    { id: 'fixture:hypothesis-unknown', kind: 'unknown_composition', entityIds: [], exposureIds: ['fixture:exposure-unknown'], observationIds: [] },
    { id: 'fixture:hypothesis-comorbidity', kind: 'comorbidity', entityIds: ['fixture:condition-a'], exposureIds: [], observationIds: [] },
    { id: 'fixture:hypothesis-alternative', kind: 'non_toxicological', entityIds: ['fixture:alternative-a'], exposureIds: [], observationIds: [] },
  ],
  appearances: [{ id: 'fixture:appearance-a', description: 'Imaginary striped triangle. Appearance does not establish composition or exposure.', sourceId: 'fixture:source-a' }],
  ...changes,
});
export const testClinicalCaseB = (changes: Partial<ClinicalCase> = {}): ClinicalCase => testClinicalCase({
  fixtureId: 'fixture:case-b', observations: [testClinicalObservation({ value: missing('not_measured') })], ...changes,
});
export const testClinicalRule = (changes: Partial<ClinicalRule> = {}): ClinicalRule => ({
  schemaVersion: CLINICAL_DEMO_VERSION, id: 'fixture:rule-alpha', revision: 1, purpose: 'software-demonstration',
  references: [{ referenceId: 'fixture:source-a', contentHash: canonicalHash(testClinicalSource()) }],
  applicability: { species: ['fixture:species-a'], population: ['fixture:population-a'], setting: ['fixture:setting-a'] },
  dependencies: [{ id: 'fixture:dependency-alpha', quantityId: 'fixture:q-alpha', unit: 'fixture:u-alpha', observationId: null,
    allowedModes: ['measured'], requireEventTime: true, requireMeasurementTime: true, eventWindow: { minOffsetMs: -1000, maxOffsetMs: 1000 } }],
  predicate: { kind: 'scalar_comparison', dependencyId: 'fixture:dependency-alpha', operator: 'gte', value: 1, unit: 'fixture:u-alpha' },
  hypothesisId: 'fixture:hypothesis-a',
  meanings: { supported: 'The invented comparison is true; this has no clinical meaning.',
    contradicted: 'The invented comparison is false; the hypothesis is preserved.', undetermined: 'The invented comparison cannot be evaluated from the supplied dependencies.' },
  ...changes,
});
export const testClinicalRuleReview = (rule: ClinicalRule = testClinicalRule(), changes: Partial<ClinicalRuleReview> = {}): ClinicalRuleReview => ({
  ruleId: rule.id, ruleHash: canonicalHash(rule), reviewerId: 'fixture:reviewer-a', scope: 'synthetic_fixture_test', status: 'approved', ...changes,
});
