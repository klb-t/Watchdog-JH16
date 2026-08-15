import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { rawBlobs, fetchEvents } from '../schema';
import { ObjectStore } from '../../storage/object_store';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export class AcquisitionRepository {
  constructor(private db: BetterSQLite3Database<any>, private store: ObjectStore) {}

  async recordFetch(runId: string, sourceId: string, payload: Buffer | null, status: string, adapterVersion?: string, provenance?: Record<string, any>) {
    let rawBlobId: string | null = null;

    if (payload && payload.length > 0) {
      const sha256 = createHash('sha256').update(payload).digest('hex');
      
      // Deduplication: Logical fetch history is not deduplicated, but physical bytes are.
      const existing = this.db.select().from(rawBlobs).where(eq(rawBlobs.sha256, sha256)).get();
      
      if (existing) {
        rawBlobId = existing.id;
      } else {
        const uri = await this.store.put(`raw/${sha256}`, payload);
        rawBlobId = randomUUID();
        this.db.insert(rawBlobs).values({
          id: rawBlobId,
          sha256,
          object_uri: uri,
          byte_size: payload.length,
          created_at: new Date().toISOString()
        }).run();
      }
    }

    const fetchEventId = randomUUID();
    this.db.insert(fetchEvents).values({
      id: fetchEventId,
      run_id: runId,
      source_id: sourceId,
      source_adapter_version: adapterVersion,
      provenance_metadata: provenance ? JSON.stringify(provenance) : undefined,
      raw_blob_id: rawBlobId,
      status,
      created_at: new Date().toISOString()
    }).run();

    return rawBlobId;
  }

  getFetchEvents(runId: string) {
    return this.db.select().from(fetchEvents).where(eq(fetchEvents.run_id, runId)).all();
  }

  getRawBlob(blobId: string) {
    return this.db.select().from(rawBlobs).where(eq(rawBlobs.id, blobId)).get();
  }
}
