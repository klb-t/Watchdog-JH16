import { z } from 'zod';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(4000);
export const PaperMethodSchema = z.enum(['describe', 'pearson', 'spearman']);
export const DataOriginSchema = z.enum(['unspecified', 'new_observations', 'original_data_reuse', 'prior_dataset', 'proxy_measure', 'new_expert_panel', 'synthetic_scenario']);
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
}).strict().superRefine((v, ctx) => {
  const roles = v.method === 'describe' ? ['a'] : ['a', 'b'];
  if (v.bindings.length !== roles.length || roles.some(r => v.bindings.filter(b => b.role === r).length !== 1))
    ctx.addIssue({ code: 'custom', message: 'Bind every method input exactly once.' });
  if (v.bindings.length === 2 && v.bindings[0].column === v.bindings[1].column)
    ctx.addIssue({ code: 'custom', message: 'Choose two distinct columns for association.' });
});
export type PaperOperationInput = z.infer<typeof PaperOperationInputSchema>;
export const PaperOperationProfileSchema = z.object({
  version: z.literal('paper-operation-ui-1'), title: text, introduction: text, scopeLabel: text,
  methods: z.array(z.object({ id: PaperMethodSchema, label: text, renderer: z.enum(['bar','scatter']), missingPolicies: z.array(z.enum(['propagate','exclude','fail'])).min(1).max(3) }).strict()).length(3),
  origins: z.array(z.object({ id: DataOriginSchema, label: text }).strict()).length(7),
  missingPolicies: z.array(z.object({ id: z.enum(['propagate', 'exclude', 'fail']), label: text }).strict()).length(3),
}).strict().refine(v => new Set(v.methods.map(x => x.id)).size === 3 && new Set(v.origins.map(x => x.id)).size === 7 && new Set(v.missingPolicies.map(x => x.id)).size === 3, 'Unique profile options required');
