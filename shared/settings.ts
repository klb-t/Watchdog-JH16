import { z } from 'zod';
export const AssistantTaskSchema = z.enum(['query_expansion', 'method_proposal', 'narrative', 'extraction_plan', 'trip_report', 'paper_method', 'extension_proposal']);
export type AssistantTask = z.infer<typeof AssistantTaskSchema>;
export const SettingsSchema = z.object({
  version: z.literal('personal-settings-1'), mode: z.enum(['simple', 'standard', 'expert', 'debug']),
  density: z.enum(['comfortable', 'compact']), language: z.enum(['pl', 'en']), onboardingComplete: z.boolean(),
  searchDailyRequestLimit: z.number().int().min(0).max(10000),
  assistant: z.object({ enabled: z.boolean(), provider: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/), economy: z.number().int().min(0).max(100),
    dailyBudgetUsd: z.number().min(0).max(1000), requestBudgetUsd: z.number().min(0).max(50), allowFree: z.boolean(),
    modelPins: z.partialRecord(AssistantTaskSchema, z.string().max(160).nullable()),
    taskProviders: z.partialRecord(AssistantTaskSchema, z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/)).optional() }).strict(),
  research: z.object({ languages: z.array(z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)).min(1).max(20),
    geographies: z.array(z.string().regex(/^[A-Z]{2}(?:-[A-Z0-9]{1,8})?$/)).max(30), dialects: z.array(z.string().trim().min(1).max(80)).max(30),
    slang: z.boolean(), sentiment: z.boolean() }).strict(),
}).strict();
export type PersonalSettings = z.infer<typeof SettingsSchema>;
export interface SettingsRecord { value: PersonalSettings; hash: string; updatedAt: string | null }
export interface CatalogModel { id: string; name: string; contextTokens: number; maxOutputTokens: number | null;
  inputUsdPerToken: number; outputUsdPerToken: number; requestUsd: number; parameters: string[]; pricePolicy: 'maximum-listed-tier' | 'owner-reviewed-ceiling' }
export interface ModelCatalog { provider: string; models: CatalogModel[]; rejected: number; fetchedAt: string; source: string; rawHash: string; hash: string; unpricedModels?: string[] }
export interface ModelRoute { task: AssistantTask; model: CatalogModel; catalogHash: string; routingProfileHash: string;
  settingsHash: string;
  provider?: string; providerProfileHash?: string; evidence?: RoutingEvidence[];
  inputTokenAllowance: number; maxOutputTokens: number; reserveMicroUsd: number; reason: string }
export const ModelCeilingSchema = z.object({ provider: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/),
  id: z.string().regex(/^[A-Za-z0-9_./:+-]{1,160}$/), contextTokens: z.number().int().min(1000).max(10000000),
  maxOutputTokens: z.number().int().min(100).max(1000000), inputUsdPerMillion: z.number().min(0).max(100000),
  outputUsdPerMillion: z.number().min(0).max(100000), requestUsd: z.number().min(0).max(100),
  source: z.string().url().max(2000), observedAt: z.string().datetime(), validUntil: z.string().datetime() }).strict();
export type ModelCeiling = z.infer<typeof ModelCeilingSchema>;
export const BenchmarkSchema = z.object({ provider: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/), model: z.string().regex(/^[A-Za-z0-9_./:+-]{1,160}$/),
  task: AssistantTaskSchema, suiteHash: z.string().regex(/^[a-f0-9]{64}$/), passed: z.number().int().min(0), total: z.number().int().min(1).max(1000000),
  source: z.string().url().max(2000), observedAt: z.string().datetime() }).strict().refine(v => v.passed <= v.total, 'Passed cannot exceed total');
export type RoutingEvidence = { model: string; benchmark: { suiteHash: string; passed: number; total: number; source: string; observedAt: string; hash: string } | null;
  operations: { calls: number; successes: number; averageLatencyMs: number | null } };
export const ResearchPlanInputSchema = z.object({ name: z.string().trim().min(1).max(160), settingsHash: z.string().regex(/^[a-f0-9]{64}$/),
  baseline: z.enum(['fixture', 'live_serp', 'none']), refreshMemory: z.boolean(), scanPapers: z.boolean(), dailyScan: z.boolean(),
  paperScope: z.enum(['substances', 'all_science']) }).strict();
export type ResearchPlanInput = z.infer<typeof ResearchPlanInputSchema>;
