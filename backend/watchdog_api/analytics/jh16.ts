import { Analyzer, AnalysisSpec, AnalysisResultValue } from './base';
import { calculateRatio, normalizeMax, pearson, spearman } from './stats';
import { Observation, numericOrNull } from '../domain/observation';

/**
 * JH2016 Pi and Hi.
 *
 * Still bespoke TypeScript at this point. E1.15 re-expresses it as a
 * `MethodSpec` over the primitive registry, which is what the specification
 * actually requires; this remains the reference implementation its golden test
 * is written against in the meantime.
 */
export class JH16Analyzer implements Analyzer {
  analyzer_id = 'jh16_faithful';
  analyzer_version = '1.1.0';

  validate_inputs(inputs: readonly Observation[], config: AnalysisSpec): void {
    if (!inputs || inputs.length === 0) throw new Error('No inputs provided for JH16 analysis');
    if (!config.parameters?.reference_scores) throw new Error("Missing 'reference_scores' in AnalysisSpec");
  }

  analyze(inputs: readonly Observation[], config: AnalysisSpec): AnalysisResultValue[] {
    this.validate_inputs(inputs, config);

    // Group by entity. Missing stays missing — never coerced to zero.
    const entityMap = new Map<string, { popularity: number | null; harm: number | null }>();
    for (const obs of inputs) {
      if (!entityMap.has(obs.entityId)) entityMap.set(obs.entityId, { popularity: null, harm: null });
      const state = entityMap.get(obs.entityId)!;
      const value = numericOrNull(obs);
      if (value === null) continue;
      if (obs.queryRole === 'popularity') state.popularity = value;
      if (obs.queryRole === 'harm') state.harm = value;
    }

    const results: AnalysisResultValue[] = [];
    const entities = Array.from(entityMap.keys()).sort(); // deterministic ordering

    const piValues: number[] = [];
    const hiValues: number[] = [];
    const refValues: number[] = [];
    const referenceScores: Record<string, number> = config.parameters.reference_scores;

    const popArray = entities.map(e => entityMap.get(e)?.popularity ?? -1);
    const piRaw = normalizeMax(popArray, true);

    entities.forEach((entity, index) => {
      const pop = entityMap.get(entity)!.popularity;
      const harm = entityMap.get(entity)!.harm;
      const pi = piRaw[index];
      const piMissing = Number.isNaN(pi);

      results.push({
        entityId: entity,
        metricKey: 'Pi',
        valueNumeric: piMissing ? null : pi,
        unit: '%',
        isMissing: piMissing,
      });

      // Hi is undefined when Ni <= 0 — never divide by zero, never substitute
      // an epsilon, never return zero.
      let hi: number | null = null;
      if (pop !== null && harm !== null) {
        hi = calculateRatio(harm, pop, true);
      }
      results.push({
        entityId: entity,
        metricKey: 'Hi',
        valueNumeric: hi,
        unit: '%',
        isMissing: hi === null,
      });

      const ref = referenceScores[entity];
      if (!piMissing && typeof ref === 'number') {
        piValues.push(pi);
        hiValues.push(hi ?? NaN);
        refValues.push(ref);
      }
    });

    if (piValues.length >= 2) {
      const p = pearson(piValues, refValues);
      results.push({ metricKey: 'pearson_pi_ref', valueNumeric: p, isMissing: p === null });
      const s = spearman(piValues, refValues);
      results.push({ metricKey: 'spearman_pi_ref', valueNumeric: s, isMissing: s === null });
    }

    const validHiIndices = hiValues.map((h, i) => (Number.isNaN(h) ? -1 : i)).filter(i => i !== -1);
    if (validHiIndices.length >= 2) {
      const hiValid = validHiIndices.map(i => hiValues[i]);
      const refValid = validHiIndices.map(i => refValues[i]);

      const p = pearson(hiValid, refValid);
      results.push({ metricKey: 'pearson_hi_ref', valueNumeric: p, isMissing: p === null });
      const s = spearman(hiValid, refValid);
      results.push({ metricKey: 'spearman_hi_ref', valueNumeric: s, isMissing: s === null });
    }

    return results;
  }
}
