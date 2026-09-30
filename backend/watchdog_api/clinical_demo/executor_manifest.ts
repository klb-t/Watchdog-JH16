import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalHash } from '../domain/canonical';

/** Source identity for this source-run demonstration, not a build signature or
 * attestation of installed dependencies. The CLI supplies bytes from its checkout;
 * the lockfile pins the dependency recipe and the runtime is recorded separately.
 * No clock, filesystem access or executable code supplied by callers is used here. */
export const CLINICAL_EXECUTOR_FILES = [
  'backend/watchdog_api/clinical_demo/executor.ts',
  'backend/watchdog_api/clinical_demo/executor_manifest.ts',
  'backend/watchdog_api/domain/canonical.ts',
  'package-lock.json',
  'shared/clinical_demo.ts',
  'shared/clinical_demo_validation.ts',
] as const;

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const ManifestBodySchema = z.object({
  version: z.literal('clinical-demo-executor-manifest-1'),
  runtime: z.object({ node: z.string().regex(/^v\d+\.\d+\.\d+$/) }).strict(),
  files: z.array(z.object({ path: z.enum(CLINICAL_EXECUTOR_FILES), sha256: digest }).strict())
    .length(CLINICAL_EXECUTOR_FILES.length),
}).strict();
const ManifestSchema = ManifestBodySchema.extend({ hash: digest }).strict();
export type ClinicalExecutorManifest = z.infer<typeof ManifestSchema>;

export function buildExecutorManifest(sources: Record<string, string>, nodeVersion: string): ClinicalExecutorManifest {
  const supplied = Object.keys(sources).sort();
  if (JSON.stringify(supplied) !== JSON.stringify([...CLINICAL_EXECUTOR_FILES].sort()))
    throw new Error('Executor source manifest requires the exact declared file set.');
  const body = ManifestBodySchema.parse({
    version: 'clinical-demo-executor-manifest-1', runtime: { node: nodeVersion },
    files: supplied.map(path => {
      const bytes = sources[path];
      if (typeof bytes !== 'string' || !bytes.length) throw new Error(`Missing executor source bytes: ${path}`);
      return { path, sha256: createHash('sha256').update(bytes, 'utf8').digest('hex') };
    }),
  });
  return { ...body, hash: canonicalHash(body) };
}

export function validateExecutorManifest(input: unknown): ClinicalExecutorManifest {
  const parsed = ManifestSchema.parse(input);
  if (JSON.stringify(parsed.files.map(file => file.path)) !== JSON.stringify([...CLINICAL_EXECUTOR_FILES].sort()))
    throw new Error('Executor source manifest file set or canonical ordering differs.');
  const { hash, ...body } = parsed;
  if (canonicalHash(body) !== hash) throw new Error('Executor source manifest hash mismatch.');
  return parsed;
}
