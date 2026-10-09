import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { RunRepository } from '../../backend/watchdog_api/db/repositories/runs';
import { ObservationRepository, AnalysisResultRepository } from '../../backend/watchdog_api/db/repositories/data';
import { ArtifactRepository } from '../../backend/watchdog_api/db/repositories/artifacts';
import { MethodSpecRepository } from '../../backend/watchdog_api/db/repositories/method_specs';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { RunOrchestrator } from '../../backend/watchdog_api/services/run_orchestrator';
import { canonicalHash, canonicalizeJson } from '../../backend/watchdog_api/domain/canonical';
import { tracer } from '../../backend/watchdog_api/utils/tracer';
import type { Observation } from '../../backend/watchdog_api/domain/observation';
import type { AnalysisResultValue } from '../../backend/watchdog_api/domain/method_spec';

const before = JSON.parse(readFileSync('tests/fixtures/jh16-unique-before.json', 'utf8'));
function observation(entityId: string, queryRole: string, value: number | null): Observation {
  const base = { seriesId: '', entityId, queryRole, queryText: 'public synthetic cardinality fixture',
    retrievedAt: '2026-10-09T00:00:00Z', sourceId: 'public-fixture', sourceAdapterVersion: '1',
    language: 'en', queryExpansionMode: 'STRICT_CANONICAL', qualityFlags: [] };
  return value === null ? { ...base, isMissing: true, numericValue: null, missingReason: 'PARSE_FAILED' }
    : { ...base, isMissing: false, numericValue: value };
}
// The public JSON result omits optional undefined fields; direct and DB readers
// have different row ordering, so compare their same complete serializable rows.
const resultBytes = (rows: AnalysisResultValue[]) => canonicalizeJson(JSON.parse(JSON.stringify(rows))
  .sort((a: AnalysisResultValue, b: AnalysisResultValue) => a.metricKey.localeCompare(b.metricKey) || (a.entityId ?? '').localeCompare(b.entityId ?? '')));

test('A4-WD-003: real source-run analysis rejects duplicates in both consumers and retains inputs/failure/provenance after reopen', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wd-jh16-cardinality-'));
  const filename = path.join(directory, 'runs.sqlite');
  let sqlite = new Database(filename); sqlite.pragma('foreign_keys=ON'); runMigrations(sqlite);
  const db = drizzle(sqlite), runs = new RunRepository(db), observations = new ObservationRepository(db), results = new AnalysisResultRepository(db);
  const artifacts = new ArtifactRepository(db), store = new LocalFileSystemStore(path.join(directory, 'objects'));
  let sourceResolutions = 0, networkCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { ++networkCalls; throw new Error('No network in synthetic analysis test'); });
  const orchestrator = new RunOrchestrator(db, store, async () => { ++sourceResolutions; throw new Error('Analysis may not fetch a source'); });
  const methods = new MethodSpecRepository(db), spec = JSON.parse(readFileSync('config/methods/jh2016-faithful.methodspec.json', 'utf8'));
  const specId = methods.upsert(spec, { id: 'jh2016-faithful' });
  methods.approve(specId, 'public-synthetic-reviewer', '2026-10-09T00:00:00Z', canonicalHash(spec));
  tracer.setMode('OFF');
  const source = (rows: Observation[]) => {
    const id = runs.createRun({ runType: 'ACQUISITION', config: { synthetic: true } });
    observations.insertMany(id, rows); return id;
  };
  try {
    // Correct unique input still runs with identical metrics/missingness; only
    // the corrected executor version deliberately changes in new provenance.
    const uniqueSource = source(before.inputs.map((row: Observation) => ({ ...row, seriesId: '' })));
    const uniqueId = runs.createRun({ runType: 'ANALYSIS', config: { source_run_id: uniqueSource,
      method_id: 'jh16_faithful', method_params: before.spec.parameters } });
    await orchestrator.executeRun(uniqueId);
    const uniqueRun = runs.getRun(uniqueId)!;
    assert.equal(uniqueRun.status, 'COMPLETED', uniqueRun.error_details ?? '');
    assert.equal(resultBytes(results.getByRunId(uniqueId)), resultBytes(JSON.parse(before.resultsCanonical)));
    const uniqueResults = resultBytes(results.getByRunId(uniqueId));
    const analysisRow = results.listAnalysisRuns(uniqueId)[0];
    assert.equal(analysisRow.executor_id, 'jh16_faithful'); assert.equal(analysisRow.executor_version, '1.1.1');
    const manifestRow = artifacts.getManifest(uniqueId)!;
    const manifestBytes = await store.get(manifestRow.object_uri), manifest = JSON.parse(manifestBytes.toString());
    assert.equal(manifest.analyses[0].executor_version, '1.1.1'); assert.equal(canonicalHash(manifest), manifestRow.sha256);

    const failures: { id: string; sourceId: string; rows: Observation[] }[] = [];
    for (const role of ['popularity', 'harm']) {
      for (const pair of [[100, 200], [100, 100], [100, null], [null, null]]) {
        const rows = [observation('anchor', 'popularity', 300), observation('anchor', 'harm', 10),
          observation('candidate', role, pair[0]), observation('candidate', role, pair[1])];
        const sourceId = source(rows), persisted = observations.getByRunId(sourceId);
        for (const selection of [
          { method_id: 'jh16_faithful', method_params: { reference_scores: { candidate: 7, anchor: 3 } } },
          { method_spec_id: specId, method_spec_hash: canonicalHash(spec) },
        ]) {
          const id = runs.createRun({ runType: 'ANALYSIS', config: { source_run_id: sourceId, ...selection } });
          await orchestrator.executeRun(id);
          assert.equal(runs.getRun(id)!.status, 'FAILED');
          assert.equal(runs.getRun(id)!.error_code, 'Ambiguous JH16 input: multiple counts for one entity and dimension');
          assert.deepEqual(results.listAnalysisRuns(id), [], 'reject before persisting any successful analysis');
          assert.deepEqual(results.getByRunId(id), []); assert.equal(artifacts.getManifest(id), undefined);
          assert.deepEqual(artifacts.getArtifacts(id), []);
          assert.deepEqual(observations.getByRunId(sourceId), persisted, 'never delete or select input rows');
          failures.push({ id, sourceId, rows: persisted });
        }
      }
    }
    assert.equal(failures.length, 16); assert.equal(sourceResolutions, 0); assert.equal(networkCalls, 0);
    assert.deepEqual(runs.getRun(uniqueId), uniqueRun);
    assert.equal(resultBytes(results.getByRunId(uniqueId)), uniqueResults);
    assert.deepEqual(await store.get(manifestRow.object_uri), manifestBytes);
    sqlite.close(); sqlite = new Database(filename); sqlite.pragma('foreign_keys=ON');
    const reopened = drizzle(sqlite), reopenedRuns = new RunRepository(reopened), reopenedResults = new AnalysisResultRepository(reopened);
    const reopenedArtifacts = new ArtifactRepository(reopened), reopenedObservations = new ObservationRepository(reopened);
    for (const failure of failures) {
      assert.equal(reopenedRuns.getRun(failure.id)!.status, 'FAILED');
      assert.equal(reopenedRuns.getRun(failure.id)!.error_code, 'Ambiguous JH16 input: multiple counts for one entity and dimension');
      assert.deepEqual(reopenedResults.listAnalysisRuns(failure.id), []); assert.deepEqual(reopenedResults.getByRunId(failure.id), []);
      assert.equal(reopenedArtifacts.getManifest(failure.id), undefined);
      assert.deepEqual(reopenedObservations.getByRunId(failure.sourceId), failure.rows);
    }
    assert.deepEqual(reopenedRuns.getRun(uniqueId), uniqueRun);
    assert.equal(resultBytes(reopenedResults.getByRunId(uniqueId)), uniqueResults);
    assert.deepEqual(reopenedResults.listAnalysisRuns(uniqueId)[0], analysisRow);
    assert.deepEqual(reopenedArtifacts.getManifest(uniqueId), manifestRow);
    assert.deepEqual(await new LocalFileSystemStore(path.join(directory, 'objects')).get(manifestRow.object_uri), manifestBytes);
  } finally { sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
});
