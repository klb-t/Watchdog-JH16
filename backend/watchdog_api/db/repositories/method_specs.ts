import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { methodSpecs } from '../schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { MethodSpec } from '../../domain/method_spec';
import { canonicalHash } from '../../domain/canonical';
import { LOCAL_USER_ID } from '../../domain/principal';

/**
 * Storage for method specs.
 *
 * `approval_state` is stored, but the stored `approved_hash` is what actually
 * decides it: `readApprovalState` recomputes the spec's hash and treats a
 * mismatch as PROPOSED. Per D7 that must be a comparison rather than a flag an
 * update has to remember to clear.
 */
export class MethodSpecRepository {
  constructor(private db: BetterSQLite3Database<any>) {}

  upsert(spec: MethodSpec, opts: { id?: string; sourceProse?: string;
    compilerProviderId?: string; compilerModel?: string } = {}): string {
    const specHash = canonicalHash(spec);
    const existing = this.db.select().from(methodSpecs).where(eq(methodSpecs.spec_hash, specHash)).get();
    if (existing) return existing.id;

    const id = opts.id ?? randomUUID();
    this.db.insert(methodSpecs).values({
      id,
      name: spec.name,
      version: spec.specVersion,
      spec_json: JSON.stringify(spec),
      spec_hash: specHash,
      approval_state: 'PROPOSED',
      source_prose: opts.sourceProse ?? null,
      compiler_provider_id: opts.compilerProviderId ?? null,
      compiler_model: opts.compilerModel ?? null,
      owner_principal_id: LOCAL_USER_ID,
      created_at: new Date().toISOString(),
    }).run();
    return id;
  }

  /** One human action approves one spec. There is no bulk approve. */
  approve(id: string, approvedBy: string, approvedAt: string) {
    if (!approvedBy || approvedBy.trim() === '') {
      throw new Error('Approval requires an identified human actor.');
    }
    const row = this.get(id);
    if (!row) throw new Error(`No such method spec: ${id}`);
    this.db.update(methodSpecs)
      .set({ approval_state: 'APPROVED', approved_hash: row.spec_hash,
             approved_by: approvedBy, approved_at: approvedAt })
      .where(eq(methodSpecs.id, id)).run();
  }

  get(id: string) {
    return this.db.select().from(methodSpecs).where(eq(methodSpecs.id, id)).get();
  }

  /** Derived from the hash, never trusted from the stored flag alone. */
  readApprovalState(id: string): 'PROPOSED' | 'APPROVED' {
    const row = this.get(id);
    if (!row || !row.approved_hash) return 'PROPOSED';
    const current = canonicalHash(JSON.parse(row.spec_json));
    return current === row.approved_hash ? 'APPROVED' : 'PROPOSED';
  }
}
