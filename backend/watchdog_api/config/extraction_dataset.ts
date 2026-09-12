import { readFileSync } from 'node:fs';
import { canonicalHash } from '../domain/canonical';
import { ExtractionDatasetProfileSchema } from '../../../shared/extraction_dataset_profile';
export function loadExtractionDatasetProfile() {
  const profile = ExtractionDatasetProfileSchema.parse(JSON.parse(readFileSync('config/extraction-dataset-ui.json', 'utf8')));
  return { ...profile, contentHash: canonicalHash(profile) };
}
