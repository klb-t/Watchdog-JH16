/** Backend errors; the shared MVP bundles resolve all authorization. */
export { ROLES, RBAC, CAPABILITIES, isRole, can, capabilitiesFor,
  AUTHORIZATION_PROFILE_VERSION } from '../../../shared/authorization';
export type { Role, Capability } from '../../../shared/authorization';
import type { Capability } from '../../../shared/authorization';

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
