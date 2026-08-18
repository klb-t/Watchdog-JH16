/**
 * Evidence tier, per D12 and `10_EVIDENCE_TIER_AND_TRUST_UI.md`.
 *
 * One ordinal classification of *how a fact was established*. It is one of
 * three independent axes and must not be conflated with the other two:
 * `evidence_tier` is epistemic, `approval_state` is governance (whether a human
 * signed off), and `quality_flags` are situational caveats. A human approving a
 * MODELED_PREDICTED pill match does not upgrade its tier — it means a human
 * reviewed and accepted a prediction, which remains a prediction.
 *
 * Schema-level only at E1. The UI that displays it is Epic E6.
 */
export const EVIDENCE_TIERS = [
  'PRIMARY_EMPIRICAL',
  'CURATED_SECONDARY',
  'RAW_OBSERVATIONAL',
  'MODELED_PREDICTED',
  'SPECULATIVE',
  'UNKNOWN'
] as const;

export type EvidenceTier = typeof EVIDENCE_TIERS[number];

/**
 * Rank for ordering and for ceiling comparisons. Lower is stronger.
 * UNKNOWN is deliberately weakest: unclassified is not a middling default.
 */
const TIER_RANK: Record<EvidenceTier, number> = {
  PRIMARY_EMPIRICAL: 0,
  CURATED_SECONDARY: 1,
  RAW_OBSERVATIONAL: 2,
  MODELED_PREDICTED: 3,
  SPECULATIVE: 4,
  UNKNOWN: 5
};

export function tierRank(tier: EvidenceTier): number {
  return TIER_RANK[tier];
}

/** True when `a` is a stronger class of evidence than `b`. */
export function isStrongerThan(a: EvidenceTier, b: EvidenceTier): boolean {
  return TIER_RANK[a] < TIER_RANK[b];
}

/**
 * The ceiling on composition established by visual matching alone.
 * `10_EVIDENCE_TIER_AND_TRUST_UI.md`: counterfeit pills are adversarial against
 * visual identification by design, so however confident a shape/colour/logo
 * match looks, it is a prediction and never rises above MODELED_PREDICTED.
 */
export const VISUAL_MATCH_TIER_CEILING: EvidenceTier = 'MODELED_PREDICTED';

export class EvidenceTierCeilingError extends Error {
  readonly code = 'validation_error';
  constructor(claimed: EvidenceTier, ceiling: EvidenceTier, context: string) {
    super(`Evidence tier '${claimed}' exceeds the '${ceiling}' ceiling for ${context}`);
    this.name = 'EvidenceTierCeilingError';
  }
}

/**
 * Enforced in the domain layer, per `09_TESTS.md` §Evidence tier, so no caller
 * can promote a visual match by writing a stronger tier into the row.
 */
export function assertWithinCeiling(claimed: EvidenceTier, ceiling: EvidenceTier, context: string): void {
  if (isStrongerThan(claimed, ceiling)) {
    throw new EvidenceTierCeilingError(claimed, ceiling, context);
  }
}
