import { Analyzer, AnalysisSpec, StatisticalResult } from './base';
import { calculateRatio, normalizeMax, pearson, spearman } from './stats';
import { Observation } from '../sources/base';

export class JH16Analyzer implements Analyzer {
  analyzer_id = 'jh16_faithful';
  analyzer_version = '1.0.0';

  validate_inputs(inputs: Observation[], config: AnalysisSpec): void {
    if (!inputs || inputs.length === 0) throw new Error("No inputs provided for JH16 analysis");
    if (!config.parameters.reference_scores) throw new Error("Missing 'reference_scores' in AnalysisSpec");
  }

  analyze(inputs: Observation[], config: AnalysisSpec): StatisticalResult[] {
    this.validate_inputs(inputs, config);
    
    // Group observations by entity
    const entityMap = new Map<string, { popularity: number | null, harm: number | null }>();
    
    inputs.forEach(obs => {
      if (!entityMap.has(obs.entity_id)) {
        entityMap.set(obs.entity_id, { popularity: null, harm: null });
      }
      const state = entityMap.get(obs.entity_id)!;
      if (obs.dimension === 'popularity' && typeof obs.result_count === 'number') {
         state.popularity = obs.result_count;
      }
      if (obs.dimension === 'harm' && typeof obs.result_count === 'number') {
         state.harm = obs.result_count;
      }
    });

    const results: StatisticalResult[] = [];
    const entities = Array.from(entityMap.keys()).sort(); // Ensure deterministic ordering
    
    // Arrays for correlation matching
    const piValues: number[] = [];
    const hiValues: number[] = [];
    const refValues: number[] = [];
    
    const referenceScores: Record<string, number> = config.parameters.reference_scores;

    // 1. Extract popularity values to compute Max Ni
    const popArray = entities.map(e => entityMap.get(e)?.popularity ?? -1);
    const piRaw = normalizeMax(popArray, true); // Returns percentages, uses -1 to yield NaN for missing
    
    entities.forEach((entity, index) => {
      const pop = entityMap.get(entity)!.popularity;
      const harm = entityMap.get(entity)!.harm;
      const pi = piRaw[index];
      
      // Compute Pi result
      results.push({
        entity_id: entity,
        metric_key: 'Pi',
        value_numeric: Number.isNaN(pi) ? null : pi,
        unit: '%'
      });
      
      // Compute Hi result
      let hi: number | null = null;
      if (pop !== null && harm !== null) {
        hi = calculateRatio(harm, pop, true);
        results.push({
          entity_id: entity,
          metric_key: 'Hi',
          value_numeric: hi,
          unit: '%'
        });
      }

      // Collect valid pairs for correlation
      const ref = referenceScores[entity];
      if (!Number.isNaN(pi) && typeof ref === 'number') {
         piValues.push(pi);
         hiValues.push(hi ?? NaN); // we only correlate Hi if it's computable, but we'll filter below
         refValues.push(ref);
      }
    });

    // 2. Correlations for Pi
    if (piValues.length > 2) {
      results.push({
        metric_key: 'pearson_pi_ref',
        value_numeric: pearson(piValues, refValues)
      });
      results.push({
        metric_key: 'spearman_pi_ref',
        value_numeric: spearman(piValues, refValues)
      });
    }

    // 3. Correlations for Hi (filter NaN)
    const validHiIndices = hiValues.map((h, i) => Number.isNaN(h) ? -1 : i).filter(i => i !== -1);
    if (validHiIndices.length > 2) {
       const hiValid = validHiIndices.map(i => hiValues[i]);
       const refValid = validHiIndices.map(i => refValues[i]);
       results.push({
         metric_key: 'pearson_hi_ref',
         value_numeric: pearson(hiValid, refValid)
       });
       results.push({
         metric_key: 'spearman_hi_ref',
         value_numeric: spearman(hiValid, refValid)
       });
    }

    return results;
  }
}
