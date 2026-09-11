import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { JobRequestSchema, RecurrenceSchema } from '../../../shared/automation';
import { canonicalHash } from '../domain/canonical';
const SourceSchema = z.object({ id: z.string(), source: z.string(), label: z.string(), implemented: z.boolean(), keyRequired: z.boolean(),
  minIntervalMs: z.number().int().min(250).optional(), origin: z.string().url().optional(), pathPrefix: z.string().optional(),
  documentation: z.string().url(), license: z.string(), purpose: z.string() }).strict();
const Schema = z.object({ schemaVersion: z.literal('automation-profile-1'), label: z.string(), verifiedOn: z.string(),
  worker: z.object({ pollMs: z.number().min(1000), leaseMs: z.number().min(60000), heartbeatMs: z.number().min(1000),
    requestTimeoutMs: z.number().min(1000).max(30000), maxResponseBytes: z.number().max(10000000) }).strict(),
  sources: z.array(SourceSchema), substanceSeeds: z.array(z.string()),
  discovery: z.object({ screeningVersion: z.string(), arxivSubstanceQuery: z.string(), europePmcSubstanceQuery: z.string(),
    methodHints: z.array(z.string()), blockers: z.array(z.string()) }).strict(),
  defaults: z.object({ substanceJob: JobRequestSchema, paperJob: JobRequestSchema, recurrence: RecurrenceSchema }).strict(),
}).strict();
export function loadAutomationProfile(filename = path.join(process.cwd(), 'config/automation.json')) {
  const data = Schema.parse(JSON.parse(readFileSync(filename, 'utf8')));
  if (new Set(data.sources.map(s => s.id)).size !== data.sources.length) throw new Error('Duplicate public source profile');
  return { ...data, contentHash: canonicalHash(data) };
}
export type AutomationProfile = ReturnType<typeof loadAutomationProfile>;
