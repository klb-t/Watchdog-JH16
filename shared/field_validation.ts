import { z } from 'zod';
import { EVIDENCE_TIERS, assertWithinCeiling } from '../backend/watchdog_api/domain/evidence_tier';
import { CONTENT_CATEGORIES, type ReferenceDocument, type FieldQuery, type FieldProfile } from './field';

const text = z.string().trim().min(1).max(500);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,180}$/);
const date = z.iso.date();
const nullableText = text.nullable();
const url = z.url().refine(value => {
  const parsed = new URL(value);
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
}, 'A public HTTPS citation without embedded credentials is required.');
const entity = z.object({ id, name: text, type: z.enum(['substance', 'symptom', 'target']), targetType: z.enum(['receptor', 'transporter', 'enzyme', 'pathway']).optional() }).strict();
const substance = entity.extend({ type: z.literal('substance') });
const region = z.object({ id, name: text, parentId: id.nullable() }).strict();
const citation = z.object({ url, title: text, publisher: text, retrievedAt: z.iso.datetime(),
  locator: text, sourceRecordId: text }).strict();
const base = { key: id, citation, evidenceTier: z.enum(EVIDENCE_TIERS),
  qualityFlags: z.array(id).max(30) };

const sample = z.object({ ...base, kind: z.literal('sample'), name: text,
  origin: z.enum(['lab_sample', 'published_alert', 'visual_report']), region,
  observedOn: date.nullable(), timeBasis: z.enum(['tested', 'published', 'reported', 'unknown']),
  testMethod: nullableText,
  appearance: z.object({ colors: z.array(text).max(10), shape: nullableText, logo: nullableText,
    scoreLine: nullableText }).strict(),
  market: z.object({ label: text, group: text, language: text }).strict().nullable(),
  components: z.array(z.object({ substance, amount: z.number().finite().nonnegative().nullable(),
    unit: nullableText, note: nullableText }).strict()).max(100),
  unknownComponents: z.array(text).max(30),
}).strict();
const assertion = z.object({ ...base, kind: z.literal('assertion'), subject: substance,
  predicate: z.enum(['INTERACTS_WITH', 'ASSOCIATED_WITH_SYMPTOM', 'ASSOCIATED_WITH_EFFECT',
    'ASSOCIATED_WITH_TOXICITY', 'AFFECTS_ORGAN_SYSTEM', 'BINDS_TO', 'AGONIST_AT', 'ANTAGONIST_AT',
    'MODULATES', 'INHIBITS', 'INDUCES', 'METABOLIZED_BY', 'ANALOG_OF', 'STRUCTURALLY_SIMILAR_TO',
    'METABOLITE_OF', 'HAS_LEGAL_STATUS', 'SUBJECT_TO_ALERT']),
  object: entity.nullable(), category: z.enum(CONTENT_CATEGORIES),
  statement: z.object({ text: z.string().trim().min(1).max(2500), language: text,
    kind: z.enum(['source_excerpt', 'curator_summary']), mechanism: nullableText,
    severity: nullableText, population: nullableText }).strict(),
  region: region.nullable(), validFrom: date.nullable(), validTo: date.nullable(),
  contradicts: z.array(id).max(30), supersedes: id.nullable(),
}).strict();

export const ReferenceDocumentSchema = z.discriminatedUnion('kind', [sample, assertion]);
export function validateReferenceDocument(input: unknown): ReferenceDocument {
  const doc = ReferenceDocumentSchema.parse(input) as ReferenceDocument;
  const entities = doc.kind === 'sample' ? doc.components.map(c => c.substance) : [doc.subject, ...(doc.object ? [doc.object] : [])];
  for (const entity of entities) if ((entity.type === 'target') !== Boolean(entity.targetType))
    throw new FieldValidationError('Targets require an explicit targetType; other entities must not carry one.');
  const uniqueSorted = (values: string[]) => [...new Set(values)].sort();
  doc.qualityFlags = uniqueSorted(doc.qualityFlags);
  if (doc.kind === 'sample') {
    doc.components.sort((a, b) => a.substance.id < b.substance.id ? -1 : a.substance.id > b.substance.id ? 1 : 0);
    doc.appearance.colors = uniqueSorted(doc.appearance.colors);
    doc.unknownComponents = uniqueSorted(doc.unknownComponents);
    if (doc.origin === 'visual_report') assertWithinCeiling(doc.evidenceTier, 'MODELED_PREDICTED', 'visual report');
    if (doc.origin === 'published_alert') assertWithinCeiling(doc.evidenceTier, 'CURATED_SECONDARY', 'published alert without a specimen report');
    if (doc.origin === 'lab_sample' && (!doc.testMethod || doc.timeBasis !== 'tested' || !doc.observedOn))
      throw new FieldValidationError('A lab sample requires its actual test method and date. Use published_alert when these are unknown.');
    if ((doc.observedOn === null) !== (doc.timeBasis === 'unknown'))
      throw new FieldValidationError('Unknown dates require an explicit unknown time basis.');
    if (new Set(doc.components.map(c => c.substance.id)).size !== doc.components.length)
      throw new FieldValidationError('A specimen cannot list the same component twice.');
    for (const component of doc.components) {
      if (component.amount !== null && !component.unit)
        throw new FieldValidationError('A measured amount requires its reported unit.');
    }
  } else {
    doc.contradicts = uniqueSorted(doc.contradicts);
    if (doc.predicate === 'INTERACTS_WITH' && (doc.object?.type !== 'substance' || doc.category !== 'interactions'))
      throw new FieldValidationError('An interaction requires two substances and the interactions category.');
    if (doc.predicate === 'ASSOCIATED_WITH_SYMPTOM' && doc.object?.type !== 'symptom')
      throw new FieldValidationError('A symptom association must reference a symptom.');
    if (doc.validFrom && doc.validTo && doc.validFrom > doc.validTo)
      throw new FieldValidationError('Validity interval is reversed.');
  }
  return doc;
}
export class FieldValidationError extends Error {
  readonly code = 'validation_error';
  constructor(message: string) { super(message); this.name = 'FieldValidationError'; }
}
export class FieldConflictError extends Error {
  readonly code = 'reference_conflict';
  constructor(message: string) { super(message); this.name = 'FieldConflictError'; }
}
const descriptor = z.string().trim().max(100).refine(v => !/[@\r\n]/.test(v), 'Only pill descriptors belong here.');
export const FieldQuerySchema = z.object({
  mode: z.enum(['pill', 'market', 'symptoms']), term: descriptor, color: descriptor,
  shape: descriptor, scoreLine: descriptor, symptomIds: z.array(id).max(30), regionId: id,
  from: date.nullable(), to: date.nullable(), includeBroaderContext: z.boolean(), language: text,
  expansionMode: z.enum(['STRICT_CANONICAL', 'SCIENTIFIC_SYNONYMS', 'LOCALIZED_SYNONYMS', 'EXPERIMENTAL_SLANG_EXPANSION']),
}).strict().superRefine((q, ctx) => {
  if (q.from && q.to && q.from > q.to) ctx.addIssue({ code: 'custom', message: 'Date window is reversed.' });
  if (q.mode === 'symptoms' && !q.symptomIds.length && !q.term) ctx.addIssue({ code: 'custom', message: 'Select a symptom or enter a symptom name.' });
});
export const validateFieldQuery = (input: unknown): FieldQuery => FieldQuerySchema.parse(input) as FieldQuery;

const profileText = z.string().min(1);
export const FieldProfileSchema = z.object({ version: profileText, staleAfterHours: z.number().positive(), offlineMaxHours: z.number().positive().max(12),
    regions: z.array(z.object({ id: profileText, name: profileText, parentId: profileText.nullable() }).strict()),
    categories: z.array(z.object({ id: z.enum(CONTENT_CATEGORIES), label: profileText }).strict()),
    tiers: z.record(z.enum(EVIDENCE_TIERS), z.object({ label: profileText, bucket: profileText, icon: profileText,
      color: z.string().regex(/^#[0-9a-f]{6}$/i) }).strict()),
    colors: z.array(z.object({ id: profileText, label: profileText, aliases: z.array(profileText) }).strict()), disclaimer: profileText,
    contacts: z.array(z.object({ regionId: profileText, name: profileText, phone: z.string().regex(/^\+?[0-9]+$/).nullable(),
      url, audience: profileText, verifiedOn: z.iso.date(), citationUrl: url }).strict()),
  }).strict();

export function validateFieldProfile(profile: unknown): FieldProfile {
  const validated = FieldProfileSchema.parse(profile) as FieldProfile;
  if (validated.categories.map(c => c.id).join(',') !== CONTENT_CATEGORIES.join(','))
    throw new Error('Responder category order must preserve the twelve-category contract.');
  const ids = new Set(validated.regions.map(r => r.id));
  if (ids.size !== validated.regions.length) throw new Error('Duplicate region IDs.');
  const seen = new Set<string>();
  for (const region of validated.regions) {
    if (region.parentId && !seen.has(region.parentId)) throw new Error('Regions must follow their parent, without cycles.');
    seen.add(region.id);
  }
  for (const contact of validated.contacts) if (!ids.has(contact.regionId)) throw new Error('Contact references an unknown region.');
  return validated;
}
