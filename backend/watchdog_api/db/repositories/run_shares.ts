import type { Database } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

/** Read-only shares of runs (migration 027). Rows are never edited or deleted; revocation is the only change. */
export interface RunShareRow {
  id: string; run_id: string; owner_principal_id: string; target_kind: 'principal' | 'email' | 'link'; target: string | null;
  token_hash: string | null; via_share_id: string | null; note: string | null; created_by: string; created_at: string;
  expires_at: string | null; revoked_at: string | null; revoked_by: string | null;
}

export class RunShareRepository {
  constructor(private readonly db: Database) {}

  insert(r: Omit<RunShareRow, 'id' | 'revoked_at' | 'revoked_by'>): string {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO run_shares (id, run_id, owner_principal_id, target_kind, target, token_hash, via_share_id, note, created_by, created_at, expires_at)
      VALUES (@id, @run_id, @owner_principal_id, @target_kind, @target, @token_hash, @via_share_id, @note, @created_by, @created_at, @expires_at)`).run({ ...r, id });
    return id;
  }
  transaction<T>(fn: () => T): T { return this.db.transaction(fn)(); }
  get(id: string): RunShareRow | undefined { return this.db.prepare('SELECT * FROM run_shares WHERE id = ?').get(id) as RunShareRow | undefined; }
  byOwner(owner: string): RunShareRow[] {
    return this.db.prepare('SELECT * FROM run_shares WHERE owner_principal_id = ? ORDER BY created_at DESC, id').all(owner) as RunShareRow[];
  }
  activeByToken(tokenHash: string, nowIso: string): RunShareRow[] {
    return this.db.prepare(`SELECT * FROM run_shares WHERE target_kind = 'link' AND token_hash = ? AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ?) ORDER BY run_id`).all(tokenHash, nowIso) as RunShareRow[];
  }
  /** Runs this principal may read because someone shared them; a share made from a link ends with the link. */
  readableRunIds(principalId: string, email: string | null, nowIso: string): Set<string> {
    const rows = this.db.prepare(`SELECT s.run_id FROM run_shares s LEFT JOIN run_shares v ON v.id = s.via_share_id
      WHERE s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > @now)
        AND (v.id IS NULL OR (v.revoked_at IS NULL AND (v.expires_at IS NULL OR v.expires_at > @now)))
        AND ((s.target_kind = 'principal' AND s.target = @pid) OR (s.target_kind = 'email' AND s.target = @email))`)
      .all({ now: nowIso, pid: principalId, email: email ?? '' }) as { run_id: string }[];
    return new Set(rows.map(r => r.run_id));
  }
  redeemedBy(linkShareId: string, principalId: string): RunShareRow | undefined {
    return this.db.prepare(`SELECT * FROM run_shares WHERE via_share_id = ? AND target_kind = 'principal' AND target = ?`).get(linkShareId, principalId) as RunShareRow | undefined;
  }
  revoke(id: string, by: string, at: string): boolean {
    return this.db.prepare('UPDATE run_shares SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL').run(at, by, id).changes === 1;
  }
}
