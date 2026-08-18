/**
 * Identity, per D3. Authentication is deferred to E4, but the seam exists from
 * E1 so that E4 is an implementation rather than a migration.
 *
 * Every study, run and artifact row carries `owner_principal_id` and
 * `visibility` from E1. Until E4 the owner is the constant `local-user`.
 */
export interface Principal {
  id: string;
  email: string | null;
  roles: string[];
  identityProvenance: string;
}

export type Visibility = 'private' | 'project' | 'shared';

export const DEFAULT_VISIBILITY: Visibility = 'private';

export const LOCAL_USER_ID = 'local-user';

export const LOCAL_USER: Readonly<Principal> = Object.freeze({
  id: LOCAL_USER_ID,
  email: null,
  roles: ['owner'],
  identityProvenance: 'local-constant'
});

/**
 * Deliberately generic in its argument: the domain layer must not depend on an
 * HTTP framework's Request type. E4's OIDC implementation sits behind the same
 * interface.
 */
export interface IdentityProvider {
  resolve(request: unknown): Promise<Principal>;
}

export class LocalUserIdentityProvider implements IdentityProvider {
  async resolve(_request: unknown): Promise<Principal> {
    return { ...LOCAL_USER, roles: [...LOCAL_USER.roles] };
  }
}
