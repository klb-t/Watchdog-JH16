import { z } from 'zod';

/**
 * Which fields may carry a default, and which may not.
 *
 * E1.1's stated test requires that "a missing required field never silently
 * defaults". A default is only permissible where absence has one unambiguous,
 * safe reading. Two rules decide it:
 *
 *   - `schema_version` is required at every level. Inventing one means
 *     validating and hashing a config authored against a different schema as
 *     though it were this one — the silent-substitution failure CLAUDE.md
 *     rule 4 forbids. Absence must be an error, not a fill-in.
 *   - `locked` on a preset is required, because defaulting it to `false` fails
 *     *open* on a scientific invariant: a FAITHFUL preset that lost the field
 *     would silently become overridable, which 03_JH2016_CONTRACT.md forbids.
 *
 * Everything else keeps its default because absence is genuinely unambiguous:
 * a config with no sources is a legitimate empty config, and
 * `missing_data_policy` defaults to `error`, which fails *closed*.
 */

export const RunManifestSchema = z.object({
  schema_version: z.string(),
  run_id: z.string().uuid(),
  effective_config_hash: z.string(),
  timestamp: z.string().datetime(),
  entities: z.array(z.string()),
  query_templates: z.record(z.string(), z.string()),
});

export const SourceConfigSchema = z.object({
  schema_version: z.string(),
  source_id: z.string(),
  adapter: z.string(),
  enabled: z.boolean().default(true),
  parameters: z.record(z.string(), z.any()).optional(),
  timeout_ms: z.number().default(30000)
});

export const AnalysisPresetSchema = z.object({
  schema_version: z.string(),
  preset_id: z.string(),
  locked: z.boolean(),
  entities: z.array(z.string()),
  query_templates: z.record(z.string(), z.string()),
  missing_data_policy: z.enum(['exclude', 'error', 'impute']).default('error'),
});

export const AppConfigSchema = z.object({
  schema_version: z.string(),
  diagnostics_mode: z.enum(['OFF', 'ERRORS', 'NORMAL', 'TRACE']).default('NORMAL'),
  sources: z.record(z.string(), SourceConfigSchema).default({}),
  analysis_presets: z.record(z.string(), AnalysisPresetSchema).default({})
});
