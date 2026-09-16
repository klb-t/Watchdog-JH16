import { Observation, QualityFlag } from '../domain/observation';

/**
 * Provider and query-plan discontinuity detection (E3.3), per rule 4 and D15.
 *
 * The failure this exists to prevent: a series is collected with one vendor,
 * the vendor is swapped mid-study, and the resulting step change in the numbers
 * is read as a real change in the world. Search providers disagree with each
 * other by large factors on the same query, so the artifact is not subtle — but
 * it is invisible unless the change itself is recorded alongside the data.
 *
 * The same argument applies to the rest of the plan's identity (D15): a series
 * whose language or expansion mode changed part-way is two measurements, not
 * one. The three flags stay distinct because the remedies differ — a provider
 * change may be re-runnable, an expansion-mode change means the earlier points
 * answered a different question.
 *
 * Two deliberate properties:
 *
 *  - **Unknown is not continuous.** Rows predating migration 003 carry
 *    `'unknown'`. A transition into or out of `'unknown'` is *not* reported as
 *    a discontinuity (there is no evidence of change), but neither is it
 *    reported as continuity — `coverage` says how much of the series could
 *    actually be checked, so a clean result over unknown data cannot be
 *    mistaken for a clean result over known data.
 *  - **Missing observations still count.** A failed fetch was still aimed at a
 *    provider, and a vendor swap that happens during an outage is exactly the
 *    case a present-values-only check would miss.
 */

export type DiscontinuityKind = Extract<QualityFlag,
  'PROVIDER_DISCONTINUITY' | 'QUERY_PLAN_DISCONTINUITY' | 'GEOGRAPHY_DISCONTINUITY'>;

export interface DiscontinuityRecord {
  readonly seriesKey: string;
  readonly kind: DiscontinuityKind;
  /** Which attribute changed: `provider_id`, `language`, and so on. */
  readonly attribute: string;
  readonly from: string;
  readonly to: string;
  /** `retrievedAt` of the first observation on the new side of the change. */
  readonly at: string;
  readonly detail: string;
}

export interface DiscontinuityReport {
  readonly records: readonly DiscontinuityRecord[];
  /** Deduplicated, sorted, ready to merge into the manifest's quality flags. */
  readonly flags: readonly QualityFlag[];
  /**
   * Per series, the fraction of adjacent pairs that could actually be compared
   * on every watched attribute. 1 means fully checked; less than 1 means some
   * rows did not record their plan.
   */
  readonly coverage: Readonly<Record<string, number>>;
}

interface WatchedAttribute {
  readonly name: string;
  readonly kind: DiscontinuityKind;
  readonly read: (o: Observation) => string;
  readonly why: string;
}

const UNKNOWN = new Set(['', 'unknown', 'undefined', 'null']);
const known = (v: string | undefined | null): string | null => {
  const s = (v ?? '').trim();
  return s === '' || UNKNOWN.has(s.toLowerCase()) ? null : s;
};

const WATCHED: readonly WatchedAttribute[] = [
  {
    name: 'provider_id',
    kind: 'PROVIDER_DISCONTINUITY',
    read: o => o.providerId ?? '',
    why: 'Two search providers report different counts for the same query, so a mid-series vendor change produces a step that is not a change in the world.',
  },
  {
    name: 'source_adapter_version',
    kind: 'PROVIDER_DISCONTINUITY',
    read: o => o.sourceAdapterVersion,
    why: 'The adapter version determines how a response was parsed. A parsing change is an instrument change even when the vendor is unchanged.',
  },
  {
    name: 'language',
    kind: 'QUERY_PLAN_DISCONTINUITY',
    read: o => o.language,
    why: 'D15: a query rendered in one language is a different measurement from the same query in another.',
  },
  {
    name: 'query_expansion_mode',
    kind: 'QUERY_PLAN_DISCONTINUITY',
    read: o => o.queryExpansionMode,
    why: 'D15: expanding to synonyms or slang is a different measurement plan, not a refinement of the canonical one.',
  },
];

/** Falls back to entity+role when `seriesId` was never assigned. */
export function seriesKeyOf(o: Observation): string {
  return o.seriesId && o.seriesId.length > 0 ? o.seriesId : `${o.entityId}::${o.queryRole}`;
}

/**
 * Chronological, with a total-order tiebreak so two runs over the same data
 * produce byte-identical records (rule 7). Timestamps collide readily when a
 * batch of fetches completes inside the same millisecond.
 */
function chronologically(a: Observation, b: Observation): number {
  return a.retrievedAt.localeCompare(b.retrievedAt)
    || (a.providerId ?? '').localeCompare(b.providerId ?? '')
    || a.queryText.localeCompare(b.queryText);
}

export function detectDiscontinuities(observations: readonly Observation[]): DiscontinuityReport {
  const bySeries = new Map<string, Observation[]>();
  for (const o of observations) {
    const k = seriesKeyOf(o);
    (bySeries.get(k) ?? bySeries.set(k, []).get(k)!).push(o);
  }

  const records: DiscontinuityRecord[] = [];
  const coverage: Record<string, number> = {};

  for (const [seriesKey, group] of bySeries) {
    const ordered = [...group].sort(chronologically);
    if (ordered.length < 2) {
      // Nothing to compare. Reported as fully covered rather than as zero:
      // a one-point series is not un-checkable, it simply has no transitions.
      coverage[seriesKey] = 1;
      continue;
    }

    let comparablePairs = 0;
    const totalPairs = (ordered.length - 1) * WATCHED.length;

    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const curr = ordered[i];

      for (const attr of WATCHED) {
        const a = known(attr.read(prev));
        const b = known(attr.read(curr));
        // Either side unknown: no evidence of a change, and no evidence of
        // continuity either. Excluded from coverage rather than assumed equal.
        if (a === null || b === null) continue;
        comparablePairs++;
        if (a === b) continue;

        records.push({
          seriesKey,
          kind: attr.kind,
          attribute: attr.name,
          from: a,
          to: b,
          at: curr.retrievedAt,
          detail: `${attr.name} changed from '${a}' to '${b}' within series '${seriesKey}'. ${attr.why}`,
        });
      }
    }

    coverage[seriesKey] = totalPairs === 0 ? 1 : comparablePairs / totalPairs;
  }

  records.sort((x, y) =>
    x.seriesKey.localeCompare(y.seriesKey) || x.at.localeCompare(y.at)
    || x.attribute.localeCompare(y.attribute) || x.from.localeCompare(y.from));

  return {
    records,
    flags: [...new Set(records.map(r => r.kind))].sort() as QualityFlag[],
    coverage: Object.fromEntries(Object.entries(coverage).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/**
 * Stamps the flags onto the affected observations, so a point carries its own
 * warning wherever it is rendered — a chart tooltip and an export row do not
 * consult the manifest.
 *
 * Both sides of a transition are marked. Only marking the new side would hide
 * that the *earlier* points came from a different instrument, which is the half
 * a reader is more likely to trust.
 */
export function annotateWithDiscontinuities(
  observations: readonly Observation[],
  report: DiscontinuityReport,
): Observation[] {
  const affected = new Map<string, Set<QualityFlag>>();
  for (const r of report.records) {
    (affected.get(r.seriesKey) ?? affected.set(r.seriesKey, new Set()).get(r.seriesKey)!).add(r.kind);
  }

  return observations.map(o => {
    const flags = affected.get(seriesKeyOf(o));
    if (!flags) return o;
    const merged = [...new Set([...o.qualityFlags, ...flags])].sort() as QualityFlag[];
    return { ...o, qualityFlags: merged } as Observation;
  });
}
