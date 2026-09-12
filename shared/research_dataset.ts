import { z } from 'zod';
import { DatasetSchema } from './workbench';
import { EVIDENCE_TIERS } from '../backend/watchdog_api/domain/evidence_tier';
export const ExtractionDatasetSchema=z.object({expectedTrialHash:z.string().regex(/^[a-f0-9]{64}$/),
  name:DatasetSchema.shape.name,description:DatasetSchema.shape.description,
  source:DatasetSchema.shape.source.omit({url:true,retrievedAt:true}).extend({url:z.union([z.literal(''),DatasetSchema.shape.source.shape.url])}),
  measure:DatasetSchema.shape.measure,normalization:DatasetSchema.shape.normalization,
  comparisonScope:DatasetSchema.shape.comparisonScope,languageMeaning:DatasetSchema.shape.languageMeaning,
  evidenceTier:z.enum(EVIDENCE_TIERS),
  columns:z.array(DatasetSchema.shape.columns.element.extend({sourceField:z.string().nullable(),emptyAsMissing:z.boolean()})).min(2).max(60),
}).strict().refine(v=>new Set(v.columns.map(c=>c.key)).size===v.columns.length,'Column identifiers must be unique');
export type ExtractionDatasetInput=z.infer<typeof ExtractionDatasetSchema>;
