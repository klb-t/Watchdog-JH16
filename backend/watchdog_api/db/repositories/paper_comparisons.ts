import type { Database } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { canonicalHash } from '../../domain/canonical';
import { WorkbenchError } from './workbench_error';
import { PaperOperationsRepository } from './paper_operations';

export type ComparisonFreezeRef = { id: string; hash: string; freezeId: string };

/** Append-only revisions and receipts. Mutable execution status belongs to the existing run. */
export class PaperComparisonsRepository {
  constructor(readonly db: Database) {}
  get(owner: string, id: string) {
    const row = this.db.prepare('SELECT * FROM paper_comparisons WHERE id=? AND owner_principal_id=?').get(id, owner) as any;
    if (!row) throw new WorkbenchError('Owned comparison not found.', 404);
    const body = JSON.parse(row.body_json);
    if (canonicalHash(body) !== row.content_hash || body.plan.operationId !== row.operation_id) throw new WorkbenchError('Comparison integrity mismatch.', 409);
    const operation = new PaperOperationsRepository(this.db).get(owner, row.operation_id);
    if (!operation || operation.hash !== body.plan.operationHash) throw new WorkbenchError('Comparison operation binding changed.', 409);
    return { id: row.id, hash: row.content_hash, body, createdAt: row.created_at };
  }
  list(owner: string, operationId: string) {
    return (this.db.prepare('SELECT id FROM paper_comparisons WHERE owner_principal_id=? AND operation_id=? ORDER BY rowid').all(owner, operationId) as any[]).map(r => this.get(owner, r.id));
  }
  save(owner: string, body: any) {
    const hash = canonicalHash(body), id = randomUUID();
    this.db.prepare('INSERT INTO paper_comparisons VALUES (?,?,?,?,?,?)').run(id, owner, body.plan.operationId, hash, JSON.stringify(body), new Date().toISOString());
    return this.get(owner, id);
  }
  event(owner: string, id: string, kind: string, data: unknown, requestId: string) {
    const record = this.get(owner, id), eventId = randomUUID();
    this.db.prepare('INSERT INTO paper_comparison_events(id,comparison_id,comparison_hash,actor_id,kind,data_json,created_at,request_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(eventId, id, record.hash, owner, kind, JSON.stringify(data), new Date().toISOString(), requestId);
    return this.receipt(eventId)!;
  }
  receipt(id: string) {
    const r = this.db.prepare('SELECT * FROM paper_comparison_events WHERE id=?').get(id) as any;
    return r ? { id: r.id, sequence: r.sequence, comparisonId: r.comparison_id, comparisonHash: r.comparison_hash, actorId: r.actor_id,
      kind: r.kind, data: JSON.parse(r.data_json), createdAt: r.created_at, requestId: r.request_id } : null;
  }
  review(owner: string, id: string) {
    this.get(owner, id);
    const r = this.db.prepare("SELECT id,kind FROM paper_comparison_events WHERE comparison_id=? AND kind IN ('APPROVE','REVOKE') ORDER BY sequence DESC LIMIT 1").get(id) as any;
    return r?.kind === 'APPROVE' ? this.receipt(r.id) : null;
  }
  history(owner: string, id: string) {
    this.get(owner, id);
    return (this.db.prepare('SELECT id FROM paper_comparison_events WHERE comparison_id=? ORDER BY sequence').all(id) as any[]).map(r => this.receipt(r.id)!);
  }
  freeze(owner: string, id: string, hash: string, requestId: string): ComparisonFreezeRef {
    return this.db.transaction(() => {
      const r = this.get(owner, id), review = this.review(owner, id);
      if (r.hash !== hash || !review || review.comparisonHash !== hash) throw new WorkbenchError('Exact comparison review required before freezing.', 409);
      const versions = this.list(owner, r.body.plan.operationId);
      const priorExposure = { operationRuns: new PaperOperationsRepository(this.db).runs(owner, r.body.plan.methodId), versions: versions.map(v => ({ id: v.id, hash: v.hash })), attempts: versions.flatMap(v => this.attempts(owner, v.id)), external: 'UNKNOWN' };
      const freeze = this.event(owner, id, 'FREEZE', { reviewId: review.id, priorExposure }, requestId);
      return { id, hash, freezeId: freeze.id };
    })();
  }
  requireFreeze(owner: string, ref: ComparisonFreezeRef) {
    const comparison = this.get(owner, ref.id), freeze = this.receipt(ref.freezeId), review = this.review(owner, ref.id);
    if (comparison.hash !== ref.hash || !freeze || freeze.kind !== 'FREEZE' || freeze.comparisonId !== ref.id || freeze.comparisonHash !== ref.hash || freeze.actorId !== review?.actorId || !review || freeze.data.reviewId !== review.id || review.sequence >= freeze.sequence)
      throw new WorkbenchError('Frozen comparison review was revoked or replaced.', 409);
    return { comparison, review, freeze };
  }
  createRun(owner: string, ref: ComparisonFreezeRef, config: any, requestId: string) {
    return this.db.transaction(() => {
      const binding = this.requireFreeze(owner, ref), plan = binding.comparison.body.plan;
      if (config.methodId !== plan.methodId || config.methodHash !== plan.methodHash || config.datasetHash !== plan.datasetHash || canonicalHash(config.selection) !== plan.selectionHash)
        throw new WorkbenchError('Comparison and run plan disagree.', 409);
      const runId = randomUUID(), receipt = this.event(owner, ref.id, 'ATTEMPT', { freezeId: ref.freezeId, runId }, requestId);
      const effective = { ...config, paperComparison: { id: ref.id, hash: ref.hash, freezeId: ref.freezeId, reviewId: binding.review.id, attemptId: receipt.id } };
      this.db.prepare(`INSERT INTO runs(id,run_type,status,owner_principal_id,visibility,created_at,effective_config,effective_config_hash)
        VALUES (?,'WORKBENCH_ANALYSIS','CREATED',?,'private',?,?,?)`).run(runId, owner, new Date().toISOString(), JSON.stringify(effective), canonicalHash(effective));
      this.db.prepare('INSERT INTO paper_comparison_attempts VALUES (?,?,?,?)').run(receipt.id, ref.id, ref.freezeId, runId);
      return runId;
    })();
  }
  forRun(owner: string, runId: string) {
    const row = this.db.prepare('SELECT * FROM paper_comparison_attempts WHERE run_id=?').get(runId) as any;
    if (!row) return null;
    const comparison = this.get(owner, row.comparison_id), binding = this.requireFreeze(owner, { id: comparison.id, hash: comparison.hash, freezeId: row.freeze_id });
    const receipt = this.receipt(row.id)!;
    const run = this.db.prepare('SELECT owner_principal_id,effective_config,effective_config_hash FROM runs WHERE id=?').get(runId) as any;
    if (!run || run.owner_principal_id !== owner || receipt.kind !== 'ATTEMPT' || receipt.sequence <= binding.freeze.sequence || receipt.data.runId !== runId || receipt.data.freezeId !== row.freeze_id) throw new WorkbenchError('Comparison attempt linkage mismatch.', 409);
    const config = JSON.parse(run.effective_config);
    if (canonicalHash(config) !== run.effective_config_hash || config.paperComparison?.attemptId !== receipt.id || config.paperComparison?.freezeId !== row.freeze_id || config.paperComparison?.id !== comparison.id || config.paperComparison?.hash !== comparison.hash || config.paperComparison?.reviewId !== binding.review.id) throw new WorkbenchError('Run did not pin this frozen comparison at creation.', 409);
    return { ...binding, attempt: { ...receipt, runId, freezeId: row.freeze_id }, run: { id: runId, ownerId: receipt.actorId, effectiveConfig: config, effectiveConfigHash: run.effective_config_hash } };
  }
  attempts(owner: string, id: string) {
    this.get(owner, id);
    return (this.db.prepare(`SELECT a.*,r.status,r.created_at,r.completed_at,x.sha256 result_hash FROM paper_comparison_attempts a
      JOIN runs r ON r.id=a.run_id LEFT JOIN artifacts x ON x.run_id=r.id AND x.kind='workbench_result'
      WHERE a.comparison_id=? ORDER BY (SELECT sequence FROM paper_comparison_events WHERE id=a.id)`).all(id) as any[])
      .map(r => ({ ...this.receipt(r.id)!, runId: r.run_id, freezeId: r.freeze_id, status: r.status, resultHash: r.result_hash ?? null,
        completedAt: r.completed_at ?? null }));
  }
}
