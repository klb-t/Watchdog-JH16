import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { SettingsSchema, AssistantTaskSchema } from '../../../shared/settings';
import { canonicalHash } from '../domain/canonical';
const Choice = z.object({ id: z.string(), label: z.string() }).strict();
const Schema = z.object({ schemaVersion: z.literal('assistant-routing-1'),
  catalog: z.object({ provider: z.literal('openrouter'), url: z.string().url(), maxAgeHours: z.number().min(1).max(168), maxBytes: z.number().max(10000000), maxModels: z.number().max(5000), documentation: z.string().url() }).strict(),
  transport: z.object({ timeoutMs: z.number().min(1000).max(120000), maxResponseBytes: z.number().max(2000000), inputOverheadTokens: z.number().int().min(1024) }).strict(),
  tasks: z.array(z.object({ id: AssistantTaskSchema, label: z.string(), maxOutputTokens: z.number().int().min(100).max(10000), minimumContext: z.number().min(8000), maxCostQuantile: z.number().min(0).max(1), instruction: z.string() }).strict()),
  routingEvidence: z.object({ minimumBenchmarkTrials: z.number().int().min(1), maximumAgeDays: z.number().int().min(1).max(365),
    benchmarkWeight: z.number().min(0).max(1), reliabilityWeight: z.number().min(0).max(1), minimumOperationalCalls: z.number().int().min(1) }).strict(),
  defaults: SettingsSchema, languageProfiles: z.array(Choice), geographyProfiles: z.array(Choice),
}).strict();
export function loadAssistantProfile(filename = path.join(process.cwd(), 'config/assistant.json')) {
  const profile = Schema.parse(JSON.parse(readFileSync(filename, 'utf8')));
  if (new Set(profile.tasks.map(t => t.id)).size !== AssistantTaskSchema.options.length) throw new Error('All unique assistant task profiles are required');
  return { ...profile, contentHash: canonicalHash(profile) };
}
export type AssistantProfile = ReturnType<typeof loadAssistantProfile>;
