import { Observation, QualityFlag, MissingReason } from '../domain/observation';

export type { Observation, QualityFlag, MissingReason };

export type SourceCapability =
  | 'result_count'
  | 'interest_over_time'
  | 'interest_by_region'
  | 'entity_reference'
  | 'scientific_literature'
  | 'numeric_reference_table'
  | 'chemical_properties'
  | 'pharmacology'
  | 'lab_sample'
  | 'alert_feed'
  | 'free_text_reports'
  | 'geospatial'
  | 'manual_dataset';

/**
 * Everything an adapter is told about what it is fetching.
 *
 * `01_ARCHITECTURE.md` §SourceAdapter: an adapter is **semantically neutral by
 * construction**. `dimension` — popularity, harm, or any other research axis a
 * future preset defines — is decided once, upstream, by the preset that renders
 * `renderedQuery`, and arrives here as an explicit field. `fetch` and
 * `normalize` copy it onto `Observation.queryRole`; they never re-derive it by
 * pattern-matching the query string.
 *
 * The failure mode this prevents: an adapter that infers meaning from the text
 * it is asked to fetch has quietly taken over a decision belonging to the
 * preset, and two presets rendering similar-looking text would be silently
 * misclassified.
 */
/**
 * How far a query plan expands beyond canonical naming, per D15 and
 * `12_DRUG_DOMAIN_ONTOLOGY_AND_ASSERTIONS.md` §Query expansion modes.
 *
 * Expanding to slang or market labels is a *different measurement plan* from
 * strict canonical naming, not a refinement of it, so it is declared rather
 * than inferred and a mid-series change is a flagged discontinuity.
 */
export const QUERY_EXPANSION_MODES = [
  'STRICT_CANONICAL',
  'SCIENTIFIC_SYNONYMS',
  'LOCALIZED_SYNONYMS',
  'EXPERIMENTAL_SLANG_EXPANSION',
] as const;

export type QueryExpansionMode = typeof QUERY_EXPANSION_MODES[number];

export interface SourceRequest {
  readonly renderedQuery: string;
  readonly dimension: string;
  readonly entityId: string;
  /**
   * BCP-47-ish language/locale tag. Per D15, a query rendered in Dutch is a
   * different measurement plan from the same query in Polish, so this is part
   * of the plan's identity rather than an adapter preference.
   */
  readonly language: string;
  readonly queryExpansionMode: QueryExpansionMode;
  readonly presetId: string;
  readonly presetVersion: string;
  /** Adapter-specific knobs, already validated by `validateParams`. */
  readonly params?: Record<string, any>;
}

export class InvalidSourceRequestError extends Error {
  readonly code = 'validation_error';
  constructor(detail: string) {
    super(`Invalid SourceRequest: ${detail}`);
    this.name = 'InvalidSourceRequestError';
  }
}

/**
 * Validates the fields every adapter depends on. Deleting or corrupting
 * `dimension` must fail here rather than falling back to text inspection —
 * asserted by the adapter-neutrality suite in `09_TESTS.md`.
 */
export function assertValidSourceRequest(request: SourceRequest | undefined | null): asserts request is SourceRequest {
  if (!request) throw new InvalidSourceRequestError('request is missing');
  if (typeof request.renderedQuery !== 'string' || request.renderedQuery.length === 0) {
    throw new InvalidSourceRequestError("'renderedQuery' is required");
  }
  if (typeof request.dimension !== 'string' || request.dimension.length === 0) {
    throw new InvalidSourceRequestError(
      "'dimension' is required and comes from the preset; an adapter must never infer it from query text"
    );
  }
  if (typeof request.entityId !== 'string' || request.entityId.length === 0) {
    throw new InvalidSourceRequestError("'entityId' is required");
  }
  // D15: language and expansion mode are part of the plan's identity, on the
  // same footing as dimension. Neither may be inferred or defaulted here — a
  // silently assumed locale or expansion mode splices two different
  // measurement plans into one series.
  if (typeof request.language !== 'string' || request.language.length === 0) {
    throw new InvalidSourceRequestError(
      "'language' is required and comes from the query plan; a query rendered in one language is a different measurement from the same query in another"
    );
  }
  if (!QUERY_EXPANSION_MODES.includes(request.queryExpansionMode)) {
    throw new InvalidSourceRequestError(
      `'queryExpansionMode' is required and must be one of ${QUERY_EXPANSION_MODES.join(', ')}; expanding to synonyms or slang is a different plan, not a refinement of the canonical one`
    );
  }
}

export interface RawFetchResult {
  payload: Buffer | null;
  status: string; // "SUCCESS" | "ZERO_RESULTS" | "RATE_LIMIT" | ...
  http_status?: number;
  metadata?: Record<string, any>;
  /** Assigned by the persistence layer once the bytes are archived. */
  raw_blob_id?: string;
  /**
   * The request this result answers. Carried on the result so `normalize` has
   * the preset's `dimension` without being handed free-form params it might be
   * tempted to interpret.
   */
  request: SourceRequest;
}

export interface ProvenanceMetadata {
  retention_policy: string;
  license: string;
  attribution: string;
}

export interface ValidatedParams {
  valid: boolean;
  normalized_params: Record<string, any>;
  errors?: string[];
}

export interface SourceAdapter {
  readonly adapter_id: string;
  readonly adapter_version: string;

  capabilities(): SourceCapability[];
  validate_params(params: Record<string, any>): ValidatedParams;
  fetch(request: SourceRequest): Promise<RawFetchResult>;
  normalize(raw: RawFetchResult): Observation[];
  provenance(raw: RawFetchResult): ProvenanceMetadata;
}

/** Shared field assembly so every adapter stamps provenance identically. */
export function baseObservationFields(raw: RawFetchResult, sourceId: string, adapterVersion: string) {
  return {
    seriesId: '',
    entityId: raw.request.entityId,
    queryRole: raw.request.dimension,
    queryText: raw.request.renderedQuery,
    retrievedAt: new Date().toISOString(),
    sourceId,
    sourceAdapterVersion: adapterVersion,
    rawArtifactId: raw.raw_blob_id,
  };
}
