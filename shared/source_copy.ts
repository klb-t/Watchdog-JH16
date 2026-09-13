import { z } from 'zod';
import { CopyPlanSchema } from './research';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const SourceCopySchema=z.object({version:z.literal('source-copy-dataset-1'),numericPolicy:z.literal('decimal-roundtrip-binary64-1'),
  trialId:z.string().min(1),trialHash:hash,candidateId:z.string().min(1),candidateHash:hash,plan:CopyPlanSchema,
  raw:z.string().max(2000000),rawHash:hash,
  mappingTemplate:z.object({id:z.string().min(1),hash,modified:z.boolean()}).strict().optional(),
  mappings:z.array(z.object({key:z.string().min(1),sourceField:z.string().nullable(),emptyAsMissing:z.boolean()}).strict()).min(2).max(60),
}).strict();
export type SourceCopy=z.infer<typeof SourceCopySchema>;
