import { z } from 'zod';
import { CLINICAL_DEMO_VERSION } from './clinical_demo';

const id = z.string().regex(/^fixture:[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/);
const ids = z.array(id).min(1).max(100)
  .refine(values => new Set(values).size === values.length, 'Duplicate IDs are not permitted');
const text = z.string().min(1).max(1000);

/** Fictional availability declarations, separate from FieldProfile and from rights.
 * Offsets describe prospective fixture observations relative to case.referenceTime,
 * the explicitly supplied demonstration decision clock. They never backfill history. */
export const SyntheticTestProfileSchema = z.object({
  schemaVersion: z.literal(CLINICAL_DEMO_VERSION),
  purpose: z.literal('software-demonstration'),
  id,
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  tests: z.array(z.object({
    id,
    quantityId: id,
    unit: id,
    available: z.boolean(),
    allowedModes: z.array(z.enum(['reported', 'measured'])).min(1).max(2)
      .refine(values => new Set(values).size === values.length, 'Duplicate modes'),
    applicability: z.object({ species: ids, population: ids, setting: ids }).strict(),
    timing: z.object({
      eventOffsetMs: z.number().int().safe().min(0),
      measurementOffsetMs: z.number().int().safe().min(0),
    }).strict().refine(value => value.measurementOffsetMs >= value.eventOffsetMs,
      'Prospective measurement cannot precede its event'),
    sourceIds: ids,
    limitations: z.array(text).min(1).max(20),
  }).strict()).max(100),
}).strict().refine(value => new Set(value.tests.map(test => test.id)).size === value.tests.length,
  'Duplicate test identities');

export type SyntheticTestProfile = z.infer<typeof SyntheticTestProfileSchema>;
export type SyntheticAvailableTest = SyntheticTestProfile['tests'][number];
export function validateSyntheticTestProfile(input: unknown): SyntheticTestProfile {
  return SyntheticTestProfileSchema.parse(input);
}

/** Bundled profile fixture; CLI exposes only these two availability variants. */
export function createDemoTestProfile(availability: 'available' | 'unavailable'): SyntheticTestProfile {
  if (availability !== 'available' && availability !== 'unavailable') throw new Error('Unknown fixture availability variant');
  return validateSyntheticTestProfile({
    schemaVersion: CLINICAL_DEMO_VERSION, purpose: 'software-demonstration', id: 'fixture:profile-demo', revision: 1,
    tests: [{
      id: 'fixture:test-alpha', quantityId: 'fixture:q-alpha', unit: 'fixture:u-alpha', available: availability === 'available',
      allowedModes: ['measured'],
      applicability: { species: ['fixture:species-a'], population: ['fixture:population-a'], setting: ['fixture:setting-a'] },
      timing: { eventOffsetMs: 0, measurementOffsetMs: 1000 },
      sourceIds: ['fixture:availability-source-a'],
      limitations: ['Invented availability declaration for a software demonstration; no actual test or clinical content.'],
    }],
  });
}
