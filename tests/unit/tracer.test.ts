import { test } from 'node:test';
import * as assert from 'node:assert';
import { tracer } from '../../backend/watchdog_api/utils/tracer';
import * as fs from 'node:fs';
import * as path from 'node:path';

test('Flight Recorder - Context propagation and events', async () => {
  tracer.setMode('TRACE');
  
  const testTraceId = 'test-trace-' + Date.now();
  
  await tracer.runWithSpan('test_component', 'test_operation', async () => {
    tracer.emit('STATE_BEFORE', { some: 'state', password: 'supersecret' });
    
    await tracer.runWithSpan('child_component', 'child_operation', async () => {
      tracer.emit('VALIDATION_RESULT', { valid: true });
    });
    
  }, { trace_id: testTraceId });

  const today = new Date().toISOString().split('T')[0];
  const logDir = path.join(process.cwd(), 'diagnostics', today, testTraceId);
  const eventsContent = fs.readFileSync(path.join(logDir, 'events.jsonl'), 'utf-8');
  
  const lines = eventsContent.trim().split('\n').map(l => JSON.parse(l));
  
  assert.ok(lines.length > 0, 'Events should be recorded');
  
  const stateBeforeEvent = lines.find(l => l.event_type === 'STATE_BEFORE');
  assert.ok(stateBeforeEvent, 'STATE_BEFORE event should exist');
  assert.strictEqual(stateBeforeEvent.payload.password, '[REDACTED]', 'Secrets must be redacted');
  
  const childEvent = lines.find(l => l.event_type === 'VALIDATION_RESULT');
  assert.ok(childEvent, 'Child span event should exist');
  assert.strictEqual(childEvent.context.parent_span_id, stateBeforeEvent.context.span_id, 'Child span should link to parent span');
  
  fs.rmSync(logDir, { recursive: true, force: true });
});

test('Flight Recorder - Error Causal Chain', async () => {
  tracer.setMode('TRACE');
  const testTraceId = 'test-error-trace-' + Date.now();
  
  const rootError = new Error("Root cause network failure");
  (rootError as any).code = "NET_ERR";
  
  const wrapperError = new Error("Adapter failed to fetch");
  wrapperError.cause = rootError;
  
  try {
    await tracer.runWithSpan('adapter', 'fetch', async () => {
      throw wrapperError;
    }, { trace_id: testTraceId });
  } catch (e) {
    // expected
  }

  const today = new Date().toISOString().split('T')[0];
  const logDir = path.join(process.cwd(), 'diagnostics', today, testTraceId);
  const errorsContent = fs.readFileSync(path.join(logDir, 'errors.jsonl'), 'utf-8');
  const errorObj = JSON.parse(errorsContent.trim().split('\n')[0]);
  
  assert.strictEqual(errorObj.message, "Adapter failed to fetch");
  assert.strictEqual(errorObj.cause_chain.length, 1);
  assert.strictEqual(errorObj.cause_chain[0].message, "Root cause network failure");
  assert.strictEqual(errorObj.cause_chain[0].error_code, "NET_ERR");
  
  fs.rmSync(logDir, { recursive: true, force: true });
});

test('Flight Recorder - concurrent sibling spans retain a unique ordered trace sequence', async () => {
  const previous = tracer.getMode(); tracer.setMode('TRACE');
  const id = `concurrent-${Date.now()}`, directory = tracer.traceDir(id);
  try {
    await tracer.runWithSpan('test', 'parent', async () => {
      await Promise.all(['first', 'second'].map(name => tracer.runWithSpan('test', name, async () => {
        tracer.input({ name }); await Promise.resolve(); tracer.result({ name });
      })));
    }, { trace_id: id });
    const events = fs.readFileSync(path.join(directory, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(events.map(e => e.context.sequence_no), events.map((_, index) => index + 1));
    assert.equal(new Set(events.map(e => e.context.span_id)).size, 3);
  } finally { tracer.setMode(previous); fs.rmSync(directory, { recursive: true, force: true }); }
});
