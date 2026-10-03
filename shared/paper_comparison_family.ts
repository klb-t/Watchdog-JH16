import { z } from 'zod';

/**
 * E5.7b.1 — frozen comparison families.
 *
 * A family is the ordered set of reviewed E5.7d comparisons for one paper,
 * fixed before any family attempt runs. Its summary always reports every
 * member against the frozen denominator — matched, deviating, not computable,
 * unclear, failed, refused, pending or not run — so nobody can report only the
 * members that happened to agree (G1–G3, docs/PARALLEL_RESEARCH_GPT.md).
 *
 * There is deliberately no family-level verdict, significance test or
 * correction: the tolerance of each member was reviewed on its own, and how
 * many agreements "count" is a scientific judgement, not code.
 */

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(4000);

export const FAMILY_LIMITS = Object.freeze({ maxMembers: 200 });

export const ComparisonFamilyInputSchema = z.object({
  documentId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  rationale: text,
  members: z.array(z.object({ comparisonId: z.string().min(1), hash }).strict()).min(1).max(FAMILY_LIMITS.maxMembers),
  supersedes: z.object({ id: z.string().min(1), hash }).strict().nullable(),
}).strict();
export type ComparisonFamilyInput = z.infer<typeof ComparisonFamilyInputSchema>;

/** Every state a member can be in. The order is the display order. */
export const MEMBER_OUTCOMES = ['reproduced', 'deviates', 'not_computable', 'method_unclear', 'failed', 'refused', 'pending', 'not_run'] as const;
export type MemberOutcome = typeof MEMBER_OUTCOMES[number];

export interface FamilyMemberEvent {
  kind: 'ATTEMPT' | 'REFUSED';
  sequence: number;
  runId: string | null;
  runStatus: string | null;
  verdict: string | null;
  reason: string | null;
}

export interface FamilyMemberSummary {
  position: number;
  comparisonId: string;
  hash: string;
  outcome: MemberOutcome;
  reason: string | null;
  runId: string | null;
  attempts: number;
}

const VERDICTS = new Set(['reproduced', 'deviates', 'not_computable', 'method_unclear']);
const FINAL_RUN = new Set(['COMPLETED', 'FAILED']);

/** The latest family event decides a member's outcome; earlier ones stay counted as attempts. */
export function memberOutcome(events: readonly FamilyMemberEvent[]): { outcome: MemberOutcome; reason: string | null; runId: string | null } {
  const last = [...events].sort((a, b) => a.sequence - b.sequence).at(-1);
  if (!last) return { outcome: 'not_run', reason: null, runId: null };
  if (last.kind === 'REFUSED') return { outcome: 'refused', reason: last.reason, runId: null };
  if (last.runStatus === 'FAILED') return { outcome: 'failed', reason: last.reason, runId: last.runId };
  if (!last.runStatus || !FINAL_RUN.has(last.runStatus)) return { outcome: 'pending', reason: null, runId: last.runId };
  if (last.verdict && VERDICTS.has(last.verdict)) return { outcome: last.verdict as MemberOutcome, reason: last.reason, runId: last.runId };
  // A completed run whose verified comparison core cannot be read is not silently a match.
  return { outcome: 'method_unclear', reason: last.reason ?? 'unreadable_comparison_result', runId: last.runId };
}

export function summarizeFamily(members: readonly { comparisonId: string; hash: string }[], eventsByMember: ReadonlyMap<string, readonly FamilyMemberEvent[]>) {
  const rows: FamilyMemberSummary[] = members.map((m, position) => {
    const events = eventsByMember.get(m.comparisonId) ?? [];
    return { position, comparisonId: m.comparisonId, hash: m.hash, ...memberOutcome(events), attempts: events.filter(e => e.kind === 'ATTEMPT').length };
  });
  const counts = Object.fromEntries(MEMBER_OUTCOMES.map(o => [o, rows.filter(r => r.outcome === o).length])) as Record<MemberOutcome, number>;
  return { version: 'paper-comparison-family-summary-1', denominator: members.length, counts, members: rows };
}
