/** Software fixtures only. These contracts carry no clinical interpretation or approval. */
export const CLINICAL_DEMO_VERSION = 'clinical-demo-1' as const;
export type MissingReason = 'not_recorded' | 'not_measured' | 'unknown' | 'not_applicable';
export type KnownOrMissing<T> = { state: 'known'; value: T } | { state: 'missing'; reason: MissingReason };
export type ObservationMode = 'reported' | 'measured';
export interface ClinicalContext {
  species: KnownOrMissing<string>;
  population: KnownOrMissing<string>;
  setting: KnownOrMissing<string>;
}
export interface ClinicalExposure {
  id: string;
  certainty: 'known' | 'possible';
  substanceIds: string[];
  classIds: string[];
  unknownComposition: boolean;
  route: KnownOrMissing<string>;
  eventTime: KnownOrMissing<string>;
  sourceId: string;
}
export interface ClinicalObservation {
  id: string;
  quantityId: string;
  value: KnownOrMissing<number>;
  unit: KnownOrMissing<string>;
  eventTime: KnownOrMissing<string>;
  measurementTime: KnownOrMissing<string>;
  mode: ObservationMode;
  sourceId: string;
  contradicts: string[];
  supersedes: string | null;
}
export interface ClinicalHypothesis {
  id: string;
  kind: 'substance' | 'class' | 'mixture' | 'unknown_composition' | 'comorbidity' | 'non_toxicological';
  entityIds: string[];
  exposureIds: string[];
  observationIds: string[];
}
export interface ClinicalCase {
  schemaVersion: typeof CLINICAL_DEMO_VERSION;
  fixtureId: string;
  purpose: 'software-demonstration';
  revision: number;
  previousCaseHash: string | null;
  referenceTime: KnownOrMissing<string>;
  context: ClinicalContext;
  sourceIds: string[];
  exposures: ClinicalExposure[];
  medications: ClinicalExposure[];
  comorbidityIds: string[];
  observations: ClinicalObservation[];
  hypotheses: ClinicalHypothesis[];
  appearances: { id: string; description: string; sourceId: string }[];
}
export interface ClinicalReferencePin { referenceId: string; contentHash: string }
export interface ClinicalDependency {
  id: string;
  quantityId: string;
  unit: string;
  observationId: string | null;
  allowedModes: ObservationMode[];
  requireEventTime: boolean;
  requireMeasurementTime: boolean;
  eventWindow: { minOffsetMs: number; maxOffsetMs: number } | null;
}
export type ClinicalOutcome = 'supported' | 'contradicted' | 'undetermined';
export interface ClinicalRule {
  schemaVersion: typeof CLINICAL_DEMO_VERSION;
  id: string;
  revision: number;
  purpose: 'software-demonstration';
  references: ClinicalReferencePin[];
  applicability: { species: string[]; population: string[]; setting: string[] };
  dependencies: ClinicalDependency[];
  predicate: { kind: 'scalar_comparison'; dependencyId: string; operator: 'eq' | 'lt' | 'lte' | 'gt' | 'gte'; value: number; unit: string };
  hypothesisId: string;
  meanings: Record<ClinicalOutcome, string>;
}
export interface ClinicalSource {
  schemaVersion: typeof CLINICAL_DEMO_VERSION;
  id: string;
  revision: number;
  purpose: 'software-demonstration';
  statement: string;
}
/** Current source state is separate from immutable content and historical trace. */
export interface ClinicalSourceState {
  document: ClinicalSource;
  contentHash: string;
  status: 'approved' | 'revoked' | 'unreviewed';
  approvedHash: string | null;
  readable: boolean;
}
export interface ClinicalRuleReview {
  ruleId: string;
  ruleHash: string;
  reviewerId: string;
  scope: 'synthetic_fixture_test';
  status: 'approved' | 'revoked' | 'unreviewed';
}
export type ClinicalApplicability = 'applicable' | 'inapplicable' | 'undetermined';
export interface ClinicalGap {
  code: string;
  dependencyId: string | null;
  observationIds: string[];
  detail: string;
}
export interface ClinicalDependencyTrace {
  dependency: ClinicalDependency;
  observationIds: string[];
  acceptedObservationId: string | null;
  value: number | null;
  gaps: ClinicalGap[];
}
export interface ClinicalRuleTrace {
  ruleId: string;
  ruleHash: string;
  references: ClinicalReferencePin[];
  hypothesisId: string;
  applicability: ClinicalApplicability;
  outcome: ClinicalOutcome;
  execution: 'evaluated' | 'blocked';
  meaning: string;
  eligible: boolean;
  dependencies: ClinicalDependencyTrace[];
  gaps: ClinicalGap[];
  operations: { operation: string; detail: string }[];
}
export interface ClinicalTrace {
  schemaVersion: typeof CLINICAL_DEMO_VERSION;
  purpose: 'software-demonstration';
  caseHash: string;
  executorHash: string;
  rules: ClinicalRuleTrace[];
  unresolvedHypothesisIds: string[];
  limitations: string[];
}
