import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tracer } from '../../backend/watchdog_api/utils/tracer';
import { readTrace, traceDirectory } from '../../backend/watchdog_api/diag/view';
import { buildDiagnosticBundle } from '../../backend/watchdog_api/diag/bundle';
import { readZip } from '../../backend/watchdog_api/utils/zip';

test('E4 diagnostics: large traces retain a bounded preview and a complete downloadable ZIP', () => {
  const previous = tracer.getLogDir(), root = mkdtempSync(path.join(tmpdir(), 'watchdog-large-trace-'));
  tracer.setLogDir(root);
  try {
    const date = '2026-09-09', id = randomUUID(), dir = traceDirectory(date, id); mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ event_type: 'RESULT', payload: { text: 'x'.repeat(4096) } }) + '\n';
    const full = line.repeat(1000); writeFileSync(path.join(dir, 'events.jsonl'), full);
    const view = readTrace(date, id); assert.equal(view.truncated, true); assert.ok(view.events.length > 0 && view.events.length < 1000);
    const bundle = buildDiagnosticBundle({ runId: 'fixture', traceId: id, traceDir: dir });
    const entries = readZip(bundle.zip);
    assert.equal(entries.find(e => e.name === 'trace/events.jsonl')?.content.toString(), full);
  } finally { tracer.setLogDir(previous); rmSync(root, { recursive: true, force: true }); }
});
