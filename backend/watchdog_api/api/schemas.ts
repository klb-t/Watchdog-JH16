import { z } from 'zod';

export const RunSubmissionSchema = z.object({
  type: z.enum(['ACQUISITION', 'ANALYSIS', 'PIPELINE']),
  config: z.object({
    source_id: z.string().optional(),
    source_params: z.record(z.string(), z.any()).optional(),
    method_id: z.string().optional(),
    method_params: z.record(z.string(), z.any()).optional(),
    source_run_id: z.string().optional()
  })
});
