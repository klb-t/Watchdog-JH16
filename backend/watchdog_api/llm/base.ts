/**
 * The `text.generate` capability contract.
 *
 * Rule 2 is the constraint this module is shaped by: **no LLM in the numerical
 * path.** A generator returns text and nothing but text. There is deliberately
 * no numeric field anywhere in `TextGenerationResult`, no "confidence", no
 * "score", and no structured-output mode — every one of those is a doorway for
 * a model-produced number to be read later as a measurement.
 *
 * A model's output is also not reproducible. That is not a defect to be hidden
 * behind `temperature: 0`; it is a property, and it is recorded
 * (`nondeterministic_content`) so that rule 7's byte-identical guarantee is
 * never quietly claimed for a run whose prose came from a sampler.
 */

export interface TextGenerationRequest {
  /** Instruction text. Contains no scientific values the model may alter. */
  readonly prompt: string;
  readonly system?: string;
  readonly model: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface TextGenerationResult {
  readonly text: string;
  readonly providerKey: string;
  readonly model: string;
  /** The provider's own id for the completion, for audit against their logs. */
  readonly upstreamId: string | null;
  /** Token counts, for cost visibility. Not a scientific quantity. */
  readonly usage: { promptTokens: number | null; completionTokens: number | null };
  readonly nondeterministic: true;
  /** Exact non-secret parameter layers and submitted-body hash, when captured. */
  readonly generation?: GenerationParameters & { requestBodyHash: string; credentialRef: string };
}

export interface GenerationParameters {
  readonly schema: 'watchdog.generation_parameters/1';
  readonly providerProfileHash: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly sources: Readonly<Record<string, 'provider_profile' | 'task_profile' | 'request' | 'reservation'>>;
  readonly hash: string;
}

export type LlmFailureKind =
  | 'credential_absent'
  | 'credential_invalid'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'model_not_permitted'
  | 'invalid_parameters'
  | 'upstream_error'
  | 'malformed_response';

/**
 * Every failure is an exception carrying a distinguishable kind. There is no
 * path that returns fallback prose: prose that reads as a finding but was
 * produced by an error handler is exactly the fabrication rule 1 forbids, and
 * it would be indistinguishable from a real narrative once approved.
 */
export class TextGenerationError extends Error {
  readonly code = 'provider_error';
  constructor(
    readonly kind: LlmFailureKind,
    readonly providerKey: string,
    detail: string,
    readonly retryable: boolean = false,
  ) {
    super(`text.generate via '${providerKey}' failed (${kind}): ${detail}`);
    this.name = 'TextGenerationError';
  }
}

/** Runtime callers must supply a JSON object; missing/malformed is not empty. */
export function assertGenerationParameterRecord(value: unknown, providerKey: string): asserts value is Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
    throw new TextGenerationError('invalid_parameters', providerKey, 'Generation parameters must be an object');
}

export interface TextGenerator {
  readonly providerKey: string;
  generate(request: TextGenerationRequest): Promise<TextGenerationResult>;
}

/** Injectable so no test reaches the network. */
export type HttpPost = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
