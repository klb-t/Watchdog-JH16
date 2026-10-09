import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadNarrativeCatalog, validateNarrativeCatalog, selectNarrativeRecipe } from '../../backend/watchdog_api/config/narrative';
import { generateNarrative, generateNarrativeWithProvider, hashNarrativePayload } from '../../backend/watchdog_api/services/narrative';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';
import { exportJson } from '../../backend/watchdog_api/services/export';
import { approve } from '../../backend/watchdog_api/domain/approval';
import type { TextGenerator, TextGenerationRequest } from '../../backend/watchdog_api/llm/base';

const before = JSON.parse(readFileSync('tests/fixtures/narrative-before.json', 'utf8'));
const payload = { presetId: null, results: [4, 3, 2, 1].map((valueNumeric, i) => ({ metricKey: 'Pi', entityId: ['a', 'b', 'c', 'd'][i], valueNumeric })), missingCount: 0, qualityFlags: [] };
const request = () => ({ runId: 'public-before', payload: structuredClone(payload), payloadHash: hashNarrativePayload(payload), templateId: 'jh2016-summary', templateVersion: '1.0', providerId: null, model: null });
const definition = () => JSON.parse(readFileSync('config/narratives.json', 'utf8'));

test('WD-001: historical default narrative bytes/content hash and provider prompt remain identical', async () => {
  const generated = generateNarrative(request());
  const { producedBy, ...oldFields } = generated;
  assert.deepEqual(oldFields, before.defaultNarrative);
  assert.equal(producedBy!.recipeHash, canonicalHash(producedBy!.recipe));
  let captured: TextGenerationRequest | undefined;
  const generator: TextGenerator = { providerKey: 'controlled', async generate(input) {
    captured = input; return { providerKey: 'controlled', model: input.model, text: generated.content,
      nondeterministic: true, upstreamId: null, usage: { promptTokens: null, completionTokens: null } };
  } };
  const sampled = await generateNarrativeWithProvider({ ...request(), model: 'public-model', generator });
  assert.deepEqual(captured, before.providerRequest);
  assert.equal(sampled.producedBy!.systemHash, canonicalHash({ system: captured!.system }));
  assert.equal(sampled.producedBy!.promptHash, canonicalHash({ prompt: captured!.prompt }));
  assert.equal(sampled.approvalState, 'PROPOSED');
  assert.equal(sampled.nondeterministicContent, true);
});

test('WD-001: recipe selection changes locale, ranking and provenance through the same data mechanism', () => {
  const en = generateNarrative(request());
  const pl = generateNarrative({ ...request(), templateId: 'summary-pl' });
  assert.match(en.content, /highest were: a, b, c\./);
  assert.match(pl.content, /popularności: a, b, c, d\./);
  assert.equal(pl.producedBy!.recipe.locale, 'pl');
  assert.notEqual(pl.producedBy!.recipeHash, en.producedBy!.recipeHash);
  const data = definition(); data.templates[1].ranking.topK = 1; data.templates[1].ranking.direction = 'ascending';
  const directory = mkdtempSync(path.join(tmpdir(), 'wd-narrative-config-'));
  try {
    const filename = path.join(directory, 'catalog.json'); writeFileSync(filename, JSON.stringify(data));
    const one = generateNarrative({ ...request(), templateId: 'summary-pl' }, loadNarrativeCatalog(filename));
    assert.match(one.content, /popularności: d\./);
    assert.notEqual(one.contentHash, pl.contentHash);
    assert.notEqual(one.producedBy!.recipeHash, pl.producedBy!.recipeHash);
    assert.deepEqual(payload, request().payload);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('WD-001: unknown ID/version and malformed data fail before a generator can dispatch', async () => {
  let calls = 0;
  const generator: TextGenerator = { providerKey: 'rejecting', async generate() { ++calls; throw new Error('dispatch forbidden'); } };
  for (const selection of [{ templateId: 'unknown', templateVersion: '1' }, { templateId: 'jh2016-summary', templateVersion: 'missing' }])
    await assert.rejects(generateNarrativeWithProvider({ ...request(), ...selection, model: 'public', generator }), /Unknown narrative template/);
  assert.equal(calls, 0);
  assert.throws(() => selectNarrativeRecipe(loadNarrativeCatalog(), { templateId: 'jh2016-summary' }));
  for (const mutate of [(d: any) => d.templates.push(d.templates[0]), (d: any) => d.templates[0].ranking.topK = -1,
    (d: any) => d.templates[0].text.counts = '{{unrecognized}}', (d: any) => d.templates[0].extra = true,
    (d: any) => d.templates[0].provider.prompt = 'No source binding']) {
    const data = definition(); mutate(data); assert.throws(() => validateNarrativeCatalog(data));
  }
});

test('WD-001: ranking ties, missingness and all/none choices are explicit and do not alter payload numbers', () => {
  const data = definition(); data.templates[0].ranking.tieBreak = 'entity_id'; data.templates[0].ranking.topK = null;
  const values = { ...payload, results: [{ metricKey: 'Pi', entityId: 'z', valueNumeric: 2 },
    { metricKey: 'Pi', entityId: 'a', valueNumeric: 2 }, { metricKey: 'Pi', entityId: 'missing', valueNumeric: null }], missingCount: 1 };
  const beforeBytes = JSON.stringify(values);
  const input = { ...request(), payload: values, payloadHash: hashNarrativePayload(values) };
  const ordered = generateNarrative(input, validateNarrativeCatalog(data));
  assert.match(ordered.content, /highest were: a, z\./);
  assert.match(ordered.content, /2 computable popularity indices/);
  assert.match(ordered.content, /not treated as zero/);
  data.templates[0].ranking.topK = 0;
  assert.doesNotMatch(generateNarrative(input, validateNarrativeCatalog(data)).content, /highest were/);
  assert.equal(JSON.stringify(values), beforeBytes);
});

test('WD-001: evidence snapshots survive later catalog changes and approved JSON export preserves the binding', () => {
  const catalog = loadNarrativeCatalog();
  const generated = generateNarrative(request(), catalog);
  const snapshot = structuredClone(generated.producedBy);
  catalog.templates[0].text.completed = 'Changed after generation';
  assert.deepEqual(generated.producedBy, snapshot);
  assert.throws(() => exportJson({ runId: generated.runId, results: [], narrative: generated }), /PROPOSED/);
  const approval = approve({ id: 'safe-narrative', kind: 'narrative', content: { content: generated.content } }, 'human', '2026-10-09T00:00:00Z');
  const exported = JSON.parse(exportJson({ runId: generated.runId, results: [], narrative: generated, narrativeApprovable: approval }));
  assert.deepEqual(exported.narrative.produced_by, snapshot);
  const { producedBy: _evidence, ...legacy } = generated;
  const oldExport = JSON.parse(exportJson({ runId: generated.runId, results: [], narrative: legacy, narrativeApprovable: approval }));
  assert.equal(Object.hasOwn(oldExport.narrative, 'produced_by'), false, 'no invented provenance for historical rows');
});
