/** MVP role bundles, not an ordinal hierarchy. See decision D18. */
export const AUTHORIZATION_PROFILE_VERSION = 'mvp-capabilities-2';
export const CAPABILITIES = [
  'run.view', 'run.create', 'method.propose', 'method.approve',
  'narrative.approve', 'export.download', 'provider.view', 'provider.approve',
  'diagnostics.view', 'diagnostics.bundle', 'principal.view', 'principal.manage',
  'responder.lookup', 'evidence.review', 'evidence.import', 'evidence.approve',
] as const;
export type Capability = typeof CAPABILITIES[number];

const viewer: readonly Capability[] = ['run.view', 'export.download', 'provider.view'];
const researcher: readonly Capability[] = [
  ...viewer, 'run.create', 'method.propose', 'method.approve', 'narrative.approve',
  'evidence.review', 'evidence.import', 'evidence.approve',
];
const responder: readonly Capability[] = ['responder.lookup'];
const admin: readonly Capability[] = [
  ...researcher, ...responder, 'provider.approve', 'principal.view',
];

export const RBAC = Object.freeze({
  viewer: Object.freeze(viewer),
  researcher: Object.freeze(researcher),
  responder: Object.freeze(responder),
  // Restricted reference access. No private research, curation, audit history,
  // role management or diagnostics are granted to an institutional profile.
  institutional: Object.freeze([...responder, 'provider.view'] as Capability[]),
  law_enforcement: Object.freeze([...responder, 'provider.view'] as Capability[]),
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
