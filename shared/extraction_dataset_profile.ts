import { z } from 'zod';
import { DatasetSchema } from './workbench';
import { EVIDENCE_TIERS } from '../backend/watchdog_api/domain/evidence_tier';
const text = z.string().min(1).max(2000);
const labels = ["nameSuffix", "description", "sourceTitle", "sourcePublisher", "sourceLicense", "measureDefault", "scopeDefault", "rowLabel", "rowDescription", "sourceField", "rowMetadata", "heading", "introduction", "name", "measure", "datasetDescription", "scope", "mapping", "precision", "label", "labelAria", "type", "typeAria", "unit", "unitAria", "unitPlaceholder", "semantics", "semanticsAria", "key", "keyAria", "columnDescription", "columnDescriptionAria", "emptyAsMissing", "sourceContext", "evidence", "normalization", "language", "sharing", "create", "saved", "open", "templates", "templateSelect", "templateNone", "templateExplanation", "templateApply", "templateApplied", "templateSaveHint", "templateName", "templateSave", "templateSaved", "templateOrigin"] as const;
export const ExtractionDatasetProfileSchema = z.object({version: z.literal('extraction-dataset-ui-1'), labels: z.record(z.enum(labels), text),
  choices: z.object({types: z.record(DatasetSchema.shape.columns.element.shape.type, text),
    semantics: z.record(DatasetSchema.shape.columns.element.shape.semanticType, text),
    normalization: z.record(DatasetSchema.shape.normalization, text), language: z.record(DatasetSchema.shape.languageMeaning, text),
    source: z.record(z.enum(['title','publisher','license','sourceRecordId','url']), text), evidence: z.record(z.enum(EVIDENCE_TIERS), text),
  }).strict(),
}).strict();
export type ExtractionDatasetProfile = z.infer<typeof ExtractionDatasetProfileSchema> & {contentHash: string};
