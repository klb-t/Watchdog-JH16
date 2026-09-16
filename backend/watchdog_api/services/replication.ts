import { pearson, spearman } from '../analytics/stats';
import { AnalysisResultValue } from '../domain/method_spec';

/**
 * Replication evaluation (E1.20, `08_REPLICATION_ENGINE.md`).
 *
 * A verdict is the comparison of one observed value to one pre-registered
 * claim. The vocabulary is deliberately four values with no `failed`: a
 * replication that does not match is a result, and a vocabulary that leans
 * produces literature that leans.
 */

export type Verdict = 'reproduced' | 'deviates' | 'not_computable' | 'method_unclear';

export type ToleranceKind = 'absolute' | 'relative' | 'rank_correlation_floor' | 'interval';

export interface ReplicationClaim {
  claim_key: string;
  claim_type: string;
  statistic?: string;
  claimed_value_numeric: number | null;
  unit?: string;
  tolerance_kind: ToleranceKind;
  tolerance_value: number;
  interval_upper?: number;
  notes?: string;
}

export interface ClaimVerdict {
  claim_key: string;
  statistic: string | null;
  claimed_value: number | null;
  observed_value: number | null;
  within_tolerance: boolean | null;
  deviation: number | null;
  verdict: Verdict;
  rationale: string;
}

/**
 * Evaluates one claim.
 *
 * `not_computable` is returned — never a silently-passing verdict — whenever
 * the observed value does not exist. Insufficient data is a distinct outcome
 * from a mismatch, and collapsing the two would hide exactly the case a
 * reader most needs to see.
 */
export function evaluateClaim(claim: ReplicationClaim, observed: number | null, note?: string): ClaimVerdict {
  const base = {
    claim_key: claim.claim_key,
    statistic: claim.statistic ?? null,
    claimed_value: claim.claimed_value_numeric,
    observed_value: observed,
  };

  if (observed === null || Number.isNaN(observed)) {
    return {
      ...base, within_tolerance: null, deviation: null, verdict: 'not_computable',
      rationale: note ?? 'The observed value could not be computed from the data in this run.',
    };
  }

  const claimed = claim.claimed_value_numeric;

  switch (claim.tolerance_kind) {
    case 'rank_correlation_floor': {
      const ok = observed >= claim.tolerance_value;
      return {
        ...base, within_tolerance: ok,
        deviation: observed - claim.tolerance_value,
        verdict: ok ? 'reproduced' : 'deviates',
        rationale: `${claim.statistic ?? 'rank correlation'} ${observed.toFixed(4)} `
          + `${ok ? 'meets' : 'falls below'} the pre-registered floor of ${claim.tolerance_value}.`,
      };
    }

    case 'interval': {
      const lower = claim.tolerance_value;
      const upper = claim.interval_upper ?? Number.POSITIVE_INFINITY;
      const ok = observed >= lower && observed <= upper;
      return {
        ...base, within_tolerance: ok,
        deviation: observed - lower,
        verdict: ok ? 'reproduced' : 'deviates',
        rationale: `${claim.statistic ?? 'value'} ${observed.toFixed(4)} `
          + `${ok ? 'falls inside' : 'falls outside'} the pre-registered interval `
          + `[${lower}, ${upper === Number.POSITIVE_INFINITY ? '∞' : upper}].`,
      };
    }

    case 'absolute': {
      if (claimed === null) {
        return { ...base, within_tolerance: null, deviation: null, verdict: 'method_unclear',
          rationale: 'An absolute tolerance needs a claimed value, and none is registered.' };
      }
      const dev = observed - claimed;
      const ok = Math.abs(dev) <= claim.tolerance_value;
      return { ...base, within_tolerance: ok, deviation: dev,
        verdict: ok ? 'reproduced' : 'deviates',
        rationale: `Observed ${observed.toFixed(4)} is ${Math.abs(dev).toFixed(4)} from the claimed `
          + `${claimed}, ${ok ? 'within' : 'outside'} the pre-registered ±${claim.tolerance_value}.` };
    }

    case 'relative': {
      if (claimed === null || claimed === 0) {
        return { ...base, within_tolerance: null, deviation: null, verdict: 'not_computable',
          rationale: 'A relative tolerance is undefined against a zero or absent claimed value.' };
      }
      const rel = (observed - claimed) / Math.abs(claimed);
      const ok = Math.abs(rel) <= claim.tolerance_value;
      return { ...base, within_tolerance: ok, deviation: rel,
        verdict: ok ? 'reproduced' : 'deviates',
        rationale: `Observed ${observed.toFixed(4)} differs from the claimed ${claimed} by `
          + `${(rel * 100).toFixed(1)}%, ${ok ? 'within' : 'outside'} the pre-registered `
          + `±${(claim.tolerance_value * 100).toFixed(0)}%.` };
    }

    default:
      return { ...base, within_tolerance: null, deviation: null, verdict: 'method_unclear',
        rationale: `Unknown tolerance kind '${claim.tolerance_kind}'.` };
  }
}

/** Observed Pearson/Spearman of Hi against the reference harm scores. */
export function observedHiVsReference(
  results: readonly AnalysisResultValue[],
  referenceScores: Record<string, number>,
  statistic: 'pearson' | 'spearman'
): { value: number | null; n: number } {
  const pairs: [number, number][] = [];
  for (const entity of Object.keys(referenceScores).sort()) {
    const hi = results.find(r => r.metricKey === 'Hi' && r.entityId === entity);
    if (!hi || hi.isMissing || hi.valueNumeric === null) continue;
    pairs.push([hi.valueNumeric, referenceScores[entity]]);
  }
  if (pairs.length < 2) return { value: null, n: pairs.length };
  const fn = statistic === 'pearson' ? pearson : spearman;
  return { value: fn(pairs.map(p => p[0]), pairs.map(p => p[1])), n: pairs.length };
}

/** Observed Spearman of the Pi ranking against the paper's published Pi. */
export function observedPiRankingStability(
  results: readonly AnalysisResultValue[],
  publishedPi: Record<string, number>
): { value: number | null; n: number } {
  const pairs: [number, number][] = [];
  for (const entity of Object.keys(publishedPi).sort()) {
    const pi = results.find(r => r.metricKey === 'Pi' && r.entityId === entity);
    if (!pi || pi.isMissing || pi.valueNumeric === null) continue;
    pairs.push([pi.valueNumeric, publishedPi[entity]]);
  }
  if (pairs.length < 2) return { value: null, n: pairs.length };
  return { value: spearman(pairs.map(p => p[0]), pairs.map(p => p[1])), n: pairs.length };
}

/**
 * What kind of attempt this is.
 *
 * This distinction is load-bearing and must never be blurred. Running the
 * pipeline over the paper's OWN published counts checks that the machinery
 * computes what the paper computed — it is not evidence that the finding
 * holds today, because the inputs are the paper's inputs. Only an attempt
 * against independently acquired data can speak to that.
 */
export type AttemptKind = 'pipeline_self_check' | 'independent_attempt';

export const ATTEMPT_KIND_MEANING: Record<AttemptKind, string> = {
  pipeline_self_check:
    "Inputs are the paper's own published counts. A 'reproduced' verdict here means this "
    + 'pipeline computes what the paper computed from the same numbers. It is NOT evidence '
    + 'that the finding replicates with data collected today.',
  independent_attempt:
    'Inputs were acquired independently of the paper. Verdicts here speak to whether the '
    + 'published finding holds against this new data.',
};
