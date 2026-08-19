/**
 * Observation with explicit missingness.
 *
 * `02_DATA_MODEL.md`: "`is_missing` is a real column with a real reason. A
 * missing observation has `numeric_value = NULL` and `is_missing = 1`. Nothing
 * downstream may coerce that to zero."
 *
 * The type is written so that the illegal state — a missing observation that
 * also carries a number — cannot be constructed, rather than merely being
 * discouraged by convention.
 */

export type MissingReason =
  | 'NOT_FETCHED'
  | 'FETCH_FAILED'
  | 'PARSE_FAILED'
  | 'PROVIDER_ZERO_RESULTS_UNRELIABLE'
  | 'SUPPRESSED_BY_POLICY'
  // Live-acquisition states (E3.2). Each is separate on purpose: they are the
  // same absence to a chart but three different actions for an operator, and
  // one of them means the study can be resumed while another means it cannot.
  //
  //  - RATE_LIMITED       transient; the same query may succeed later
  //  - QUOTA_EXHAUSTED    a billing state; retrying changes nothing
  //  - CREDENTIAL_UNAVAILABLE  the provider was never reachable for this run
  //
  // Collapsing them into FETCH_FAILED would make a half-finished run
  // indistinguishable from a genuinely unanswerable query.
  | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED'
  | 'CREDENTIAL_UNAVAILABLE';

export type QualityFlag =
  | 'PROVIDER_DISCONTINUITY'
  | 'COUNT_PARSE_UNCERTAIN'
  | 'PROVIDER_ESTIMATE'
  | 'SAFESEARCH_UNKNOWN'
  // D15 / 02_DATA_MODEL.md: the same disclosure discipline as
  // PROVIDER_DISCONTINUITY, applied to the rest of the query plan's identity.
  | 'QUERY_PLAN_DISCONTINUITY'
  | 'ALIAS_SET_DISCONTINUITY'
  | 'GEOGRAPHY_DISCONTINUITY';

interface ObservationBase {
  readonly seriesId: string;
  readonly entityId: string;
  /**
   * Which research axis this measures — `popularity`, `harm`, and so on.
   * Decided by the preset and carried on `SourceRequest`; never inferred by an
   * adapter from query text (`01_ARCHITECTURE.md` §SourceAdapter).
   */
  readonly queryRole: string;
  readonly queryText: string;
  readonly retrievedAt: string;
  readonly sourceId: string;
  readonly sourceAdapterVersion: string;
  readonly providerId?: string;
  readonly providerVersion?: string;
  readonly rawArtifactId?: string;
  readonly qualityFlags: readonly QualityFlag[];
}

export interface PresentObservation extends ObservationBase {
  readonly isMissing: false;
  readonly numericValue: number;
  readonly missingReason?: never;
}

export interface MissingObservation extends ObservationBase {
  readonly isMissing: true;
  readonly numericValue: null;
  readonly missingReason: MissingReason;
}

export type Observation = PresentObservation | MissingObservation;

export function isMissing(o: Observation): o is MissingObservation {
  return o.isMissing;
}

/**
 * The single accessor analysis code should use. Returns `null` for a missing
 * observation — never `0`, never a carried-forward previous value.
 */
export function numericOrNull(o: Observation): number | null {
  return o.isMissing ? null : o.numericValue;
}

export class MissingNotZeroError extends Error {
  readonly code = 'scientific_input_error';
  constructor(context: string) {
    super(`Refusing to coerce a missing observation to a number in ${context}. Missing is not zero.`);
    this.name = 'MissingNotZeroError';
  }
}

/**
 * Use where a number is genuinely required and missingness is a hard error,
 * so the failure is loud at the point of misuse rather than silently zero.
 */
export function requireNumeric(o: Observation, context: string): number {
  if (o.isMissing) throw new MissingNotZeroError(context);
  return o.numericValue;
}
