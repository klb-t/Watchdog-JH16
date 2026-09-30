import { z } from 'zod';
import { CLINICAL_DEMO_VERSION, type ClinicalCase, type ClinicalRule, type ClinicalSource, type ClinicalSourceState, type ClinicalRuleReview } from './clinical_demo';

const id = z.string().regex(/^fixture:[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(1000);
const timestamp = z.iso.datetime({ precision: 0 });
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const ids = z.array(id).max(100).refine(values => new Set(values).size === values.length, 'Duplicate IDs are not permitted');
const missing = z.object({ state: z.literal('missing'), reason: z.enum(['not_recorded', 'not_measured', 'unknown', 'not_applicable']) }).strict();
const known = <T extends z.ZodType>(value: T) => z.discriminatedUnion('state', [z.object({ state: z.literal('known'), value }).strict(), missing]);
const modes = z.array(z.enum(['reported', 'measured'])).min(1).max(2).refine(values => new Set(values).size === values.length, 'Duplicate modes');
const base = { schemaVersion: z.literal(CLINICAL_DEMO_VERSION), purpose: z.literal('software-demonstration') };
const exposure = z.object({ id, certainty: z.enum(['known', 'possible']), substanceIds: ids, classIds: ids,
  unknownComposition: z.boolean(), route: known(id), eventTime: known(timestamp), sourceId: id,
}).strict().refine(value => value.unknownComposition || value.substanceIds.length + value.classIds.length > 0,
  'An exposure requires composition or explicit unknown composition');
export const ClinicalObservationSchema = z.object({ id, quantityId: id,
  value: known(z.number().finite()), unit: known(id), eventTime: known(timestamp), measurementTime: known(timestamp),
  mode: z.enum(['reported', 'measured']), sourceId: id, contradicts: ids, supersedes: id.nullable(),
}).strict();
const hypothesis = z.object({ id,
  kind: z.enum(['substance', 'class', 'mixture', 'unknown_composition', 'comorbidity', 'non_toxicological']),
  entityIds: ids, exposureIds: ids, observationIds: ids,
}).strict().superRefine((value, ctx) => {
  if (['substance', 'class', 'comorbidity', 'non_toxicological'].includes(value.kind) && !value.entityIds.length)
    ctx.addIssue({ code: 'custom', message: 'This hypothesis kind requires an entity', path: ['entityIds'] });
});
export const ClinicalCaseSchema = z.object({ ...base,
  fixtureId: z.enum(['fixture:case-a', 'fixture:case-b']), revision, previousCaseHash: hash.nullable(),
  referenceTime: known(timestamp), context: z.object({ species: known(id), population: known(id), setting: known(id) }).strict(),
  sourceIds: ids.min(1), exposures: z.array(exposure).max(100), medications: z.array(exposure).max(100),
  comorbidityIds: ids, observations: z.array(ClinicalObservationSchema).max(200), hypotheses: z.array(hypothesis).max(100),
  appearances: z.array(z.object({ id, description: text, sourceId: id }).strict()).max(100),
}).strict().superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if ((value.revision === 1) !== (value.previousCaseHash === null)) issue('First revision has no previous hash; later revisions require one');
  const records = [...value.exposures, ...value.medications, ...value.observations, ...value.hypotheses, ...value.appearances];
  if (new Set(records.map(record => record.id)).size !== records.length) issue('Record IDs must be globally unique within a case');
  const sources = new Set(value.sourceIds);
  for (const record of [...value.exposures, ...value.medications, ...value.observations, ...value.appearances])
    if (!sources.has(record.sourceId)) issue(`Unknown source ${record.sourceId}`);
  const observations = new Map(value.observations.map(observation => [observation.id, observation]));
  const exposureIds = new Set([...value.exposures, ...value.medications].map(exposure => exposure.id));
  for (const item of value.hypotheses) {
    for (const reference of item.exposureIds) if (!exposureIds.has(reference)) issue(`Unknown hypothesis exposure ${reference}`);
    for (const reference of item.observationIds) if (!observations.has(reference)) issue(`Unknown hypothesis observation ${reference}`);
    if (item.kind === 'mixture' && item.entityIds.length < 2 &&
      ![...value.exposures, ...value.medications].some(exposure => item.exposureIds.includes(exposure.id) && exposure.unknownComposition))
      issue('A mixture requires multiple entities or an explicitly unknown composition in a linked exposure');
  }
  for (const observation of value.observations) {
    for (const reference of observation.contradicts) {
      if (reference === observation.id || !observations.has(reference)) issue(`Invalid contradiction reference ${reference}`);
      else if (observations.get(reference)!.quantityId !== observation.quantityId) issue('Contradictory observations must refer to the same quantity');
    }
    if (observation.supersedes !== null) {
      const previous = observations.get(observation.supersedes);
      if (!previous || previous.id === observation.id) issue(`Invalid supersession reference ${observation.supersedes}`);
      else if (previous.quantityId !== observation.quantityId)
        issue('Supersession requires the same quantity');
    }
    const seen = new Set<string>([observation.id]);
    let next = observation.supersedes;
    while (next !== null && observations.has(next)) {
      if (seen.has(next)) { issue('Supersession cycles are forbidden'); break; }
      seen.add(next);
      next = observations.get(next)!.supersedes;
    }
  }
});

export const ClinicalDependencySchema = z.object({ id, quantityId: id, unit: id, observationId: id.nullable(),
  allowedModes: modes, requireEventTime: z.boolean(), requireMeasurementTime: z.boolean(),
  eventWindow: z.object({ minOffsetMs: z.number().int().safe(), maxOffsetMs: z.number().int().safe() }).strict().nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.eventWindow && (value.eventWindow.minOffsetMs > value.eventWindow.maxOffsetMs || !value.requireEventTime))
    ctx.addIssue({ code: 'custom', message: 'An event window requires event time and ordered bounds' });
});
const referencePin = z.object({ referenceId: id, contentHash: hash }).strict();
export const ClinicalRuleSchema = z.object({ ...base, id, revision,
  references: z.array(referencePin).min(1).max(100),
  applicability: z.object({ species: ids.min(1), population: ids.min(1), setting: ids.min(1) }).strict(),
  dependencies: z.array(ClinicalDependencySchema).min(1).max(100),
  predicate: z.object({ kind: z.literal('scalar_comparison'), dependencyId: id,
    operator: z.enum(['eq', 'lt', 'lte', 'gt', 'gte']), value: z.number().finite(), unit: id }).strict(),
  hypothesisId: id,
  meanings: z.object({ supported: text, contradicted: text, undetermined: text }).strict(),
}).strict().superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (new Set(value.references.map(reference => reference.referenceId)).size !== value.references.length) issue('Duplicate source references');
  if (new Set(value.dependencies.map(dependency => dependency.id)).size !== value.dependencies.length) issue('Duplicate dependency IDs');
  const target = value.dependencies.find(dependency => dependency.id === value.predicate.dependencyId);
  if (!target) issue('Predicate must reference a declared dependency');
  else if (target.unit !== value.predicate.unit) issue('Predicate unit must exactly match the dependency unit');
});
export const ClinicalSourceSchema = z.object({ ...base, id, revision, statement: text }).strict();
export const ClinicalSourceStateSchema = z.object({ document: ClinicalSourceSchema, contentHash: hash,
  status: z.enum(['approved', 'revoked', 'unreviewed']), approvedHash: hash.nullable(), readable: z.boolean(),
}).strict();
export const ClinicalRuleReviewSchema = z.object({ ruleId: id, ruleHash: hash, reviewerId: id,
  scope: z.literal('synthetic_fixture_test'), status: z.enum(['approved', 'revoked', 'unreviewed']),
}).strict();
// Explicit result casts compensate for Zod's optional-null inference when this
// repository compiles without strictNullChecks. Runtime schemas still require
// every nullable field and reject undefined or omitted values.
export function validateClinicalCase(input: unknown): ClinicalCase { return ClinicalCaseSchema.parse(input) as ClinicalCase; }
export function validateClinicalRule(input: unknown): ClinicalRule { return ClinicalRuleSchema.parse(input) as ClinicalRule; }
export function validateClinicalSource(input: unknown): ClinicalSource { return ClinicalSourceSchema.parse(input) as ClinicalSource; }
export function validateClinicalSourceState(input: unknown): ClinicalSourceState { return ClinicalSourceStateSchema.parse(input) as ClinicalSourceState; }
export function validateClinicalRuleReview(input: unknown): ClinicalRuleReview { return ClinicalRuleReviewSchema.parse(input) as ClinicalRuleReview; }
