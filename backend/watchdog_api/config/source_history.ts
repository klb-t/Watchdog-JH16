import { readFileSync } from 'node:fs';
import { canonicalHash } from '../domain/canonical';
import { SourceHistoryProfileSchema, type SourceHistoryProfile } from '../../../shared/source_history';
export function loadSourceHistoryProfile(): SourceHistoryProfile {
  const profile = SourceHistoryProfileSchema.parse(JSON.parse(readFileSync('config/source-history-ui.json', 'utf8')));
  return { ...profile, contentHash: canonicalHash(profile) };
}
