import type { Database } from 'better-sqlite3';
import { Role } from '../../identity/roles';

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
  /** Joined from `principal_roles`; the highest rung held. */
  role: Role | null;
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
         (SELECT pr.role_id FROM principal_roles pr
           WHERE pr.principal_id = p.id
           ORDER BY CASE pr.role_id
             WHEN 'dev' THEN 0 WHEN 'admin' THEN 1
             WHEN 'researcher' THEN 2 WHEN 'viewer' THEN 3 ELSE 4 END
           LIMIT 1) AS role
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
    return this.sqlite.prepare(`${SELECT_PRINCIPALS} WHERE p.id = ?`).get(id) as PrincipalRow | undefined;
  }

  list(): PrincipalRow[] {
    return this.sqlite.prepare(`${SELECT_PRINCIPALS} ORDER BY p.id`).all() as PrincipalRow[];
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
