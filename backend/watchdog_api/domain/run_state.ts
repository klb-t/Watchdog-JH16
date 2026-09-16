/**
 * Run lifecycle, per `01_ARCHITECTURE.md` §Run lifecycle:
 *
 *   CREATED → VALIDATING → QUEUED → RUNNING → NORMALIZING → ANALYZING
 *           → EXPORTING → COMPLETED
 *
 * Any active stage may transition to FAILED. Cancellation goes to CANCELLED.
 * Finalised runs are immutable except for append-only audit metadata; a
 * correction is a new run with `supersedes_run_id` set, never an edit.
 */
export const RUN_STATES = [
  'CREATED',
  'VALIDATING',
  'QUEUED',
  'RUNNING',
  'NORMALIZING',
  'ANALYZING',
  'EXPORTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
] as const;

export type RunState = typeof RUN_STATES[number];

/** States from which no further transition is legal. */
export const TERMINAL_RUN_STATES: readonly RunState[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

/** Stages that represent work in flight, and so may fail or be cancelled. */
const ACTIVE_STATES: readonly RunState[] = [
  'CREATED', 'VALIDATING', 'QUEUED', 'RUNNING', 'NORMALIZING', 'ANALYZING', 'EXPORTING'
];

const HAPPY_PATH: readonly RunState[] = [
  'CREATED', 'VALIDATING', 'QUEUED', 'RUNNING', 'NORMALIZING', 'ANALYZING', 'EXPORTING', 'COMPLETED'
];

export function isTerminal(state: RunState): boolean {
  return TERMINAL_RUN_STATES.includes(state);
}

/**
 * A transition is legal if it advances one step along the happy path, or
 * diverts an active stage to FAILED or CANCELLED. Skipping a stage is not
 * legal: a run that never normalised must not claim to have analysed.
 */
export function canTransition(from: RunState, to: RunState): boolean {
  if (isTerminal(from)) return false;
  if (to === 'FAILED' || to === 'CANCELLED') return ACTIVE_STATES.includes(from);

  const fromIndex = HAPPY_PATH.indexOf(from);
  const toIndex = HAPPY_PATH.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) return false;
  return toIndex === fromIndex + 1;
}

export class IllegalRunTransitionError extends Error {
  readonly code = 'validation_error';
  readonly from: RunState;
  readonly to: RunState;

  constructor(from: RunState, to: RunState) {
    super(`Illegal run transition: ${from} → ${to}`);
    this.name = 'IllegalRunTransitionError';
    this.from = from;
    this.to = to;
  }
}

/** Throws unless the transition is legal. Callers persist only after this passes. */
export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) throw new IllegalRunTransitionError(from, to);
}
