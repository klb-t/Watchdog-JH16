import type { Database } from 'better-sqlite3';
import { canonicalHash } from '../../domain/canonical';
import { WorkbenchError } from './workbench_error';
import { ResearchRepository } from './research';

/** The method pins the context hash. Context never confers approval on a paper. */
export class PaperOperationsRepository {
  constructor(readonly db: Database) {}
  get(owner: string, id: string) {
    const r = this.db.prepare('SELECT * FROM paper_operations WHERE id=? AND owner_principal_id=?').get(id, owner) as any;
    if (!r) return null;
    const body = JSON.parse(r.body_json);
    if (canonicalHash(body) !== r.content_hash || body.document.id !== r.document_id || body.datasetId !== r.dataset_id)
      throw new WorkbenchError('Paper operation integrity mismatch.', 409);
    const doc = new ResearchRepository(this.db).document(owner, body.document.id);
    if (!doc || doc.hash !== body.document.hash) throw new WorkbenchError('Owned source document required.', 409);
    return { id: r.id, hash: r.content_hash, body, methodId: r.method_id, createdAt: r.created_at };
  }
  forMethod(owner: string, methodId: string) {
    const r = this.db.prepare('SELECT id FROM paper_operations WHERE method_id=?').get(methodId) as any;
    if (!r) return null;
    const record = this.get(owner, r.id);
    if (!record) throw new WorkbenchError('This method requires its owned paper context.', 403);
    return record;
  }
  list(owner: string) {
    return (this.db.prepare('SELECT id FROM paper_operations WHERE owner_principal_id=? ORDER BY created_at DESC,id LIMIT 100').all(owner) as any[]).map(r => this.get(owner, r.id)!);
  }
  save(owner: string, body: any, methodId: string) {
    const hash = canonicalHash(body), id = canonicalHash({ owner, hash });
    this.db.prepare('INSERT OR IGNORE INTO paper_operations VALUES (?,?,?,?,?,?,?,?)')
      .run(id, owner, body.document.id, body.datasetId, methodId, hash, JSON.stringify(body), new Date().toISOString());
    return this.forMethod(owner, methodId)!;
  }
  runs(owner: string, methodId: string) {
    return this.db.prepare(`SELECT r.id,r.status,r.created_at AS createdAt,r.completed_at AS completedAt,a.sha256 AS resultHash
      FROM runs r LEFT JOIN artifacts a ON a.run_id=r.id AND a.kind='workbench_result'
      WHERE r.owner_principal_id=? AND json_extract(r.effective_config,'$.methodId')=? ORDER BY r.created_at DESC,r.id LIMIT 100`).all(owner, methodId);
  }
}
