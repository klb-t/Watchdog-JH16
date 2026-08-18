import { canonicalHash } from './canonical';

/**
 * The approval gate, per D7 and `04_METHOD_COMPILER_AND_APPROVAL.md`.
 *
 * Two states only. Everything a model produces starts `PROPOSED`.
 *
 * The load-bearing detail: **approval binds to the content hash**, and the
 * check is a comparison rather than a stored boolean. Any edit changes the
 * hash and the artifact is `PROPOSED` again with no further action — there is
 * no flag an update has to remember to clear, because that is the version that
 * eventually fails.
 */
export type ApprovalState = 'PROPOSED' | 'APPROVED';

export type ApprovableKind =
  | 'method_spec'
  | 'narrative'
  | 'provider'
  | 'extraction_candidate'
  | 'reference_mapping'
  | 'alert_rule'
  | 'replication_claim';

export interface Approvable<T = unknown> {
  readonly id: string;
  readonly kind: ApprovableKind;
  /** The content approval is bound to. Hashing this yields the current hash. */
  readonly content: T;
  /** The hash that was approved, if any. Absent means never approved. */
  readonly approvedHash?: string;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
}

export class ApprovalRequiredError extends Error {
  readonly code = 'approval_required';
  readonly kind: ApprovableKind;
  readonly artifactId: string;

  constructor(kind: ApprovableKind, artifactId: string, detail: string) {
    super(`Approval required for ${kind} '${artifactId}': ${detail}`);
    this.name = 'ApprovalRequiredError';
    this.kind = kind;
    this.artifactId = artifactId;
  }
}

/** The hash of an artifact's current content. */
export function currentHash(artifact: Approvable): string {
  return canonicalHash(artifact.content);
}

/**
 * Derived, never stored. A row's approval state is recomputed from its content
 * on every read, so editing approved content silently reverts it to PROPOSED.
 */
export function approvalState(artifact: Approvable): ApprovalState {
  if (!artifact.approvedHash) return 'PROPOSED';
  return currentHash(artifact) === artifact.approvedHash ? 'APPROVED' : 'PROPOSED';
}

/**
 * Called at the entry of: method execution, export, manifest finalisation,
 * narrative inclusion, and any live provider call.
 */
export function requireApproved(artifact: Approvable): void {
  if (!artifact.approvedHash) {
    throw new ApprovalRequiredError(artifact.kind, artifact.id, 'never approved');
  }
  if (currentHash(artifact) !== artifact.approvedHash) {
    throw new ApprovalRequiredError(
      artifact.kind,
      artifact.id,
      'content changed since approval, so the approval no longer applies'
    );
  }
}

/**
 * Records one human approval of one artifact.
 *
 * `approvedBy` is required and has no default: there is deliberately no code
 * path that approves without a human actor, no bulk approve, and no
 * approve-on-timeout. The caller must be an API handler acting on a human
 * action.
 */
export function approve<T>(artifact: Approvable<T>, approvedBy: string, approvedAt: string): Approvable<T> {
  if (!approvedBy || approvedBy.trim() === '') {
    throw new ApprovalRequiredError(artifact.kind, artifact.id, 'approval requires an identified human actor');
  }
  return {
    ...artifact,
    approvedHash: currentHash(artifact),
    approvedBy,
    approvedAt
  };
}
