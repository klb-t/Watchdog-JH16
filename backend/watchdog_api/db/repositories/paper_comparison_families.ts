import type { Database } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { canonicalHash } from '../../domain/canonical';
import { WorkbenchError } from './workbench_error';

/** E5.7b.1: write-once family membership and the events recorded through it. SQL only. */
export class PaperComparisonFamiliesRepository {
  constructor(readonly db: Database) {}

  get(owner: string, id: string) {
    const row = this.db.prepare('SELECT * FROM paper_comparison_families WHERE id=? AND owner_principal_id=?').get(id, owner) as any;
    if (!row) throw new WorkbenchError('Owned comparison family not found.', 404);
    const body = JSON.parse(row.body_json);
    if (canonicalHash(body) !== row.content_hash || body.documentId !== row.document_id) throw new WorkbenchError('Comparison family integrity mismatch.', 409);
    return { id: row.id as string, hash: row.content_hash as string, body, createdAt: row.created_at as string };
  }

  list(owner: string, documentId: string) {
    return (this.db.prepare('SELECT id FROM paper_comparison_families WHERE owner_principal_id=? AND document_id=? ORDER BY rowid').all(owner, documentId) as any[])
      .map(r => this.get(owner, r.id));
  }

  save(owner: string, body: any) {
    const id = randomUUID();
    this.db.prepare('INSERT INTO paper_comparison_families VALUES (?,?,?,?,?,?)')
      .run(id, owner, body.documentId, canonicalHash(body), JSON.stringify(body), new Date().toISOString());
    return this.get(owner, id);
  }

  /** Later families that name this one as superseded. The old family is never edited. */
  supersededBy(owner: string, id: string) {
    return this.list(owner, this.get(owner, id).body.documentId)
      .filter(f => f.body.supersedes?.id === id).map(f => ({ id: f.id, hash: f.hash, createdAt: f.createdAt }));
  }

  record(owner: string, familyId: string, comparisonId: string, kind: 'ATTEMPT' | 'REFUSED', attemptId: string | null, data: unknown, requestId: string) {
    this.get(owner, familyId);
    this.db.prepare(`INSERT INTO paper_comparison_family_events(id,family_id,comparison_id,kind,attempt_id,data_json,actor_id,created_at,request_id)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), familyId, comparisonId, kind, attemptId, JSON.stringify(data), owner, new Date().toISOString(), requestId);
  }

  events(owner: string, familyId: string) {
    this.get(owner, familyId);
    return (this.db.prepare(`SELECT e.*, a.run_id, r.status run_status FROM paper_comparison_family_events e
      LEFT JOIN paper_comparison_attempts a ON a.id=e.attempt_id LEFT JOIN runs r ON r.id=a.run_id
      WHERE e.family_id=? ORDER BY e.sequence`).all(familyId) as any[])
      .map(r => ({ id: r.id as string, sequence: r.sequence as number, comparisonId: r.comparison_id as string, kind: r.kind as 'ATTEMPT' | 'REFUSED',
        attemptId: (r.attempt_id ?? null) as string | null, runId: (r.run_id ?? null) as string | null, runStatus: (r.run_status ?? null) as string | null,
        data: JSON.parse(r.data_json), createdAt: r.created_at as string, requestId: r.request_id as string }));
  }

  /** The attempt a specific freeze produced, if the run was created at all. */
  attemptForFreeze(freezeId: string): string | null {
    const row = this.db.prepare('SELECT id FROM paper_comparison_attempts WHERE freeze_id=?').get(freezeId) as any;
    return row?.id ?? null;
  }
}
