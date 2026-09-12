import { z } from 'zod';
import { DatasetSchema } from './workbench';
import { EVIDENCE_TIERS } from '../backend/watchdog_api/domain/evidence_tier';
export const ExtractionDatasetSchema=z.object({expectedTrialHash:z.string().regex(/^[a-f0-9]{64}$/),
  name:DatasetSchema.shape.name,description:DatasetSchema.shape.description,
  source:DatasetSchema.shape.source.omit({url:true,retrievedAt:true}).extend({url:z.union([z.literal(''),DatasetSchema.shape.source.shape.url])}),
  measure:DatasetSchema.shape.measure,normalization:DatasetSchema.shape.normalization,
  comparisonScope:DatasetSchema.shape.comparisonScope,languageMeaning:DatasetSchema.shape.languageMeaning,
  evidenceTier:z.enum(EVIDENCE_TIERS),
  template:z.object({id:z.string().min(1),expectedHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional(),
  columns:z.array(DatasetSchema.shape.columns.element.extend({sourceField:z.string().nullable(),emptyAsMissing:z.boolean()})).min(2).max(60),
}).strict().refine(v=>new Set(v.columns.map(c=>c.key)).size===v.columns.length,'Column identifiers must be unique');
export type ExtractionDatasetInput=z.infer<typeof ExtractionDatasetSchema>;

/** Reusable mapping deliberately excludes observations, citation, review and evidence tier. */
export const ExtractionMappingSchema=z.object({columns:ExtractionDatasetSchema.shape.columns,
  measure:ExtractionDatasetSchema.shape.measure,normalization:ExtractionDatasetSchema.shape.normalization,
  comparisonScope:ExtractionDatasetSchema.shape.comparisonScope,languageMeaning:ExtractionDatasetSchema.shape.languageMeaning,
}).strict().refine(v=>new Set(v.columns.map(c=>c.key)).size===v.columns.length,'Column identifiers must be unique');
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(250);
export const ExtractionMappingTemplateSchema=z.object({version:z.literal('extraction-mapping-template-1'),name:z.string().trim().min(1).max(100),
  candidateId:id,candidateHash:hash,sourceDatasetId:id,sourceDatasetHash:hash,sourceTrialId:id,sourceTrialHash:hash,mapping:ExtractionMappingSchema,
}).strict();
export type ExtractionMappingTemplate=z.infer<typeof ExtractionMappingTemplateSchema>;
export type ExtractionMappingTemplateRecord={id:string;hash:string;body:ExtractionMappingTemplate;createdAt:string};
export function extractionMapping(settings:Pick<ExtractionDatasetInput,'columns'|'measure'|'normalization'|'comparisonScope'|'languageMeaning'>) {
  const {columns,measure,normalization,comparisonScope,languageMeaning}=settings;
  return ExtractionMappingSchema.parse({columns,measure,normalization,comparisonScope,languageMeaning});
}
