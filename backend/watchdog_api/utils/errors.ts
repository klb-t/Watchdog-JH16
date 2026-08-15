import { randomUUID } from 'node:crypto';

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
