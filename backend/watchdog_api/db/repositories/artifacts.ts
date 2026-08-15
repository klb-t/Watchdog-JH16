import { eq } from 'drizzle-orm';
import { manifests } from '../schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export class ArtifactRepository {
  constructor(private db: BetterSQLite3Database<any>) {}

  finalizeManifest(runId: string, uri: string, sha256: string) {
    // WORM check
    const existing = this.db.select().from(manifests).where(eq(manifests.run_id, runId)).get();
    if (existing) {
      throw new Error("WORM Violation: Manifest is already finalized and cannot be modified.");
    }

    this.db.insert(manifests).values({
      run_id: runId,
      object_uri: uri,
      sha256,
      finalized_at: new Date().toISOString()
    }).run();
  }

  getManifest(runId: string) {
    return this.db.select().from(manifests).where(eq(manifests.run_id, runId)).get();
  }
}
