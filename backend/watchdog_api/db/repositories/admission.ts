import type { Database } from 'better-sqlite3';

/**
 * Storage for E4.5 admission: identities, grants, invitations, applications and
 * one-time sign-in challenges. SQL only — every rule about who may do what lives
 * in `identity/admission.ts`, which is the only caller.
 *
 * Kept in the repository layer because D2's invariant (no SQL outside it) has a
 * test behind it.
 */

export interface PrincipalAuthRow {
  id: string;
  email: string | null;
  display_name: string | null;
  active: number;
  session_version: number;
  created_at: string;
  last_seen_at: string | null;
}

export interface GrantRow {
  id: string;
  email: string;
  roles_json: string;
  source: 'invitation' | 'open_link' | 'application' | 'admin';
  source_id: string | null;
  granted_by: string;
  granted_at: string;
  expires_at: string | null;
  note: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
}

export interface InvitationRow {
  id: string;
  kind: 'email' | 'open_link';
  token_hash: string;
  email: string | null;
  roles_json: string;
  note: string | null;
  max_uses: number;
  uses: number;
  expires_at: string;
  access_expires_at: string | null;
  created_by: string;
  created_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  delivery_status: 'draft' | 'link_shared' | 'sent' | 'send_failed';
  delivery_detail: string | null;
  last_delivery_at: string | null;
}

export interface ApplicationRow {
  id: string;
  principal_id: string;
  email: string;
  display_name: string | null;
  affiliation: string | null;
  reason: string;
  requested_roles_json: string;
  status: 'pending' | 'approved' | 'denied' | 'withdrawn';
  submitted_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  grant_id: string | null;
}

export interface ChallengeRow {
  id: string;
  kind: 'email_code' | 'operator_link';
  email: string;
  secret_hash: string;
  created_at: string;
  expires_at: string;
  attempts: number;
  consumed_at: string | null;
  delivery_status: 'pending' | 'sent' | 'send_failed' | 'printed';
}

export interface IdentityRow {
  provider: 'google' | 'email' | 'operator';
  subject: string;
  principal_id: string;
  email: string;
  first_seen_at: string;
  last_seen_at: string;
}

export class AdmissionRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ------------------------------------------------------------ principals

  principal(id: string): PrincipalAuthRow | undefined {
    return this.db.prepare(`SELECT id, email, display_name, active, session_version, created_at, last_seen_at
      FROM principals WHERE id = ?`).get(id) as PrincipalAuthRow | undefined;
  }

  principalByEmail(email: string): PrincipalAuthRow | undefined {
    // Oldest first, so an address that somehow has two rows resolves stably.
    return this.db.prepare(`SELECT id, email, display_name, active, session_version, created_at, last_seen_at
      FROM principals WHERE lower(email) = ? ORDER BY created_at, id LIMIT 1`).get(email) as PrincipalAuthRow | undefined;
  }

  principals(): PrincipalAuthRow[] {
    return this.db.prepare(`SELECT id, email, display_name, active, session_version, created_at, last_seen_at
      FROM principals WHERE email IS NOT NULL ORDER BY lower(email), id`).all() as PrincipalAuthRow[];
  }

  createPrincipal(p: { id: string; email: string; displayName: string | null; provenance: string; at: string }): void {
    this.db.prepare(`INSERT INTO principals (id, email, display_name, identity_provenance, active, created_at, last_seen_at, session_version)
      VALUES (?, ?, ?, ?, 1, ?, ?, 1)`).run(p.id, p.email, p.displayName, p.provenance, p.at, p.at);
  }

  /** A provider-supplied name fills an empty one; it never overwrites a name the person chose. */
  touchPrincipal(id: string, displayName: string | null, at: string): void {
    this.db.prepare(`UPDATE principals SET last_seen_at = ?, display_name = COALESCE(display_name, ?) WHERE id = ?`)
      .run(at, displayName, id);
  }

  setDisplayName(id: string, displayName: string | null): void {
    this.db.prepare('UPDATE principals SET display_name = ? WHERE id = ?').run(displayName, id);
  }

  setPrincipalActive(id: string, active: boolean): void {
    this.db.prepare('UPDATE principals SET active = ?, session_version = session_version + 1 WHERE id = ?')
      .run(active ? 1 : 0, id);
  }

  bumpSessionVersion(id: string): void {
    this.db.prepare('UPDATE principals SET session_version = session_version + 1 WHERE id = ?').run(id);
  }

  // ------------------------------------------------------------ identities

  identity(provider: string, subject: string): IdentityRow | undefined {
    return this.db.prepare('SELECT * FROM principal_identities WHERE provider = ? AND subject = ?')
      .get(provider, subject) as IdentityRow | undefined;
  }

  identitiesOf(principalId: string): IdentityRow[] {
    return this.db.prepare('SELECT * FROM principal_identities WHERE principal_id = ? ORDER BY provider, subject')
      .all(principalId) as IdentityRow[];
  }

  linkIdentity(i: { provider: string; subject: string; principalId: string; email: string; at: string }): void {
    this.db.prepare(`INSERT INTO principal_identities (provider, subject, principal_id, email, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(i.provider, i.subject, i.principalId, i.email, i.at, i.at);
  }

  touchIdentity(provider: string, subject: string, at: string): void {
    this.db.prepare('UPDATE principal_identities SET last_seen_at = ? WHERE provider = ? AND subject = ?')
      .run(at, provider, subject);
  }

  // ------------------------------------------------------------ grants

  /** Not revoked and not expired at `nowIso`. */
  activeGrants(email: string, nowIso: string): GrantRow[] {
    return this.db.prepare(`SELECT * FROM admission_grants
      WHERE email = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY granted_at, id`).all(email, nowIso) as GrantRow[];
  }

  allActiveGrants(nowIso: string): GrantRow[] {
    return this.db.prepare(`SELECT * FROM admission_grants
      WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY email, granted_at, id`).all(nowIso) as GrantRow[];
  }

  grantHistory(email: string): GrantRow[] {
    return this.db.prepare('SELECT * FROM admission_grants WHERE email = ? ORDER BY granted_at DESC, id')
      .all(email) as GrantRow[];
  }

  grant(id: string): GrantRow | undefined {
    return this.db.prepare('SELECT * FROM admission_grants WHERE id = ?').get(id) as GrantRow | undefined;
  }

  insertGrant(g: Omit<GrantRow, 'revoked_at' | 'revoked_by' | 'revoke_reason'>): void {
    this.db.prepare(`INSERT INTO admission_grants
      (id, email, roles_json, source, source_id, granted_by, granted_at, expires_at, note)
      VALUES (@id, @email, @roles_json, @source, @source_id, @granted_by, @granted_at, @expires_at, @note)`).run(g);
  }

  revokeActiveGrants(email: string, by: string, reason: string, at: string): number {
    return this.db.prepare(`UPDATE admission_grants SET revoked_at = ?, revoked_by = ?, revoke_reason = ?
      WHERE email = ? AND revoked_at IS NULL`).run(at, by, reason, email).changes;
  }

  // ------------------------------------------------------------ invitations

  insertInvitation(i: Omit<InvitationRow, 'uses' | 'revoked_at' | 'revoked_by' | 'delivery_status' |
    'delivery_detail' | 'last_delivery_at'>): void {
    this.db.prepare(`INSERT INTO invitations
      (id, kind, token_hash, email, roles_json, note, max_uses, expires_at, access_expires_at, created_by, created_at)
      VALUES (@id, @kind, @token_hash, @email, @roles_json, @note, @max_uses, @expires_at, @access_expires_at,
              @created_by, @created_at)`).run(i);
  }

  invitation(id: string): InvitationRow | undefined {
    return this.db.prepare('SELECT * FROM invitations WHERE id = ?').get(id) as InvitationRow | undefined;
  }

  invitationByTokenHash(hash: string): InvitationRow | undefined {
    return this.db.prepare('SELECT * FROM invitations WHERE token_hash = ?').get(hash) as InvitationRow | undefined;
  }

  invitations(): InvitationRow[] {
    return this.db.prepare('SELECT * FROM invitations ORDER BY created_at DESC, id').all() as InvitationRow[];
  }

  /**
   * The atomic seat. Two people opening the last use of a link at the same
   * moment cannot both get in, because the check and the increment are one
   * statement.
   */
  consumeInvitationUse(id: string, nowIso: string): boolean {
    return this.db.prepare(`UPDATE invitations SET uses = uses + 1
      WHERE id = ? AND uses < max_uses AND revoked_at IS NULL AND expires_at > ?`).run(id, nowIso).changes === 1;
  }

  revokeInvitation(id: string, by: string, at: string): boolean {
    return this.db.prepare('UPDATE invitations SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL')
      .run(at, by, id).changes === 1;
  }

  rotateInvitationToken(id: string, tokenHash: string): void {
    this.db.prepare(`UPDATE invitations SET token_hash = ?, delivery_status = 'draft', delivery_detail = NULL
      WHERE id = ?`).run(tokenHash, id);
  }

  setInvitationDelivery(id: string, status: InvitationRow['delivery_status'], detail: string | null, at: string): void {
    this.db.prepare(`UPDATE invitations SET delivery_status = ?, delivery_detail = ?, last_delivery_at = ? WHERE id = ?`)
      .run(status, detail, at, id);
  }

  redemption(invitationId: string, principalId: string): { grant_id: string } | undefined {
    return this.db.prepare('SELECT grant_id FROM invitation_redemptions WHERE invitation_id = ? AND principal_id = ?')
      .get(invitationId, principalId) as { grant_id: string } | undefined;
  }

  redemptionsOf(invitationId: string): { email: string; redeemed_at: string }[] {
    return this.db.prepare(`SELECT email, redeemed_at FROM invitation_redemptions
      WHERE invitation_id = ? ORDER BY redeemed_at, id`).all(invitationId) as { email: string; redeemed_at: string }[];
  }

  insertRedemption(r: { id: string; invitationId: string; principalId: string; email: string; grantId: string; at: string }): void {
    this.db.prepare(`INSERT INTO invitation_redemptions (id, invitation_id, principal_id, email, grant_id, redeemed_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(r.id, r.invitationId, r.principalId, r.email, r.grantId, r.at);
  }

  // ------------------------------------------------------------ applications

  insertApplication(a: Omit<ApplicationRow, 'decided_at' | 'decided_by' | 'decision_note' | 'grant_id'>): void {
    this.db.prepare(`INSERT INTO access_applications
      (id, principal_id, email, display_name, affiliation, reason, requested_roles_json, status, submitted_at)
      VALUES (@id, @principal_id, @email, @display_name, @affiliation, @reason, @requested_roles_json, @status,
              @submitted_at)`).run(a);
  }

  application(id: string): ApplicationRow | undefined {
    return this.db.prepare('SELECT * FROM access_applications WHERE id = ?').get(id) as ApplicationRow | undefined;
  }

  applicationsOf(principalId: string): ApplicationRow[] {
    return this.db.prepare('SELECT * FROM access_applications WHERE principal_id = ? ORDER BY submitted_at DESC, id')
      .all(principalId) as ApplicationRow[];
  }

  pendingApplicationOf(principalId: string): ApplicationRow | undefined {
    return this.db.prepare("SELECT * FROM access_applications WHERE principal_id = ? AND status = 'pending'")
      .get(principalId) as ApplicationRow | undefined;
  }

  applications(): ApplicationRow[] {
    return this.db.prepare(`SELECT * FROM access_applications
      ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, submitted_at DESC, id`).all() as ApplicationRow[];
  }

  /** Only a pending application can be decided; a race loses cleanly. */
  decideApplication(id: string, d: { status: 'approved' | 'denied' | 'withdrawn'; by: string; note: string | null;
    grantId: string | null; at: string }): boolean {
    return this.db.prepare(`UPDATE access_applications
      SET status = ?, decided_by = ?, decision_note = ?, grant_id = ?, decided_at = ?
      WHERE id = ? AND status = 'pending'`).run(d.status, d.by, d.note, d.grantId, d.at, id).changes === 1;
  }

  // ------------------------------------------------------------ challenges

  insertChallenge(c: Omit<ChallengeRow, 'attempts' | 'consumed_at'>): void {
    this.db.prepare(`INSERT INTO sign_in_challenges (id, kind, email, secret_hash, created_at, expires_at, delivery_status)
      VALUES (@id, @kind, @email, @secret_hash, @created_at, @expires_at, @delivery_status)`).run(c);
  }

  challenge(id: string): ChallengeRow | undefined {
    return this.db.prepare('SELECT * FROM sign_in_challenges WHERE id = ?').get(id) as ChallengeRow | undefined;
  }

  challengeBySecretHash(kind: ChallengeRow['kind'], hash: string): ChallengeRow | undefined {
    return this.db.prepare('SELECT * FROM sign_in_challenges WHERE kind = ? AND secret_hash = ?')
      .get(kind, hash) as ChallengeRow | undefined;
  }

  /** The newest unconsumed, unexpired code for an address; older ones are ignored. */
  liveChallenge(kind: ChallengeRow['kind'], email: string, nowIso: string): ChallengeRow | undefined {
    return this.db.prepare(`SELECT * FROM sign_in_challenges
      WHERE kind = ? AND email = ? AND consumed_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC, id DESC LIMIT 1`).get(kind, email, nowIso) as ChallengeRow | undefined;
  }

  countChallengesSince(kind: ChallengeRow['kind'], email: string, sinceIso: string): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM sign_in_challenges
      WHERE kind = ? AND email = ? AND created_at > ?`).get(kind, email, sinceIso) as { n: number }).n;
  }

  incrementChallengeAttempts(id: string): number {
    this.db.prepare('UPDATE sign_in_challenges SET attempts = attempts + 1 WHERE id = ?').run(id);
    return (this.db.prepare('SELECT attempts FROM sign_in_challenges WHERE id = ?').get(id) as { attempts: number }).attempts;
  }

  consumeChallenge(id: string, at: string): boolean {
    return this.db.prepare('UPDATE sign_in_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
      .run(at, id).changes === 1;
  }

  setChallengeDelivery(id: string, status: ChallengeRow['delivery_status']): void {
    this.db.prepare('UPDATE sign_in_challenges SET delivery_status = ? WHERE id = ?').run(status, id);
  }

  /**
   * Mirrors current effective roles into `principal_roles`, which older
   * readers (the principals listing, ownership reports) still use. The
   * authority for every request remains the live grant computation; this is a
   * convenience copy refreshed at sign-in and on every admission change.
   */
  mirrorRoles(principalId: string, roles: readonly string[]): void {
    this.db.prepare('DELETE FROM principal_roles WHERE principal_id = ?').run(principalId);
    const insert = this.db.prepare('INSERT OR IGNORE INTO principal_roles (principal_id, role_id) VALUES (?, ?)');
    for (const role of [...roles].sort()) insert.run(principalId, role);
  }
}
