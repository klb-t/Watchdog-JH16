import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(4000);
export const PaperComparisonStatisticSchema = z.enum(['pearson', 'spearman', 'describe.mean', 'describe.median', 'describe.sd', 'describe.min', 'describe.max']);
export const PaperComparisonClaimSchema = z.object({
  quote: z.string().min(1).max(4000), expectedValue: z.number().finite().nullable(),
  unit: text.nullable(), statistic: PaperComparisonStatisticSchema, rationale: text,
  tolerance: z.object({ kind: z.enum(['absolute', 'relative']), value: z.number().finite().nonnegative(), rationale: text }).strict(),
}).strict();
export const PaperComparisonInputSchema = z.object({
  operationId: z.string().min(1), operationHash: hash, claim: PaperComparisonClaimSchema,
  supersedes: z.object({ id: z.string().min(1), hash }).strict().nullable(),
}).strict();
export type PaperComparisonClaim = z.infer<typeof PaperComparisonClaimSchema>;
export type PaperComparisonInput = z.infer<typeof PaperComparisonInputSchema>;
