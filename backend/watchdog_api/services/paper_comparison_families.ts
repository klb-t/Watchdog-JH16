import { ComparisonFamilyInputSchema, summarizeFamily, type FamilyMemberEvent } from '../../../shared/paper_comparison_family';
import { PaperComparisonFamiliesRepository } from '../db/repositories/paper_comparison_families';
import { WorkbenchError } from '../db/repositories/workbench_error';
import type { PaperComparisonService } from './paper_comparisons';

/**
 * E5.7b.1 — frozen comparison families over existing E5.7d comparisons.
 *
 * Creating a family freezes its membership: each member must be an owned,
 * exactly reviewed comparison of the same document version. Execution goes
 * member by member through the existing freeze/run path, and every outcome —
 * including a refusal before any run exists — is recorded against the family.
 * No numerical method changes here; verdicts are read back through the
 * verified E5.7d result path.
 */
export class PaperComparisonFamilyService {
  constructor(readonly repo: PaperComparisonFamiliesRepository, readonly comparisons: PaperComparisonService) {}

  async create(owner: string, raw: unknown, requestId: string) {
    const input = ComparisonFamilyInputSchema.parse(raw);
    const ids = input.members.map(m => m.comparisonId);
    if (new Set(ids).size !== ids.length) throw new WorkbenchError('A comparison can appear in a family only once.', 409);
    const members = [];
    let documentHash: string | null = null;
    for (const m of input.members) {
      const c = await this.comparisons.get(owner, m.comparisonId);
      if (c.hash !== m.hash) throw new WorkbenchError('A family member is not the exact current comparison version.', 409);
      if (!c.review || c.review.comparisonHash !== c.hash) throw new WorkbenchError('Every family member needs an exact review before the family is frozen.', 409);
      if (c.body.source.documentId !== input.documentId) throw new WorkbenchError('All family members must come from the named document.', 409);
      documentHash ??= c.body.source.documentHash;
      if (c.body.source.documentHash !== documentHash) throw new WorkbenchError('All family members must anchor to the same document version.', 409);
      members.push({ comparisonId: c.id, hash: c.hash, reviewId: c.review.id, operationId: c.body.plan.operationId,
        priorAttempts: c.attempts.map((a: any) => ({ id: a.id, runId: a.runId, status: a.status })) });
    }
    let supersedes = null;
    if (input.supersedes) {
      const previous = this.repo.get(owner, input.supersedes.id);
      if (previous.hash !== input.supersedes.hash || previous.body.documentId !== input.documentId)
        throw new WorkbenchError('A superseded family must be an owned exact version for the same document.', 409);
      supersedes = { id: previous.id, hash: previous.hash };
    }
    const body = {
      version: 'paper-comparison-family-1', documentId: input.documentId, documentHash, title: input.title, rationale: input.rationale,
      members: members.map(({ priorAttempts, ...m }) => m),
      supersedes,
      // What had already been seen when the family was fixed. Freezing here is
      // not preregistration: earlier attempts may have shaped the choice.
      priorExposure: { members: members.map(m => ({ comparisonId: m.comparisonId, attempts: m.priorAttempts })), external: 'UNKNOWN' },
    };
    const saved = this.repo.save(owner, body);
    this.comparisons.operations.research.audit(owner, 'paper.comparison_family.freeze', saved.id, { hash: saved.hash, requestId, members: members.length });
    return this.get(owner, saved.id);
  }

  async get(owner: string, id: string) {
    const family = this.repo.get(owner, id);
    const events = this.repo.events(owner, id);
    const byMember = new Map<string, FamilyMemberEvent[]>();
    for (const e of events) {
      let verdict: string | null = null, reason: string | null = e.kind === 'REFUSED' ? e.data.reason ?? null : e.data.error ?? null;
      if (e.kind === 'ATTEMPT' && e.runStatus === 'COMPLETED' && e.runId) {
        try {
          const verified = await this.comparisons.result(owner, e.comparisonId, e.runId);
          const core = (verified as any).result?.paperComparison?.core;
          verdict = core?.verdict ?? null; reason = core?.reason ?? null;
        } catch (error) {
          // Revoked review or a changed receipt: the outcome cannot be vouched for.
          reason = `unreadable_comparison_result: ${(error as Error).message}`;
        }
      }
      const list = byMember.get(e.comparisonId) ?? [];
      list.push({ kind: e.kind, sequence: e.sequence, runId: e.runId, runStatus: e.runStatus, verdict, reason });
      byMember.set(e.comparisonId, list);
    }
    return { ...family, summary: summarizeFamily(family.body.members, byMember), events, supersededBy: this.repo.supersededBy(owner, id) };
  }

  async list(owner: string, documentId: string) {
    return Promise.all(this.repo.list(owner, documentId).map(f => this.get(owner, f.id)));
  }

  /** Runs every member once, in the frozen order. A refusal is recorded, never skipped. */
  async execute(owner: string, id: string, expectedHash: string, requestId: string) {
    const family = this.repo.get(owner, id);
    if (family.hash !== expectedHash) throw new WorkbenchError('Comparison family hash is stale.', 409);
    for (const m of family.body.members) {
      let freezeId: string | null = null, failure: Error | null = null;
      try {
        const live = await this.comparisons.get(owner, m.comparisonId);
        if (live.hash !== m.hash) throw new WorkbenchError('Member comparison no longer matches the frozen version.', 409);
        const ref = this.comparisons.repo.freeze(owner, m.comparisonId, m.hash, requestId);
        freezeId = ref.freezeId;
        await this.comparisons.operations.workbench.execute(owner, live.body.plan.methodId, requestId, ref);
      } catch (error) { failure = error as Error; }
      const attemptId = freezeId ? this.repo.attemptForFreeze(freezeId) : null;
      if (attemptId) this.repo.record(owner, id, m.comparisonId, 'ATTEMPT', attemptId, { freezeId, error: failure ? failure.message : null }, requestId);
      else this.repo.record(owner, id, m.comparisonId, 'REFUSED', null, { freezeId, reason: failure?.message ?? 'No run was created.' }, requestId);
    }
    this.comparisons.operations.research.audit(owner, 'paper.comparison_family.execute', id, { hash: family.hash, requestId });
    return this.get(owner, id);
  }
}
