import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  Role, ROLES, isRole, capabilitiesFor, can, grantableRoles, openLinkAllowsRole,
} from '../../../shared/authorization';
import { AdmissionRepository, GrantRow, InvitationRow, ApplicationRow } from '../db/repositories/admission';

/**
 * E4.5 — who may use this installation, and as what.
 *
 * The one idea everything below follows: **identity is not admission.** A
 * verified email address says who someone is. It grants nothing. Capabilities
 * come only from grants, which are:
 *
 *  - bound to an exact verified address (`admission_grants.email`);
 *  - created only by someone holding `access.admit`, and only for roles whose
 *    every capability the creator already holds (`grantableRoles`);
 *  - evaluated live on every request, so revoking one takes effect on the next
 *    request, not when a cookie expires;
 *  - never deleted — revocation, expiry and replacement are recorded facts.
 *
 * Operator bootstrap grants from `WATCHDOG_GRANTS` sit alongside. They cannot be
 * changed from the UI, which is what makes it impossible to lock the owner out
 * of their own installation by a mis-click.
 */

export class AdmissionError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = 'AdmissionError';
  }
}

export interface AdmissionActor {
  readonly principalId: string;
  readonly email: string | null;
  readonly roles: readonly string[];
  readonly requestId: string;
}

export interface GrantSource {
  readonly kind: 'environment' | 'grant';
  readonly id: string | null;
  readonly roles: Role[];
  readonly source: string;
  readonly expiresAt: string | null;
  readonly grantedBy: string | null;
  readonly grantedAt: string | null;
}

export interface EffectiveAdmission {
  readonly roles: Role[];
  readonly sources: GrantSource[];
}

export const INVITATION_LIMITS = Object.freeze({
  defaultExpiryDays: 7,
  maxExpiryDays: 30,
  maxOpenLinkUses: 50,
  noteMax: 1000,
});

/** Actor id for actions taken from the server shell. */
export const OPERATOR = 'operator';

/** The one server-shell actor. Frozen and compared by reference. */
export const OPERATOR_ACTOR: AdmissionActor = Object.freeze({
  principalId: OPERATOR, email: null, roles: Object.freeze([] as string[]), requestId: 'cli',
});

export const APPLICATION_LIMITS = Object.freeze({ reasonMin: 20, reasonMax: 2000, fieldMax: 200 });

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,63}$/;

export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== 'string') throw new AdmissionError('validation_error', 400, 'An email address is required.');
  const email = raw.trim().toLowerCase();
  if (email.length > 320 || !EMAIL.test(email)) {
    throw new AdmissionError('validation_error', 400, 'That is not a valid email address.');
  }
  return email;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf-8').digest('hex');
}

/** Constant-time equality of two hex digests of equal, known length. */
export function sameDigest(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** 256 bits, URL-safe. Only its hash is stored. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** `j•••@uni.lodz.pl` — enough to recognise your own address, not enough to harvest one. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`;
}

function parseRoles(json: string): Role[] {
  return (JSON.parse(json) as unknown[]).filter(isRole);
}

function sortedRoles(roles: Iterable<Role>): Role[] {
  return [...new Set(roles)].sort((a, b) => ROLES.indexOf(a) - ROLES.indexOf(b));
}

function requireRoles(raw: unknown): Role[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AdmissionError('validation_error', 400, 'Choose at least one role.');
  }
  const unknown = raw.filter(r => !isRole(r));
  if (unknown.length > 0) {
    throw new AdmissionError('validation_error', 400, `Unknown role(s): ${unknown.map(String).join(', ')}.`);
  }
  return sortedRoles(raw as Role[]);
}

function boundedText(raw: unknown, max: number, field: string): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new AdmissionError('validation_error', 400, `${field} must be text.`);
  const text = raw.trim();
  if (text.length > max) throw new AdmissionError('validation_error', 400, `${field} is longer than ${max} characters.`);
  return text || null;
}

function futureIso(raw: unknown, now: Date, field: string): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const at = new Date(String(raw));
  if (Number.isNaN(at.getTime())) throw new AdmissionError('validation_error', 400, `${field} is not a date.`);
  if (at.getTime() <= now.getTime()) throw new AdmissionError('validation_error', 400, `${field} must be in the future.`);
  return at.toISOString();
}

export interface InvitationView {
  id: string;
  kind: 'email' | 'open_link';
  email: string | null;
  roles: Role[];
  note: string | null;
  maxUses: number;
  uses: number;
  expiresAt: string;
  accessExpiresAt: string | null;
  createdBy: string;
  createdAt: string;
  status: 'active' | 'expired' | 'revoked' | 'used_up';
  deliveryStatus: InvitationRow['delivery_status'];
  deliveryDetail: string | null;
  lastDeliveryAt: string | null;
  redeemedBy: { email: string; redeemedAt: string }[];
}

export interface InvitationPreview {
  status: 'valid' | 'expired' | 'revoked' | 'used_up' | 'unknown' | 'inviter_no_longer_authorized';
  kind?: 'email' | 'open_link';
  roles?: Role[];
  note?: string | null;
  inviter?: string | null;
  expiresAt?: string;
  emailHint?: string | null;
}

export interface MemberView {
  email: string;
  principalId: string | null;
  displayName: string | null;
  roles: Role[];
  sources: GrantSource[];
  active: boolean;
  lastSeenAt: string | null;
  signInMethods: string[];
  /** Whether the viewer may change or revoke this person's access. */
  modifiable: boolean;
  notModifiableReason: string | null;
}

export class AdmissionService {
  constructor(
    private readonly repo: AdmissionRepository,
    private readonly bootstrap: Readonly<Record<string, Role>>,
    private readonly audit: (actorId: string, action: string, objectType: string, objectId: string,
      requestId: string, metadata: unknown) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ------------------------------------------------------------------ roles

  /** Operator grants from the environment: exact address first, then @domain. */
  private bootstrapRolesFor(email: string): Role[] {
    const exact = this.bootstrap[email];
    const at = email.lastIndexOf('@');
    const domain = at >= 0 ? this.bootstrap[email.slice(at)] : undefined;
    return sortedRoles([exact, domain].filter(isRole));
  }

  /** The single authority for what an address may do right now. */
  effective(email: string | null): EffectiveAdmission {
    if (!email) return { roles: [], sources: [] };
    const sources: GrantSource[] = [];
    const bootstrap = this.bootstrapRolesFor(email);
    if (bootstrap.length > 0) {
      sources.push({ kind: 'environment', id: null, roles: bootstrap, source: 'operator',
        expiresAt: null, grantedBy: null, grantedAt: null });
    }
    for (const g of this.repo.activeGrants(email, this.now().toISOString())) {
      sources.push({ kind: 'grant', id: g.id, roles: parseRoles(g.roles_json), source: g.source,
        expiresAt: g.expires_at, grantedBy: g.granted_by, grantedAt: g.granted_at });
    }
    return { roles: sortedRoles(sources.flatMap(s => s.roles)), sources };
  }

  private actorRoles(actor: AdmissionActor): Role[] {
    // The server-shell actor is compared by identity, not by id: no request can
    // construct it, because routes build actors from `req.principal`.
    if (actor === OPERATOR_ACTOR) return [...ROLES];
    // Re-derived rather than trusted from the request, so an actor whose access
    // was revoked a moment ago cannot finish an action with stale rights.
    return this.effective(actor.email).roles;
  }

  private requireAdmit(actor: AdmissionActor): Role[] {
    const roles = this.actorRoles(actor);
    if (!can(roles, 'access.admit')) {
      throw new AdmissionError('forbidden', 403, 'Admitting people requires the access.admit capability.');
    }
    return roles;
  }

  private requireGrantable(actorRoles: readonly string[], roles: readonly Role[]): void {
    const allowed = new Set(grantableRoles(actorRoles));
    const beyond = roles.filter(r => !allowed.has(r));
    if (beyond.length > 0) {
      throw new AdmissionError('forbidden', 403,
        `You cannot grant ${beyond.join(', ')}: it carries capabilities you do not hold yourself.`);
    }
  }

  /** You may change someone's access only if you hold everything they hold. */
  private modifiability(actor: AdmissionActor, actorRoles: readonly Role[], email: string): string | null {
    if (actor.email && actor.email === email) return 'You cannot change your own access.';
    if (!can(actorRoles, 'access.admit')) return 'Requires access.admit.';
    const held = new Set(capabilitiesFor(actorRoles));
    const target = this.effective(email);
    if (!capabilitiesFor(target.roles).every(c => held.has(c))) {
      return 'This person holds capabilities you do not; only someone who holds all of them can change their access.';
    }
    return null;
  }

  // ------------------------------------------------------------------ sign-in

  /**
   * Maps a verified identity to a principal, creating or linking as needed.
   * Returns null for a principal that has been blocked.
   *
   * Linking by verified address is safe here because every method that reaches
   * this function has proven control of that address (Google's email_verified,
   * or a code delivered to it) — except the operator link, which is proven by
   * shell access to the server and is therefore stronger, not weaker.
   */
  signIn(input: { provider: 'google' | 'email' | 'operator'; subject: string; email: string;
    displayName: string | null }): { principalId: string; sessionVersion: number } | null {
    const email = normalizeEmail(input.email);
    const at = this.now().toISOString();
    return this.repo.transaction(() => {
      const known = this.repo.identity(input.provider, input.subject);
      let principalId: string;
      if (known) {
        principalId = known.principal_id;
        this.repo.touchIdentity(input.provider, input.subject, at);
      } else {
        const byEmail = this.repo.principalByEmail(email);
        principalId = byEmail?.id ?? `u_${randomUUID()}`;
        if (!byEmail) {
          this.repo.createPrincipal({ id: principalId, email, displayName: input.displayName,
            provenance: input.provider === 'google' ? 'google-oidc' : input.provider === 'email' ? 'email-code' : 'operator-link', at });
        }
        this.repo.linkIdentity({ provider: input.provider, subject: input.subject, principalId, email, at });
      }
      const principal = this.repo.principal(principalId)!;
      if (!principal.active) return null;
      this.repo.touchPrincipal(principalId, input.displayName, at);
      this.repo.mirrorRoles(principalId, this.effective(principal.email?.toLowerCase() ?? email).roles);
      return { principalId, sessionVersion: principal.session_version };
    });
  }

  // ------------------------------------------------------------------ profile

  /** The name shown on invitations and to administrators; the person's own choice. */
  setDisplayName(actor: AdmissionActor, raw: unknown): string | null {
    const name = boundedText(raw, APPLICATION_LIMITS.fieldMax, 'The name');
    this.repo.setDisplayName(actor.principalId, name);
    return name;
  }

  displayNameOf(principalId: string): string | null {
    return this.repo.principal(principalId)?.display_name ?? null;
  }

  // ------------------------------------------------------------------ invitations

  createInvitation(actor: AdmissionActor, input: {
    kind?: unknown; email?: unknown; roles?: unknown; note?: unknown; expiresInDays?: unknown;
    maxUses?: unknown; accessExpiresAt?: unknown;
  }): { invitation: InvitationView; token: string } {
    const actorRoles = this.requireAdmit(actor);
    const kind = input.kind === 'open_link' ? 'open_link' : input.kind === 'email' ? 'email' : null;
    if (!kind) throw new AdmissionError('validation_error', 400, "kind must be 'email' or 'open_link'.");
    const roles = requireRoles(input.roles);
    this.requireGrantable(actorRoles, roles);

    const email = kind === 'email' ? normalizeEmail(input.email) : null;
    if (kind === 'open_link') {
      const barred = roles.filter(r => !openLinkAllowsRole(r));
      if (barred.length > 0) {
        throw new AdmissionError('forbidden', 403,
          `An open link cannot grant ${barred.join(', ')}. Anyone holding the link can use it, so roles that ` +
          'can admit people, manage principals or read diagnostics need an invitation to a specific address.');
      }
    }
    if (email && this.effective(email).roles.length > 0) {
      throw new AdmissionError('conflict', 409,
        `${email} already has access. Change their roles instead of inviting them again.`);
    }

    const days = input.expiresInDays === undefined ? INVITATION_LIMITS.defaultExpiryDays : Number(input.expiresInDays);
    if (!Number.isInteger(days) || days < 1 || days > INVITATION_LIMITS.maxExpiryDays) {
      throw new AdmissionError('validation_error', 400,
        `The link must expire within 1–${INVITATION_LIMITS.maxExpiryDays} days.`);
    }
    const maxUses = kind === 'email' ? 1 : input.maxUses === undefined ? 1 : Number(input.maxUses);
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > INVITATION_LIMITS.maxOpenLinkUses) {
      throw new AdmissionError('validation_error', 400,
        `An open link may be used 1–${INVITATION_LIMITS.maxOpenLinkUses} times.`);
    }

    const now = this.now();
    const token = newToken();
    const row = {
      id: randomUUID(), kind, token_hash: hashSecret(token), email,
      roles_json: JSON.stringify(roles), note: boundedText(input.note, INVITATION_LIMITS.noteMax, 'The note'),
      max_uses: maxUses, expires_at: new Date(now.getTime() + days * 86_400_000).toISOString(),
      access_expires_at: futureIso(input.accessExpiresAt, now, 'Access expiry'),
      created_by: actor.principalId, created_at: now.toISOString(),
    } as const;
    this.repo.insertInvitation(row);
    this.audit(actor.principalId, 'access.invitation.created', 'invitation', row.id, actor.requestId,
      { kind, email, roles, maxUses, expiresAt: row.expires_at, accessExpiresAt: row.access_expires_at });
    return { invitation: this.invitationView(this.repo.invitation(row.id)!), token };
  }

  private invitationStatus(i: InvitationRow): InvitationView['status'] {
    if (i.revoked_at) return 'revoked';
    if (i.uses >= i.max_uses) return 'used_up';
    if (i.expires_at <= this.now().toISOString()) return 'expired';
    return 'active';
  }

  invitationView(i: InvitationRow): InvitationView {
    return {
      id: i.id, kind: i.kind, email: i.email, roles: parseRoles(i.roles_json), note: i.note,
      maxUses: i.max_uses, uses: i.uses, expiresAt: i.expires_at, accessExpiresAt: i.access_expires_at,
      createdBy: i.created_by, createdAt: i.created_at, status: this.invitationStatus(i),
      deliveryStatus: i.delivery_status, deliveryDetail: i.delivery_detail, lastDeliveryAt: i.last_delivery_at,
      redeemedBy: this.repo.redemptionsOf(i.id).map(r => ({ email: r.email, redeemedAt: r.redeemed_at })),
    };
  }

  /** The invitation behind a token, or null. Hash lookup, so the token is never compared as text. */
  private byToken(token: unknown): InvitationRow | null {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    return this.repo.invitationByTokenHash(hashSecret(token)) ?? null;
  }

  /** Has the inviter lost the right to extend this invitation since creating it? */
  private inviterStillAuthorized(i: InvitationRow): boolean {
    // Created from the server shell; root access is the authority, not a role.
    if (i.created_by === OPERATOR) return true;
    const inviter = this.repo.principal(i.created_by);
    if (!inviter?.active || !inviter.email) return false;
    const roles = this.effective(inviter.email.toLowerCase()).roles;
    const allowed = new Set(grantableRoles(roles));
    return parseRoles(i.roles_json).every(r => allowed.has(r));
  }

  preview(token: unknown): InvitationPreview {
    const i = this.byToken(token);
    if (!i) return { status: 'unknown' };
    const status = this.invitationStatus(i);
    const inviter = this.repo.principal(i.created_by);
    const base: InvitationPreview = {
      status: status === 'active' ? 'valid' : status, kind: i.kind, roles: parseRoles(i.roles_json),
      note: i.note, inviter: i.created_by === OPERATOR ? 'the installation operator'
        : inviter?.display_name ?? inviter?.email ?? null, expiresAt: i.expires_at,
      emailHint: i.email ? maskEmail(i.email) : null,
    };
    if (status === 'active' && !this.inviterStillAuthorized(i)) return { ...base, status: 'inviter_no_longer_authorized' };
    return base;
  }

  /**
   * Turns a token plus a verified identity into a grant.
   *
   * For an email invitation the verified address must be the invited one. A
   * forwarded link therefore does nothing for the person it was forwarded to,
   * and — importantly — does not burn the invitation either, so the intended
   * recipient can still use it.
   */
  redeem(actor: AdmissionActor, token: unknown): { grantId: string; roles: Role[]; alreadyRedeemed: boolean } {
    if (!actor.email) throw new AdmissionError('unauthenticated', 401, 'Sign in first.');
    const i = this.byToken(token);
    if (!i) throw new AdmissionError('invitation_invalid', 404, 'This invitation link is not valid.');

    const previous = this.repo.redemption(i.id, actor.principalId);
    if (previous) return { grantId: previous.grant_id, roles: parseRoles(i.roles_json), alreadyRedeemed: true };

    const status = this.invitationStatus(i);
    if (status !== 'active') {
      const messages = {
        revoked: 'This invitation was withdrawn.', expired: 'This invitation has expired.',
        used_up: 'This invitation has already been used.',
      } as const;
      throw new AdmissionError(`invitation_${status}`, 410, messages[status]);
    }
    if (i.kind === 'email' && i.email !== actor.email) {
      throw new AdmissionError('invitation_address_mismatch', 403,
        `This invitation was sent to ${maskEmail(i.email!)}. You are signed in as ${actor.email}. ` +
        'Sign in with the invited address; the invitation stays valid for it.');
    }
    if (!this.inviterStillAuthorized(i)) {
      throw new AdmissionError('invitation_inviter_unauthorized', 410,
        'The person who created this invitation can no longer grant these roles. Ask for a new invitation.');
    }

    const roles = parseRoles(i.roles_json);
    const at = this.now().toISOString();
    const grantId = randomUUID();
    this.repo.transaction(() => {
      if (!this.repo.consumeInvitationUse(i.id, at)) {
        throw new AdmissionError('invitation_used_up', 410, 'This invitation has already been used.');
      }
      this.repo.insertGrant({ id: grantId, email: actor.email!, roles_json: JSON.stringify(roles),
        source: i.kind === 'email' ? 'invitation' : 'open_link', source_id: i.id, granted_by: i.created_by,
        granted_at: at, expires_at: i.access_expires_at, note: i.note });
      this.repo.insertRedemption({ id: randomUUID(), invitationId: i.id, principalId: actor.principalId,
        email: actor.email!, grantId, at });
      const pending = this.repo.pendingApplicationOf(actor.principalId);
      if (pending) {
        this.repo.decideApplication(pending.id, { status: 'withdrawn', by: actor.principalId,
          note: 'Superseded by an accepted invitation.', grantId, at });
      }
      this.repo.mirrorRoles(actor.principalId, this.effective(actor.email).roles);
    });
    this.audit(actor.principalId, 'access.invitation.redeemed', 'invitation', i.id, actor.requestId,
      { kind: i.kind, email: actor.email, roles, grantId });
    return { grantId, roles, alreadyRedeemed: false };
  }

  private manageableInvitation(actor: AdmissionActor, id: string): InvitationRow {
    const actorRoles = this.requireAdmit(actor);
    const i = this.repo.invitation(id);
    if (!i) throw new AdmissionError('not_found', 404, 'No such invitation.');
    this.requireGrantable(actorRoles, parseRoles(i.roles_json));
    return i;
  }

  revokeInvitation(actor: AdmissionActor, id: string): InvitationView {
    const i = this.manageableInvitation(actor, id);
    if (this.repo.revokeInvitation(id, actor.principalId, this.now().toISOString())) {
      this.audit(actor.principalId, 'access.invitation.revoked', 'invitation', id, actor.requestId, { kind: i.kind });
    }
    return this.invitationView(this.repo.invitation(id)!);
  }

  /** A fresh link for the same invitation; the old one stops working at once. */
  rotateInvitation(actor: AdmissionActor, id: string): { invitation: InvitationView; token: string } {
    const i = this.manageableInvitation(actor, id);
    if (this.invitationStatus(i) !== 'active') {
      throw new AdmissionError('conflict', 409, 'Only an active invitation can get a new link.');
    }
    const token = newToken();
    this.repo.rotateInvitationToken(id, hashSecret(token));
    this.audit(actor.principalId, 'access.invitation.rotated', 'invitation', id, actor.requestId, {});
    return { invitation: this.invitationView(this.repo.invitation(id)!), token };
  }

  /** Confirms the caller holds this invitation's current token, e.g. before emailing it. */
  verifyInvitationToken(actor: AdmissionActor, id: string, token: unknown): InvitationRow {
    const i = this.manageableInvitation(actor, id);
    if (typeof token !== 'string' || !sameDigest(hashSecret(token), i.token_hash)) {
      throw new AdmissionError('validation_error', 400,
        'That link is not the current one for this invitation. Create a new link and send that.');
    }
    if (this.invitationStatus(i) !== 'active') {
      throw new AdmissionError('conflict', 409, 'This invitation is no longer active.');
    }
    return i;
  }

  recordDelivery(actor: AdmissionActor, id: string, status: InvitationRow['delivery_status'],
    detail: string | null): InvitationView {
    const i = this.manageableInvitation(actor, id);
    this.repo.setInvitationDelivery(id, status, detail, this.now().toISOString());
    this.audit(actor.principalId, `access.invitation.${status}`, 'invitation', id, actor.requestId,
      { kind: i.kind, detail });
    return this.invitationView(this.repo.invitation(id)!);
  }

  // ------------------------------------------------------------------ applications

  submitApplication(actor: AdmissionActor, input: {
    reason?: unknown; affiliation?: unknown; displayName?: unknown; requestedRoles?: unknown;
  }): ApplicationRow {
    if (!actor.email) throw new AdmissionError('unauthenticated', 401, 'Sign in first.');
    if (this.effective(actor.email).roles.length > 0) {
      throw new AdmissionError('conflict', 409, 'You already have access to this installation.');
    }
    if (this.repo.pendingApplicationOf(actor.principalId)) {
      throw new AdmissionError('conflict', 409, 'Your application is already waiting for a decision.');
    }
    const reason = boundedText(input.reason, APPLICATION_LIMITS.reasonMax, 'The reason');
    if (!reason || reason.length < APPLICATION_LIMITS.reasonMin) {
      throw new AdmissionError('validation_error', 400,
        `Please explain in at least ${APPLICATION_LIMITS.reasonMin} characters why you need access.`);
    }
    const requested = Array.isArray(input.requestedRoles) ? input.requestedRoles.filter(isRole) : [];
    const row = {
      id: randomUUID(), principal_id: actor.principalId, email: actor.email,
      display_name: boundedText(input.displayName, APPLICATION_LIMITS.fieldMax, 'The name'),
      affiliation: boundedText(input.affiliation, APPLICATION_LIMITS.fieldMax, 'The affiliation'),
      reason, requested_roles_json: JSON.stringify(sortedRoles(requested)), status: 'pending' as const,
      submitted_at: this.now().toISOString(),
    };
    this.repo.insertApplication(row);
    if (row.display_name && !this.displayNameOf(actor.principalId)) this.repo.setDisplayName(actor.principalId, row.display_name);
    this.audit(actor.principalId, 'access.application.submitted', 'access_application', row.id, actor.requestId,
      { requestedRoles: requested });
    return this.repo.application(row.id)!;
  }

  withdrawApplication(actor: AdmissionActor): ApplicationRow {
    const pending = this.repo.pendingApplicationOf(actor.principalId);
    if (!pending) throw new AdmissionError('not_found', 404, 'You have no application waiting.');
    this.repo.decideApplication(pending.id, { status: 'withdrawn', by: actor.principalId, note: null,
      grantId: null, at: this.now().toISOString() });
    this.audit(actor.principalId, 'access.application.withdrawn', 'access_application', pending.id, actor.requestId, {});
    return this.repo.application(pending.id)!;
  }

  myApplications(actor: AdmissionActor): ApplicationRow[] {
    return this.repo.applicationsOf(actor.principalId);
  }

  approveApplication(actor: AdmissionActor, id: string, input: { roles?: unknown; note?: unknown;
    accessExpiresAt?: unknown }): ApplicationRow {
    const actorRoles = this.requireAdmit(actor);
    const roles = requireRoles(input.roles);
    this.requireGrantable(actorRoles, roles);
    const application = this.repo.application(id);
    if (!application) throw new AdmissionError('not_found', 404, 'No such application.');
    if (application.email === actor.email) throw new AdmissionError('forbidden', 403, 'You cannot approve your own application.');

    const at = this.now().toISOString();
    const grantId = randomUUID();
    const note = boundedText(input.note, INVITATION_LIMITS.noteMax, 'The note');
    this.repo.transaction(() => {
      // The grant first, because the application row references it. If the
      // application was already decided, the throw below rolls the grant back
      // with it — the "only a pending application" guard still holds.
      this.repo.insertGrant({ id: grantId, email: application.email, roles_json: JSON.stringify(roles),
        source: 'application', source_id: id, granted_by: actor.principalId, granted_at: at,
        expires_at: futureIso(input.accessExpiresAt, this.now(), 'Access expiry'), note });
      if (!this.repo.decideApplication(id, { status: 'approved', by: actor.principalId, note, grantId, at })) {
        throw new AdmissionError('conflict', 409, 'This application has already been decided.');
      }
      this.repo.mirrorRoles(application.principal_id, this.effective(application.email).roles);
    });
    this.audit(actor.principalId, 'access.application.approved', 'access_application', id, actor.requestId,
      { email: application.email, roles, grantId });
    return this.repo.application(id)!;
  }

  denyApplication(actor: AdmissionActor, id: string, input: { note?: unknown }): ApplicationRow {
    this.requireAdmit(actor);
    const note = boundedText(input.note, INVITATION_LIMITS.noteMax, 'The note');
    if (!this.repo.decideApplication(id, { status: 'denied', by: actor.principalId, note, grantId: null,
      at: this.now().toISOString() })) {
      throw new AdmissionError(this.repo.application(id) ? 'conflict' : 'not_found',
        this.repo.application(id) ? 409 : 404, 'This application is not waiting for a decision.');
    }
    this.audit(actor.principalId, 'access.application.denied', 'access_application', id, actor.requestId, {});
    return this.repo.application(id)!;
  }

  applications(actor: AdmissionActor): ApplicationRow[] {
    this.requireView(actor);
    return this.repo.applications();
  }

  // ------------------------------------------------------------------ members

  private requireView(actor: AdmissionActor): Role[] {
    const roles = this.actorRoles(actor);
    if (!can(roles, 'principal.view') && !can(roles, 'access.admit')) {
      throw new AdmissionError('forbidden', 403, 'Viewing members requires principal.view.');
    }
    return roles;
  }

  members(actor: AdmissionActor): MemberView[] {
    const actorRoles = this.requireView(actor);
    const emails = new Set<string>();
    for (const key of Object.keys(this.bootstrap)) if (!key.startsWith('@')) emails.add(key);
    for (const g of this.repo.allActiveGrants(this.now().toISOString())) emails.add(g.email);
    const principals = new Map<string, ReturnType<AdmissionRepository['principals']>[number]>();
    for (const p of this.repo.principals()) {
      const email = p.email!.toLowerCase();
      if (!principals.has(email)) principals.set(email, p);
      emails.add(email);
    }
    return [...emails].sort().flatMap(email => {
      const p = principals.get(email) ?? null;
      const eff = this.effective(email);
      // Signed-in people without access are applicants, listed with their
      // applications rather than here — unless they were blocked, which is a
      // decision an administrator needs to be able to find and undo.
      if (eff.roles.length === 0 && (!p || p.active)) return [];
      const blocker = this.modifiability(actor, actorRoles, email);
      return [{
        email, principalId: p?.id ?? null, displayName: p?.display_name ?? null, roles: eff.roles,
        sources: eff.sources, active: p ? !!p.active : true, lastSeenAt: p?.last_seen_at ?? null,
        signInMethods: p ? [...new Set(this.repo.identitiesOf(p.id).map(i => i.provider))] : [],
        modifiable: blocker === null, notModifiableReason: blocker,
      }];
    });
  }

  /** Replaces this person's UI-managed roles. Operator grants remain untouched. */
  setRoles(actor: AdmissionActor, rawEmail: unknown, input: { roles?: unknown; note?: unknown;
    accessExpiresAt?: unknown }): MemberView {
    const actorRoles = this.requireAdmit(actor);
    const email = normalizeEmail(rawEmail);
    const blocker = this.modifiability(actor, actorRoles, email);
    if (blocker) throw new AdmissionError('forbidden', 403, blocker);
    const roles = requireRoles(input.roles);
    this.requireGrantable(actorRoles, roles);
    const at = this.now().toISOString();
    const grantId = randomUUID();
    this.repo.transaction(() => {
      this.repo.revokeActiveGrants(email, actor.principalId, 'replaced', at);
      this.repo.insertGrant({ id: grantId, email, roles_json: JSON.stringify(roles), source: 'admin',
        source_id: null, granted_by: actor.principalId, granted_at: at,
        expires_at: futureIso(input.accessExpiresAt, this.now(), 'Access expiry'),
        note: boundedText(input.note, INVITATION_LIMITS.noteMax, 'The note') });
      const p = this.repo.principalByEmail(email);
      if (p) this.repo.mirrorRoles(p.id, this.effective(email).roles);
    });
    this.audit(actor.principalId, 'access.member.roles_set', 'principal_email', email, actor.requestId, { roles, grantId });
    return this.members(actor).find(m => m.email === email)!;
  }

  /**
   * Removes UI-granted access. With `block`, the person also cannot sign in or
   * apply again until unblocked — for the case where a leaked open link was used
   * by someone who should not be here.
   */
  revoke(actor: AdmissionActor, rawEmail: unknown, input: { reason?: unknown; block?: unknown }): {
    revokedGrants: number; blocked: boolean; operatorGrantRemains: boolean } {
    const actorRoles = this.requireAdmit(actor);
    const email = normalizeEmail(rawEmail);
    const blocker = this.modifiability(actor, actorRoles, email);
    if (blocker) throw new AdmissionError('forbidden', 403, blocker);
    const reason = boundedText(input.reason, INVITATION_LIMITS.noteMax, 'The reason') ?? 'revoked';
    const at = this.now().toISOString();
    const block = input.block === true;
    let revoked = 0;
    this.repo.transaction(() => {
      revoked = this.repo.revokeActiveGrants(email, actor.principalId, reason, at);
      const p = this.repo.principalByEmail(email);
      if (p) {
        if (block) this.repo.setPrincipalActive(p.id, false);
        this.repo.mirrorRoles(p.id, this.effective(email).roles);
      }
    });
    this.audit(actor.principalId, block ? 'access.member.blocked' : 'access.member.revoked', 'principal_email',
      email, actor.requestId, { revokedGrants: revoked, reason });
    return { revokedGrants: revoked, blocked: block, operatorGrantRemains: this.bootstrapRolesFor(email).length > 0 };
  }

  unblock(actor: AdmissionActor, rawEmail: unknown): void {
    const actorRoles = this.requireAdmit(actor);
    const email = normalizeEmail(rawEmail);
    const blocker = this.modifiability(actor, actorRoles, email);
    if (blocker) throw new AdmissionError('forbidden', 403, blocker);
    const p = this.repo.principalByEmail(email);
    if (!p) throw new AdmissionError('not_found', 404, 'Nobody has signed in with that address.');
    this.repo.setPrincipalActive(p.id, true);
    this.audit(actor.principalId, 'access.member.unblocked', 'principal_email', email, actor.requestId, {});
  }

  invitations(actor: AdmissionActor): InvitationView[] {
    this.requireView(actor);
    return this.repo.invitations().map(i => this.invitationView(i));
  }

  grantHistory(actor: AdmissionActor, rawEmail: unknown): GrantRow[] {
    this.requireView(actor);
    return this.repo.grantHistory(normalizeEmail(rawEmail));
  }

  // ------------------------------------------------------------------ operator (CLI)

  /**
   * Operator grant from the server shell. The CLI is the actor, attested by
   * root access, so the escalation rule does not apply — this is how the very
   * first administrator of a fresh installation is created when no bootstrap
   * grant is configured in the environment.
   */
  operatorGrant(rawEmail: unknown, rawRoles: unknown, note: string | null): string {
    const email = normalizeEmail(rawEmail);
    const roles = requireRoles(rawRoles);
    const at = this.now().toISOString();
    const grantId = randomUUID();
    this.repo.transaction(() => {
      this.repo.revokeActiveGrants(email, OPERATOR, 'replaced by operator grant', at);
      this.repo.insertGrant({ id: grantId, email, roles_json: JSON.stringify(roles), source: 'admin', source_id: null,
        granted_by: OPERATOR, granted_at: at, expires_at: null, note });
      const p = this.repo.principalByEmail(email);
      if (p) this.repo.mirrorRoles(p.id, this.effective(email).roles);
    });
    this.audit(OPERATOR, 'access.member.operator_grant', 'principal_email', email, 'cli', { roles, grantId });
    return grantId;
  }
}


/**
 * Invitation created from the server shell (`watchdog-admin invite`). Same
 * validation as the UI path except the escalation rule, which root access
 * supersedes; the open-link role cap still applies, because it protects against
 * a leaked link rather than against the person creating it.
 */
export function operatorInvitation(service: AdmissionService, input: Parameters<AdmissionService['createInvitation']>[1]) {
  return service.createInvitation(OPERATOR_ACTOR, input);
}
