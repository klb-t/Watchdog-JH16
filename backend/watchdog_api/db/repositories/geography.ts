import type { Database } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ObjectStore } from '../../storage/object_store';
import { canonicalHash, canonicalizeJson } from '../../domain/canonical';
import { validateGeometryLayer, type GeometryLayerRecord } from '../../../../shared/geography';
import { appendAudit } from './audit';
import { WorkbenchError } from './workbench_error';

export class GeographyRepository {
  constructor(private readonly db: Database, private readonly store: ObjectStore) {}
  async import(input: unknown, actor: string, requestId: string): Promise<GeometryLayerRecord> {
    const document = validateGeometryLayer(input), contentHash = canonicalHash(document), id = `geometry-${contentHash}-${canonicalHash(actor).slice(0, 10)}`;
    const bytes = Buffer.from(canonicalizeJson(document)), uri = await this.store.put(`raw/${contentHash}`, bytes);
    this.db.transaction(() => {
      const now = new Date().toISOString();
      this.db.prepare('INSERT OR IGNORE INTO raw_blobs(id,sha256,object_uri,byte_size,media_type,retention_class,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(`geometry-raw-${contentHash}`, contentHash, uri, bytes.length, 'application/json', 'geometry-import', now);
      const blob = this.db.prepare('SELECT id FROM raw_blobs WHERE sha256=?').get(contentHash) as { id: string };
      this.db.prepare('INSERT OR IGNORE INTO geometry_layers(id,name,content_hash,raw_blob_id,owner_principal_id,created_at) VALUES (?,?,?,?,?,?)').run(id, document.name, contentHash, blob.id, actor, now);
      this.db.prepare('INSERT INTO geometry_import_events VALUES (?,?,?,?,?)').run(randomUUID(), id, blob.id, actor, now);
      appendAudit(this.db, actor, 'geometry.import', 'geometry_layer', id, requestId, { contentHash, features: document.features.length });
    })();
    return (await this.get(id, actor, true))!;
  }
  async get(id: string, actor: string, review = false): Promise<GeometryLayerRecord | null> {
    const row = this.db.prepare('SELECT g.*,b.object_uri FROM geometry_layers g JOIN raw_blobs b ON b.id=g.raw_blob_id WHERE g.id=?').get(id) as any;
    if (!row || row.owner_principal_id !== actor && row.visibility !== 'shared_aggregate') return null;
    const document = validateGeometryLayer(JSON.parse((await this.store.get(row.object_uri)).toString()));
    const live = this.db.prepare('SELECT * FROM geometry_layers WHERE id=?').get(id) as any;
    if (!live || live.owner_principal_id !== actor && live.visibility !== 'shared_aggregate') return null;
    const hash = canonicalHash(document);
    if (hash !== live.content_hash) throw new WorkbenchError('Geometry source integrity mismatch.', 409);
    const approved = live.approved_hash === hash;
    if (!approved && !(review && live.owner_principal_id === actor)) return null;
    return { id, document, contentHash: hash, ownerId: live.owner_principal_id, visibility: live.visibility,
      approvalState: approved ? 'APPROVED' : 'PROPOSED', approvedHash: live.approved_hash, approvedBy: live.approved_by, approvedAt: live.approved_at };
  }
  async list(actor: string, review: boolean) {
    const rows = this.db.prepare("SELECT id FROM geometry_layers WHERE owner_principal_id=? OR visibility='shared_aggregate' ORDER BY created_at DESC,id").all(actor) as { id: string }[];
    const records = await Promise.all(rows.map(r => this.get(r.id, actor, review)));
    return records.filter((r): r is GeometryLayerRecord => Boolean(r));
  }
  async approve(id: string, actor: string, expectedHash: string, share: boolean, requestId: string) {
    const current = await this.get(id, actor, true);
    if (!current || current.contentHash !== expectedHash) throw new WorkbenchError('Geometry is unavailable or its review hash changed.', 409);
    if (current.ownerId !== actor) throw new WorkbenchError('Only the geometry owner can change its approval or sharing.', 403);
    this.db.transaction(() => {
      this.db.prepare('UPDATE geometry_layers SET approved_hash=?,approved_by=?,approved_at=?,visibility=? WHERE id=?').run(expectedHash, actor, new Date().toISOString(), share ? 'shared_aggregate' : 'private', id);
      appendAudit(this.db, actor, 'geometry.approve', 'geometry_layer', id, requestId, { expectedHash, sharedAggregate: share });
    })();
    return this.get(id, actor, true);
  }
  async revoke(id: string, actor: string, requestId: string) {
    const current = await this.get(id, actor, true);
    if (!current || current.ownerId !== actor) throw new WorkbenchError('Geometry ownership required.', 403);
    this.db.transaction(() => {
      this.db.prepare('UPDATE geometry_layers SET approved_hash=NULL,approved_by=NULL,approved_at=NULL WHERE id=?').run(id);
      appendAudit(this.db, actor, 'geometry.revoke', 'geometry_layer', id, requestId, { previousHash: current.approvedHash });
    })();
  }
}
