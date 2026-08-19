import { eq } from 'drizzle-orm';
import { observations, series, analysisResults, analysisRuns } from '../schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { Observation as DomainObservation, QualityFlag, MissingReason } from '../../domain/observation';
import { LOCAL_USER_ID, DEFAULT_VISIBILITY } from '../../domain/principal';
import { AnalysisResultValue } from '../../domain/method_spec';
import { randomUUID } from 'node:crypto';

/** A stable series identity for one (entity, role, source) triple. */
export interface SeriesKey {
  entityId: string;
  queryRole: string;
  sourceId: string;
  metricKey?: string;
  unit?: string;
}

export class ObservationRepository {
  constructor(private db: BetterSQLite3Database<any>) {}

  /** Finds or creates the series a set of observations belongs to. */
  ensureSeries(key: SeriesKey): string {
    const existing = this.db.select().from(series).all().find(s =>
      s.substance_id === key.entityId &&
      s.query_role === key.queryRole &&
      s.source_id === key.sourceId
    );
    if (existing) return existing.id;

    const id = randomUUID();
    this.db.insert(series).values({
      id,
      metric_key: key.metricKey ?? `${key.queryRole}.result_count`,
      substance_id: key.entityId,
      source_id: key.sourceId,
      query_role: key.queryRole,
      unit: key.unit ?? 'count',
      owner_principal_id: LOCAL_USER_ID,
      visibility: DEFAULT_VISIBILITY,
      created_at: new Date().toISOString(),
    }).run();
    return id;
  }

  insertMany(runId: string, obsList: readonly DomainObservation[]) {
    if (obsList.length === 0) return;
    const now = new Date().toISOString();

    const values = obsList.map(obs => {
      const seriesId = obs.seriesId || this.ensureSeries({
        entityId: obs.entityId,
        queryRole: obs.queryRole,
        sourceId: obs.sourceId,
      });

      return {
        id: randomUUID(),
        series_id: seriesId,
        run_id: runId,
        observed_at: obs.retrievedAt,
        retrieved_at: obs.retrievedAt,
        numeric_value: obs.isMissing ? null : obs.numericValue,
        text_value: null,
        is_missing: obs.isMissing ? 1 : 0,
        missing_reason: obs.isMissing ? obs.missingReason : null,
        raw_artifact_id: obs.rawArtifactId ?? null,
        provider_id: obs.providerId ?? null,
        source_adapter_version: obs.sourceAdapterVersion,
        query_text: obs.queryText,
        language: obs.language,
        query_expansion_mode: obs.queryExpansionMode,
        quality_flags_json: JSON.stringify(obs.qualityFlags ?? []),
        created_at: now,
      };
    });

    this.db.insert(observations).values(values).run();
  }

  /**
   * Reads observations back as domain objects. `source_adapter_version` is a
   * real stored column, so a real version round-trips; the string 'unknown'
   * appears only when the value genuinely was never recorded (E1.26).
   */
  getByRunId(runId: string): DomainObservation[] {
    const rows = this.db.select().from(observations).where(eq(observations.run_id, runId)).all();
    const seriesById = new Map(this.db.select().from(series).all().map(s => [s.id, s]));

    return rows
      .sort((a, b) => a.id.localeCompare(b.id)) // deterministic ordering
      .map(r => {
        const s = seriesById.get(r.series_id);
        const base = {
          seriesId: r.series_id,
          entityId: s?.substance_id ?? 'unknown_entity',
          queryRole: s?.query_role ?? 'unknown',
          queryText: r.query_text ?? '',
          // Rows written before migration 003 genuinely do not know their plan.
          // 'unknown' is honest; defaulting to the current preset's language
          // would manufacture the continuity the detector is meant to test.
          language: r.language ?? 'unknown',
          queryExpansionMode: r.query_expansion_mode ?? 'unknown',
          retrievedAt: r.retrieved_at,
          sourceId: s?.source_id ?? 'unknown',
          sourceAdapterVersion: r.source_adapter_version ?? 'unknown',
          providerId: r.provider_id ?? undefined,
          rawArtifactId: r.raw_artifact_id ?? undefined,
          qualityFlags: (JSON.parse(r.quality_flags_json ?? '[]') as QualityFlag[]),
        };

        return r.is_missing === 1
          ? { ...base, isMissing: true as const, numericValue: null, missingReason: (r.missing_reason ?? 'NOT_FETCHED') as MissingReason }
          : { ...base, isMissing: false as const, numericValue: r.numeric_value ?? 0 };
      });
  }
}

export class AnalysisResultRepository {
  constructor(private db: BetterSQLite3Database<any>) {}

  /** Creates the analysis_runs row results hang off. */
  createAnalysisRun(runId: string, opts: {
    methodSpecId?: string;
    executorId?: string;
    executorVersion?: string;
    inputSeriesIds?: string[];
    inputHashes?: string[];
  } = {}): string {
    const id = randomUUID();
    this.db.insert(analysisRuns).values({
      id,
      run_id: runId,
      method_spec_id: opts.methodSpecId ?? null,
      input_series_ids_json: JSON.stringify(opts.inputSeriesIds ?? []),
      input_hashes_json: JSON.stringify(opts.inputHashes ?? []),
      executor_id: opts.executorId ?? null,
      executor_version: opts.executorVersion ?? null,
      status: 'COMPLETED',
      created_at: new Date().toISOString(),
    }).run();
    return id;
  }

  insertMany(analysisRunId: string, results: readonly AnalysisResultValue[]) {
    if (results.length === 0) return;
    const now = new Date().toISOString();
    const values = results.map(r => ({
      id: randomUUID(),
      analysis_run_id: analysisRunId,
      substance_id: r.entityId ?? null,
      metric_key: r.metricKey,
      value_numeric: r.valueNumeric,
      value_text: r.valueText ?? null,
      unit: r.unit ?? null,
      is_missing: r.isMissing ? 1 : 0,
      statistic_metadata_json: r.statisticMetadata ? JSON.stringify(r.statisticMetadata) : null,
      created_at: now,
    }));
    this.db.insert(analysisResults).values(values).run();
  }

  listAnalysisRuns(runId: string) {
    return this.db.select().from(analysisRuns).where(eq(analysisRuns.run_id, runId)).all()
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** All results for a top-level run, across its analysis runs. */
  getByRunId(runId: string): AnalysisResultValue[] {
    const aRuns = this.db.select().from(analysisRuns).where(eq(analysisRuns.run_id, runId)).all();
    const ids = new Set(aRuns.map(a => a.id));
    if (ids.size === 0) return [];

    return this.db.select().from(analysisResults).all()
      .filter(r => ids.has(r.analysis_run_id))
      .sort((a, b) => {
        const k = a.metric_key.localeCompare(b.metric_key);
        if (k !== 0) return k;
        return (a.substance_id ?? '').localeCompare(b.substance_id ?? '');
      })
      .map(r => ({
        entityId: r.substance_id ?? undefined,
        metricKey: r.metric_key,
        valueNumeric: r.value_numeric,
        valueText: r.value_text ?? undefined,
        unit: r.unit ?? undefined,
        isMissing: r.is_missing === 1,
        statisticMetadata: r.statistic_metadata_json ? JSON.parse(r.statistic_metadata_json) : undefined,
      }));
  }
}
