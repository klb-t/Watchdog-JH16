import { Analyzer, AnalysisSpec, AnalysisResultValue } from './base';
import { pearson, spearman } from './stats';
import { Observation } from '../domain/observation';

/**
 * Exploratory calibration of JH16 against Google Trends.
 *
 * Trends scales every request (group of terms) to its own maximum, so groups
 * are put on one scale through a shared anchor term, as the configuration
 * declares (`config/calibration/jh2016-trends.json`). The scaled interest is
 * then compared by rank with Pi values the run configuration carries (the
 * paper's published Pi and, optionally, the Pi of a stored JH16 run).
 * Interest is never treated as a result count, and nothing here is a verdict.
 */

interface Group { id: string; terms: string[]; anchor?: string; scale_to?: string }
interface Side { window?: string; ratio?: [string, string]; reference?: string }
interface Analysis { id: string; label: string; x: Side; y: Side; exclude_compare_flag?: string }

export class TrendsCalibrationAnalyzer implements Analyzer {
  analyzer_id = 'jh16_trends_calibration';
  analyzer_version = '1.0.0';

  validate_inputs(inputs: readonly Observation[], config: AnalysisSpec): void {
    const p = config.parameters ?? {};
    if (!p.calibration?.groups?.length || !p.calibration?.windows || !p.calibration?.analyses) throw new Error("Missing 'calibration' (groups, windows, analyses) in AnalysisSpec");
    if (!p.term_entities || !p.published_pi) throw new Error("Missing 'term_entities' or 'published_pi' in AnalysisSpec");
    if (!inputs.length) throw new Error('No Trends observations to calibrate');
  }

  analyze(inputs: readonly Observation[], config: AnalysisSpec): AnalysisResultValue[] {
    this.validate_inputs(inputs, config);
    const p = config.parameters, cal = p.calibration, entityOf = (t: string) => p.term_entities[t] ?? t;
    // group -> entity -> month -> value; missing observations contribute nothing.
    const raw = new Map<string, Map<string, Map<string, number>>>();
    for (const o of inputs) {
      if (o.isMissing || !o.observedAt || !o.queryRole.startsWith('interest:')) continue;
      const g = o.queryRole.slice('interest:'.length);
      const byEntity = raw.get(g) ?? new Map(); raw.set(g, byEntity);
      const series = byEntity.get(o.entityId) ?? new Map(); byEntity.set(o.entityId, series);
      series.set(o.observedAt.slice(0, 7), o.numericValue);
    }
    const total = (s?: Map<string, number>) => s ? [...s.values()].reduce((a, b) => a + b, 0) : 0;
    const results: AnalysisResultValue[] = [];
    const scaled = new Map<string, Map<string, number>>(); // entity -> month -> value on G1's scale
    const factor = new Map<string, number | null>();
    for (const g of cal.groups as Group[]) {
      const own = raw.get(g.id);
      let k: number | null = 1;
      if (g.scale_to) {
        const anchor = entityOf(g.anchor!), target = g.scale_to === cal.groups[0].id ? raw.get(g.scale_to)?.get(anchor) : scaled.get(anchor);
        const denominator = total(own?.get(anchor)), numerator = total(target);
        k = own && denominator > 0 && numerator > 0 && factor.get(g.scale_to) !== null ? numerator / denominator : null;
      }
      factor.set(g.id, k);
      results.push({ metricKey: `scale_${g.id}`, valueNumeric: k, isMissing: k === null, unit: 'factor' });
      if (k === null || !own) continue;
      for (const term of g.terms) {
        const e = entityOf(term), s = own.get(e);
        if (!s || scaled.has(e)) continue;
        scaled.set(e, new Map([...s].map(([m, v]) => [m, v * k!])));
      }
    }
    const entities = Object.keys(p.term_entities).map(entityOf).sort();
    const windowMean = (e: string, w: string): number | null => {
      const s = scaled.get(e), months = cal.windows[w] as string[];
      const xs = months.map(m => s?.get(m)).filter((v): v is number => typeof v === 'number');
      return xs.length === months.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    for (const w of Object.keys(cal.windows).sort()) for (const e of entities) {
      const v = windowMean(e, w);
      results.push({ entityId: e, metricKey: `trends_${w}`, valueNumeric: v, isMissing: v === null, unit: 'relative interest' });
    }
    const refs: Record<string, Record<string, number> | undefined> = { published_pi: p.published_pi, published_pi_may2012: p.published_pi_may2012, compare_pi: p.compare_pi };
    // A name is a configured window (scaled Trends) or a reference Pi set.
    const named = (name: string, e: string): number | null => cal.windows[name] ? windowMean(e, name) : (refs[name]?.[e] ?? null);
    const side = (s: Side, e: string): number | null => {
      if (s.window) return windowMean(e, s.window);
      if (s.reference) return refs[s.reference]?.[e] ?? null;
      const top = named(s.ratio![0], e), bottom = named(s.ratio![1], e);
      return top === null || bottom === null || bottom === 0 ? null : top / bottom;
    };
    for (const a of cal.analyses as Analysis[]) {
      const excluded = a.exclude_compare_flag ? entities.filter(e => (p.compare_flags?.[e] ?? []).includes(a.exclude_compare_flag)) : [];
      const pairs = entities.filter(e => !excluded.includes(e)).map(e => [side(a.x, e), side(a.y, e)] as const)
        .filter((xy): xy is readonly [number, number] => xy[0] !== null && xy[1] !== null);
      const meta = { label: a.label, excluded, n: pairs.length };
      const rho = pairs.length >= 3 ? spearman(pairs.map(x => x[0]), pairs.map(x => x[1])) : null;
      const logs = pairs.filter(([x, y]) => x > 0 && y > 0);
      const r = logs.length >= 3 ? pearson(logs.map(([x]) => Math.log10(x)), logs.map(([, y]) => Math.log10(y))) : null;
      results.push({ metricKey: `${a.id}_spearman`, valueNumeric: rho, isMissing: rho === null, statisticMetadata: meta });
      results.push({ metricKey: `${a.id}_pearson_log10`, valueNumeric: r, isMissing: r === null, statisticMetadata: { ...meta, n: logs.length } });
      results.push({ metricKey: `${a.id}_n`, valueNumeric: pairs.length, isMissing: false, unit: 'pairs' });
    }
    return results;
  }
}
