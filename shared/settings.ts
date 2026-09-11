import { z } from 'zod';
export const AssistantTaskSchema = z.enum(['query_expansion', 'method_proposal', 'narrative']);
export type AssistantTask = z.infer<typeof AssistantTaskSchema>;
export const SettingsSchema = z.object({
  version: z.literal('personal-settings-1'), mode: z.enum(['simple', 'standard', 'expert', 'debug']),
  density: z.enum(['comfortable', 'compact']), language: z.enum(['pl', 'en']), onboardingComplete: z.boolean(),
  searchDailyRequestLimit: z.number().int().min(0).max(10000),
  assistant: z.object({ enabled: z.boolean(), provider: z.literal('openrouter'), economy: z.number().int().min(0).max(100),
    dailyBudgetUsd: z.number().min(0).max(1000), requestBudgetUsd: z.number().min(0).max(50), allowFree: z.boolean(),
    modelPins: z.record(AssistantTaskSchema, z.string().max(160).nullable()) }).strict(),
  research: z.object({ languages: z.array(z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)).min(1).max(20),
    geographies: z.array(z.string().regex(/^[A-Z]{2}(?:-[A-Z0-9]{1,8})?$/)).max(30), dialects: z.array(z.string().trim().min(1).max(80)).max(30),
    slang: z.boolean(), sentiment: z.boolean() }).strict(),
}).strict();
export type PersonalSettings = z.infer<typeof SettingsSchema>;
export interface SettingsRecord { value: PersonalSettings; hash: string; updatedAt: string | null }
export interface CatalogModel { id: string; name: string; contextTokens: number; maxOutputTokens: number | null;
  inputUsdPerToken: number; outputUsdPerToken: number; requestUsd: number; parameters: string[]; pricePolicy: 'maximum-listed-tier' }
export interface ModelCatalog { provider: 'openrouter'; models: CatalogModel[]; rejected: number; fetchedAt: string; source: string; rawHash: string; hash: string }
export interface ModelRoute { task: AssistantTask; model: CatalogModel; catalogHash: string; routingProfileHash: string;
  settingsHash: string;
  inputTokenAllowance: number; maxOutputTokens: number; reserveMicroUsd: number; reason: string }
export const ResearchPlanInputSchema = z.object({ name: z.string().trim().min(1).max(160), settingsHash: z.string().regex(/^[a-f0-9]{64}$/),
  baseline: z.enum(['fixture', 'live_serp', 'none']), refreshMemory: z.boolean(), scanPapers: z.boolean(), dailyScan: z.boolean(),
  paperScope: z.enum(['substances', 'all_science']) }).strict();
export type ResearchPlanInput = z.infer<typeof ResearchPlanInputSchema>;
