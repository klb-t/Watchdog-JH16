import { z } from 'zod';

export const RunManifestSchema = z.object({
  schema_version: z.string(),
  run_id: z.string().uuid(),
  effective_config_hash: z.string(),
  timestamp: z.string().datetime(),
  entities: z.array(z.string()),
  query_templates: z.record(z.string(), z.string()),
});

export const SourceConfigSchema = z.object({
  schema_version: z.string().default("1.0"),
  source_id: z.string(),
  adapter: z.string(),
  enabled: z.boolean().default(true),
  parameters: z.record(z.string(), z.any()).optional(),
  timeout_ms: z.number().default(30000)
});

export const AnalysisPresetSchema = z.object({
  schema_version: z.string().default("1.0"),
  preset_id: z.string(),
  locked: z.boolean().default(false),
  entities: z.array(z.string()),
  query_templates: z.record(z.string(), z.string()),
  missing_data_policy: z.enum(['exclude', 'error', 'impute']).default('error'),
});

export const AppConfigSchema = z.object({
  schema_version: z.string().default("1.0"),
  diagnostics_mode: z.enum(['OFF', 'ERRORS', 'NORMAL', 'TRACE']).default('NORMAL'),
  sources: z.record(z.string(), SourceConfigSchema).default({}),
  analysis_presets: z.record(z.string(), AnalysisPresetSchema).default({})
});
