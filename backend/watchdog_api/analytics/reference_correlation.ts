import { Analyzer, AnalysisSpec, AnalysisResultValue } from './base';
import { pearson, spearman, correlationPValueTwoSided } from './stats';
import { Observation } from '../domain/observation';

/**
 * Correlation of one measured dimension with a reference table, per entity
 * (e.g. Google Trends interest by US state vs a published state prevalence).
 *
 * The reference's keys are the entities compared: an entity the measurement
 * lacks, or measured as missing, is a missing pair, never a zero. Only the
 * statistic the preset declares is computed. Sensitivity variants drop named
 * entities and are reported separately; they are never verdicts.
 *
 * Parameters (from the locked preset, hashed with the run configuration):
 *   comparisons: [{ id, dimension, statistic: 'pearson'|'spearman', reference: { entity: number } }]
 *   sensitivity: [{ id, comparison, exclude_entities: string[] }]
 */

interface Comparison { id: string; dimension: string; statistic: 'pearson' | 'spearman'; reference: Record<string, number> }
interface Sensitivity { id: string; comparison: string; exclude_entities: string[] }

export class ReferenceCorrelationAnalyzer implements Analyzer {
  analyzer_id = 'reference_correlation';
  analyzer_version = '1.0.0';

  validate_inputs(_inputs: readonly Observation[], config: AnalysisSpec): void {
    const p = config.parameters ?? {};
    if (!Array.isArray(p.comparisons) || !p.comparisons.length) throw new Error("Missing 'comparisons' in AnalysisSpec");
    for (const c of p.comparisons as Comparison[]) {
      if (!c.id || !c.dimension || !['pearson', 'spearman'].includes(c.statistic)) throw new Error(`Comparison '${c.id}' needs id, dimension and statistic pearson|spearman`);
      if (!c.reference || !Object.keys(c.reference).length || Object.values(c.reference).some(v => typeof v !== 'number' || !Number.isFinite(v)))
        throw new Error(`Comparison '${c.id}' needs a numeric reference table`);
    }
    for (const s of (p.sensitivity ?? []) as Sensitivity[])
      if (!(p.comparisons as Comparison[]).some(c => c.id === s.comparison)) throw new Error(`Sensitivity '${s.id}' names an unknown comparison`);
  }

  analyze(inputs: readonly Observation[], config: AnalysisSpec): AnalysisResultValue[] {
    this.validate_inputs(inputs, config);
    const p = config.parameters, results: AnalysisResultValue[] = [];
    const correlate = (c: Comparison, id: string, exclude: string[]) => {
      const entities = Object.keys(c.reference).filter(e => !exclude.includes(e)).sort();
      const pairs: { entity: string; x: number; y: number }[] = [], missing: string[] = [];
      for (const entity of entities) {
        const own = inputs.filter(o => o.queryRole === c.dimension && o.entityId === entity);
        if (own.length > 1) throw new Error(`Ambiguous input: ${own.length} values for ${entity} in '${c.dimension}'`);
        if (!own.length || own[0].isMissing || own[0].numericValue === null) { missing.push(entity); continue; }
        pairs.push({ entity, x: own[0].numericValue, y: c.reference[entity] });
      }
      const n = pairs.length;
      const value = n >= 3 ? (c.statistic === 'pearson' ? pearson : spearman)(pairs.map(q => q.x), pairs.map(q => q.y)) : null;
      results.push({ metricKey: `${id}_${c.statistic}`, valueNumeric: value, isMissing: value === null, unit: 'coefficient',
        statisticMetadata: { n, expected_n: entities.length, p_two_sided: correlationPValueTwoSided(value, n), missing_entities: missing, excluded_entities: [...exclude].sort() } });
      results.push({ metricKey: `${id}_n`, valueNumeric: n, isMissing: false, unit: 'pairs' });
      return pairs;
    };
    for (const c of p.comparisons as Comparison[]) {
      for (const q of correlate(c, c.id, [])) results.push({ entityId: q.entity, metricKey: `${c.id}_measured`, valueNumeric: q.x, isMissing: false, statisticMetadata: { reference: q.y } });
    }
    for (const s of (p.sensitivity ?? []) as Sensitivity[]) correlate((p.comparisons as Comparison[]).find(c => c.id === s.comparison)!, s.id, s.exclude_entities);
    return results;
  }
}
