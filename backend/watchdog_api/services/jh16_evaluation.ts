import * as fs from 'node:fs';
import * as path from 'node:path';
import { pearson, spearman, correlationPValueTwoSided } from '../analytics/stats';
import { evaluateClaim, ATTEMPT_KIND_MEANING, AttemptKind, ClaimVerdict, ReplicationClaim } from './replication';
import type { Observation } from '../domain/observation';
import type { AnalysisResultValue } from '../domain/method_spec';

/**
 * JH16 evaluation of one run: the comparison the paper's hypothesis is about.
 *
 * Pi and Hi come from the run's stored analysis results; this step only
 * compares them with the versioned reference set and the pre-registered claims.
 * Every threshold is read from configuration (`config/replication/`), and the
 * attempt kind keeps a recomputation of the paper's own counts apart from an
 * independent measurement.
 */

export const JH16_EVALUATION_VERSION = '1.0.0';

export interface CorrelationStat { statistic: 'pearson' | 'spearman'; value: number | null; p_two_sided: number | null; n: number }

export interface EntityRow {
  entity_id: string; reference_score: number | null;
  Ni: number | null; Ni_harm: number | null; Pi: number | null; Hi: number | null;
  published_Pi: number | null; published_Hi: number | null;
  missing: { query_role: string; reason: string }[]; flags: string[];
}

export interface Jh16Evaluation {
  evaluation_version: string;
  attempt_kind: AttemptKind; attempt_meaning: string;
  reference: { set_key: string; version: string };
  interpretation: { id: string; version: string; registered_in_commit: string };
  claims_version: string;
  complete: boolean; expected_entities: string[]; missing_entities: string[];
  entities: EntityRow[];
  hi_vs_reference: CorrelationStat[];
  pi_vs_reference: CorrelationStat[];
  pi_vs_published: CorrelationStat;
  verdicts: ClaimVerdict[];
  hypothesis_harm: { reading: 'supports' | 'contradicts' | 'undecided' | 'not_computable'; rule: string };
  exploratory: { id: string; reason: string; excluded: string[]; hi_vs_reference: CorrelationStat[] }[];
  quality_flags: string[];
}

export interface Jh16EvaluationConfig {
  reference: { set_key: string; version: string; scores: Record<string, number> };
  claims: { claims: ReplicationClaim[]; _pre_registration?: { bands_proposed_in_commit?: string } };
  interpretation: any;
  published: { substances: { canonical: string; Pi_percent: number; Hi_percent: number }[] };
}

export function loadJh16EvaluationConfig(root = process.cwd()): Jh16EvaluationConfig {
  const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf-8'));
  const interpretation = read('config/replication/jh2016-interpretation.json');
  return { interpretation, reference: read(interpretation.reference_ref), claims: read(interpretation.claims_ref),
    published: read(interpretation.published_values_ref) };
}

function correlations(x: number[], y: number[]): CorrelationStat[] {
  const n = x.length;
  return (['pearson', 'spearman'] as const).map(statistic => {
    const value = n >= 2 ? (statistic === 'pearson' ? pearson(x, y) : spearman(x, y)) : null;
    return { statistic, value, p_two_sided: correlationPValueTwoSided(value, n), n };
  });
}

/** Fixture adapters replay the paper's own counts; anything else was measured independently. */
export function attemptKindFor(observations: readonly Observation[]): AttemptKind {
  return observations.length > 0 && observations.every(o => o.sourceId === 'fixture_jh2016') ? 'pipeline_self_check' : 'independent_attempt';
}

export function evaluateJh16(observations: readonly Observation[], results: readonly AnalysisResultValue[], cfg: Jh16EvaluationConfig): Jh16Evaluation {
  const rules = cfg.interpretation, scores = cfg.reference.scores;
  const expected = Object.keys(scores).sort();
  const published = new Map(cfg.published.substances.map(s => [s.canonical, s]));
  const metric = (key: string, entity: string) => {
    const r = results.find(x => x.metricKey === key && x.entityId === entity);
    return r && !r.isMissing && typeof r.valueNumeric === 'number' && Number.isFinite(r.valueNumeric) ? r.valueNumeric : null;
  };
  const count = (entity: string, role: string) => {
    const o = observations.find(x => x.entityId === entity && x.queryRole === role);
    return o && !o.isMissing ? o.numericValue : null;
  };

  const entities: EntityRow[] = expected.map(entity => {
    const own = observations.filter(o => o.entityId === entity);
    const flags = new Set<string>(own.flatMap(o => [...o.qualityFlags]).filter(f => f !== 'PROVIDER_ESTIMATE'));
    const Hi = metric('Hi', entity);
    if (Hi !== null && Hi > rules.entity_flags.hi_above_percent) flags.add('HI_ABOVE_100');
    return {
      entity_id: entity, reference_score: scores[entity] ?? null,
      Ni: count(entity, 'popularity'), Ni_harm: count(entity, 'harm'), Pi: metric('Pi', entity), Hi,
      published_Pi: published.get(entity)?.Pi_percent ?? null, published_Hi: published.get(entity)?.Hi_percent ?? null,
      missing: [...own.filter(o => o.isMissing).map(o => ({ query_role: o.queryRole, reason: (o as any).missingReason as string })),
        ...['harm', 'popularity'].filter(role => !own.some(o => o.queryRole === role)).map(role => ({ query_role: role, reason: 'NOT_FETCHED' }))]
        .sort((a, b) => a.query_role.localeCompare(b.query_role)),
      flags: [...flags].sort(),
    };
  });

  const hiRows = entities.filter(e => e.Hi !== null && e.reference_score !== null);
  const piRows = entities.filter(e => e.Pi !== null && e.reference_score !== null);
  const pubRows = entities.filter(e => e.Pi !== null && e.published_Pi !== null);
  const missingEntities = entities.filter(e => e.Hi === null || e.Pi === null).map(e => e.entity_id);
  const complete = hiRows.length === rules.required_complete_n && piRows.length === rules.required_complete_n;

  const hi = correlations(hiRows.map(e => e.Hi!), hiRows.map(e => e.reference_score!));
  const pi = correlations(piRows.map(e => e.Pi!), piRows.map(e => e.reference_score!));
  const pubValue = pubRows.length >= 2 ? spearman(pubRows.map(e => e.Pi!), pubRows.map(e => e.published_Pi!)) : null;
  const piPub: CorrelationStat = { statistic: 'spearman', value: pubValue, p_two_sided: correlationPValueTwoSided(pubValue, pubRows.length), n: pubRows.length };

  const incompleteNote = `Not computable: ${missingEntities.length} of ${expected.length} substances lack a valid value (${missingEntities.join(', ')}). Verdicts need all ${rules.required_complete_n}.`;
  const verdicts = [...cfg.claims.claims].sort((a, b) => a.claim_key.localeCompare(b.claim_key)).map(claim => {
    const observed = claim.claim_key === 'popularity_ranking_stability' ? piPub.value
      : claim.statistic === 'spearman' ? hi[1].value : hi[0].value;
    return evaluateClaim(claim, complete ? observed : null, complete ? undefined : incompleteNote);
  });

  const h = rules.hypothesis_harm, [hp, hs] = hi;
  let reading: Jh16Evaluation['hypothesis_harm']['reading'] = 'undecided';
  if (!complete || hp.value === null || hs.value === null) reading = 'not_computable';
  else if (hp.value >= h.supports.pearson_min && hp.p_two_sided !== null && hp.p_two_sided < h.supports.p_two_sided_below) reading = 'supports';
  else if (hp.value < h.contradicts.pearson_below && hs.value < h.contradicts.spearman_below) reading = 'contradicts';

  const exploratory = (rules.exploratory_sensitivity as any[]).map(s => {
    const excluded = entities.filter(e => (s.exclude_entities ?? []).includes(e.entity_id) || (s.exclude_flag && e.flags.includes(s.exclude_flag))).map(e => e.entity_id);
    const rows = hiRows.filter(e => !excluded.includes(e.entity_id));
    return { id: s.id, reason: s.reason, excluded, hi_vs_reference: correlations(rows.map(e => e.Hi!), rows.map(e => e.reference_score!)) };
  });

  const attempt_kind = attemptKindFor(observations);
  return {
    evaluation_version: JH16_EVALUATION_VERSION, attempt_kind, attempt_meaning: ATTEMPT_KIND_MEANING[attempt_kind],
    reference: { set_key: cfg.reference.set_key, version: cfg.reference.version },
    interpretation: { id: rules.interpretation_id, version: rules.version, registered_in_commit: rules._pre_registration.registered_in_commit },
    claims_version: cfg.claims._pre_registration?.bands_proposed_in_commit ?? 'unversioned',
    complete, expected_entities: expected, missing_entities: missingEntities, entities,
    hi_vs_reference: hi, pi_vs_reference: pi, pi_vs_published: piPub, verdicts,
    hypothesis_harm: { reading, rule: `supports: Pearson >= ${h.supports.pearson_min} and two-sided p < ${h.supports.p_two_sided_below}; contradicts: Pearson < ${h.contradicts.pearson_below} and Spearman < ${h.contradicts.spearman_below}; otherwise undecided; n must be ${rules.required_complete_n}` },
    exploratory,
    quality_flags: [...new Set(entities.flatMap(e => e.flags))].sort(),
  };
}
