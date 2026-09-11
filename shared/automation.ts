import { z } from 'zod';

export const JobRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('substance_refresh'), names: z.array(z.string().trim().min(2).max(160)).min(1).max(30),
    providers: z.array(z.enum(['pubchem', 'chembl', 'wikidata', 'europe_pmc'])).min(1).max(4).refine(p => p.includes('pubchem') && new Set(p).size === p.length, 'PubChem identity resolution is required; providers must be unique'),
    maxRequests: z.number().int().min(1).max(200), pageLimit: z.number().int().min(1).max(10) }).strict(),
  z.object({ kind: z.literal('paper_scan'), providers: z.array(z.enum(['arxiv', 'europe_pmc'])).min(1).max(2),
    scope: z.enum(['substances', 'all_science']), lookbackDays: z.number().int().min(1).max(90),
    maxRequests: z.number().int().min(1).max(40), pageLimit: z.number().int().min(1).max(20) }).strict(),
  z.object({ kind: z.literal('catalog_refresh'), provider: z.literal('openrouter'), maxRequests: z.literal(1) }).strict(),
  z.object({ kind: z.literal('paper_review'), documentId: z.string().min(1).max(100).nullable(), includeDiscoveredAbstracts: z.boolean(),
    maxRequests: z.number().int().min(1).max(5), retryFailed: z.boolean().optional() }).strict()
    .refine(v=>!v.retryFailed||v.documentId!==null,'A retry must identify one document'),
]);
export type JobRequest = z.infer<typeof JobRequestSchema>;
export const RecurrenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily_utc'), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }).strict(),
  z.object({ kind: z.literal('interval'), minutes: z.number().int().min(15).max(525600) }).strict(),
]);
export type Recurrence = z.infer<typeof RecurrenceSchema>;
export const ScheduleSchema = z.object({ name: z.string().trim().min(1).max(160), recurrence: RecurrenceSchema,
  request: JobRequestSchema, enabled: z.boolean() }).strict()
  .refine(v=>v.request.kind!=='paper_review'||!v.request.retryFailed,'Failed paid attempts can be retried only by a one-off job');
export type ScheduleInput = z.infer<typeof ScheduleSchema>;
export type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'CANCELED' | 'INTERRUPTED';
export interface AutomationJob {
  id: string; ownerId: string; scheduleId: string | null; dueAt: string; status: JobStatus;
  request: JobRequest; requestHash: string; createdAt: string; startedAt: string | null; finishedAt: string | null;
  result: Record<string, unknown> | null; error: string | null; cancelRequested: boolean;
}
export interface ScheduleRecord extends ScheduleInput { id: string; contentHash: string; nextDueAt: string; updatedAt: string }

/** Next future occurrence. Missed slots coalesce into one job, never a catch-up storm. */
export function nextOccurrence(recurrence: Recurrence, after: Date, previousDue?: string): string {
  if (!Number.isFinite(after.getTime())) throw new Error('Invalid scheduler clock');
  if (recurrence.kind === 'daily_utc') {
    const next = new Date(after); next.setUTCHours(recurrence.hour, recurrence.minute, 0, 0);
    if (next <= after) next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString();
  }
  const interval = recurrence.minutes * 60000, anchor = previousDue ? Date.parse(previousDue) : after.getTime();
  return new Date(anchor + Math.max(1, Math.floor((after.getTime() - anchor) / interval) + 1) * interval).toISOString();
}

export interface PublicReceipt { id: string; provider: string; url: string; fetchedAt: string; sha256: string;
  httpStatus: number; bytes: number; adapterVersion: string; jobId: string; license: string }
export interface PaperRecord {
  id: string; provider: 'arxiv' | 'europe_pmc'; sourceId: string; title: string; abstract: string | null;
  authors: string[]; doi: string | null; url: string; publishedAt: string | null; updatedAt: string | null;
  categories: string[]; sourceLanguage: string | null; geography: null; receiptId: string;
  screening: { version: string; hints: string[]; blockers: string[]; state: 'DISCOVERED'; clinicalUse: false };
}
export interface MemorySubstance { id: string; name: string; identifiers: { namespace: string; value: string; provenance: string }[];
  aliases: { name: string; language: string | null; source: string }[];
  records: { id: string; provider: string; kind: string; value: any; receipt: PublicReceipt }[];
  activities: { id: string; value: any; evidenceTier: string; approvalState: string; citation: any }[] }
