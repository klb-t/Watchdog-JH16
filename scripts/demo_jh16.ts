/**
 * `npm run demo:jh16` — the E1 exit criterion.
 *
 * From a clean clone, with no credentials and no network, produces a complete
 * run directory: manifest, raw fixture copies, normalized observations,
 * analysis output, charts, exports, replication verdicts and the trace.
 *
 * Run it twice and the two directories are byte-identical apart from run id
 * and timestamps — that determinism is the point, not a nicety.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

import { runMigrations } from '../backend/watchdog_api/db/migrations';
import { LocalFileSystemStore } from '../backend/watchdog_api/storage/object_store';
import { RunRepository } from '../backend/watchdog_api/db/repositories/runs';
import { AcquisitionRepository } from '../backend/watchdog_api/db/repositories/acquisition';
import { ObservationRepository, AnalysisResultRepository } from '../backend/watchdog_api/db/repositories/data';
import { ArtifactRepository } from '../backend/watchdog_api/db/repositories/artifacts';
import { MethodSpecRepository } from '../backend/watchdog_api/db/repositories/method_specs';
import { FixtureSourceAdapter } from '../backend/watchdog_api/sources/fixture_source';
import { SourceRequest } from '../backend/watchdog_api/sources/base';
import { TypeScriptMethodExecutor } from '../backend/watchdog_api/analysis/executor';
import { MethodSpec, TypedSeries } from '../backend/watchdog_api/domain/method_spec';
import { Observation } from '../backend/watchdog_api/domain/observation';
import { approve, Approvable } from '../backend/watchdog_api/domain/approval';
import { buildManifest, serializeManifest } from '../backend/watchdog_api/services/manifest';
import { buildAllCharts } from '../backend/watchdog_api/services/charts';
import { detectDiscontinuities, annotateWithDiscontinuities } from '../backend/watchdog_api/services/discontinuity';
import { generateNarrative, hashNarrativePayload } from '../backend/watchdog_api/services/narrative';
import { exportCsv, exportJson } from '../backend/watchdog_api/services/export';
import { canonicalHash } from '../backend/watchdog_api/domain/canonical';
import {
  evaluateClaim, observedHiVsReference, observedPiRankingStability,
  ATTEMPT_KIND_MEANING, ReplicationClaim,
} from '../backend/watchdog_api/services/replication';
import { tracer } from '../backend/watchdog_api/utils/tracer';

const ROOT = process.cwd();
const FIXTURE_SET = 'faithful_2014-06-20';
const RUNS_DIR = path.join(ROOT, 'runs');

/** Fixed so two runs differ only by run id and timestamps. */
const DEMO_APPROVER = 'demo-operator';
const DEMO_APPROVED_AT = '2026-01-01T00:00:00.000Z';

function readJson(...p: string[]) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf-8'));
}

function write(dir: string, name: string, content: string | Buffer) {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

async function runDemo(traceId: string, runId: string, runDir: string) {

  const preset = readJson('config', 'presets', 'jh2016-faithful.json');
  const spec: MethodSpec = readJson('config', 'methods', 'jh2016-faithful.methodspec.json');
  const reference = readJson('config', 'reference', 'nutt-2010.json');

  const sqlite = new Database(path.join(runDir, 'run.sqlite'));
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite);
  const db = drizzle(sqlite);

  const store = new LocalFileSystemStore(path.join(runDir, 'object_store'));
  const runRepo = new RunRepository(db);
  const acqRepo = new AcquisitionRepository(db, store);
  const obsRepo = new ObservationRepository(db);
  const anRepo = new AnalysisResultRepository(db);
  const artRepo = new ArtifactRepository(db);
  const specRepo = new MethodSpecRepository(db);

  const config = {
    source_id: 'fixture_jh2016',
    source_params: { fixture_set: FIXTURE_SET },
    preset_id: preset.preset_id,
    preset_version: preset.preset_version,
    language: preset.language,
    query_expansion_mode: preset.query_expansion_mode,
  };

  const dbRunId = runRepo.createRun({
    id: runId,                     // one run, one id
    runType: 'PIPELINE', config,
    presetId: preset.preset_id, presetVersion: preset.preset_version,
    effectiveConfigHash: canonicalHash(config),
  });

  for (const s of ['VALIDATING', 'QUEUED', 'RUNNING'] as const) runRepo.updateStatus(dbRunId, s);

  // ---------------------------------------------------------------- acquire
  const adapter = new FixtureSourceAdapter();
  const observations: Observation[] = [];

  // Sorted, so the acquisition order is a fact of the preset and not of a
  // directory listing.
  const plan = [...preset.substances]
    .sort((a: any, b: any) => a.canonical.localeCompare(b.canonical))
    .flatMap((sub: any) => ['harm', 'popularity'].map(dimension => ({
      entityId: sub.canonical,
      dimension,
      renderedQuery: (dimension === 'popularity'
        ? preset.queries.popularity_template
        : preset.queries.harm_template).replace('{query_label}', sub.query_label),
    })));

  tracer.emit('START_ACQUISITION', { source: config.source_id, fixture_set: FIXTURE_SET, planned_queries: plan.length });

  for (const item of plan) {
    const request: SourceRequest = {
      renderedQuery: item.renderedQuery,
      dimension: item.dimension,
      entityId: item.entityId,
      language: preset.language,
      queryExpansionMode: preset.query_expansion_mode,
      presetId: preset.preset_id,
      presetVersion: preset.preset_version,
      params: { fixture_set: FIXTURE_SET },
    };

    const raw = await adapter.fetch(request);
    raw.raw_blob_id = (await acqRepo.recordFetch({
      runId: dbRunId, sourceId: config.source_id, payload: raw.payload, status: raw.status,
      adapterVersion: adapter.adapter_version, providerId: 'fixture',
      renderedQuery: item.renderedQuery, httpStatus: raw.http_status,
      requestHash: canonicalHash({ q: item.renderedQuery, d: item.dimension }),
      provenance: adapter.provenance(raw),
    })) ?? undefined;

    const normalized = adapter.normalize(raw);
    for (const o of normalized) {
      if (o.isMissing) {
        tracer.decision('recorded_missing', 'missing_reason', o.missingReason,
          { entity: o.entityId, dimension: item.dimension });
      }
    }
    observations.push(...normalized);
  }

  runRepo.updateStatus(dbRunId, 'NORMALIZING');

  // E3.3. On this fixture run nothing changes instrument mid-series, so the
  // report is empty — which is the point: the check runs on every run, and an
  // empty result here is evidence rather than an absence of checking.
  const discontinuity = detectDiscontinuities(observations);
  for (const r of discontinuity.records) {
    tracer.decision('discontinuity_detected', r.attribute, `${r.from} -> ${r.to}`, { series: r.seriesKey });
  }
  obsRepo.insertMany(dbRunId, annotateWithDiscontinuities(observations, discontinuity));
  tracer.emit('OBSERVATIONS_PERSISTED', {
    count: observations.length, missing: observations.filter(o => o.isMissing).length });

  // ---------------------------------------------------------------- analyse
  runRepo.updateStatus(dbRunId, 'ANALYZING');
  const stored = obsRepo.getByRunId(dbRunId);

  const entityIds = [...new Set(stored.map(o => o.entityId))].sort();

  // Every flag raised on any observation in this run. Collected from stored
  // observations rather than from the analysis artifact: a flag that a
  // primitive never saw must still reach the manifest, since the manifest is
  // the disclosure and dropping one there is a highest-severity defect.
  const storedDiscontinuity = detectDiscontinuities(stored);
  const observationFlags = [...new Set([
    ...stored.flatMap(o => [...o.qualityFlags]),
    ...storedDiscontinuity.flags,
  ])].sort();
  const seriesFor = (role: string): TypedSeries => ({
    name: role === 'popularity' ? 'Ni' : 'Ni_harm',
    unit: 'count', semanticType: 'count', entityIds,
    values: entityIds.map(e => {
      const o = stored.find(x => x.entityId === e && x.queryRole === role);
      return o && !o.isMissing ? o.numericValue : null;
    }),
    // Carried onto the series so the executor propagates them to its output.
    qualityFlags: [...new Set(
      stored.filter(x => x.queryRole === role).flatMap(x => [...x.qualityFlags]))].sort(),
  } as TypedSeries);

  // The spec is stored, then approved by an explicit human action, then
  // executed. Nothing auto-approves and the run references a real stored row.
  const specId = specRepo.upsert(spec, { id: 'jh2016-faithful' });
  specRepo.approve(specId, DEMO_APPROVER, DEMO_APPROVED_AT);

  const approvable: Approvable = approve(
    { id: 'jh2016-faithful', kind: 'method_spec', content: spec },
    DEMO_APPROVER, DEMO_APPROVED_AT);

  const artifact = await new TypeScriptMethodExecutor()
    .execute(spec, [seriesFor('popularity'), seriesFor('harm')], { approvable });

  tracer.emit('ANALYSIS_COMPLETE', {
    method_spec_hash: artifact.specHash, results: artifact.results.length });

  const analysisRunId = anRepo.createAnalysisRun(dbRunId, {
    methodSpecId: 'jh2016-faithful',
    executorId: artifact.executorId, executorVersion: artifact.executorVersion,
    inputSeriesIds: entityIds,
  });
  anRepo.insertMany(analysisRunId, artifact.results);

  const results = anRepo.getByRunId(dbRunId);

  // ----------------------------------------------------------------- output
  runRepo.updateStatus(dbRunId, 'EXPORTING');

  const allFlags = [...new Set([...observationFlags, ...artifact.qualityFlags])].sort();
  const charts = buildAllCharts(results, reference.scores, allFlags);

  const narrativePayload = {
    presetId: preset.preset_id,
    results: results.map(r => ({ metricKey: r.metricKey, entityId: r.entityId, valueNumeric: r.valueNumeric, unit: r.unit })),
    missingCount: stored.filter(o => o.isMissing).length,
    qualityFlags: allFlags,
  };
  const narrative = generateNarrative({
    runId: dbRunId,
    payload: narrativePayload, payloadHash: hashNarrativePayload(narrativePayload),
    templateId: 'jh2016-summary', templateVersion: '1.0', providerId: null, model: null,
  });
  const narrativeApprovable: Approvable = approve(
    { id: 'demo-narrative', kind: 'narrative', content: { content: narrative.content } },
    DEMO_APPROVER, DEMO_APPROVED_AT);

  const exportInput = {
    runId: dbRunId, results, narrative, narrativeApprovable,
    missingObservations: stored.filter(o => o.isMissing).map(o => ({
      entity_id: o.entityId, query_role: o.queryRole,
      missing_reason: (o as Extract<Observation, { isMissing: true }>).missingReason,
    })),
    qualityFlags: allFlags,
  };

  // ----------------------------------------------------- replication verdicts
  //
  // The bands were pre-registered in config/replication/jh2016.json and in the
  // git commit it names, before any verdict existed anywhere in this repo.
  const target = readJson('config', 'replication', 'jh2016.json');
  const paper = readJson('fixtures', 'jh2016', 'paper_reported.json');

  // This attempt runs over the paper's OWN published counts, so it checks the
  // machinery, not the finding. Saying so in the artifact is the difference
  // between a self-check and a claim about the world.
  const attemptKind = 'pipeline_self_check' as const;

  const publishedPi = Object.fromEntries(
    paper.substances.map((sub: any) => [sub.canonical, sub.Pi_percent]));
  const referenceScores = reference.scores as Record<string, number>;

  const pearsonObs = observedHiVsReference(results, referenceScores, 'pearson');
  const spearmanObs = observedHiVsReference(results, referenceScores, 'spearman');
  const rankingObs = observedPiRankingStability(results, publishedPi);

  const verdicts = (target.claims as ReplicationClaim[]).map(claim => {
    if (claim.claim_key === 'harm_index_vs_reference_pearson') {
      return evaluateClaim(claim, pearsonObs.value);
    }
    if (claim.claim_key === 'popularity_ranking_stability') {
      return evaluateClaim(claim, rankingObs.value);
    }
    return evaluateClaim(claim, null, 'No observed value is wired for this claim key.');
  });

  // Reported alongside, never as a pass/fail claim: the paper never claimed a
  // Spearman value, so scoring one against a band would be inventing a claim
  // on its behalf. 03_JH2016_CONTRACT.md's "report both" is satisfied here.
  const alsoReported = {
    spearman_hi_vs_reference: spearmanObs.value,
    _why_not_a_claim: 'The paper reports Pearson. Spearman is computed and shown for '
      + 'completeness, but it is not scored against a tolerance because the paper never '
      + 'asserted it.',
  };

  // Band 3, deliberately verdict-free: the deviation of each published point
  // value is described, not judged.
  const pointValueDeviations = paper.substances.map((sub: any) => {
    const pi = results.find(r => r.metricKey === 'Pi' && r.entityId === sub.canonical);
    const hi = results.find(r => r.metricKey === 'Hi' && r.entityId === sub.canonical);
    const rel = (obs: number | null | undefined, pub: number) =>
      obs === null || obs === undefined ? null : (obs - pub) / pub;
    return {
      entity_id: sub.canonical,
      published_Pi: sub.Pi_percent, observed_Pi: pi?.valueNumeric ?? null,
      relative_change_Pi: rel(pi?.valueNumeric, sub.Pi_percent),
      published_Hi: sub.Hi_percent, observed_Hi: hi?.valueNumeric ?? null,
      relative_change_Hi: rel(hi?.valueNumeric, sub.Hi_percent),
    };
  }).sort((a: any, b: any) => a.entity_id.localeCompare(b.entity_id));

  const replication = {
    target: `${target.title} (doi:${target.identifier})`,
    target_id: target.target_id,
    attempt_kind: attemptKind,
    attempt_kind_meaning: ATTEMPT_KIND_MEANING[attemptKind],
    pre_registration: target._pre_registration,
    verdicts,
    also_reported: alsoReported,
    point_value_deviations: {
      _note: target._band_3_deliberately_absent.reason,
      values: pointValueDeviations,
    },
    summary: Object.fromEntries(
      ['reproduced', 'deviates', 'not_computable', 'method_unclear']
        .map(v => [v, verdicts.filter(x => x.verdict === v).length])),
  };

  tracer.emit('REPLICATION_EVALUATED', {
    attempt_kind: attemptKind,
    verdicts: verdicts.map(v => ({ claim: v.claim_key, verdict: v.verdict })),
  });

  // ------------------------------------------------------------- run directory
  write(runDir, 'observations.json', JSON.stringify(
    stored.map(o => ({
      entity_id: o.entityId, query_role: o.queryRole, query_text: o.queryText,
      value: o.isMissing ? null : o.numericValue, is_missing: o.isMissing,
      missing_reason: o.isMissing ? (o as any).missingReason : null,
      quality_flags: [...o.qualityFlags].sort(),
      source_adapter_version: o.sourceAdapterVersion,
    })).sort((a, b) => a.entity_id.localeCompare(b.entity_id) || a.query_role.localeCompare(b.query_role)),
    null, 2) + '\n');

  write(runDir, 'analysis.json', JSON.stringify({
    executor_id: artifact.executorId, executor_version: artifact.executorVersion,
    method_spec_hash: artifact.specHash, quality_flags: allFlags,
    results,
  }, null, 2) + '\n');

  for (const chart of charts) write(runDir, `charts/${chart.id}.json`, JSON.stringify(chart, null, 2) + '\n');

  write(runDir, 'exports/results.csv', exportCsv(exportInput));
  write(runDir, 'exports/results.json', exportJson(exportInput));
  write(runDir, 'narrative.json', JSON.stringify(narrative, null, 2) + '\n');
  write(runDir, 'replication.json', JSON.stringify(replication, null, 2) + '\n');

  // Raw fixture copies, addressed by content hash.
  for (const fe of acqRepo.getFetchEvents(dbRunId)) {
    if (!fe.raw_blob_id) continue;
    const blob = acqRepo.getRawBlob(fe.raw_blob_id);
    if (!blob) continue;
    write(runDir, `raw/${blob.sha256}.json`, await store.get(blob.object_uri));
  }

  // Artifacts are recorded before the manifest so the manifest can list them.
  for (const [name, kind] of [['exports/results.csv', 'export'], ['exports/results.json', 'export'],
                              ['analysis.json', 'analysis'], ['narrative.json', 'narrative']] as const) {
    const bytes = fs.readFileSync(path.join(runDir, name));
    artRepo.recordArtifact({
      runId: dbRunId, kind, objectUri: `file://${name}`,
      sha256: createHash('sha256').update(bytes).digest('hex'), byteSize: bytes.length,
    });
  }

  const run = runRepo.getRun(dbRunId)!;
  const manifest = buildManifest({
    run: { ...run, status: 'COMPLETED' },
    presetLocked: preset.locked === true,
    fetches: acqRepo.getFetchEvents(dbRunId).map(f => ({
      source_id: f.source_id, provider_id: f.provider_id ?? null,
      provider_version: f.provider_version ?? null, rendered_query: f.rendered_query ?? null,
      request_hash: f.request_hash ?? null,
      raw_blob_sha256: f.raw_blob_id ? (acqRepo.getRawBlob(f.raw_blob_id)?.sha256 ?? null) : null,
      http_status: f.http_status ?? null, status: f.status,
    })),
    analyses: [{
      method_spec_id: 'jh2016-faithful', method_spec_hash: artifact.specHash,
      approval_state: 'APPROVED', approved_by: DEMO_APPROVER,
      executor_id: artifact.executorId, executor_version: artifact.executorVersion,
      input_series_ids: entityIds, input_hashes: [canonicalHash(seriesFor('popularity')), canonicalHash(seriesFor('harm'))],
    }],
    artifacts: artRepo.getArtifacts(dbRunId).map(a => ({ kind: a.kind, sha256: a.sha256, object_uri: a.object_uri })),
    missingObservations: exportInput.missingObservations,
    qualityFlags: allFlags,
    discontinuities: storedDiscontinuity.records.map(r => ({
      series_key: r.seriesKey, kind: r.kind, attribute: r.attribute,
      from: r.from, to: r.to, at: r.at,
    })),
    discontinuityCoverage: storedDiscontinuity.coverage,
    narratives: [{
      provider_id: narrative.providerId, model: narrative.model,
      generation_params: narrative.generationParams,
      input_payload_hash: narrative.inputPayloadHash, approval_state: 'APPROVED',
    }],
  });

  const { bytes: manifestBytes, sha256: manifestHash } = serializeManifest(manifest);
  write(runDir, 'manifest.json', manifestBytes);
  const manifestUri = await store.put(`manifests/${dbRunId}.json`, manifestBytes);
  artRepo.finalizeManifest(dbRunId, manifestUri, manifestHash);

  runRepo.updateStatus(dbRunId, 'COMPLETED');
  tracer.emit('RUN_COMPLETED', { runId: dbRunId, manifest_sha256: manifestHash });


  sqlite.close();

  const pi = results.filter(r => r.metricKey === 'Pi' && !r.isMissing).length;
  const hi = results.filter(r => r.metricKey === 'Hi' && !r.isMissing).length;

  console.log(`demo:jh16 complete`);
  console.log(`  run directory : runs/${runId}`);
  console.log(`  observations  : ${stored.length} (${exportInput.missingObservations.length} missing)`);
  console.log(`  computed      : ${pi} Pi, ${hi} Hi`);
  console.log(`  manifest      : sha256 ${manifestHash}`);
  for (const v of verdicts) {
    console.log(`  replication   : ${v.claim_key} → ${v.verdict.toUpperCase()} (${v.rationale})`);
  }
  console.log(`  attempt kind  : ${attemptKind} — ${ATTEMPT_KIND_MEANING[attemptKind]}`);
}

// Wrapped in a span so the run actually has a trace to put in its directory —
// the tracer records against a correlation context, and outside one there is
// nothing to record.
async function main() {
  const runId = randomUUID();
  const runDir = path.join(RUNS_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });

  // The run's trace belongs to the run, not to a shared global folder: two
  // concurrent runs must not be able to disturb each other's diagnostic record.
  tracer.setLogDir(path.join(runDir, 'diagnostics'));
  // TRACE before the span opens: the span's own entry events are part of the
  // record, and setting the mode inside it would silently drop them.
  tracer.setMode('TRACE');

  const traceId = randomUUID();
  await tracer.runWithSpan('demo', 'demo:jh16', () => runDemo(traceId, runId, runDir), { trace_id: traceId });

  // Captured after the span closes: runWithSpan emits its own exit events on
  // the way out, so copying from inside the span would drop the tail of the
  // very record the bundle is meant to preserve.
  const traceDir = tracer.traceDir(traceId);
  if (fs.existsSync(traceDir)) {
    for (const f of fs.readdirSync(traceDir).sort()) {
      write(runDir, `trace/${f}`, fs.readFileSync(path.join(traceDir, f)));
    }
  } else {
    write(runDir, 'trace/README.txt',
      'No trace events were captured for this run (diagnostics mode may be OFF).\n');
  }

  // The trace now lives at trace/; the directory the tracer wrote to is an
  // implementation detail and is not part of the published run.
  fs.rmSync(path.join(runDir, 'diagnostics'), { recursive: true, force: true });
}

main().catch(err => { console.error(err); process.exit(1); });
