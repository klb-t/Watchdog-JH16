import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { canonicalHash } from '../../domain/canonical';
import type { Edition } from '../../services/manuscript_editing';

/** Write-once language editions of replication manuscripts, with their cost. */
export class ManuscriptEditionRepository {
  constructor(private readonly db: BetterSQLite3Database<any>) {}

  save(owner: string, e: Edition) {
    const body = JSON.stringify(e);
    this.db.run(sql`INSERT INTO manuscript_editions VALUES (${e.id}, ${owner}, ${e.target_id}, ${e.manuscript_input_hash}, ${e.provider}, ${e.model},
      ${e.settings_hash}, ${body}, ${canonicalHash(e)}, ${e.estimated_cost_usd}, ${e.created_at.slice(0, 10)}, ${e.created_at})`);
    return e;
  }

  spentToday(owner: string): number {
    const day = new Date().toISOString().slice(0, 10);
    const row = this.db.get<{ total: number | null }>(sql`SELECT SUM(estimated_cost_usd) AS total FROM manuscript_editions WHERE owner_principal_id = ${owner} AND day_utc = ${day}`);
    return row?.total ?? 0;
  }

  get(owner: string, id: string): Edition | null {
    const row = this.db.get<{ body_json: string; content_hash: string }>(sql`SELECT body_json, content_hash FROM manuscript_editions WHERE id = ${id} AND owner_principal_id = ${owner}`);
    if (!row) return null;
    const e = JSON.parse(row.body_json) as Edition;
    if (canonicalHash(e) !== row.content_hash) throw new Error('Manuscript edition integrity mismatch');
    return e;
  }

  list(owner: string, target: string) {
    return this.db.all<{ id: string; model: string; manuscript_input_hash: string; estimated_cost_usd: number; created_at: string }>(
      sql`SELECT id, model, manuscript_input_hash, estimated_cost_usd, created_at FROM manuscript_editions WHERE owner_principal_id = ${owner} AND target_id = ${target} ORDER BY created_at DESC, id`);
  }
}
