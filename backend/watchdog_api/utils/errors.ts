import { randomUUID } from 'node:crypto';

/**
 * Thrown by any capability registered as 'planned' or 'blocked' when invoked.
 * Per CLAUDE.md rule 1: a stub must never reach a code path that produces a
 * number a human might read as a measurement. There is no fallback value.
 */
export class NotImplementedError extends Error {
  readonly code = 'NOT_IMPLEMENTED';
  readonly capabilityId: string;
  readonly status: string;

  constructor(capabilityId: string, status: string) {
    super(`Capability '${capabilityId}' is not implemented. Status: ${status}`);
    this.name = 'NotImplementedError';
    this.capabilityId = capabilityId;
    this.status = status;
  }
}

export interface ConfigIssue {
  path: string;
  rule: string;
  message: string;
}

/**
 * Thrown when configuration fails schema validation.
 *
 * 01_ARCHITECTURE.md §Configuration: "Invalid configuration fails at startup,
 * loudly, with the failing path and the schema rule. Never fall back to a
 * default when configuration is present but wrong." The raw ZodError message
 * is a JSON blob; this renders the same information as one legible line per
 * issue while keeping the structured `issues` for programmatic callers.
 */
export class ConfigValidationError extends Error {
  readonly code = 'validation_error';
  readonly issues: ConfigIssue[];

  constructor(issues: ConfigIssue[]) {
    const detail = issues
      .map(i => `  at '${i.path}': ${i.message} [${i.rule}]`)
      .join('\n');
    super(`Configuration failed validation:\n${detail}`);
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

export interface ErrorEnvelope {
  error_id: string;
  trace_id?: string;
  span_id?: string;
  timestamp: string;
  component: string;
  operation: string;
  stage?: string;
  error_code: string;
  exception_type: string;
  message: string;
  stack_trace?: string;
  cause_chain: ErrorEnvelope[];
  retryable: boolean;
  handled: boolean;
}

export function buildErrorEnvelope(
  error: any,
  context: { component: string; operation: string; trace_id?: string; span_id?: string; stage?: string },
  handled: boolean = false,
  retryable: boolean = false,
  errorCode: string = 'UNKNOWN_ERROR'
): ErrorEnvelope {
  const causeChain: ErrorEnvelope[] = [];
  let currentCause = error.cause;
  
  while (currentCause) {
    causeChain.push({
      error_id: randomUUID(),
      timestamp: new Date().toISOString(),
      component: context.component,
      operation: context.operation,
      error_code: currentCause.code || 'UNKNOWN_CAUSE',
      exception_type: currentCause.name || 'Error',
      message: currentCause.message || String(currentCause),
      stack_trace: currentCause.stack,
      cause_chain: [],
      retryable: false,
      handled: true,
    });
    currentCause = currentCause.cause;
  }

  return {
    error_id: randomUUID(),
    trace_id: context.trace_id,
    span_id: context.span_id,
    timestamp: new Date().toISOString(),
    component: context.component,
    operation: context.operation,
    stage: context.stage,
    error_code: error.code || errorCode,
    exception_type: error.name || 'Error',
    message: error.message || String(error),
    stack_trace: error.stack,
    cause_chain: causeChain,
    retryable,
    handled
  };
}
