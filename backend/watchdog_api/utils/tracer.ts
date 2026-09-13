import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { redact, redactText } from './redaction';
import { buildErrorEnvelope, ErrorEnvelope } from './errors';

export type DiagnosticsMode = 'OFF' | 'ERRORS' | 'NORMAL' | 'TRACE';

export interface TraceContext {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  sequence_no: number;
  request_id?: string;
  run_id?: string;
  job_id?: string;
  actor_id?: string;
  component: string;
  operation: string;
  stage?: string;
}

/**
 * The ordered event vocabulary from `06_DIAGNOSTICS.md`:
 *
 *   STEP_ENTER -> STATE_BEFORE -> INPUT -> VALIDATION -> DECISION
 *              -> TRANSFORM/CALL -> RESULT -> STATE_AFTER -> STEP_EXIT
 *
 * On failure: EXCEPTION -> stack -> cause chain -> STATE_AT_FAILURE.
 */
export const TRACE_EVENT_TYPES = [
  'SPAN_START', 'STEP_ENTER', 'STATE_BEFORE', 'INPUT', 'VALIDATION', 'DECISION',
  'TRANSFORM', 'CALL', 'RESULT', 'STATE_AFTER', 'STEP_EXIT', 'SPAN_END',
  'EXCEPTION', 'STATE_AT_FAILURE', 'WARNING',
] as const;

export type TraceEventType = typeof TRACE_EVENT_TYPES[number] | string;

export interface TraceEvent {
  event_type: string;
  context: TraceContext;
  timestamp: string;
  payload?: any;
}

class Tracer {
  private mode: DiagnosticsMode = 'NORMAL';
  private als = new AsyncLocalStorage<TraceContext>();
  private sequences = new WeakMap<TraceContext, { value: number }>();
  // Overridable so a run can keep its own trace inside its own run directory,
  // rather than every run sharing one global folder.
  private logDir = process.env.WATCHDOG_DIAGNOSTICS_DIR
    ? path.resolve(process.env.WATCHDOG_DIAGNOSTICS_DIR)
    : path.join(process.cwd(), 'diagnostics');

  constructor() {
    const envMode = process.env.WATCHDOG_DIAGNOSTICS_MODE?.toUpperCase() as DiagnosticsMode;
    if (['OFF', 'ERRORS', 'NORMAL', 'TRACE'].includes(envMode)) {
      this.mode = envMode;
    }
    if (this.mode === 'TRACE' || this.mode === 'ERRORS') {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  public getLogDir(): string {
    return this.logDir;
  }

  public setLogDir(dir: string) {
    this.logDir = path.resolve(dir);
    if (this.mode === 'TRACE' || this.mode === 'ERRORS') {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  public traceDir(traceId: string, when: Date = new Date()): string {
    return path.join(this.logDir, when.toISOString().split('T')[0], traceId);
  }

  public getMode(): DiagnosticsMode {
    return this.mode;
  }

  public setMode(mode: DiagnosticsMode) {
    this.mode = mode;
    if (this.mode === 'TRACE' || this.mode === 'ERRORS') {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  public getContext(): TraceContext | undefined {
    return this.als.getStore();
  }

  private writeLog(traceId: string, filename: string, data: any) {
    if (this.mode === 'OFF') return;
    const today = new Date().toISOString().split('T')[0];
    const traceDir = path.join(this.logDir, today, traceId);
    fs.mkdirSync(traceDir, { recursive: true });
    const filepath = path.join(traceDir, filename);
    const line = JSON.stringify(redact(data)) + '\n';
    fs.appendFileSync(filepath, line); // Synchronous for simplicity in dev flight recorder
  }

  public emit(eventType: string, payload?: any) {
    if (this.mode === 'OFF') return;
    const ctx = this.getContext();
    if (!ctx) return;
    
    ctx.sequence_no++;
    const event: TraceEvent = {
      event_type: eventType,
      context: { ...ctx },
      timestamp: new Date().toISOString(),
      payload: payload ? redact(payload) : undefined
    };

    if (this.mode === 'TRACE') {
      this.writeLog(ctx.trace_id, 'events.jsonl', event);
    } else if (this.mode === 'NORMAL') {
      if (['SPAN_START', 'SPAN_END', 'WARNING', 'EXCEPTION'].includes(eventType)) {
        console.log(redactText(`[${eventType}] ${ctx.component}:${ctx.operation} - ${JSON.stringify(redact(payload) || '')}`));
      }
    }
  }

  /**
   * Records which branch was taken **and the value that determined it**.
   * `06_DIAGNOSTICS.md` calls this the single highest-value event type for
   * debugging and the one most often omitted, so it gets a first-class API
   * rather than relying on callers to hand-roll a payload.
   */
  public decision(branch: string, becauseField: string, becauseValue: unknown, extra?: Record<string, unknown>) {
    this.emit('DECISION', { branch, because: { field: becauseField, value: becauseValue }, ...extra });
  }

  public stateBefore(state: unknown) { this.emit('STATE_BEFORE', { state }); }
  public stateAfter(state: unknown) { this.emit('STATE_AFTER', { state }); }
  public input(value: unknown) { this.emit('INPUT', { value }); }
  public validation(valid: boolean, detail?: unknown) { this.emit('VALIDATION', { valid, detail }); }
  public result(value: unknown) { this.emit('RESULT', { value }); }

  public emitError(error: any, handled: boolean = false, retryable: boolean = false) {
    if (this.mode === 'OFF') return;
    const ctx = this.getContext();
    if (!ctx) return;
    
    const envelope = redact(buildErrorEnvelope(error, ctx, handled, retryable)) as ErrorEnvelope;
    if (this.mode === 'TRACE' || this.mode === 'ERRORS') {
      this.writeLog(ctx.trace_id, 'errors.jsonl', envelope);
      this.emit('EXCEPTION', { error_id: envelope.error_id });
    }
    if (this.mode === 'NORMAL') {
      console.error(redactText(`[ERROR] ${ctx.component}:${ctx.operation} ${envelope.message}`));
    }
  }

  public async runWithSpan<T>(
    component: string,
    operation: string,
    fn: () => T | Promise<T>,
    overrides?: Partial<TraceContext>
  ): Promise<T> {
    const parentCtx = this.getContext();
    const trace_id = overrides?.trace_id || parentCtx?.trace_id || randomUUID();
    const span_id = randomUUID();
    const sameTrace = parentCtx?.trace_id === trace_id;
    const parent_span_id = sameTrace ? parentCtx?.span_id : undefined;
    const sequence = sameTrace && parentCtx ? this.sequences.get(parentCtx)! : { value: 0 };
    
    const newCtx: TraceContext = {
      trace_id,
      span_id,
      parent_span_id,
      sequence_no: sequence.value,
      component,
      operation,
      request_id: overrides?.request_id || parentCtx?.request_id,
      run_id: overrides?.run_id || parentCtx?.run_id,
      job_id: overrides?.job_id || parentCtx?.job_id,
      actor_id: overrides?.actor_id || parentCtx?.actor_id,
      stage: overrides?.stage || parentCtx?.stage,
    };
    // Every span of a trace shares one counter, including concurrently awaited siblings.
    // An enumerable accessor keeps the public context/event schema unchanged.
    Object.defineProperty(newCtx, 'sequence_no', { enumerable: true, get: () => sequence.value, set: value => { sequence.value = value; } });
    this.sequences.set(newCtx, sequence);

    return this.als.run(newCtx, async () => {
      this.emit('SPAN_START');
      this.emit('STEP_ENTER');
      try {
        const result = await fn();
        this.emit('STEP_EXIT', { status: 'success' });
        this.emit('SPAN_END');
        return result;
      } catch (err) {
        this.emit('STATE_AT_FAILURE');
        this.emitError(err);
        this.emit('STEP_EXIT', { status: 'failed' });
        this.emit('SPAN_END');
        throw err;
      }
    });
  }
}

export const tracer = new Tracer();

export function traceStep(component: string, operation: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      return tracer.runWithSpan(component, operation, () => originalMethod.apply(this, args));
    };
    return descriptor;
  };
}
