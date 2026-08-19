/**
 * The role ladder and RBAC matrix (E4.1).
 *
 * Recovered pre-MVP requirement, folded into E4 by the conflict resolution in
 * `00_STATE_AND_DECISIONS.md`: `viewer < researcher < admin < dev`.
 *
 * The matrix is data, not a tree of `if` statements, for the same reason the
 * science is: it can be printed, diffed and tested exhaustively. A permission
 * check spread across route handlers cannot be reviewed as a whole, and the
 * gap is always in the handler nobody re-read.
 */

export const ROLES = ['viewer', 'researcher', 'admin', 'dev'] as const;
export type Role = typeof ROLES[number];

/** Rank only orders the ladder; it never grants anything on its own. */
const RANK: Record<Role, number> = { viewer: 0, researcher: 1, admin: 2, dev: 3 };

export const CAPABILITIES = [
  'run.view',
  'run.create',
  'method.propose',
  'method.approve',
  'narrative.approve',
  'export.download',
  'provider.view',
  'provider.approve',
  'diagnostics.view',
  'diagnostics.bundle',
  'principal.manage',
] as const;
export type Capability = typeof CAPABILITIES[number];

/**
 * Exhaustive and explicit. Every cell is stated, so adding a capability forces
 * a decision for each role instead of inheriting one by omission.
 */
export const RBAC: Readonly<Record<Role, readonly Capability[]>> = Object.freeze({
  viewer: ['run.view', 'export.download', 'provider.view'],

  researcher: [
    'run.view', 'run.create', 'method.propose', 'method.approve', 'narrative.approve',
    'export.download', 'provider.view',
  ],

  // Approving a *provider* is deliberately not a researcher's power: it changes
  // which instrument the whole installation measures with, and D5 treats a
  // silently adopted vendor as a changed measuring device.
  admin: [
    'run.view', 'run.create', 'method.propose', 'method.approve', 'narrative.approve',
    'export.download', 'provider.view', 'provider.approve', 'principal.manage',
  ],

  // The diagnostics surface can expose request payloads and configuration, so
  // it is gated to `dev` rather than folded into `admin`.
  dev: [
    'run.view', 'run.create', 'method.propose', 'method.approve', 'narrative.approve',
    'export.download', 'provider.view', 'provider.approve', 'principal.manage',
    'diagnostics.view', 'diagnostics.bundle',
  ],
});

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

export function highestRole(roles: readonly string[]): Role | null {
  const valid = roles.filter(isRole);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (RANK[a] >= RANK[b] ? a : b));
}

/**
 * The single authority. A principal with no recognised role has no
 * capabilities — the ladder fails closed, so a typo in a role name removes
 * access rather than silently granting the default.
 */
export function can(roles: readonly string[], capability: Capability): boolean {
  return roles.filter(isRole).some(r => RBAC[r].includes(capability));
}

export class ForbiddenError extends Error {
  readonly code = 'forbidden';
  constructor(readonly capability: Capability, readonly roles: readonly string[]) {
    super(`Role(s) [${roles.join(', ') || 'none'}] may not '${capability}'.`);
    this.name = 'ForbiddenError';
  }
}

export class UnauthenticatedError extends Error {
  readonly code = 'unauthenticated';
  constructor(detail = 'This request requires a signed-in principal.') {
    super(detail);
    this.name = 'UnauthenticatedError';
  }
}
