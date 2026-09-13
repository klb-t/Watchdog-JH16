import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { fetchEvents, rawBlobs, runs } from '../schema';
import { ObjectStore } from '../../storage/object_store';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export interface RecordFetchInput {
  runId: string;
  sourceId: string;
  payload: Buffer | null;
  status: string;
  adapterVersion?: string;
  providerId?: string;
  providerVersion?: string;
  renderedQuery?: string;
  requestHash?: string;
  httpStatus?: number;
  providerRequestId?: string;
  errorCode?: string;
  provenance?: Record<string, any>;
  requestedAt?: string;
}

export class AcquisitionRepository {
  constructor(private db: BetterSQLite3Database<any>, private store: ObjectStore) {}

  /**
   * Archives raw bytes and records the fetch event.
   *
   * Two fetches returning identical bytes share one physical blob row; the
   * fetch events stay distinct. Per `02_DATA_MODEL.md`, logical fetch history
   * is never deduplicated away — two identical results on two dates is itself
   * a finding.
   */
  async recordFetch(input: RecordFetchInput): Promise<string | null>;
  async recordFetch(
    runId: string, sourceId: string, payload: Buffer | null, status: string,
    adapterVersion?: string, provenance?: Record<string, any>
  ): Promise<string | null>;
  async recordFetch(
    a: RecordFetchInput | string,
    sourceId?: string,
    payload?: Buffer | null,
    status?: string,
    adapterVersion?: string,
    provenance?: Record<string, any>
  ): Promise<string | null> {
    const input: RecordFetchInput = typeof a === 'string'
      ? { runId: a, sourceId: sourceId!, payload: payload ?? null, status: status!, adapterVersion, provenance }
      : a;

    let rawBlobId: string | null = null;

    if (input.payload && input.payload.length > 0) {
      const sha256 = createHash('sha256').update(input.payload).digest('hex');
      const existing = this.db.select().from(rawBlobs).where(eq(rawBlobs.sha256, sha256)).get();

      if (existing) {
        rawBlobId = existing.id;
      } else {
        const objectUri = await this.store.put(`raw/${sha256}`, input.payload);
        rawBlobId = randomUUID();
        this.db.insert(rawBlobs).values({
          id: rawBlobId,
          sha256,
          object_uri: objectUri,
          byte_size: input.payload.length,
          media_type: 'application/octet-stream',
          retention_class: input.provenance?.retention_policy ?? null,
          created_at: new Date().toISOString(),
        }).run();
      }
    }

    const now = new Date().toISOString();
    this.db.insert(fetchEvents).values({
      id: randomUUID(),
      run_id: input.runId,
      source_id: input.sourceId,
      provider_id: input.providerId ?? null,
      provider_version: input.providerVersion ?? input.adapterVersion ?? null,
      request_hash: input.requestHash ?? null,
      rendered_query: input.renderedQuery ?? null,
      requested_at: input.requestedAt ?? now,
      completed_at: now,
      status: input.status,
      provider_request_id: input.providerRequestId ?? null,
      http_status: input.httpStatus ?? null,
      raw_blob_id: rawBlobId,
      error_code: input.errorCode ?? null,
      metadata_json: input.provenance ? JSON.stringify(input.provenance) : null,
      created_at: now,
    }).run();

    return rawBlobId;
  }

  getFetchEvents(runId: string) {
    return this.db.select().from(fetchEvents).where(eq(fetchEvents.run_id, runId)).all()
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  getRawBlob(id: string) {
    return this.db.select().from(rawBlobs).where(eq(rawBlobs.id, id)).get();
  }

  getOwnedRawBlob(id: string, actor: string) {
    // Blobs deduplicate across owners. Access follows an owned acquisition
    // event, never knowledge of a content hash or the first blob creator.
    const event = this.db.select({ id: fetchEvents.id }).from(fetchEvents)
      .innerJoin(runs, eq(runs.id, fetchEvents.run_id))
      .where(and(eq(fetchEvents.raw_blob_id, id), eq(runs.owner_principal_id, actor))).get();
    return event ? this.getRawBlob(id) : undefined;
  }
}
