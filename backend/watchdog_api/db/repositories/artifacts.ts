import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { manifests, artifacts, runs } from '../schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export const MANIFEST_SCHEMA_VERSION = '1.0';

export class ArtifactRepository {
  constructor(private db: BetterSQLite3Database<any>) {}

  /**
   * WORM: a finalised run's manifest is never mutated. A correction is a
   * superseding run that references the original, never an edit.
   */
  finalizeManifest(runId: string, uri: string, sha256: string, schemaVersion = MANIFEST_SCHEMA_VERSION) {
    const existing = this.db.select().from(manifests).where(eq(manifests.run_id, runId)).get();
    if (existing) {
      throw new Error("WORM Violation: Manifest is already finalized and cannot be modified.");
    }

    this.db.insert(manifests).values({
      run_id: runId,
      schema_version: schemaVersion,
      object_uri: uri,
      sha256,
      finalized_at: new Date().toISOString()
    }).run();
  }

  getManifest(runId: string) {
    return this.db.select().from(manifests).where(eq(manifests.run_id, runId)).get();
  }

  recordArtifact(input: {
    runId: string;
    kind: 'raw' | 'normalized' | 'analysis' | 'figure' | 'export' | 'narrative' | 'method_spec' | 'manifest';
    objectUri: string;
    sha256: string;
    byteSize?: number;
    mediaType?: string;
    metadata?: Record<string, unknown>;
  }): string {
    const id = randomUUID();
    const run = this.db.select().from(runs).where(eq(runs.id, input.runId)).get();
    if (!run) throw new Error('An artifact requires an existing owning run.');
    this.db.insert(artifacts).values({
      id,
      run_id: input.runId,
      kind: input.kind,
      media_type: input.mediaType ?? null,
      object_uri: input.objectUri,
      sha256: input.sha256,
      byte_size: input.byteSize ?? null,
      immutable: 1,
      owner_principal_id: run.owner_principal_id,
      visibility: run.visibility,
      created_at: new Date().toISOString(),
      metadata_json: input.metadata ? JSON.stringify(input.metadata) : null,
    }).run();
    return id;
  }

  getArtifacts(runId: string) {
    return this.db.select().from(artifacts).where(eq(artifacts.run_id, runId)).all()
      .sort((a, b) => {
        const k = a.kind.localeCompare(b.kind);
        return k !== 0 ? k : a.sha256.localeCompare(b.sha256);
      });
  }
}
