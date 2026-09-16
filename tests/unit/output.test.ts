import { test } from 'node:test';
import * as assert from 'node:assert';
import { buildManifest, assertManifestComplete, serializeManifest, IncompleteManifestError } from '../../backend/watchdog_api/services/manifest';
import { generateNarrative, hashNarrativePayload, NarrativePayload, NarrativePayloadTamperedError } from '../../backend/watchdog_api/services/narrative';
import { exportCsv, exportJson, UnapprovedArtifactExportError } from '../../backend/watchdog_api/services/export';
import { buildPiChart, buildHiChart, buildHiVsReferenceChart } from '../../backend/watchdog_api/services/charts';
import { AnalysisResultValue } from '../../backend/watchdog_api/domain/method_spec';
import { approve, Approvable } from '../../backend/watchdog_api/domain/approval';

const RESULTS: AnalysisResultValue[] = [
  { entityId: 'alcohol', metricKey: 'Pi', valueNumeric: 100, unit: '%', isMissing: false },
  { entityId: 'cannabis', metricKey: 'Pi', valueNumeric: 15.2, unit: '%', isMissing: false },
  { entityId: 'ghb', metricKey: 'Pi', valueNumeric: null, unit: '%', isMissing: true },
  { entityId: 'alcohol', metricKey: 'Hi', valueNumeric: 27.5, unit: '%', isMissing: false },
  { entityId: 'ghb', metricKey: 'Hi', valueNumeric: null, unit: '%', isMissing: true },
];

const baseManifestInput = () => ({
  run: {
    id: 'run-1', run_type: 'PIPELINE', status: 'COMPLETED', created_at: '2026-01-01T00:00:00Z',
    started_at: '2026-01-01T00:00:01Z', completed_at: '2026-01-01T00:00:09Z',
    app_version: '0.0.0', git_commit: 'abc123',
    effective_config: JSON.stringify({ source_id: 'fixture_jh2016' }),
    effective_config_hash: 'cfg-hash', preset_id: 'jh2016-faithful', preset_version: '2016-faithful-v1',
  },
  presetLocked: true,
  fetches: [{ source_id: 'fixture_jh2016', provider_id: 'fixture', provider_version: '1.0.0',
    rendered_query: '"alcohol"', request_hash: 'rq1', raw_blob_sha256: 'sha1', http_status: 200, status: 'SUCCESS' }],
  analyses: [{ method_spec_id: 'm1', method_spec_hash: 'mh1', approval_state: 'APPROVED', approved_by: 'a-human',
    executor_id: 'typescript-inprocess', executor_version: '1.0.0', input_series_ids: ['s1'], input_hashes: ['h1'] }],
  artifacts: [{ kind: 'raw', sha256: 'sha1', object_uri: 'file://blob/sha1' }],
  missingObservations: [{ entity_id: 'ghb', query_role: 'popularity', missing_reason: 'PARSE_FAILED' }],
  qualityFlags: ['PROVIDER_ESTIMATE', 'COUNT_PARSE_UNCERTAIN'],
});

// -------------------------------------------------------------------------
// E1.19 — Manifest.
// -------------------------------------------------------------------------

test('E1.19: a golden run manifest contains every required field', () => {
  const m = buildManifest(baseManifestInput());

  for (const field of [
    'schema_version', 'run_id', 'run_type', 'status', 'app_version', 'git_commit',
    'effective_config_hash', 'effective_config', 'preset_id', 'preset_version', 'preset_locked',
    'fetches', 'analyses', 'quality_flags', 'artifacts', 'missing_observations',
    'narratives', 'substitutions',
  ]) {
    assert.ok(field in m, `manifest missing '${field}'`);
  }

  // Per-fetch provenance is complete enough to re-identify the request.
  assert.strictEqual(m.fetches[0].rendered_query, '"alcohol"');
  assert.strictEqual(m.fetches[0].provider_id, 'fixture');
  assert.strictEqual(m.fetches[0].raw_blob_sha256, 'sha1');

  // Per-analysis provenance names the spec, its approval and the executor.
  assert.strictEqual(m.analyses[0].method_spec_hash, 'mh1');
  assert.strictEqual(m.analyses[0].approval_state, 'APPROVED');
  assert.strictEqual(m.analyses[0].executor_version, '1.0.0');
});

test('E1.19: every quality flag and every missing observation reaches the manifest', () => {
  const m = buildManifest(baseManifestInput());

  assert.deepStrictEqual(m.quality_flags, ['COUNT_PARSE_UNCERTAIN', 'PROVIDER_ESTIMATE'],
    'flags are deduplicated and sorted, and none is dropped');
  assert.deepStrictEqual(m.missing_observations,
    [{ entity_id: 'ghb', query_role: 'popularity', missing_reason: 'PARSE_FAILED' }],
    'missing observations are enumerated with reasons');
});

test('E1.19: an incomplete manifest fails loudly rather than shipping', () => {
  const partial: any = { schema_version: '1.0', run_id: 'r' };
  assert.throws(() => assertManifestComplete(partial), IncompleteManifestError);
});

test('E1.19: manifests are deterministic — same input, same bytes', () => {
  const a = serializeManifest(buildManifest(baseManifestInput()));
  const b = serializeManifest(buildManifest(baseManifestInput()));
  assert.deepStrictEqual(a.bytes, b.bytes);
  assert.strictEqual(a.sha256, b.sha256);

  // Input ordering must not change the output.
  const shuffled = baseManifestInput();
  shuffled.qualityFlags = ['PROVIDER_ESTIMATE', 'COUNT_PARSE_UNCERTAIN'].reverse();
  assert.strictEqual(serializeManifest(buildManifest(shuffled)).sha256, a.sha256);
});

// -------------------------------------------------------------------------
// E1.17 — Narrative.
// -------------------------------------------------------------------------

const payload = (): NarrativePayload => ({
  presetId: 'jh2016-faithful',
  results: RESULTS.map(r => ({ metricKey: r.metricKey, entityId: r.entityId, valueNumeric: r.valueNumeric, unit: r.unit })),
  missingCount: 2, qualityFlags: ['PROVIDER_ESTIMATE'],
});

test('E1.17: the narrative service cannot alter a numeric value', () => {
  const p = payload();
  const before = JSON.stringify(p);
  const n = generateNarrative({
    runId: 'run-1', payload: p, payloadHash: hashNarrativePayload(p),
    templateId: 'jh2016-summary', templateVersion: '1.0', providerId: null, model: null,
  });

  assert.strictEqual(JSON.stringify(p), before, 'the payload it was handed is unchanged');
  // Nothing it emits is a value a caller could mistake for a measurement.
  assert.strictEqual(typeof n.content, 'string');
  assert.strictEqual(n.approvalState, 'PROPOSED');
  assert.strictEqual(n.generated, true);
  assert.strictEqual(n.inputPayloadHash, hashNarrativePayload(p));
});

test('E1.17: a payload that changed under its hash is refused', () => {
  const p = payload();
  const hash = hashNarrativePayload(p);
  const tampered = { ...p, missingCount: 0 };

  assert.throws(() => generateNarrative({
    runId: 'run-1', payload: tampered, payloadHash: hash,
    templateId: 't', templateVersion: '1', providerId: null, model: null,
  }), NarrativePayloadTamperedError);
});

test('E1.17: the narrative uses precise status language, never "successful replication"', () => {
  const p = payload();
  const n = generateNarrative({
    runId: 'run-1', payload: p, payloadHash: hashNarrativePayload(p),
    templateId: 't', templateVersion: '1', providerId: null, model: null,
  });

  assert.match(n.content, /methodological reproduction completed/i);
  assert.ok(!/successful(ly)? replicat/i.test(n.content),
    'code that ran is not science that replicated');
  assert.match(n.content, /not treated as zero/i, 'missingness is stated, not glossed');
});

// -------------------------------------------------------------------------
// E1.18 — Export.
// -------------------------------------------------------------------------

test('E1.18: exported values equal stored values, and missing is never zero', () => {
  const csv = exportCsv({ runId: 'run-1', results: RESULTS });
  const lines = csv.trim().split('\n');

  const ghbPi = lines.find(l => l.startsWith('run-1,ghb,Pi'))!;
  assert.ok(ghbPi.endsWith(',,%,true'), `missing must export as empty + is_missing=true, got: ${ghbPi}`);
  assert.ok(!/,0,/.test(ghbPi), 'a missing value must never export as 0');

  const alcoholPi = lines.find(l => l.startsWith('run-1,alcohol,Pi'))!;
  assert.ok(alcoholPi.includes(',100,'), 'stored values export unchanged');

  const json = JSON.parse(exportJson({ runId: 'run-1', results: RESULTS }));
  const ghb = json.results.find((r: any) => r.entity_id === 'ghb' && r.metric_key === 'Pi');
  assert.strictEqual(ghb.value_numeric, null);
  assert.strictEqual(ghb.is_missing, true);
});

test('E1.18: an unapproved narrative cannot reach an export', () => {
  const p = payload();
  const narrative = generateNarrative({
    runId: 'run-1', payload: p, payloadHash: hashNarrativePayload(p),
    templateId: 't', templateVersion: '1', providerId: null, model: null,
  });

  assert.throws(() => exportCsv({ runId: 'run-1', results: RESULTS, narrative }),
    UnapprovedArtifactExportError);
  assert.throws(() => exportJson({ runId: 'run-1', results: RESULTS, narrative }),
    UnapprovedArtifactExportError);

  const approved: Approvable = approve(
    { id: 'n1', kind: 'narrative', content: { content: narrative.content } },
    'a-human', '2026-01-01T00:00:00Z');

  const csv = exportCsv({ runId: 'run-1', results: RESULTS, narrative, narrativeApprovable: approved });
  assert.ok(csv.includes('# GENERATED NARRATIVE'), 'approved prose is included...');
  assert.ok(csv.includes('machine-written'), '...and marked as machine-written');
});

test('E1.18: generated prose is distinguishable from computed results in JSON too', () => {
  const p = payload();
  const narrative = generateNarrative({
    runId: 'run-1', payload: p, payloadHash: hashNarrativePayload(p),
    templateId: 't', templateVersion: '1', providerId: null, model: null,
  });
  const approved: Approvable = approve(
    { id: 'n1', kind: 'narrative', content: { content: narrative.content } },
    'a-human', '2026-01-01T00:00:00Z');

  const json = JSON.parse(exportJson({
    runId: 'run-1', results: RESULTS, narrative, narrativeApprovable: approved }));

  assert.strictEqual(json.narrative.content_kind, 'GENERATED');
  assert.strictEqual(json.narrative.generated_by_machine, true);
  // The computed results carry no such marker, so the two cannot be confused.
  assert.ok(!('generated_by_machine' in json.results[0]));
});

// -------------------------------------------------------------------------
// E1.16 — Charts.
// -------------------------------------------------------------------------

test('E1.16: a missing value renders as visibly missing, never as zero or a gap', () => {
  const chart = buildPiChart(RESULTS, ['PROVIDER_DISCONTINUITY']);

  const ghb = (chart.points as any[]).find(p => p.entityId === 'ghb');
  assert.ok(ghb, 'a missing substance is still drawn, not dropped from the comparison');
  assert.strictEqual(ghb.value, null);
  assert.strictEqual(ghb.missing, true);
  assert.ok(ghb.missingReason, 'the point says why it is missing');

  // The renderer is told explicitly how to draw it, and told not to read it
  // as zero. A bare gap would be indistinguishable from a zero-height bar.
  assert.strictEqual(chart.missingRendering.treatAsZero, false);
  assert.strictEqual(chart.missingRendering.style, 'hatched-placeholder');

  for (const p of chart.points as any[]) {
    if (p.missing) assert.notStrictEqual(p.value, 0);
  }
});

test('E1.16: a series carrying PROVIDER_DISCONTINUITY shows it in the legend', () => {
  const chart = buildHiChart(RESULTS, ['PROVIDER_DISCONTINUITY', 'PROVIDER_ESTIMATE']);
  assert.deepStrictEqual(chart.legendFlags, ['PROVIDER_DISCONTINUITY', 'PROVIDER_ESTIMATE']);
});

test('E1.16: the Hi-versus-reference scatter marks incomparable points as missing', () => {
  const chart = buildHiVsReferenceChart(RESULTS, { alcohol: 72, ghb: 19, unknown_sub: 5 });

  const alcohol = (chart.points as any[]).find(p => p.entityId === 'alcohol');
  assert.deepStrictEqual([alcohol.x, alcohol.y, alcohol.missing], [27.5, 72, false]);

  const ghb = (chart.points as any[]).find(p => p.entityId === 'ghb');
  assert.strictEqual(ghb.missing, true, 'Hi is missing so the pair is not plottable');
  assert.strictEqual(ghb.x, null);

  const noHi = (chart.points as any[]).find(p => p.entityId === 'unknown_sub');
  assert.strictEqual(noHi.missing, true, 'a reference score with no Hi is equally not plottable');
});
