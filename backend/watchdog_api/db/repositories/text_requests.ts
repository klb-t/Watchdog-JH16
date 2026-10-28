import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { canonicalHash } from '../../domain/canonical';

/** Write-once text requests and their append-only events (migration 026). */

export type RequestEventKind = 'launched' | 'deferred' | 'accepted' | 'answered' | 'failed';
export interface StoredRequest { id: string; created_at: string; text_sha256: string; content_hash: string; body: any; events: { sequence: number; kind: RequestEventKind; body: any; created_at: string }[] }

export class TextRequestRepository {
  constructor(private readonly db: BetterSQLite3Database<any>) {}
  create(owner: string, textSha256: string, body: any): StoredRequest {
    const id = randomUUID(), created_at = new Date().toISOString(), content_hash = canonicalHash(body);
    this.db.run(sql`INSERT INTO text_requests VALUES (${id}, ${owner}, ${textSha256}, ${JSON.stringify(body)}, ${content_hash}, ${created_at})`);
    return this.get(owner, id)!;
  }
  event(owner: string, requestId: string, kind: RequestEventKind, body: any) {
    if (!this.get(owner, requestId)) throw new Error('Request not found');
    this.db.run(sql`INSERT INTO text_request_events (request_id, owner_principal_id, kind, body_json, created_at) VALUES (${requestId}, ${owner}, ${kind}, ${JSON.stringify(body)}, ${new Date().toISOString()})`);
  }
  get(owner: string, id: string): StoredRequest | null {
    const r = this.db.get<any>(sql`SELECT * FROM text_requests WHERE owner_principal_id = ${owner} AND id = ${id}`);
    if (!r) return null;
    const body = JSON.parse(r.body_json);
    if (canonicalHash(body) !== r.content_hash) throw new Error('Text request integrity mismatch');
    const events = this.db.all<any>(sql`SELECT * FROM text_request_events WHERE request_id = ${id} AND owner_principal_id = ${owner} ORDER BY sequence`)
      .map(e => ({ sequence: e.sequence, kind: e.kind, body: JSON.parse(e.body_json), created_at: e.created_at }));
    return { id: r.id, created_at: r.created_at, text_sha256: r.text_sha256, content_hash: r.content_hash, body, events };
  }
  list(owner: string) {
    return this.db.all<any>(sql`SELECT id, created_at, body_json FROM text_requests WHERE owner_principal_id = ${owner} ORDER BY created_at DESC, id`)
      .map(r => { const b = JSON.parse(r.body_json); return { id: r.id, created_at: r.created_at, excerpt: b.text.slice(0, 160), target_id: b.analysis.target?.target_id ?? null }; });
  }
}
