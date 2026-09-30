import type { Database } from 'better-sqlite3';
import { Role, isRole } from '../../identity/roles';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AdmissionRequest, AdmissionInvitation, InstallationGrant } from '../../../../shared/admission';

/**
 * The one place principal rows and ownership transfer are written.
 *
 * Lives here, not beside the identity code that uses it, because D2's
 * invariant is that SQL exists only in the repository layer — an invariant
 * with a test behind it, which is how this file's first location was caught.
 */

export interface PrincipalRow {
  id: string;
  email: string | null;
  display_name: string | null;
  /** Legacy single-profile presentation; null when multiple profiles apply. */
  role: Role | null;
  roles: Role[];
  identity_provenance: string;
  active: number;
  created_at: string;
  last_seen_at: string | null;
}

/**
 * Roles live in `principal_roles`, per migration 001's shape. Joined in one
 * statement rather than fetched per principal: an admin screen listing twenty
 * people should not issue twenty-one queries.
 */
const SELECT_PRINCIPALS = `
  SELECT p.id, p.email, p.display_name, p.identity_provenance, p.active,
         p.created_at, p.last_seen_at,
         (SELECT json_group_array(role_id) FROM (SELECT pr.role_id FROM principal_roles pr
           WHERE pr.principal_id = p.id
           ORDER BY pr.role_id)) AS roles_json
  FROM principals p
`;

/**
 * Every table carrying `owner_principal_id`, read from the live schema.
 *
 * Derived rather than listed. A hardcoded list was written first and was
 * wrong — it named two tables that do not have the column — and worse, it
 * would have gone stale the next time a migration added an owned table,
 * silently leaving those rows behind on every future ownership transfer. A
 * half-migrated ownership graph is precisely the failure the transaction
 * below exists to prevent, so the list must not be the weak link.
 */
export function ownedTables(sqlite: Database): string[] {
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  return tables
    .filter(t => (sqlite.prepare(`PRAGMA table_info(${t.name})`).all() as { name: string }[])
      .some(c => c.name === 'owner_principal_id'))
    .map(t => t.name);
}

export class PrincipalRepository {
  constructor(private readonly sqlite: Database) {}

  get(id: string): PrincipalRow | undefined {
    const row = this.sqlite.prepare(`${SELECT_PRINCIPALS} WHERE p.id = ?`).get(id);
    return row ? this.decode(row) : undefined;
  }

  list(): PrincipalRow[] {
    return this.sqlite.prepare(`${SELECT_PRINCIPALS} ORDER BY p.id`).all().map(row => this.decode(row));
  }

  private decode(raw: unknown): PrincipalRow {
    const { roles_json, ...row } = raw as Omit<PrincipalRow, 'role' | 'roles'> & { roles_json: string };
    const roles = (JSON.parse(roles_json) as unknown[]).filter(isRole);
    return { ...row, roles, role: roles.length === 1 ? roles[0] : null };
  }

  /** A verified applicant is recorded for ownership but receives no role. */
  recordIdentity(p: { id: string; email: string; displayName: string | null; at: string }): void {
    this.sqlite.prepare(`INSERT INTO principals (id,email,display_name,identity_provenance,active,created_at,last_seen_at)
      VALUES (@id,@email,@displayName,'google-oidc',1,@at,@at)
      ON CONFLICT(id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,last_seen_at=excluded.last_seen_at`).run(p);
  }

  grant(email: string): InstallationGrant | undefined {
    const row = this.sqlite.prepare('SELECT * FROM installation_grants WHERE email=?').get(email.toLowerCase()) as any;
    if (!row) return undefined;
    const { roles_json, active, ...rest } = row;
    return { ...rest, active: active === 1, roles: JSON.parse(roles_json).filter(isRole) };
  }

  effectiveRoles(email: string, bootstrapRole: Role | null): Role[] {
    const override = this.grant(email);
    if (override) return override.active ? override.roles : [];
    return bootstrapRole ? [bootstrapRole] : [];
  }

  syncRoles(id: string, roles: Role[]): void {
    this.sqlite.transaction(() => {
      this.sqlite.prepare('DELETE FROM principal_roles WHERE principal_id=?').run(id);
      for (const role of [...new Set(roles)].sort()) this.sqlite.prepare('INSERT INTO principal_roles VALUES (?,?)').run(id,role);
    })();
  }

  requests(): AdmissionRequest[] {
    return this.sqlite.prepare('SELECT * FROM admission_requests ORDER BY created_at,principal_id').all() as AdmissionRequest[];
  }

  requestFor(id: string): AdmissionRequest | null {
    return this.sqlite.prepare('SELECT * FROM admission_requests WHERE principal_id=?').get(id) as AdmissionRequest ?? null;
  }

  submitRequest(id: string, email: string, reason: string, at: string): AdmissionRequest {
    return this.sqlite.transaction(() => {
      this.sqlite.prepare(`INSERT INTO admission_requests VALUES (?,?,?,'pending',?,?)
        ON CONFLICT(principal_id) DO UPDATE SET email=excluded.email,reason=excluded.reason,status='pending',updated_at=excluded.updated_at`)
        .run(id,email,reason,at,at);
      this.event(id,'access.request',email,{ reason },at);
      return this.requestFor(id)!;
    })();
  }

  setGrant(email: string, roles: Role[], active: boolean, actor: string, at: string): InstallationGrant {
    return this.sqlite.transaction(() => {
      const ordered = [...new Set(roles)].sort();
      this.sqlite.prepare(`INSERT INTO installation_grants VALUES (?,?,?,?,?)
        ON CONFLICT(email) DO UPDATE SET roles_json=excluded.roles_json,active=excluded.active,actor_principal_id=excluded.actor_principal_id,updated_at=excluded.updated_at`)
        .run(email,JSON.stringify(ordered),Number(active),actor,at);
      for (const p of this.list().filter(p => p.email?.toLowerCase() === email)) {
        this.syncRoles(p.id,active ? ordered : []);
        this.sqlite.prepare('UPDATE principals SET active=? WHERE id=?').run(Number(active),p.id);
      }
      this.sqlite.prepare('UPDATE admission_requests SET status=?,updated_at=? WHERE email=?')
        .run(active ? 'approved' : 'rejected',at,email);
      this.event(actor,active ? 'access.grant' : 'access.revoke',email,{ roles: ordered },at);
      return this.grant(email)!;
    })();
  }

  grants(): InstallationGrant[] {
    return (this.sqlite.prepare('SELECT email FROM installation_grants ORDER BY email').all() as {email:string}[]).map(r => this.grant(r.email)!);
  }

  invitations(): AdmissionInvitation[] {
    return this.sqlite.prepare(`SELECT id,email,message,actor_principal_id,created_at,expires_at,revoked_at,accepted_at,accepted_principal_id
      FROM admission_invitations ORDER BY created_at,id`).all() as AdmissionInvitation[];
  }

  createInvitation(email: string, message: string, actor: string, at: string, expiresAt: string): { invitation: AdmissionInvitation; token: string } {
    return this.sqlite.transaction(() => {
      const id = randomUUID(), token = randomBytes(32).toString('base64url');
      this.sqlite.prepare('INSERT INTO admission_invitations VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(id,this.invitationHash(token),email,message,actor,at,expiresAt,null,null,null);
      this.event(actor,'invitation.create',email,{ id,expires_at:expiresAt },at);
      return { invitation: this.invitations().find(i => i.id === id)!, token };
    })();
  }

  revokeInvitation(id: string, actor: string, at: string): boolean {
    return this.sqlite.transaction(() => {
      const invitation = this.invitations().find(i => i.id === id);
      if (!invitation || invitation.revoked_at) return false;
      this.sqlite.prepare('UPDATE admission_invitations SET revoked_at=? WHERE id=?').run(at,id);
      this.event(actor,'invitation.revoke',invitation.email,{ id },at);
      return true;
    })();
  }

  acceptInvitation(token: string, principalId: string, email: string, at: string): AdmissionRequest {
    return this.sqlite.transaction(() => {
      const invitation = this.sqlite.prepare('SELECT * FROM admission_invitations WHERE token_hash=?').get(this.invitationHash(token)) as AdmissionInvitation | undefined;
      // Do not reveal whether a token exists for somebody else's identity.
      if (!invitation || invitation.email !== email || invitation.revoked_at || invitation.accepted_at || invitation.expires_at <= at) {
        throw new Error('Invitation unavailable for this verified identity.');
      }
      this.sqlite.prepare('UPDATE admission_invitations SET accepted_at=?,accepted_principal_id=? WHERE id=?').run(at,principalId,invitation.id);
      this.event(principalId,'invitation.accept',email,{ id:invitation.id },at);
      return this.submitRequest(principalId,email,invitation.message || 'Invited to this installation.',at);
    })();
  }

  private invitationHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
  private event(actor: string, action: string, email: string, detail: unknown, at: string): void {
    this.sqlite.prepare('INSERT INTO admission_events (actor_principal_id,action,target_email,detail_json,created_at) VALUES (?,?,?,?,?)')
      .run(actor,action,email,JSON.stringify(detail),at);
  }

  /**
   * Records a sign-in. `first_seen_at` is preserved across sign-ins; the role
   * is refreshed, because the grant list is authoritative for what someone may
   * do *now* while the row remains the record of who they are.
   */
  upsertOnSignIn(p: {
    id: string; email: string | null; displayName: string | null;
    role: Role; identityProvenance: string; at: string;
  }): void {
    // One transaction: a principal row without its role row is a signed-in
    // person with no capabilities, which looks like a permissions bug.
    this.sqlite.transaction(() => {
      this.sqlite.prepare(`
        INSERT INTO principals (id, email, display_name, identity_provenance, active, created_at, last_seen_at)
        VALUES (@id, @email, @display_name, @provenance, 1, @at, @at)
        ON CONFLICT(id) DO UPDATE SET
          email = excluded.email,
          display_name = excluded.display_name,
          last_seen_at = excluded.last_seen_at
      `).run({
        id: p.id, email: p.email, display_name: p.displayName,
        provenance: p.identityProvenance, at: p.at,
      });

      // The grant list is authoritative for what someone may do now, so the
      // role set is replaced rather than added to: revoking a grant must
      // actually revoke it at the next sign-in.
      this.sqlite.prepare('DELETE FROM principal_roles WHERE principal_id = ?').run(p.id);
      this.sqlite.prepare('INSERT INTO principal_roles (principal_id, role_id) VALUES (?, ?)')
        .run(p.id, p.role);
    })();
  }

  /**
   * Hands every `local-user` row to a real principal (E4.1's stated test).
   *
   * One transaction across all eight tables: a half-migrated database would
   * leave a run owned by one principal and its artifacts by another, which is
   * worse than not having started.
   *
   * Idempotent — a second call moves nothing, because there is nothing left
   * under `local-user` to move.
   */
  migrateLocalUserRows(toPrincipalId: string): Record<string, number> {
    if (!this.get(toPrincipalId)) {
      throw new Error(`Cannot migrate to unknown principal '${toPrincipalId}'. Sign in once first.`);
    }
    if (toPrincipalId === 'local-user') {
      throw new Error('Refusing to migrate local-user onto itself.');
    }

    const moved: Record<string, number> = {};
    this.sqlite.transaction(() => {
      for (const table of ownedTables(this.sqlite)) {
        const r = this.sqlite
          .prepare(`UPDATE ${table} SET owner_principal_id = ? WHERE owner_principal_id = 'local-user'`)
          .run(toPrincipalId);
        moved[table] = r.changes;
      }
    })();
    return moved;
  }

  countOwnedBy(principalId: string): number {
    return ownedTables(this.sqlite).reduce((sum, t) => sum + (this.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE owner_principal_id = ?`)
      .get(principalId) as { n: number }).n, 0);
  }
}
