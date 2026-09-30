import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SearchProfileSchema, type SearchProfile } from '../../../shared/search';
import { canonicalHash } from '../domain/canonical';
export function loadSearchProfile(): SearchProfile {
  const body = SearchProfileSchema.parse(JSON.parse(readFileSync(path.join(process.cwd(), 'config/search.json'), 'utf8')));
  return { ...body, contentHash: canonicalHash(body) };
}
