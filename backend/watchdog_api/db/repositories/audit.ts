import type { Database } from 'better-sqlite3';
export class AuditRepository {
  constructor(private readonly db: Database) {}
  append(...event: Parameters<typeof appendAudit> extends [Database, ...infer Rest] ? Rest : never) { appendAudit(this.db, ...event); }
}
import { randomUUID } from 'node:crypto';
import { canonicalHash } from '../../domain/canonical';
/** All consumers append to the same hash chain. No parallel debug/audit truth store. */
export function appendAudit(db: Database, actorId: string, action: string, objectType: string, objectId: string, requestId: string, metadata: unknown) {
  const previous = db.prepare('SELECT event_hash FROM audit_events ORDER BY rowid DESC LIMIT 1').get() as any;
  const event = { id: randomUUID(), timestamp: new Date().toISOString(), actor_type: 'principal', actor_id: actorId, action,
    object_type: objectType, object_id: objectId, request_id: requestId, metadata_json: JSON.stringify(metadata), previous_event_hash: previous?.event_hash ?? null };
  db.prepare(`INSERT INTO audit_events(id,timestamp,actor_type,actor_id,action,object_type,object_id,request_id,metadata_json,previous_event_hash,event_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(...Object.values(event), canonicalHash(event));
}
