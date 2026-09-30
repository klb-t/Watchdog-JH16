import { PaperComparisonClaimSchema, PaperComparisonInputSchema, type PaperComparisonClaim } from '../../../shared/paper_comparison';
import type { AnalysisResultValue } from '../domain/method_spec';
import { canonicalHash } from '../domain/canonical';
import { PaperComparisonsRepository } from '../db/repositories/paper_comparisons';
import { WorkbenchError } from '../db/repositories/workbench_error';
import type { PaperOperationService } from './paper_operations';
import { anchorQuote } from './paper_intake';
import { evaluateClaim, type Verdict } from './replication';

/** Strict adapter around the established evaluator; no numerical method is changed. */
export function evaluatePaperComparison(raw: PaperComparisonClaim, results: readonly AnalysisResultValue[]) {
  const claim = PaperComparisonClaimSchema.parse(raw), matches = results.filter(r => r.metricKey === claim.statistic);
  const selected = matches.length === 1 ? matches[0] : null;
  if (selected && selected.valueNumeric !== null && !Number.isFinite(selected.valueNumeric)) throw new WorkbenchError('Comparison observation must be finite or explicitly null.');
  const issues: string[] = [];
  if (matches.length > 1) issues.push('ambiguous_result');
  if (selected?.entityId != null) issues.push('non_scalar_result');
  if (!claim.unit || (selected && (!selected.unit || claim.unit !== selected.unit)) || (['pearson', 'spearman'].includes(claim.statistic) && claim.unit !== 'dimensionless')) issues.push('unit_mismatch');
  if (!matches.length) issues.push('missing_result');
  if (selected && (selected.isMissing || selected.valueNumeric === null)) issues.push('missing_value');
  if (claim.expectedValue === null) issues.push('absent_expected');
  if (claim.tolerance.kind === 'relative' && claim.expectedValue === 0) issues.push('zero_relative_base');
  const base = { version: 'paper-comparison-core-1', statistic: claim.statistic, expectedValue: claim.expectedValue, expectedUnit: claim.unit,
    observedValue: selected?.valueNumeric ?? null, observedUnit: selected?.unit ?? null, tolerance: claim.tolerance, issues };
  const unclear = (verdict: Verdict, reason: string, rationale: string) => ({ ...base, verdict, withinTolerance: null, deviation: null, reason, rationale });
  if (issues.includes('ambiguous_result')) return unclear('method_unclear', 'ambiguous_result', 'The selected metric does not identify exactly one scalar.');
  if (issues.includes('non_scalar_result')) return unclear('method_unclear', 'non_scalar_result', 'An entity-indexed result is not the selected scalar.');
  if (issues.includes('unit_mismatch')) return unclear('method_unclear', 'unit_mismatch', 'Expected and observed units must be explicit and identical; correlations require dimensionless units.');
  if (claim.expectedValue === null && claim.tolerance.kind === 'absolute') return unclear('method_unclear', 'absent_expected', 'An absolute tolerance needs a claimed value, and none is registered.');
  if (issues.includes('missing_result')) return unclear('not_computable', 'missing_result', 'The exact selected metric is absent.');
  if (issues.includes('missing_value')) return unclear('not_computable', 'missing_value', 'The selected scalar is explicitly missing.');
  const evaluated = evaluateClaim({ claim_key: claim.statistic, claim_type: 'paper_scalar', statistic: claim.statistic,
    claimed_value_numeric: claim.expectedValue, unit: claim.unit, tolerance_kind: claim.tolerance.kind, tolerance_value: claim.tolerance.value }, selected!.valueNumeric);
  if (evaluated.deviation !== null && !Number.isFinite(evaluated.deviation)) throw new WorkbenchError('Comparison arithmetic overflow; no finite deviation can be retained.');
  return { ...base, verdict: evaluated.verdict, withinTolerance: evaluated.within_tolerance, deviation: evaluated.deviation,
    reason: claim.expectedValue === null ? 'absent_expected' : claim.tolerance.kind === 'relative' && claim.expectedValue === 0 ? 'zero_relative_base' : evaluated.within_tolerance ? 'within_tolerance' : 'outside_tolerance', rationale: evaluated.rationale };
}

export class PaperComparisonService {
  constructor(readonly repo: PaperComparisonsRepository, readonly operations: PaperOperationService) {}
  private async live(owner: string, id: string) {
    const r = this.repo.get(owner, id), op = this.operations.get(owner, r.body.plan.operationId);
    await this.operations.workbench.repo.requireFigure(op.method.selection.figure, owner);
    const current = this.operations.get(owner, r.body.plan.operationId);
    if (current.hash !== r.body.plan.operationHash || current.method.id !== r.body.plan.methodId || current.method.hash !== r.body.plan.methodHash)
      throw new WorkbenchError('Comparison plan changed.', 409);
    return this.repo.get(owner, id);
  }
  async get(owner: string, id: string) {
    const record = await this.live(owner, id);
    return { ...record, review: this.repo.review(owner, id), attempts: this.repo.attempts(owner, id), history: this.repo.history(owner, id) };
  }
  async list(owner: string, operationId: string) {
    const op = this.operations.get(owner, operationId);
    await this.operations.workbench.repo.requireFigure(op.method.selection.figure, owner);
    return Promise.all(this.repo.list(owner, operationId).map(r => this.get(owner, r.id)));
  }
  async propose(owner: string, raw: unknown, requestId: string) {
    const input = PaperComparisonInputSchema.parse(raw), op = this.operations.get(owner, input.operationId);
    if (op.hash !== input.operationHash) throw new WorkbenchError('Comparison operation version is stale.', 409);
    if (!(op.body.method === 'describe' ? input.claim.statistic.startsWith('describe.') : input.claim.statistic === op.body.method)) throw new WorkbenchError('Selected statistic is incompatible with the pinned method.', 409);
    await this.operations.workbench.repo.requireFigure(op.method.selection.figure, owner);
    this.operations.get(owner, op.id);
    const previous = input.supersedes ? this.repo.get(owner, input.supersedes.id) : null;
    if (previous && (previous.hash !== input.supersedes!.hash || previous.body.plan.operationId !== op.id)) throw new WorkbenchError('Superseded comparison must be an owned exact version of this operation.', 409);
    const versions = this.repo.list(owner, op.id);
    const body = { version: 'paper-comparison-1', claim: input.claim,
      source: { documentId: op.body.document.id, documentHash: op.body.document.hash,
        anchor: anchorQuote(op.body.document.body.text.slice(0, op.body.excerptCharacters), input.claim.quote), provenance: 'USER_DECLARED_SOURCE_INTERPRETATION' },
      plan: { operationId: op.id, operationHash: op.hash, methodId: op.method.id, methodHash: op.method.hash,
        datasetId: op.body.datasetId, datasetHash: op.body.datasetHash, selectionHash: canonicalHash(op.method.selection) },
      supersedes: input.supersedes, priorExposure: { versions: versions.map(v => ({ id: v.id, hash: v.hash })),
        operationRuns: this.operations.repo.runs(owner, op.method.id), attempts: versions.flatMap(v => this.repo.attempts(owner, v.id)), external: 'UNKNOWN' },
      limitations: { operationHash: op.hash, meaning: op.body.meaning, scope: op.body.scope, originsVerified: false, fidelity: { method: 'NOT_ASSESSED', data: 'NOT_ASSESSED', population: 'NOT_ASSESSED', analysis: 'NOT_ASSESSED' } } };
    const saved = this.repo.save(owner, body);
    this.operations.research.audit(owner, 'paper.comparison.propose', saved.id, { hash: saved.hash, requestId });
    return this.get(owner, saved.id);
  }
  async approve(owner: string, id: string, expectedHash: string, requestId: string) {
    const r = await this.live(owner, id);
    if (r.hash !== expectedHash) throw new WorkbenchError('Comparison review hash is stale.', 409);
    this.repo.event(owner, id, 'APPROVE', {}, requestId);
    return this.get(owner, id);
  }
  async revoke(owner: string, id: string, expectedHash: string, requestId: string) {
    const r = this.repo.get(owner, id);
    if (r.hash !== expectedHash) throw new WorkbenchError('Comparison revocation hash is stale.', 409);
    this.repo.event(owner, id, 'REVOKE', {}, requestId);
    return { ...r, review: null, attempts: this.repo.attempts(owner, id), history: this.repo.history(owner, id) };
  }
  async execute(owner: string, id: string, expectedHash: string, requestId: string) {
    const r = await this.live(owner, id), ref = this.repo.freeze(owner, id, expectedHash, requestId);
    return this.operations.workbench.execute(owner, r.body.plan.methodId, requestId, ref);
  }
  async result(owner: string, id: string, runId: string) {
    const r = await this.live(owner, id), bound = this.repo.forRun(owner, runId);
    if (!bound || bound.comparison.id !== id) throw new WorkbenchError('An originally bound comparison attempt is required.', 409);
    const result = await this.operations.result(owner, r.body.plan.operationId, runId);
    const live = this.repo.forRun(owner, runId);
    if (canonicalHash(live) !== canonicalHash(bound) || canonicalHash(result.result.paperComparison?.comparison) !== canonicalHash(bound.comparison)) throw new WorkbenchError('Comparison result receipt changed.', 409);
    return result;
  }
}
