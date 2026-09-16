import type { Database } from 'better-sqlite3';
import type { PublicReceipt } from '../../../../shared/automation';
import { compareJson, SourceHistoryError, SourceHistoryProfileSchema } from '../../../../shared/source_history';
import type { SourceContext, SourceObservation, SourceHistoryEntry, SourceHistoryGroup, SourceHistoryPage, SourceComparison, SourceHistoryProfile, JsonValue } from '../../../../shared/source_history';
import { canonicalHash,canonicalizeJson } from '../../domain/canonical';
import { decodeCollectionContext } from '../../utils/collection_context';

const joins = `FROM substance_reference_observations o
 JOIN substance_reference_records r ON r.id=o.record_id
 JOIN public_fetch_receipts f ON f.id=o.receipt_id
 LEFT JOIN raw_blobs b ON b.id=f.raw_blob_id`;
const fields = `o.sequence,o.origin,o.source_profile_hash,r.id AS record_id,r.substance_id,r.provider,r.kind,r.content_hash,r.value_json,
 f.id AS receipt_id,f.provider AS receipt_provider,f.url,f.fetched_at,f.job_id,f.http_status,f.adapter_version,f.license,f.collection_context_json,
 b.sha256,b.byte_size`;
const contextFields = 'r.substance_id,r.provider,r.kind,f.url,f.adapter_version,o.source_profile_hash,f.collection_context_json';
const contextWhere = 'r.substance_id=? AND r.provider=? AND r.kind=? AND f.url=? AND f.adapter_version=? AND o.source_profile_hash=? AND f.collection_context_json IS ?';
const contextValues = (c: SourceContext) => [c.substanceId,c.provider,c.kind,c.url,c.adapterVersion,c.sourceProfileHash,c.collection?canonicalizeJson(c.collection):null];
function context(row: any): SourceContext {
  return { substanceId: row.substance_id, provider: row.provider, kind: row.kind, url: row.url,
    adapterVersion: row.adapter_version, sourceProfileHash: row.source_profile_hash, ...decodeCollectionContext(row.collection_context_json) };
}
function receipt(row: any): PublicReceipt {
  return { id: row.receipt_id, provider: row.receipt_provider, url: row.url, fetchedAt: row.fetched_at,
    sha256: row.sha256 ?? '', httpStatus: row.http_status, bytes: row.byte_size ?? 0,
    adapterVersion: row.adapter_version, jobId: row.job_id, license: row.license, ...decodeCollectionContext(row.collection_context_json) };
}
function observation(row: any): SourceObservation {
  return { sequence: row.sequence, recordId: row.record_id, contentHash: row.content_hash, origin: row.origin, receipt: receipt(row) };
}
function checkedValue(row: any): JsonValue {
  const value = JSON.parse(row.value_json);
  const hash = canonicalHash({ id: row.substance_id, provider: row.provider, kind: row.kind, value });
  if (hash !== row.content_hash || row.record_id !== `reference-${hash}`) throw new SourceHistoryError('Stored reference content hash mismatch');
  return value;
}

export class ReferenceHistoryRepository {
  constructor(private readonly db: Database) {}
  /** Called inside the same transaction as the content record. Replaying one receipt is idempotent. */
  observe(recordId: string, supplied: PublicReceipt) {
    const f = this.db.prepare(`SELECT f.*,b.sha256,b.byte_size,j.profile_hash FROM public_fetch_receipts f
      JOIN automation_jobs j ON j.id=f.job_id LEFT JOIN raw_blobs b ON b.id=f.raw_blob_id WHERE f.id=?`).get(supplied.id) as any;
    if (!f || canonicalHash(receipt({ ...f, receipt_id: f.id, receipt_provider: f.provider })) !== canonicalHash(supplied))
      throw new SourceHistoryError('Receipt does not match its stored acquisition');
    const r = this.db.prepare('SELECT * FROM substance_reference_records WHERE id=?').get(recordId) as any;
    if (!r || r.provider !== f.provider || f.http_status < 200 || f.http_status >= 300 || !f.sha256)
      throw new SourceHistoryError('A successful matching source receipt is required');
    checkedValue({ ...r, record_id: r.id });
    const conflicting = this.db.prepare(`SELECT 1 FROM substance_reference_observations o JOIN substance_reference_records r ON r.id=o.record_id
      WHERE o.receipt_id=? AND r.substance_id=? AND r.provider=? AND r.kind=? AND r.id<>?`).get(f.id,r.substance_id,r.provider,r.kind,recordId);
    if (conflicting) throw new SourceHistoryError('One receipt cannot assert conflicting versions of the same reference kind');
    this.db.prepare(`INSERT OR IGNORE INTO substance_reference_observations(record_id,receipt_id,source_profile_hash,origin)
      VALUES (?,?,?,'recorded')`).run(recordId,f.id,f.profile_hash);
  }
  private requireSubstance(id: string) {
    if (!this.db.prepare('SELECT 1 FROM substance_reference_records WHERE substance_id=?').get(id)) throw new SourceHistoryError('Substance not found',404);
  }
  groups(id: string, limit: number, offset = 0): { groups: SourceHistoryGroup[]; nextOffset: number | null } {
    this.requireSubstance(id);
    const rows = this.db.prepare(`SELECT ${contextFields},MAX(o.sequence) AS anchor,COUNT(*) AS observations,
      COUNT(DISTINCT r.id) AS versions,MIN(f.fetched_at) AS first_seen,MAX(f.fetched_at) AS last_checked,
      SUM(CASE WHEN o.origin='legacy_first_receipt' THEN 1 ELSE 0 END) AS legacy
      ${joins} WHERE r.substance_id=? GROUP BY ${contextFields}
      ORDER BY r.provider,r.kind,f.url,f.adapter_version,o.source_profile_hash,f.collection_context_json LIMIT ? OFFSET ?`).all(id,limit+1,offset) as any[];
    return { groups: rows.slice(0,limit).map(row => ({ context: context(row), contextHash: canonicalHash(context(row)), anchor: row.anchor,
      observations: row.observations, versions: row.versions, firstObservedAt: row.first_seen, lastObservedAt: row.last_checked, legacyObservations: row.legacy })),
      nextOffset: rows.length > limit ? offset + limit : null };
  }
  private row(id: string, sequence: number): any {
    const row = this.db.prepare(`SELECT ${fields} ${joins} WHERE r.substance_id=? AND o.sequence=?`).get(id,sequence) as any;
    if (!row) throw new SourceHistoryError('Source observation not found',404);
    return row;
  }
  page(id: string, anchor: number, limit: number, before?: number): SourceHistoryPage {
    return this.db.transaction(() => {
      const base = this.row(id,anchor), ctx = context(base), ctxHash = canonicalHash(ctx);
      const cursor = before === undefined ? null : this.row(id,before);
      if (cursor && canonicalHash(context(cursor)) !== ctxHash) throw new SourceHistoryError('History cursor belongs to a different source context');
      // Windows are evaluated over the complete context before pagination, preserving version ages and transitions.
      const rows = this.db.prepare(`WITH history AS (SELECT ${fields},
        LAG(r.content_hash) OVER (ORDER BY f.fetched_at,o.sequence) AS previous_hash,
        MIN(f.fetched_at) OVER (PARTITION BY r.id) AS version_first,
        MAX(f.fetched_at) OVER (PARTITION BY r.id) AS version_last,
        COUNT(*) OVER (PARTITION BY r.id) AS version_count
        ${joins} WHERE ${contextWhere}) SELECT * FROM history
        ${cursor ? 'WHERE fetched_at<? OR (fetched_at=? AND sequence<?)' : ''}
        ORDER BY fetched_at DESC,sequence DESC LIMIT ?`).all(...contextValues(ctx),
          ...(cursor ? [cursor.fetched_at,cursor.fetched_at,cursor.sequence] : []),limit+1) as any[];
      return { context: ctx, contextHash: ctxHash, entries: rows.slice(0,limit).map((row): SourceHistoryEntry => {
        checkedValue(row);
        return { ...observation(row), transition: row.previous_hash === null ? 'FIRST_LINKED' : row.previous_hash === row.content_hash ? 'UNCHANGED' : 'CHANGED',
          versionFirstObservedAt: row.version_first, versionLastObservedAt: row.version_last, versionObservations: row.version_count };
      }), nextBefore: rows.length > limit ? rows[limit-1].sequence : null };
    })();
  }
  compare(id: string, from: number, to: number, expectedContextHash: string, profile: SourceHistoryProfile): SourceComparison {
    return this.db.transaction(() => {
      const a = this.row(id,from), b = this.row(id,to), ctx = context(a), contextHash = canonicalHash(ctx);
      if (from === to) throw new SourceHistoryError('Choose two different source observations');
      if (contextHash !== expectedContextHash || canonicalHash(context(b)) !== contextHash)
        throw new SourceHistoryError('Comparisons require the same substance, source URL, record kind, adapter, source profile and collection context');
      const { contentHash: profileHash, ...profileBody } = profile;
      SourceHistoryProfileSchema.parse(profileBody);
      if (canonicalHash(profileBody) !== profileHash) throw new SourceHistoryError('Comparison profile hash mismatch');
      const aValue = checkedValue(a), bValue = checkedValue(b);
      const body = { version: 'source-comparison-1' as const, context: ctx, contextHash, profile,
        from: { ...observation(a), value: aValue }, to: { ...observation(b), value: bValue },
        equal: a.content_hash === b.content_hash, difference: compareJson(aValue,bValue,profile.limits) };
      return { body, contentHash: canonicalHash(body) };
    })();
  }
}
