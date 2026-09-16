import { z } from 'zod';

export const RunSubmissionSchema = z.object({
  type: z.enum(['ACQUISITION', 'ANALYSIS', 'PIPELINE']),
  config: z.object({
    source_id: z.string().optional(),
    source_params: z.record(z.string(), z.any()).optional(),
    method_id: z.string().optional(),
    method_params: z.record(z.string(), z.any()).optional(),
    source_run_id: z.string().optional(),
    // D15: part of the query plan's identity, carried through rather than
    // stripped, and never defaulted server-side.
    language: z.string().optional(),
    query_expansion_mode: z.enum([
      'STRICT_CANONICAL', 'SCIENTIFIC_SYNONYMS', 'LOCALIZED_SYNONYMS', 'EXPERIMENTAL_SLANG_EXPANSION'
    ]).optional(),
    entities: z.array(z.string()).optional(),
    query_templates: z.record(z.string(), z.string()).optional()
  })
});
