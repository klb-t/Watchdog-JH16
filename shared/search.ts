import { z } from 'zod';
import type { Capability } from './authorization';

/** Search categories describe stored entities, not a ranking of their credibility. */
export const SEARCH_KINDS = ['substance', 'symptom', 'target', 'sample', 'market_label', 'interaction', 'dataset', 'paper', 'run', 'schedule', 'source'] as const;
export type SearchKind = typeof SEARCH_KINDS[number];
export const SEARCH_CAPABILITIES: readonly Capability[] = ['responder.lookup', 'evidence.review', 'workbench.view', 'method.propose', 'run.view', 'run.create'];
export const SEARCH_KIND_CAPABILITIES: Readonly<Record<SearchKind, readonly Capability[]>> = {
  substance: ['responder.lookup', 'evidence.review'], symptom: ['responder.lookup', 'evidence.review'],
  target: ['responder.lookup', 'evidence.review'], sample: ['responder.lookup', 'evidence.review'],
  market_label: ['responder.lookup', 'evidence.review'], interaction: ['responder.lookup', 'evidence.review'],
  dataset: ['workbench.view'], paper: ['method.propose'], run: ['run.view'], schedule: ['run.create'], source: ['run.view'],
};
export const SearchProfileSchema = z.object({
  version: z.literal('owned-metadata-search-1'),
  limits: z.object({ queryCharacters: z.number().int().min(1).max(1000), defaultPage: z.number().int().positive(),
    maximumPage: z.number().int().positive().max(500), maximumOffset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict(),
  labels: z.object(Object.fromEntries(SEARCH_KINDS.map(kind => [kind, z.string().trim().min(1).max(100)])) as Record<SearchKind, z.ZodString>).strict(),
  scope: z.string().trim().min(1).max(2000), ordering: z.literal('kind_label_id'),
}).strict().refine(p => p.limits.defaultPage <= p.limits.maximumPage, 'Default page cannot exceed the maximum.');
export type SearchProfile = z.infer<typeof SearchProfileSchema> & { contentHash: string };
export interface SearchQuery { q: string; kind: SearchKind | 'all'; limit: number; offset: number }
export interface SearchProvenance { recordId: string; contentHash: string | null; publisher: string; url: string | null; evidenceTier: string | null; approvalState: string | null }
export interface SearchHit {
  id: string; kind: SearchKind; label: string; details: string[]; href: string;
  visibility: 'owned' | 'shared_aggregate' | 'reference' | 'registry';
  status: string | null; contentHash: string | null; provenance: SearchProvenance[];
}
export interface SearchResponse {
  query: SearchQuery; profile: SearchProfile; availableKinds: SearchKind[];
  total: number; results: SearchHit[]; nextOffset: number | null; paginationBoundaryReached: boolean;
}
export function searchQuerySchema(profile: SearchProfile) {
  return z.object({ q: z.string().trim().max(profile.limits.queryCharacters).default(''),
    kind: z.enum(['all', ...SEARCH_KINDS]).default('all'),
    limit: z.coerce.number().int().min(1).max(profile.limits.maximumPage).default(profile.limits.defaultPage),
    offset: z.coerce.number().int().min(0).max(profile.limits.maximumOffset).default(0),
  }).strict();
}
/** Unicode normalization and a literal substring match: %, _ and SQL syntax have no special meaning. */
export const normalizeSearchText = (text: string) => text.normalize('NFKC').toLowerCase();
export function compareSearchHits(a: SearchHit, b: SearchHit): number {
  const left = [a.kind, normalizeSearchText(a.label), a.id], right = [b.kind, normalizeSearchText(b.label), b.id];
  for (let i = 0; i < left.length; i++) { if (left[i] < right[i]) return -1; if (left[i] > right[i]) return 1; }
  return 0;
}
