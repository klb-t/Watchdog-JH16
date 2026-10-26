import * as fs from 'node:fs';
import * as path from 'node:path';
import { evaluateClaim, ATTEMPT_KIND_MEANING, ClaimVerdict, ReplicationClaim } from './replication';
import type { AnalysisResultValue } from '../domain/method_spec';

/**
 * Evaluation of one run against a replication target whose dossier declares
 * `evaluation_kind: "reference_correlation"` (any target other than the JH16
 * special case). Statistics are read from the run's stored analysis results;
 * this step only compares them with the target's pre-registered claims and
 * reading rules (`config/replication/<target>.json`, `<target>-interpretation.json`).
 * The endpoint list in the dossier says which comparison each claim reads.
 */

export const REPLICATION_EVALUATION_ROLE = 'replication_evaluation';
export const REPLICATION_EVALUATION_VERSION = '1.0.0';

type Reading = 'supports' | 'contradicts' | 'undecided' | 'not_computable';
export interface ComparisonResult {
  id: string; label: string; statistic: string; value: number | null; p_two_sided: number | null; n: number; expected_n: number;
  required_n: number | null; missing_entities: string[]; entities: { entity_id: string; measured: number; reference: number }[];
}
export interface ReplicationEvaluation {
  evaluation_version: string; target_id: string; attempt_kind: 'independent_attempt'; attempt_meaning: string;
  interpretation: { id: string; version: string; protocol: string | null }; claims_version: string;
  complete: boolean; comparisons: ComparisonResult[]; verdicts: ClaimVerdict[];
  readings: { hypothesis_id: string; comparison: string; reading: Reading; rule: string }[];
  exploratory: { id: string; comparison: string; reason: string; excluded: string[]; value: number | null; p_two_sided: number | null; n: number }[];
}

export interface ReplicationEvaluationConfig { target: { target_id: string; claims: ReplicationClaim[]; _pre_registration?: any }; interpretation: any; dossier: any; preset: any }

export function loadReplicationEvaluationConfig(targetId: string, root = process.cwd()): ReplicationEvaluationConfig {
  if (!/^[a-z0-9-]+$/.test(targetId)) throw new Error(`Invalid replication target id '${targetId}'`);
  const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf-8'));
  const dir = 'config/replication';
  const dossier = read(`${dir}/${targetId}-dossier.json`), interpretation = read(`${dir}/${targetId}-interpretation.json`);
  if (dossier.evaluation_kind !== 'reference_correlation') throw new Error(`Target '${targetId}' does not declare evaluation_kind reference_correlation`);
  return { target: read(interpretation.claims_ref), interpretation, dossier, preset: read(interpretation.preset_ref) };
}

export function evaluateReplication(results: readonly AnalysisResultValue[], cfg: ReplicationEvaluationConfig): ReplicationEvaluation {
  const rules = cfg.interpretation;
  const stat = (id: string, statistic: string) => {
    const r = results.find(x => !x.entityId && x.metricKey === `${id}_${statistic}`), m = (r?.statisticMetadata ?? {}) as any;
    return { value: r && !r.isMissing && typeof r.valueNumeric === 'number' ? r.valueNumeric : null, p_two_sided: m.p_two_sided ?? null, n: m.n ?? 0,
      expected_n: m.expected_n ?? 0, missing_entities: (m.missing_entities ?? []) as string[], excluded: (m.excluded_entities ?? []) as string[] };
  };
  const comparisons: ComparisonResult[] = [...cfg.preset.comparisons].sort((a: any, b: any) => a.id.localeCompare(b.id)).map((c: any) => {
    const s = stat(c.id, c.statistic);
    const entities = results.filter(r => r.entityId && r.metricKey === `${c.id}_measured` && typeof r.valueNumeric === 'number')
      .map(r => ({ entity_id: r.entityId!, measured: r.valueNumeric!, reference: Number((r.statisticMetadata as any)?.reference) }))
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
    return { id: c.id, label: c.label, statistic: c.statistic, value: s.value, p_two_sided: s.p_two_sided, n: s.n, expected_n: s.expected_n,
      required_n: rules.required_complete_n?.[c.id] ?? null, missing_entities: s.missing_entities, entities };
  });
  const byId = new Map(comparisons.map(c => [c.id, c]));
  const completeFor = (c: ComparisonResult) => c.value !== null && (c.required_n === null || c.n === c.required_n);
  const complete = comparisons.every(completeFor);
  const comparisonOf = (claimKey: string) => {
    const ref = (cfg.dossier.endpoints ?? []).find((e: any) => e.claim_key === claimKey)?.p_value as string | undefined;
    return ref?.startsWith('comparisons.') ? byId.get(ref.slice('comparisons.'.length)) ?? null : null;
  };
  const verdicts = [...cfg.target.claims].sort((a, b) => a.claim_key.localeCompare(b.claim_key)).map(claim => {
    const c = comparisonOf(claim.claim_key);
    if (!c) return evaluateClaim(claim, null, 'No dossier endpoint maps this claim to a comparison.');
    return completeFor(c) ? evaluateClaim(claim, c.value)
      : evaluateClaim(claim, null, `Not computable: ${c.n} of ${c.required_n ?? c.expected_n} required pairs (missing: ${c.missing_entities.join(', ') || 'none'}).`);
  });
  const readings = (rules.hypotheses ?? []).map((h: any) => {
    const c = byId.get(h.comparison), rule = `supports: ${h.statistic} > ${h.supports.value_above} and two-sided p < ${h.supports.p_two_sided_below}; contradicts: ${h.statistic} <= ${h.contradicts.value_at_most}; otherwise undecided; n must be ${c?.required_n ?? 'all'}`;
    let reading: Reading = 'undecided';
    if (!c || !completeFor(c)) reading = 'not_computable';
    else if (c.value! > h.supports.value_above && c.p_two_sided !== null && c.p_two_sided < h.supports.p_two_sided_below) reading = 'supports';
    else if (c.value! <= h.contradicts.value_at_most) reading = 'contradicts';
    return { hypothesis_id: h.id, comparison: h.comparison, reading, rule };
  });
  const exploratory = (rules.exploratory_sensitivity ?? []).map((s: any) => {
    const statistic = cfg.preset.comparisons.find((c: any) => c.id === s.comparison)?.statistic ?? 'pearson', r = stat(s.id, statistic);
    return { id: s.id, comparison: s.comparison, reason: s.reason, excluded: r.excluded, value: r.value, p_two_sided: r.p_two_sided, n: r.n };
  });
  return { evaluation_version: REPLICATION_EVALUATION_VERSION, target_id: cfg.target.target_id, attempt_kind: 'independent_attempt',
    attempt_meaning: ATTEMPT_KIND_MEANING.independent_attempt,
    interpretation: { id: rules.interpretation_id, version: rules.version, protocol: rules._pre_registration?.protocol ?? null },
    claims_version: cfg.target._pre_registration?.proposed_at ?? 'unversioned', complete, comparisons, verdicts, readings, exploratory };
}
