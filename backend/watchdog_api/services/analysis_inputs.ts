import { createHash } from 'node:crypto';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Observation } from '../domain/observation';
import type { AnalysisResultValue, TypedSeries } from '../domain/method_spec';
import { canonicalHash, canonicalizeJson } from '../domain/canonical';
import { RunRepository } from '../db/repositories/runs';
import { ObservationRepository, AnalysisResultRepository } from '../db/repositories/data';
import { ArtifactRepository } from '../db/repositories/artifacts';
import { AcquisitionRepository } from '../db/repositories/acquisition';
import type { ObjectStore } from '../storage/object_store';
import type { ManifestFetchRecord } from './manifest';

export const ANALYSIS_INPUT_SCHEMA = 'watchdog.analysis_inputs/1';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export interface ConsumedExecution {
  method_id: string;
  method_spec_id: string | null;
  method_spec_hash: string | null;
  method_spec?: unknown;
  parameters?: Record<string, unknown>;
  typed_series?: readonly TypedSeries[];
  approval_state: string;
  approved_by: string | null;
  approved_hash: string | null;
  executor_id: string;
  executor_version: string;
}

export interface AnalysisInputCapture {
  schema: typeof ANALYSIS_INPUT_SCHEMA;
  run_id: string;
  owner_principal_id: string;
  source_run: { id: string; effective_config_hash: string | null };
  hash_scope: 'canonical_json_domain_observations_with_row_ids';
  observation_ids: string[];
  observations: Observation[];
  series: { id: string; sha256: string }[];
  fetches: ManifestFetchRecord[];
}
export interface AnalysisInputReceipt extends AnalysisInputCapture { execution: ConsumedExecution }

function sameOwner(db: BetterSQLite3Database<any>, runId: string, sourceId: string, owner: string, sourceRequired: boolean) {
  const runs = new RunRepository(db), source = runs.getRun(sourceId);
  if (!runs.getOwnedRun(runId, owner) || (sourceRequired && !source) || (source && source.owner_principal_id !== owner))
    throw new Error('Analysis input ownership or source availability changed');
}

/** Recheck the complete read set after the final asynchronous boundary. A
 * prior per-item check cannot authorize disclosure after a later item awaited.
 */
export function assertAnalysisInputAccess(db: BetterSQLite3Database<any>, runId: string, owner: string,
  sourceIds: readonly string[], expectedStatus?: string) {
  const run = new RunRepository(db).getOwnedRun(runId, owner);
  if (!run || (expectedStatus !== undefined && run.status !== expectedStatus))
    throw new Error('Analysis run ownership or lifecycle changed');
  for (const sourceId of new Set(sourceIds)) sameOwner(db, runId, sourceId, owner, false);
}

function seriesBindings(ids: readonly string[], observations: readonly Observation[]) {
  return [...new Set(observations.map(row => row.seriesId))].sort().map(id => ({ id,
    sha256: canonicalHash(observations.flatMap((observation, index) => observation.seriesId === id
      ? [{ observation_id: ids[index], observation }] : [])) }));
}

/** Capture before executing, never reconstruct a completed run from live rows. */
export function captureAnalysisInput(db: BetterSQLite3Database<any>, store: ObjectStore,
  runId: string, sourceRunId: string): AnalysisInputCapture {
  return db.transaction<AnalysisInputCapture>(() => {
    const runs = new RunRepository(db), run = runs.getRun(runId);
    if (!run) throw new Error('Analysis input requires an existing owning run');
    sameOwner(db, runId, sourceRunId, run.owner_principal_id, true);
    const source = runs.getRun(sourceRunId)!;
    const input = new ObservationRepository(db).inputSnapshot(sourceRunId);
    const acquisition = new AcquisitionRepository(db, store);
    // Existing manifest projection: no raw response/credential/metadata bags.
    const fetches = acquisition.getFetchEvents(sourceRunId).map(row => ({
      source_id: row.source_id, provider_id: row.provider_id ?? null,
      provider_version: row.provider_version ?? null, rendered_query: row.rendered_query ?? null,
      request_hash: row.request_hash ?? null,
      raw_blob_sha256: row.raw_blob_id ? acquisition.getRawBlob(row.raw_blob_id)?.sha256 ?? null : null,
      http_status: row.http_status ?? null, status: row.status,
    }));
    return { schema: ANALYSIS_INPUT_SCHEMA, run_id: runId, owner_principal_id: run.owner_principal_id,
      source_run: { id: sourceRunId, effective_config_hash: source.effective_config_hash },
      hash_scope: 'canonical_json_domain_observations_with_row_ids', observation_ids: input.observationIds,
      observations: input.observations, series: seriesBindings(input.observationIds, input.observations), fetches };
  });
}

/** Call before the executor; the serialized bytes also detach caller objects. */
export function freezeAnalysisInput(capture: AnalysisInputCapture, execution: ConsumedExecution) {
  const receipt: AnalysisInputReceipt = clone({ ...capture, execution });
  const bytes = Buffer.from(canonicalizeJson(receipt));
  return { receipt, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Validation failures call neither this writer nor createAnalysisRun.
 * A successful put followed by failed DB transaction can leave an unregistered
 * content-addressed object; it is not exposed as a successful analysis.
 */
export async function persistAnalysisWithInput(db: BetterSQLite3Database<any>, store: ObjectStore,
  frozen: ReturnType<typeof freezeAnalysisInput>, results: readonly AnalysisResultValue[]): Promise<string> {
  const { receipt, bytes, sha256 } = frozen;
  if (canonicalizeJson(receipt) !== bytes.toString() || canonicalHash(receipt) !== sha256)
    throw new Error('Frozen analysis input changed before persistence');
  const active = () => {
    if (new RunRepository(db).getRun(receipt.run_id)?.status !== 'ANALYZING')
      throw new Error('Analysis run is no longer active for result publication');
  };
  active();
  sameOwner(db, receipt.run_id, receipt.source_run.id, receipt.owner_principal_id, true);
  const uri = await store.put(`analysis-inputs/${sha256}.json`, bytes);
  active();
  sameOwner(db, receipt.run_id, receipt.source_run.id, receipt.owner_principal_id, true);
  return db.transaction(() => {
    sameOwner(db, receipt.run_id, receipt.source_run.id, receipt.owner_principal_id, true);
    const artifacts = new ArtifactRepository(db);
    if (artifacts.getManifest(receipt.run_id)) throw new Error('Finalized analysis input cannot be replaced');
    const analyses = new AnalysisResultRepository(db), execution = receipt.execution;
    const id = analyses.createAnalysisRun(receipt.run_id, {
      methodSpecId: execution.method_spec_id ?? undefined, executorId: execution.executor_id,
      executorVersion: execution.executor_version, inputSeriesIds: receipt.series.map(row => row.id),
      inputHashes: receipt.series.map(row => row.sha256),
    });
    analyses.insertMany(id, results);
    artifacts.recordArtifact({ runId: receipt.run_id, kind: 'normalized', objectUri: uri,
      sha256, byteSize: bytes.length, mediaType: 'application/json',
      metadata: { schema: ANALYSIS_INPUT_SCHEMA, analysis_run_id: id, source_run_id: receipt.source_run.id } });
    return id;
  });
}

export interface InputEvidence {
  schema: 'watchdog.analysis_input_evidence/1';
  status: 'verified' | 'unavailable' | 'not_applicable';
  reason?: string;
  receipts: { analysis_run_id: string; source_run_id: string; source_availability: 'present' | 'unavailable';
    sha256: string; object_uri: string }[];
}
export interface AnalysisInputDisclosure {
  evidence: InputEvidence;
  observations: Observation[] | null;
  receipts: { analysisRunId: string; receipt: AnalysisInputReceipt; sha256: string; objectUri: string }[];
}

const unavailable = (reason: string): AnalysisInputDisclosure => ({
  evidence: { schema: 'watchdog.analysis_input_evidence/1', status: 'unavailable', reason, receipts: [] },
  observations: null, receipts: [],
});

/** Return only verified historical inputs. Unknown evidence is not empty data. */
export async function readAnalysisInput(db: BetterSQLite3Database<any>, store: ObjectStore,
  runId: string, owner: string): Promise<AnalysisInputDisclosure> {
  const runs = new RunRepository(db), run = runs.getOwnedRun(runId, owner);
  if (!run) return unavailable('not_found');
  const analyses = new AnalysisResultRepository(db).listAnalysisRuns(runId);
  if (analyses.length === 0) {
    if (run.run_type === 'ACQUISITION') return { evidence: { schema: 'watchdog.analysis_input_evidence/1',
      status: 'not_applicable', reason: 'current_acquisition_rows', receipts: [] },
      observations: new ObservationRepository(db).getByRunId(runId), receipts: [] };
    return unavailable('legacy_input_not_recorded');
  }
  const artifacts = new ArtifactRepository(db).getArtifacts(runId);
  const resolved: AnalysisInputDisclosure['receipts'] = [];
  const evidence: InputEvidence = { schema: 'watchdog.analysis_input_evidence/1', status: 'verified', receipts: [] };
  try {
    for (const analysis of analyses) {
      const matches = artifacts.filter(row => {
        if (row.kind !== 'normalized' || !row.metadata_json) return false;
        const metadata = JSON.parse(row.metadata_json);
        return metadata.schema === ANALYSIS_INPUT_SCHEMA && metadata.analysis_run_id === analysis.id;
      });
      if (matches.length === 0) return unavailable('legacy_input_not_recorded');
      if (matches.length !== 1) return unavailable('ambiguous_input_receipt');
      const artifact = matches[0], metadata = JSON.parse(artifact.metadata_json!);
      sameOwner(db, runId, metadata.source_run_id, owner, false);
      let bytes: Buffer;
      try { bytes = await store.get(artifact.object_uri); }
      catch { return unavailable('input_artifact_unavailable'); }
      sameOwner(db, runId, metadata.source_run_id, owner, false);
      if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256)
        return unavailable('input_artifact_hash_mismatch');
      const receipt = JSON.parse(bytes.toString()) as AnalysisInputReceipt;
      if (receipt.schema !== ANALYSIS_INPUT_SCHEMA || receipt.run_id !== runId ||
          receipt.owner_principal_id !== owner || receipt.source_run.id !== metadata.source_run_id ||
          receipt.hash_scope !== 'canonical_json_domain_observations_with_row_ids' ||
          !Array.isArray(receipt.observations) || !Array.isArray(receipt.observation_ids) ||
          receipt.observations.length !== receipt.observation_ids.length ||
          new Set(receipt.observation_ids).size !== receipt.observation_ids.length ||
          receipt.observation_ids.some(id => typeof id !== 'string' || !id) ||
          receipt.observations.some(row => typeof row.seriesId !== 'string' || !row.seriesId ||
            typeof row.entityId !== 'string' || typeof row.queryRole !== 'string' ||
            typeof row.queryText !== 'string' || typeof row.sourceId !== 'string' ||
            typeof row.sourceAdapterVersion !== 'string' || typeof row.retrievedAt !== 'string' ||
            typeof row.language !== 'string' || typeof row.queryExpansionMode !== 'string' ||
            !Array.isArray(row.qualityFlags) || row.qualityFlags.some(flag => typeof flag !== 'string') ||
            (row.isMissing === true ? row.numericValue !== null || typeof row.missingReason !== 'string'
              : row.isMissing !== false || typeof row.numericValue !== 'number' || !Number.isFinite(row.numericValue))) ||
          canonicalizeJson(receipt.series) !== canonicalizeJson(seriesBindings(receipt.observation_ids, receipt.observations)) ||
          canonicalizeJson(receipt.series.map(row => row.id)) !== canonicalizeJson(JSON.parse(analysis.input_series_ids_json ?? '[]')) ||
          canonicalizeJson(receipt.series.map(row => row.sha256)) !== canonicalizeJson(JSON.parse(analysis.input_hashes_json ?? '[]')) ||
          receipt.execution.executor_id !== analysis.executor_id || receipt.execution.executor_version !== analysis.executor_version ||
          receipt.execution.method_spec_id !== analysis.method_spec_id)
        return unavailable('input_binding_mismatch');
      if (receipt.execution.method_spec_id !== null &&
          (receipt.execution.method_spec_hash !== canonicalHash(receipt.execution.method_spec) ||
           receipt.execution.approved_hash !== receipt.execution.method_spec_hash))
        return unavailable('method_input_binding_mismatch');
      const source = runs.getRun(receipt.source_run.id);
      evidence.receipts.push({ analysis_run_id: analysis.id, source_run_id: receipt.source_run.id,
        source_availability: source ? 'present' : 'unavailable', sha256: artifact.sha256, object_uri: artifact.object_uri });
      resolved.push({ analysisRunId: analysis.id, receipt, sha256: artifact.sha256, objectUri: artifact.object_uri });
    }
    assertAnalysisInputAccess(db, runId, owner, resolved.map(record => record.receipt.source_run.id));
    // Identical observations consumed by several analyses are one disclosure
    // item; differing historical contents retain separate hash identities.
    const unique = new Map<string, Observation>();
    for (const { receipt } of resolved) receipt.observations.forEach((row, index) =>
      unique.set(canonicalHash({ source_run_id: receipt.source_run.id, observation_id: receipt.observation_ids[index], row }), row));
    return { evidence, observations: [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row), receipts: resolved };
  } catch { return unavailable('input_integrity_or_access_unavailable'); }
}
