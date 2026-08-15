import { eq } from 'drizzle-orm';
import { observations, analysisResults } from '../schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { Observation } from '../../sources/base';
import { StatisticalResult } from '../../analytics/base';
import { randomUUID } from 'node:crypto';

export class ObservationRepository {
  constructor(private db: BetterSQLite3Database<any>) {}

  insertMany(runId: string, obsList: Observation[]) {
    if (obsList.length === 0) return;
    const values = obsList.map(obs => ({
      id: randomUUID(),
      run_id: runId,
      entity_id: obs.entity_id,
      dimension: obs.dimension,
      query_text: obs.query_text,
      result_count: obs.result_count,
      retrieved_at: obs.retrieved_at,
      source_id: obs.source_id,
      raw_artifact_id: obs.raw_artifact_id || null,
    }));
    this.db.insert(observations).values(values).run();
  }

  getByRunId(runId: string): Observation[] {
    const rows = this.db.select().from(observations).where(eq(observations.run_id, runId)).all();
    return rows.map(r => ({
      entity_id: r.entity_id,
      dimension: r.dimension,
      query_text: r.query_text,
      result_count: r.result_count,
      retrieved_at: r.retrieved_at,
      source_id: r.source_id,
      source_adapter_version: 'unknown', // not storing natively to save space unless requested, but required by interface
      raw_artifact_id: r.raw_artifact_id || undefined
    }));
  }
}

export class AnalysisResultRepository {
  constructor(private db: BetterSQLite3Database<any>) {}

  insertMany(runId: string, results: StatisticalResult[]) {
    if (results.length === 0) return;
    const values = results.map(r => ({
      id: randomUUID(),
      run_id: runId,
      entity_id: r.entity_id || null,
      metric_key: r.metric_key,
      value_numeric: r.value_numeric !== undefined ? r.value_numeric : null,
      value_text: r.value_text || null,
      unit: r.unit || null,
    }));
    this.db.insert(analysisResults).values(values).run();
  }

  getByRunId(runId: string): StatisticalResult[] {
    const rows = this.db.select().from(analysisResults).where(eq(analysisResults.run_id, runId)).all();
    return rows.map(r => ({
      entity_id: r.entity_id || undefined,
      metric_key: r.metric_key,
      value_numeric: r.value_numeric !== null ? r.value_numeric : null,
      value_text: r.value_text || undefined,
      unit: r.unit || undefined
    }));
  }
}
