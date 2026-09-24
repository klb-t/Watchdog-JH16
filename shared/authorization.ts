/** MVP role bundles, not an ordinal hierarchy. See decision D18. */
export const AUTHORIZATION_PROFILE_VERSION = 'mvp-capabilities-4';
export const CAPABILITIES = [
  'run.view', 'run.create', 'method.propose', 'method.approve',
  'narrative.approve', 'export.download', 'provider.view', 'provider.approve',
  'diagnostics.view', 'diagnostics.bundle', 'principal.view', 'principal.manage',
  // E4.5: admit people to this installation — invite, approve applications,
  // assign and revoke profiles. Bounded by `grantableRoles`, so holding it never
  // lets anyone hand out more than they themselves hold.
  'access.admit',
  'workbench.view', 'workbench.analyze', 'dataset.import', 'dataset.review', 'dataset.approve', 'figure.manage',
  'responder.lookup', 'evidence.review', 'evidence.import', 'evidence.approve',
] as const;
export type Capability = typeof CAPABILITIES[number];

const viewer: readonly Capability[] = ['run.view', 'export.download', 'provider.view'];
const researcher: readonly Capability[] = [
  ...viewer, 'run.create', 'method.propose', 'method.approve', 'narrative.approve',
  'evidence.review', 'evidence.import', 'evidence.approve',
  'workbench.view', 'workbench.analyze', 'dataset.import', 'dataset.review', 'dataset.approve', 'figure.manage',
];
const responder: readonly Capability[] = ['responder.lookup'];
const admin: readonly Capability[] = [
  ...researcher, ...responder, 'provider.approve', 'principal.view', 'access.admit',
];

export const RBAC = Object.freeze({
  viewer: Object.freeze(viewer),
  researcher: Object.freeze(researcher),
  responder: Object.freeze(responder),
  // Restricted reference access. No private research, curation, audit history,
  // role management or diagnostics are granted to an institutional profile.
  institutional: Object.freeze([...responder, 'provider.view', 'workbench.view', 'workbench.analyze', 'figure.manage'] as Capability[]),
  law_enforcement: Object.freeze([...responder, 'provider.view', 'workbench.view', 'workbench.analyze', 'figure.manage'] as Capability[]),
  admin: Object.freeze(admin),
  developer: CAPABILITIES,
  // Compatibility for existing OIDC grants and signed sessions. No migration
  // may strand a maintainer whose deployment still names the original role.
  dev: CAPABILITIES,
});
export type Role = keyof typeof RBAC;
export const ROLES = Object.freeze(Object.keys(RBAC) as Role[]);

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && Object.hasOwn(RBAC, value);
}

export function capabilitiesFor(roles: readonly string[]): Capability[] {
  const granted = new Set(roles.filter(isRole).flatMap(role => [...RBAC[role]]));
  return CAPABILITIES.filter(capability => granted.has(capability));
}

/** Fail closed, including unknown role/capability strings at runtime. */
export function can(roles: readonly string[], capability: Capability): boolean {
  return capabilitiesFor(roles).includes(capability);
}

/**
 * Roles this granter may hand out: exactly those whose every capability the
 * granter already holds. Delegation without escalation (E4.5): an admin can
 * admit researchers, responders and other admins, never a developer, because
 * `developer` carries diagnostics and principal management an admin lacks.
 */
export function grantableRoles(granterRoles: readonly string[]): Role[] {
  if (!can(granterRoles, 'access.admit')) return [];
  const held = new Set(capabilitiesFor(granterRoles));
  return ROLES.filter(role => RBAC[role].every(capability => held.has(capability)));
}

/**
 * Capabilities a bearer link can never confer, whoever creates it.
 *
 * An open link is transferable by design — whoever holds it can join — so it
 * must never be able to create someone who can admit further people, manage
 * principals or read diagnostics. A leaked link then costs one bounded seat,
 * not control of the installation.
 */
export const OPEN_LINK_FORBIDDEN_CAPABILITIES: readonly Capability[] =
  ['access.admit', 'principal.manage', 'principal.view', 'diagnostics.view', 'diagnostics.bundle'];

export function openLinkAllowsRole(role: string): boolean {
  return isRole(role) && !RBAC[role].some(c => OPEN_LINK_FORBIDDEN_CAPABILITIES.includes(c));
}
