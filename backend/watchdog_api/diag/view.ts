import { readdirSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import { tracer } from '../utils/tracer';
import { redact, redactText } from '../utils/redaction';
const safeTrace = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function traceDirectory(date: string, id: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !safeTrace.test(id)) throw new Error('Use an ISO date and UUID trace ID.');
  return path.join(tracer.getLogDir(), date, id);
}
export function listTraces() {
  const root = tracer.getLogDir(); if (!existsSync(root)) return [];
  return readdirSync(root).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse().slice(0, 7).flatMap(date =>
    readdirSync(path.join(root, date)).filter(id => safeTrace.test(id)).map(id => ({ date, id,
      hasErrors: existsSync(path.join(root, date, id, 'errors.jsonl')), modifiedAt: statSync(path.join(root, date, id)).mtime.toISOString() })))
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, 200);
}
export function readTrace(date: string, id: string) {
  const dir = traceDirectory(date, id);
  let truncated = false;
  const read = (name: string) => {
    const file = path.join(dir, name); if (!existsSync(file)) return [];
    const bytes = Math.min(statSync(file).size, 4_000_000), fd = openSync(file, 'r'), buffer = Buffer.alloc(bytes);
    let length = 0; try { length = readSync(fd, buffer, 0, bytes, 0); } finally { closeSync(fd); }
    const limited = statSync(file).size > length; truncated ||= limited;
    const text = buffer.subarray(0, length).toString('utf8');
    // Exclude a partially read final record; the complete bytes remain in the ZIP.
    return (limited ? text.slice(0, text.lastIndexOf('\n') + 1) : text).trim().split('\n').filter(Boolean).map(line => { try { return redact(JSON.parse(line)); } catch { return { warning: 'Incomplete final log entry', text: redactText(line) }; } });
  };
  const events = read('events.jsonl'), errors = read('errors.jsonl');
  return { date, id, events, errors, truncated };
}
