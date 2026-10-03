import { z } from 'zod';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(4000);
export const PaperMethodSchema = z.enum(['describe', 'pearson', 'spearman']);
export const DataOriginSchema = z.enum(['unspecified', 'new_observations', 'original_data_reuse', 'prior_dataset', 'proxy_measure', 'new_expert_panel', 'synthetic_scenario']);
export const PaperCohortSchema = z.object({
  rowIds: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.:-]{0,99}$/)).min(1).max(10000),
  quote: z.string().min(1).max(4000), rationale: text,
}).strict().refine(v => new Set(v.rowIds).size === v.rowIds.length, 'Cohort row identifiers must be distinct.');
export const PaperOperationInputSchema = z.object({
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('manual_quote'), documentId: z.string().min(1), documentHash: hash, quote: z.string().min(1).max(4000) }).strict(),
    z.object({ kind: z.literal('assessment_operation'), assessmentId: z.string().min(1), assessmentHash: hash, operationIndex: z.number().int().min(0).max(39) }).strict(),
  ]),
  method: PaperMethodSchema, datasetId: z.string().min(1), datasetHash: hash,
  bindings: z.array(z.object({ role: z.enum(['a', 'b']), column: z.string().min(1), rationale: text,
    origin: DataOriginSchema, requirementId: z.string().min(1).nullable(),
    substitution: z.object({ id: z.string().min(1), hash }).strict().nullable(),
  }).strict()).min(1).max(2),
  missingPolicy: z.enum(['propagate', 'exclude', 'fail']), scopeNote: text,
  cohort: PaperCohortSchema.optional(),
}).strict().superRefine((v, ctx) => {
  const roles = v.method === 'describe' ? ['a'] : ['a', 'b'];
  if (v.bindings.length !== roles.length || roles.some(r => v.bindings.filter(b => b.role === r).length !== 1))
    ctx.addIssue({ code: 'custom', message: 'Bind every method input exactly once.' });
  if (v.bindings.length === 2 && v.bindings[0].column === v.bindings[1].column)
    ctx.addIssue({ code: 'custom', message: 'Choose two distinct columns for association.' });
});
export type PaperOperationInput = z.infer<typeof PaperOperationInputSchema>;
const comparisonProfile = z.object({
  verdictLabel: text, observedLabel: text, deviationLabel: text, reasonLabel: text, rawResultLabel: text,
  title: text,
  notice: text,
  quoteLabel: text,
  expectedLabel: text,
  expectedMissingLabel: text,
  unitLabel: text,
  unitMissingLabel: text,
  statisticLabel: text,
  rationaleLabel: text,
  toleranceKindLabel: text,
  toleranceValueLabel: text,
  toleranceRationaleLabel: text,
  absoluteLabel: text,
  relativeLabel: text,
  saveLabel: text,
  reviewLabel: text,
  approveLabel: text,
  revokeLabel: text,
  executeLabel: text,
  reviseLabel: text,
  historyLabel: text,
  openLabel: text,
  versionLabel: text,
  reviewedLabel: text,
  unreviewedLabel: text,
  attemptsLabel: text,
  noAttemptsLabel: text,
  priorExposureLabel: text,
  exposureNotice: text,
  showResultLabel: text,
  exportLabel: text,
  resultLabel: text,
  detailsLabel: text,
  sourceLabel: text,
  missingLabel: text,
  saveNotice: text,
  downloadNotice: text,
  downloadError: text,
  inheritedLabel: text,
  methodRequiredLabel: text,
  statistics: z.array(z.object({ id: z.enum(['pearson', 'spearman', 'describe.mean', 'describe.median', 'describe.sd', 'describe.min', 'describe.max']), label: text }).strict()).length(7),
}).strict().refine(v => new Set(v.statistics.map(s => s.id)).size === 7, 'Unique comparison statistics required');
const familyOutcome = z.enum(['reproduced', 'deviates', 'not_computable', 'method_unclear', 'failed', 'refused', 'pending', 'not_run']);
/** E5.7b.1 labels; outcome keys mirror MEMBER_OUTCOMES in shared/paper_comparison_family.ts. */
const familyProfile = z.object({
  title: text, notice: text, titleLabel: text, rationaleLabel: text, membersLabel: text, noMembersLabel: text,
  createLabel: text, executeLabel: text, listLabel: text, denominatorLabel: text, supersedesLabel: text,
  supersededByLabel: text, reviseLabel: text, exposureLabel: text, eventsLabel: text, createdNotice: text,
  exportLabel: text, exportNotice: text,
  outcomes: z.record(familyOutcome, text).refine(v => familyOutcome.options.every(o => o in v), 'Every outcome needs a label'),
}).strict();
export const PaperOperationProfileSchema = z.object({
  version: z.enum(['paper-operation-ui-2', 'paper-operation-ui-3', 'paper-operation-ui-4']), title: text, introduction: text, scopeLabel: text,
  comparison: comparisonProfile.optional(),
  family: familyProfile.optional(),
  cohort: z.object({ title: text, allRows: text, selectedRows: text, quoteLabel: text, rationaleLabel: text,
    searchLabel: text, notice: text, reviewLabel: text }).strict(),
  methods: z.array(z.object({ id: PaperMethodSchema, label: text, renderer: z.enum(['bar','scatter']), missingPolicies: z.array(z.enum(['propagate','exclude','fail'])).min(1).max(3) }).strict()).length(3),
  origins: z.array(z.object({ id: DataOriginSchema, label: text }).strict()).length(7),
  missingPolicies: z.array(z.object({ id: z.enum(['propagate', 'exclude', 'fail']), label: text }).strict()).length(3),
}).strict().refine(v => new Set(v.methods.map(x => x.id)).size === 3 && new Set(v.origins.map(x => x.id)).size === 7 && new Set(v.missingPolicies.map(x => x.id)).size === 3, 'Unique profile options required').refine(v => v.version === 'paper-operation-ui-2' ? v.comparison === undefined : !!v.comparison, 'Comparison labels require profile version 3 or later')
  .refine(v => v.version === 'paper-operation-ui-4' ? !!v.family : v.family === undefined, 'Family labels require profile version 4');
