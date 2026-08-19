import { test, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tracer } from '../../backend/watchdog_api/utils/tracer';
import {
  redact, redactText, registerSecretValue, clearRegisteredSecrets, REDACTED
} from '../../backend/watchdog_api/utils/redaction';
import { buildErrorEnvelope } from '../../backend/watchdog_api/utils/errors';
import { buildDiagnosticBundle } from '../../backend/watchdog_api/diag/bundle';
import { createZip, readZip } from '../../backend/watchdog_api/utils/zip';

const DIAG_ROOT = path.join(process.cwd(), 'diagnostics');

function cleanup() {
  if (fs.existsSync(DIAG_ROOT)) fs.rmSync(DIAG_ROOT, { recursive: true, force: true });
}

beforeEach(() => { clearRegisteredSecrets(); cleanup(); });
afterEach(() => { clearRegisteredSecrets(); cleanup(); });

function readEvents(traceId: string): any[] {
  const dir = tracer.traceDir(traceId);
  const file = path.join(dir, 'events.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

// -------------------------------------------------------------------------
// E1.4 — Tracer.
// Stated test: a traced call chain produces ordered events with consistent
// trace_id and monotonic sequence_no.
// -------------------------------------------------------------------------

test('E1.4: a traced chain has one trace_id and a strictly monotonic sequence_no', async () => {
  tracer.setMode('TRACE');
  const traceId = `t-mono-${Date.now()}`;

  await tracer.runWithSpan('outer', 'op', async () => {
    tracer.stateBefore({ phase: 'start' });
    tracer.input({ n: 1 });

    await tracer.runWithSpan('middle', 'op', async () => {
      tracer.validation(true);
      tracer.decision('take_fast_path', 'count', 42);

      await tracer.runWithSpan('inner', 'op', async () => {
        tracer.result({ ok: true });
      });
    });

    tracer.stateAfter({ phase: 'end' });
  }, { trace_id: traceId });

  const events = readEvents(traceId);
  assert.ok(events.length >= 10, `expected a full chain, got ${events.length} events`);

  // One trace_id across every layer.
  const traceIds = new Set(events.map(e => e.context.trace_id));
  assert.deepStrictEqual([...traceIds], [traceId], 'every event shares the chain trace_id');

  // Strictly monotonic sequence_no across the whole chain, including across
  // the nested span boundaries — this is what makes the log readable in order.
  const seqs = events.map(e => e.context.sequence_no);
  for (let i = 1; i < seqs.length; i++) {
    assert.ok(seqs[i] > seqs[i - 1],
      `sequence_no must strictly increase; event ${i} went ${seqs[i - 1]} -> ${seqs[i]}`);
  }

  // Span nesting is recoverable: a child names its parent.
  const inner = events.find(e => e.context.component === 'inner')!;
  const middle = events.find(e => e.context.component === 'middle')!;
  assert.ok(inner, 'inner span emitted');
  assert.strictEqual(inner.context.parent_span_id, middle.context.span_id);
});

test('E1.4: DECISION records the branch and the value that determined it', async () => {
  tracer.setMode('TRACE');
  const traceId = `t-dec-${Date.now()}`;

  await tracer.runWithSpan('c', 'op', async () => {
    tracer.decision('used_cached_result', 'cache_age_seconds', 12);
  }, { trace_id: traceId });

  const decision = readEvents(traceId).find(e => e.event_type === 'DECISION');
  assert.ok(decision, 'a DECISION event must be recorded');
  assert.strictEqual(decision.payload.branch, 'used_cached_result');
  assert.deepStrictEqual(decision.payload.because, { field: 'cache_age_seconds', value: 12 });
});

test('E1.4: the four modes are switchable without touching instrumentation', async () => {
  for (const mode of ['OFF', 'ERRORS', 'NORMAL', 'TRACE'] as const) {
    tracer.setMode(mode);
    assert.strictEqual(tracer.getMode(), mode);
  }

  // OFF writes nothing, with the same calls in the same places.
  tracer.setMode('OFF');
  const traceId = `t-off-${Date.now()}`;
  await tracer.runWithSpan('c', 'op', async () => { tracer.emit('INPUT', { a: 1 }); }, { trace_id: traceId });
  assert.strictEqual(readEvents(traceId).length, 0, 'OFF must produce no trace output');
});

// -------------------------------------------------------------------------
// E1.5 — Redaction.
// Stated test: the canary secret is absent from trace stream, logs, manifest,
// bundle and error envelope.
// -------------------------------------------------------------------------

const CANARY = 'sk-live-CANARY-d41d8cd98f00b204e9800998';

test('E1.5: the canary is absent from every sink', async () => {
  tracer.setMode('TRACE');
  registerSecretValue(CANARY);
  const traceId = `t-canary-${Date.now()}`;

  const errorEnvelope = buildErrorEnvelope(
    new Error(`upstream rejected credential ${CANARY}`),
    { component: 'adapter', operation: 'fetch' }
  );

  await tracer.runWithSpan('adapter', 'fetch', async () => {
    // By key: a credential-shaped field.
    tracer.emit('STATE_BEFORE', { api_key: CANARY, note: 'configured' });
    // By value: the same secret interpolated into free text, where there is
    // no credential-shaped key to match on.
    tracer.emit('INPUT', { message: `calling upstream with ${CANARY}` });
  }, { trace_id: traceId });

  // Sink 1: the trace stream on disk.
  const traceFile = path.join(tracer.traceDir(traceId), 'events.jsonl');
  const raw = fs.readFileSync(traceFile, 'utf-8');
  assert.ok(!raw.includes(CANARY), 'canary leaked into the trace stream');
  assert.ok(raw.includes(REDACTED), 'redaction should be visible, not silent');

  // Sink 2: the error envelope.
  const envelopeJson = JSON.stringify(redact(errorEnvelope));
  assert.ok(!envelopeJson.includes(CANARY), 'canary leaked into the error envelope');

  // Sink 3: a manifest.
  const manifest = { run_id: 'r1', provider_config: { api_key: CANARY }, note: `key=${CANARY}` };
  assert.ok(!JSON.stringify(redact(manifest)).includes(CANARY), 'canary leaked into the manifest');

  // Sink 4: text logs.
  assert.ok(!redactText(`log line containing ${CANARY}`).includes(CANARY), 'canary leaked into a log line');

  // Sink 5: the diagnostic bundle.
  const bundle = buildDiagnosticBundle({
    runId: 'r1',
    traceId,
    effectiveConfig: { provider: { api_key: CANARY } },
    manifest,
    errorEnvelope,
  });
  assert.ok(!bundle.zip.toString('utf-8').includes(CANARY), 'canary leaked into the diagnostic bundle');
});

test('E1.5: redaction survives cycles and buffers rather than hanging', () => {
  const cyclic: any = { name: 'x' };
  cyclic.self = cyclic;
  const out = redact(cyclic);
  assert.strictEqual(out.name, 'x');
  assert.strictEqual(out.self, '[CIRCULAR]');

  assert.match(redact({ blob: Buffer.from('abc') }).blob, /^\[BUFFER 3 bytes\]$/);
});

// -------------------------------------------------------------------------
// E1.6 — Error envelopes and cause chains.
// Stated test: an error raised four layers down arrives with its full chain
// and the state at failure.
// -------------------------------------------------------------------------

test('E1.6: an error four layers down arrives with its whole chain', async () => {
  tracer.setMode('TRACE');
  const traceId = `t-chain-${Date.now()}`;

  const l4 = new Error('layer4: sqlite constraint violated');
  (l4 as any).code = 'SQLITE_CONSTRAINT';
  const l3 = new Error('layer3: repository could not persist observation'); l3.cause = l4;
  const l2 = new Error('layer2: normalization step failed'); l2.cause = l3;
  const l1 = new Error('layer1: run aborted'); l1.cause = l2;

  await assert.rejects(async () => {
    await tracer.runWithSpan('service', 'executeRun', async () => {
      tracer.stateBefore({ step: 'PERSISTING_OBSERVATIONS', entity: 'alcohol' });
      throw l1;
    }, { trace_id: traceId });
  });

  const errFile = path.join(tracer.traceDir(traceId), 'errors.jsonl');
  const envelope = JSON.parse(fs.readFileSync(errFile, 'utf-8').trim().split('\n')[0]);

  assert.strictEqual(envelope.message, 'layer1: run aborted');
  assert.strictEqual(envelope.cause_chain.length, 3, 'three causes below the top-level error');
  assert.deepStrictEqual(
    envelope.cause_chain.map((c: any) => c.message),
    [
      'layer2: normalization step failed',
      'layer3: repository could not persist observation',
      'layer4: sqlite constraint violated',
    ]
  );
  assert.strictEqual(envelope.cause_chain[2].error_code, 'SQLITE_CONSTRAINT',
    'the root cause keeps its own code');

  // And the state at failure is recoverable from the same trace.
  const events = readEvents(traceId);
  assert.ok(events.find(e => e.event_type === 'STATE_AT_FAILURE'), 'STATE_AT_FAILURE must be emitted');
  const before = events.find(e => e.event_type === 'STATE_BEFORE');
  assert.strictEqual(before.payload.state.step, 'PERSISTING_OBSERVATIONS');
});

// -------------------------------------------------------------------------
// E1.7 — Diagnostic bundle.
// Stated test: a deliberately failed fixture run yields a bundle from which
// the direct cause is identifiable without re-running.
// -------------------------------------------------------------------------

test('E1.7: zip round-trips and is byte-deterministic', () => {
  const entries = [
    { name: 'b.txt', content: Buffer.from('bbb') },
    { name: 'a.txt', content: Buffer.from('aaa') },
  ];
  const one = createZip(entries);
  const two = createZip([...entries].reverse());
  assert.deepStrictEqual(one, two, 'entry order must not change the bytes');

  const back = readZip(one);
  assert.deepStrictEqual(back.map(e => e.name), ['a.txt', 'b.txt']);
  assert.strictEqual(back[0].content.toString(), 'aaa');
});

test('E1.7: the direct cause of a failed run is identifiable from the bundle alone', async () => {
  tracer.setMode('TRACE');
  const traceId = `t-bundle-${Date.now()}`;

  // A deliberately failed run, crossing service -> adapter -> parse.
  const parseError = new Error('count field was the string "about 42,000", not a number');
  (parseError as any).code = 'normalization_error';
  const adapterError = new Error('fixture adapter failed to normalize'); adapterError.cause = parseError;

  let envelopeSeen: unknown = null;
  await assert.rejects(async () => {
    await tracer.runWithSpan('service', 'executeRun', async () => {
      tracer.stateBefore({ step: 'NORMALIZING', entity: 'khat', dimension: 'harm' });
      tracer.decision('reject_unparseable_count', 'raw_value', 'about 42,000');
      envelopeSeen = buildErrorEnvelope(adapterError, { component: 'adapter', operation: 'normalize' });
      throw adapterError;
    }, { trace_id: traceId });
  });

  const bundle = buildDiagnosticBundle({
    runId: 'run-xyz',
    traceId,
    effectiveConfig: { source_id: 'offline_fixture', language: 'en' },
    manifest: null,
    artifacts: [{ kind: 'raw', sha256: 'abc123', object_uri: 'file://blob/abc123' }],
    errorEnvelope: envelopeSeen,
  });

  const files = Object.fromEntries(readZip(bundle.zip).map(e => [e.name, e.content.toString('utf-8')]));

  // The bundle is self-describing and complete.
  for (const required of [
    'bundle.json', 'environment.json', 'dependencies.json',
    'effective_config.json', 'manifest.json', 'artifacts.json', 'error_envelope.json',
  ]) {
    assert.ok(files[required] !== undefined, `bundle missing ${required}`);
  }
  assert.ok(Object.keys(files).some(f => f.startsWith('trace/')), 'bundle must carry the trace stream');

  // The direct cause is readable without re-running anything.
  const envelope = JSON.parse(files['error_envelope.json']);
  assert.strictEqual(envelope.cause_chain[0].message,
    'count field was the string "about 42,000", not a number');

  // ...as is the branch that produced it, and the state it happened in.
  // Concatenate the whole trace stream: it is split across events.jsonl and
  // errors.jsonl, and the reader should not care which file a fact is in.
  const trace = Object.entries(files)
    .filter(([n]) => n.startsWith('trace/'))
    .map(([, c]) => c)
    .join('\n');
  assert.ok(trace.includes('reject_unparseable_count'), 'the deciding branch is in the trace');
  assert.ok(trace.includes('NORMALIZING'), 'the state at failure is in the trace');

  // Environment is fingerprinted, but process.env is deliberately not included.
  const env = JSON.parse(files['environment.json']);
  assert.ok(env.node_version && env.platform);
  assert.ok(!('env' in env) && !('process_env' in env),
    'process.env is the likeliest place for a credential and must not be captured');
});
