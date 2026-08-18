/**
 * Stable machine-readable error codes, per `01_ARCHITECTURE.md` §Error taxonomy.
 * Exposed to the client; provider detail stays in the diagnostic stream.
 */
export const ERROR_CODES = [
  'validation_error',
  'authorization_error',
  'approval_required',
  'source_auth_error',
  'source_rate_limit',
  'source_timeout',
  'source_schema_change',
  'normalization_error',
  'scientific_input_error',
  'method_spec_invalid',
  'analysis_error',
  'storage_error',
  'export_error',
  'cancellation'
] as const;

export type ErrorCode = typeof ERROR_CODES[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/** Base for domain errors carrying a taxonomy code. */
export abstract class DomainError extends Error {
  abstract readonly code: ErrorCode;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
