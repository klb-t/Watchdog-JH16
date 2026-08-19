import { createHash } from 'node:crypto';
import { canonicalizeJson } from '../domain/canonical';

/**
 * Run manifest assembly (E1.19).
 *
 * `02_DATA_MODEL.md`: "A manifest that omits a substitution, a missing value or
 * a flag is a defect of the highest severity in this project. The manifest is
 * the scientific claim; everything else is working material."
 *
 * So this module's job is completeness, and `assertManifestComplete` exists to
 * make an incomplete one fail loudly at build time rather than ship quietly.
 */

export const MANIFEST_SCHEMA_VERSION = '1.0';

export interface ManifestFetchRecord {
  source_id: string;
  provider_id: string | null;
  provider_version: string | null;
  rendered_query: string | null;
  request_hash: string | null;
  raw_blob_sha256: string | null;
  http_status: number | null;
  status: string;
}

export interface ManifestAnalysisRecord {
  method_spec_id: string | null;
  method_spec_hash: string | null;
  approval_state: string;
  approved_by: string | null;
  executor_id: string | null;
  executor_version: string | null;
  input_series_ids: string[];
  input_hashes: string[];
}

export interface ManifestMissingObservation {
  entity_id: string;
  query_role: string;
  missing_reason: string;
}

export interface ManifestNarrativeRecord {
  provider_id: string | null;
  model: string | null;
  generation_params: Record<string, unknown> | null;
  input_payload_hash: string;
  approval_state: string;
}

export interface RunManifest {
  schema_version: string;
  run_id: string;
  run_type: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  app_version: string | null;
  git_commit: string | null;
  effective_config_hash: string | null;
  effective_config: unknown;
  preset_id: string | null;
  preset_version: string | null;
  preset_locked: boolean;
  fetches: ManifestFetchRecord[];
  analyses: ManifestAnalysisRecord[];
  quality_flags: string[];
  artifacts: { kind: string; sha256: string; object_uri: string }[];
  missing_observations: ManifestMissingObservation[];
  narratives: ManifestNarrativeRecord[];
  /** Any provider/unit/method substitution that happened, per rule 4. */
  substitutions: { kind: string; from: string; to: string; recorded_at: string }[];
  /**
   * Detected mid-series changes of instrument or query plan (E3.3).
   *
   * Distinct from `substitutions`: a substitution is a decision someone made
   * and recorded, whereas this is what the data itself shows happened. The two
   * disagreeing is informative — an undeclared discontinuity means a vendor or
   * plan changed without anyone declaring it.
   */
  discontinuities: ManifestDiscontinuity[];
  /**
   * Per series, the fraction of adjacent observation pairs that could actually
   * be checked for discontinuity. Present so that an empty `discontinuities`
   * list over unverifiable rows is not read as a clean bill of health.
   */
  discontinuity_coverage: Record<string, number>;
}

export interface ManifestDiscontinuity {
  series_key: string;
  kind: string;
  attribute: string;
  from: string;
  to: string;
  at: string;
}

/** Fields whose absence makes the manifest a defect rather than merely thin. */
const REQUIRED_FIELDS: (keyof RunManifest)[] = [
  'schema_version', 'run_id', 'run_type', 'status', 'created_at',
  'effective_config_hash', 'effective_config', 'preset_id', 'preset_version', 'preset_locked',
  'fetches', 'analyses', 'quality_flags', 'artifacts', 'missing_observations',
  'narratives', 'substitutions', 'discontinuities', 'discontinuity_coverage',
];

/**
 * Fields that must additionally be non-null. A manifest may legitimately not
 * know the git commit; it may never not know which configuration produced it.
 */
const REQUIRED_NON_NULL: (keyof RunManifest)[] = [
  'schema_version', 'run_id', 'run_type', 'status', 'created_at',
  'effective_config_hash', 'effective_config',
];

export class IncompleteManifestError extends Error {
  readonly code = 'export_error';
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`Manifest is incomplete; missing required field(s): ${missing.join(', ')}`);
    this.name = 'IncompleteManifestError';
    this.missing = missing;
  }
}

export function assertManifestComplete(manifest: Partial<RunManifest>): asserts manifest is RunManifest {
  const absent = REQUIRED_FIELDS.filter(f => !(f in manifest) || manifest[f] === undefined);
  const nulled = REQUIRED_NON_NULL.filter(f => manifest[f] === null);
  const missing = [...absent, ...nulled.map(f => `${String(f)} (null)`)];
  if (missing.length > 0) throw new IncompleteManifestError(missing as string[]);
}

export interface BuildManifestInput {
  run: {
    id: string; run_type: string; status: string; created_at: string;
    started_at?: string | null; completed_at?: string | null;
    app_version?: string | null; git_commit?: string | null;
    effective_config?: string | null; effective_config_hash?: string | null;
    preset_id?: string | null; preset_version?: string | null;
  };
  presetLocked?: boolean;
  fetches: ManifestFetchRecord[];
  analyses: ManifestAnalysisRecord[];
  artifacts: { kind: string; sha256: string; object_uri: string }[];
  missingObservations: ManifestMissingObservation[];
  qualityFlags: string[];
  discontinuities?: ManifestDiscontinuity[];
  discontinuityCoverage?: Record<string, number>;
  narratives?: ManifestNarrativeRecord[];
  substitutions?: { kind: string; from: string; to: string; recorded_at: string }[];
}

export function buildManifest(input: BuildManifestInput): RunManifest {
  const manifest: RunManifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    run_id: input.run.id,
    run_type: input.run.run_type,
    status: input.run.status,
    created_at: input.run.created_at,
    started_at: input.run.started_at ?? null,
    completed_at: input.run.completed_at ?? null,
    app_version: input.run.app_version ?? null,
    git_commit: input.run.git_commit ?? null,
    effective_config_hash: input.run.effective_config_hash ?? null,
    effective_config: input.run.effective_config ? JSON.parse(input.run.effective_config) : {},
    preset_id: input.run.preset_id ?? null,
    preset_version: input.run.preset_version ?? null,
    preset_locked: input.presetLocked ?? false,

    // Everything below is sorted so two runs on identical input produce
    // byte-identical manifests.
    fetches: [...input.fetches].sort((a, b) =>
      (a.rendered_query ?? '').localeCompare(b.rendered_query ?? '') ||
      a.source_id.localeCompare(b.source_id)),
    analyses: [...input.analyses].sort((a, b) =>
      (a.method_spec_hash ?? '').localeCompare(b.method_spec_hash ?? '')),
    quality_flags: [...new Set(input.qualityFlags)].sort(),
    // Sorted by kind then URI, deliberately NOT by sha256: an artifact that
    // names its own run has a run-dependent digest, so hash-ordering would
    // shuffle the list between otherwise identical runs. The URI is stable.
    artifacts: [...input.artifacts].sort((a, b) =>
      a.kind.localeCompare(b.kind) || a.object_uri.localeCompare(b.object_uri)),
    missing_observations: [...input.missingObservations].sort((a, b) =>
      a.entity_id.localeCompare(b.entity_id) || a.query_role.localeCompare(b.query_role)),
    narratives: [...(input.narratives ?? [])].sort((a, b) =>
      a.input_payload_hash.localeCompare(b.input_payload_hash)),
    substitutions: [...(input.substitutions ?? [])].sort((a, b) =>
      a.kind.localeCompare(b.kind) || a.from.localeCompare(b.from)),
    discontinuities: [...(input.discontinuities ?? [])].sort((a, b) =>
      a.series_key.localeCompare(b.series_key) || a.at.localeCompare(b.at)
      || a.attribute.localeCompare(b.attribute) || a.from.localeCompare(b.from)),
    discontinuity_coverage: Object.fromEntries(
      Object.entries(input.discontinuityCoverage ?? {}).sort(([a], [b]) => a.localeCompare(b))),
  };

  assertManifestComplete(manifest);
  return manifest;
}

/** Canonical bytes and hash for storage. */
export function serializeManifest(manifest: RunManifest): { bytes: Buffer; sha256: string } {
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return { bytes, sha256: createHash('sha256').update(canonicalizeJson(manifest)).digest('hex') };
}
