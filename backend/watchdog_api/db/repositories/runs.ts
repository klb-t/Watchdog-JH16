import { eq } from 'drizzle-orm';
import { runs } from '../schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'node:crypto';
import { RunState, assertTransition } from '../../domain/run_state';
import { LOCAL_USER_ID, DEFAULT_VISIBILITY } from '../../domain/principal';
import { canonicalHash } from '../../domain/canonical';

export type { RunState };

export interface CreateRunInput {
  /** Supply when the caller must know the id before the row exists. */
  id?: string;
  runType: 'ACQUISITION' | 'ANALYSIS' | 'PIPELINE';
  config: any;
  presetId?: string;
  presetVersion?: string;
  effectiveConfigHash?: string;
  triggerType?: string;
  ownerPrincipalId?: string;
}

export class RunRepository {
  constructor(private db: BetterSQLite3Database<any>) {}

  createRun(input: CreateRunInput | 'ACQUISITION' | 'ANALYSIS' | 'PIPELINE', legacyConfig?: any): string {
    // Accepts either the structured input or the original (type, config) pair,
    // so existing callers keep working while E1.25 rewires configuration.
    const normalized: CreateRunInput = typeof input === 'string'
      ? { runType: input, config: legacyConfig }
      : input;

    const id = normalized.id ?? randomUUID();
    this.db.insert(runs).values({
      id,
      run_type: normalized.runType,
      preset_id: normalized.presetId ?? null,
      preset_version: normalized.presetVersion ?? null,
      status: 'CREATED',
      trigger_type: normalized.triggerType ?? 'manual',
      owner_principal_id: normalized.ownerPrincipalId ?? LOCAL_USER_ID,
      visibility: DEFAULT_VISIBILITY,
      effective_config: JSON.stringify(normalized.config ?? {}),
      // Always hashed: an unidentifiable configuration makes the run
      // irreproducible, and the manifest refuses to finalise without it.
      effective_config_hash: normalized.effectiveConfigHash ?? canonicalHash(normalized.config ?? {}),
      created_at: new Date().toISOString(),
    }).run();
    return id;
  }

  /**
   * Transitions are validated against the domain state machine before they are
   * persisted, so an illegal sequence fails loudly rather than being recorded.
   */
  updateStatus(id: string, status: RunState, errorCode?: string, errorDetails?: string) {
    const current = this.getRun(id);
    if (current) assertTransition(current.status as RunState, status);

    const updateData: Record<string, unknown> = { status };
    if (errorCode) updateData.error_code = errorCode;
    if (errorDetails) updateData.error_details = errorDetails;
    if (status === 'RUNNING' && current && !current.started_at) {
      updateData.started_at = new Date().toISOString();
    }
    if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
      updateData.completed_at = new Date().toISOString();
    }

    this.db.update(runs).set(updateData).where(eq(runs.id, id)).run();
  }

  /** Advances through every intermediate stage; used where a caller legitimately skips ahead. */
  advanceTo(id: string, target: RunState, path: RunState[]) {
    for (const step of path) {
      const current = this.getRun(id);
      if (current?.status === target) return;
      this.updateStatus(id, step);
    }
  }

  incrementWarnings(id: string, by = 1) {
    const current = this.getRun(id);
    if (!current) return;
    this.db.update(runs)
      .set({ warning_count: (current.warning_count ?? 0) + by })
      .where(eq(runs.id, id)).run();
  }

  setProvenance(id: string, appVersion: string | null, gitCommit: string | null) {
    this.db.update(runs)
      .set({ app_version: appVersion, git_commit: gitCommit })
      .where(eq(runs.id, id)).run();
  }

  getRun(id: string) {
    return this.db.select().from(runs).where(eq(runs.id, id)).get();
  }

  getOwnedRun(id: string, actor: string) {
    const run = this.getRun(id);
    return run?.owner_principal_id === actor ? run : undefined;
  }

  getRuns(limit: number = 50, actor?: string) {
    const all = actor === undefined ? this.db.select().from(runs).all()
      : this.db.select().from(runs).where(eq(runs.owner_principal_id, actor)).all();
    return all
      .sort((a, b) => {
        const t = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        return t !== 0 ? t : a.id.localeCompare(b.id); // deterministic ordering
      })
      .slice(0, limit);
  }
}
