import { AnalysisResultValue } from '../domain/method_spec';

/**
 * Chart specifications (E1.16).
 *
 * Produced in the service layer as data, so the rule that matters can be
 * tested without a browser: **a missing value renders as visibly missing,
 * never as zero and never as a gap that reads as zero.**
 *
 * A gap is not good enough. On a bar chart an absent bar is indistinguishable
 * from a zero-height bar, which is exactly the confusion `missing is not zero`
 * exists to prevent — so missing points carry an explicit marker the renderer
 * must draw.
 */

export type ChartKind = 'bar' | 'scatter';

export interface ChartPoint {
  entityId: string;
  /** null only when `missing` is true. */
  value: number | null;
  missing: boolean;
  missingReason?: string;
}

export interface ScatterPoint {
  entityId: string;
  x: number | null;
  y: number | null;
  missing: boolean;
}

export interface ChartSpec {
  id: string;
  kind: ChartKind;
  title: string;
  xLabel: string;
  yLabel: string;
  unit: string;
  points: ChartPoint[] | ScatterPoint[];
  /** Rendered in the legend; a series crossing a discontinuity must disclose it. */
  legendFlags: string[];
  /** How the renderer must depict a missing point. Not optional. */
  missingRendering: {
    style: 'hatched-placeholder';
    label: string;
    /** Explicitly false so no renderer can read the absence of a value as zero. */
    treatAsZero: false;
  };
}

const MISSING_RENDERING = {
  style: 'hatched-placeholder' as const,
  label: 'no data',
  treatAsZero: false as const,
};

function metricPoints(results: readonly AnalysisResultValue[], metricKey: string): ChartPoint[] {
  return results
    .filter(r => r.metricKey === metricKey && r.entityId)
    .map(r => ({
      entityId: r.entityId!,
      value: r.isMissing ? null : r.valueNumeric,
      missing: r.isMissing,
      missingReason: r.isMissing ? 'not computable from the observations in this run' : undefined,
    }))
    .sort((a, b) => {
      // Missing points sort last but are still present — they are drawn, not
      // dropped, because a dropped substance silently shrinks the comparison.
      if (a.missing !== b.missing) return a.missing ? 1 : -1;
      if (!a.missing && !b.missing) return (b.value ?? 0) - (a.value ?? 0);
      return a.entityId.localeCompare(b.entityId);
    });
}

export function buildPiChart(results: readonly AnalysisResultValue[], flags: readonly string[] = []): ChartSpec {
  return {
    id: 'pi-bar',
    kind: 'bar',
    title: 'Relative popularity index (Pi)',
    xLabel: 'Substance',
    yLabel: 'Pi',
    unit: '%',
    points: metricPoints(results, 'Pi'),
    legendFlags: [...new Set(flags)].sort(),
    missingRendering: MISSING_RENDERING,
  };
}

export function buildHiChart(results: readonly AnalysisResultValue[], flags: readonly string[] = []): ChartSpec {
  return {
    id: 'hi-bar',
    kind: 'bar',
    title: 'Harm index (Hi)',
    xLabel: 'Substance',
    yLabel: 'Hi',
    unit: '%',
    points: metricPoints(results, 'Hi'),
    legendFlags: [...new Set(flags)].sort(),
    missingRendering: MISSING_RENDERING,
  };
}

/** Hi against the versioned reference harm scores. */
export function buildHiVsReferenceChart(
  results: readonly AnalysisResultValue[],
  referenceScores: Record<string, number>,
  flags: readonly string[] = []
): ChartSpec {
  const hi = new Map(results.filter(r => r.metricKey === 'Hi' && r.entityId)
    .map(r => [r.entityId!, r]));

  const points: ScatterPoint[] = [...new Set([...hi.keys(), ...Object.keys(referenceScores)])]
    .sort()
    .map(entityId => {
      const h = hi.get(entityId);
      const ref = referenceScores[entityId];
      const missing = !h || h.isMissing || typeof ref !== 'number';
      return {
        entityId,
        x: missing || !h ? null : h.valueNumeric,
        y: typeof ref === 'number' ? ref : null,
        missing,
      };
    });

  return {
    id: 'hi-vs-reference-scatter',
    kind: 'scatter',
    title: 'Harm index against reference harm scores',
    xLabel: 'Hi (%)',
    yLabel: 'Reference harm score',
    unit: '%',
    points,
    legendFlags: [...new Set(flags)].sort(),
    missingRendering: MISSING_RENDERING,
  };
}

export function buildAllCharts(
  results: readonly AnalysisResultValue[],
  referenceScores: Record<string, number>,
  flags: readonly string[] = []
): ChartSpec[] {
  return [
    buildPiChart(results, flags),
    buildHiChart(results, flags),
    buildHiVsReferenceChart(results, referenceScores, flags),
  ];
}
