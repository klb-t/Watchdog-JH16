import type { FieldSnapshot, OfflineLookupEvent, FieldQuery, FieldResult, ReferenceRecord } from '../../shared/field';
import { verifySnapshot } from '../../shared/field_snapshot';
import { validateFieldQuery } from '../../shared/field_validation';
import { lookupField } from '../../shared/field_lookup';
import { UiError, clientError, responseError } from './api_error';

const CACHE = 'watchdog-field-snapshot-1', QUEUE = 'watchdog-field-audit-1';
/** A refusal by the server. `message` keeps the server's English text; `code`/`vars` let the page show its label. */
export class HttpFailure extends UiError {
  constructor(readonly status: number, message: string, code?: string, vars?: Record<string, string | number>) { super(message, code, vars, status); }
}
/**
 * Failures raised by shared validation (snapshot verification, offline lookup) carry English
 * text only; the stable code for the reader's label is attached here. An unlisted message
 * stays as it is.
 */
const SHARED_FAILURES: Record<string, string> = {
  'Offline snapshot identity or integrity mismatch.': 'field_snapshot_mismatch',
  'Offline snapshot expired or its clock window is invalid. Reconnect to synchronize.': 'field_snapshot_expired',
  'Duplicate snapshot records.': 'field_snapshot_duplicate',
  'A cached reference changed after approval. Reconnect to synchronize.': 'field_snapshot_changed',
  'Select a registered region.': 'field_region_unregistered',
  'Region hierarchy contains a cycle.': 'field_region_cycle',
  'Reference region is not registered.': 'field_reference_region_unregistered',
};
function coded(e: unknown): unknown {
  if (e instanceof UiError || !(e instanceof Error)) return e;
  const issues = (e as { issues?: { message?: unknown }[] }).issues;
  if (e.name === 'ZodError' && Array.isArray(issues)) {
    const detail = issues.map(i => String(i.message)).join('; ');
    return clientError('field_query_invalid', `The lookup descriptors are invalid: ${detail}`, { detail });
  }
  const code = SHARED_FAILURES[e.message];
  return code ? clientError(code, e.message) : e;
}
async function verified(input: unknown, hash: string, principalId: string) {
  try { return await verifySnapshot(input, hash, principalId); } catch (e) { throw coded(e); }
}
export async function fieldApi(path: string, body?: unknown) {
  const response = await fetch(`/api/field/${path}`, { cache: 'no-store', ...(body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) {
    if ([401, 403].includes(response.status)) clearFieldCache();
    const payload = await response.json().catch(() => ({}));
    const message = payload.message ?? payload.error ?? `Request failed (${response.status}).`;
    const ui = responseError(response, payload);
    const code = ui.code === 'http_status' ? 'field_request_failed' : ui.code;
    throw new HttpFailure(response.status, typeof message === 'string' ? message : ui.message, code, { ...ui.vars, detail: ui.message });
  }
  return response.json().catch(() => { throw new HttpFailure(502, 'The server returned invalid reference data.', 'field_invalid_response'); });
}
export function clearFieldCache() { localStorage.removeItem(CACHE); localStorage.removeItem(QUEUE); }
export async function readFieldCache(principalId?: string) {
  const raw = localStorage.getItem(CACHE);
  if (!raw) throw clientError('field_offline_missing', 'No offline snapshot. Synchronize while connected.');
  const saved = JSON.parse(raw);
  const snapshot = await verified(saved.snapshot, saved.hash, principalId ?? saved.snapshot?.principalId);
  return { snapshot, hash: saved.hash as string };
}
export async function syncField(principalId: string) {
  await flushFieldAudit(principalId);
  const data = await fieldApi('snapshot');
  const snapshot = await verified(data.snapshot, data.hash, principalId);
  // Writes can fail (private browsing or quota); the caller must disclose this.
  const old = localStorage.getItem(CACHE);
  if (old && JSON.parse(old).snapshot?.principalId !== principalId) clearFieldCache();
  localStorage.setItem(CACHE, JSON.stringify({ snapshot, hash: data.hash }));
  return snapshot;
}
function queue(principalId: string): OfflineLookupEvent[] {
  const raw = localStorage.getItem(QUEUE);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (parsed.principalId !== principalId) throw clientError('field_audit_other_account', 'Pending offline audit belongs to another account. Sign out before changing account.');
  return parsed.events;
}
export function pendingFieldAudit(principalId: string) { return queue(principalId).length; }
export async function flushFieldAudit(principalId: string) {
  const events = queue(principalId);
  if (!events.length) return;
  // Global discovery can have many result IDs. Keep each request below the
  // server's JSON limit; never truncate an event or acknowledge unsent receipts.
  const batches: OfflineLookupEvent[][] = []; let batch: OfflineLookupEvent[] = [], bytes = 20;
  for (const event of events) {
    const size = new TextEncoder().encode(JSON.stringify(event)).length + 1;
    if (size > 1_000_000) throw clientError('field_audit_receipt_too_large', 'An offline audit receipt is too large to synchronize without truncation.');
    if (batch.length && bytes + size > 1_000_000) { batches.push(batch); batch = []; bytes = 20; }
    batch.push(event); bytes += size;
  }
  if (batch.length) batches.push(batch);
  for (const next of batches) {
    const { acceptedIds } = await fieldApi('offline-events', { events: next });
    // Preserve events added during the request and receipts not acknowledged.
    localStorage.setItem(QUEUE, JSON.stringify({ principalId, events: queue(principalId).filter(e => !acceptedIds.includes(e.id)) }));
  }
}
export async function offlineFieldLookup(principalId: string, input: FieldQuery): Promise<{ result: FieldResult; snapshot: FieldSnapshot }> {
  let query: FieldQuery;
  try { query = validateFieldQuery(input); } catch (e) { throw coded(e); }
  const { snapshot, hash } = await readFieldCache(principalId);
  let result: FieldResult;
  try { result = lookupField(snapshot, query); } catch (e) { throw coded(e); }
  const events = queue(principalId);
  if (events.length >= 100) throw clientError('field_audit_queue_full_lookup', 'Offline audit queue is full. Reconnect before the next lookup.');
  events.push({ id: crypto.randomUUID(), clientOccurredAt: new Date().toISOString(), snapshotHash: hash,
    query, resultIds: [...[...result.candidates, ...result.globalCandidates].map(c => c.record.id), ...result.symptomCandidates.map(c => c.card.substance.id)] });
  // Audit persists before any result reaches the UI. Never silently drop a lookup.
  localStorage.setItem(QUEUE, JSON.stringify({ principalId, events }));
  return { result, snapshot };
}

/** Exact cached inspection has its own receipt; it never pretends to execute a query. */
export async function offlineFieldReference(principalId: string, referenceId: string): Promise<{ record: ReferenceRecord; snapshot: FieldSnapshot }> {
  const { snapshot, hash } = await readFieldCache(principalId);
  const record = snapshot.records.find(r => r.id === referenceId);
  if (!record) throw clientError('field_reference_not_offline', 'The linked reference is not present in the approved offline snapshot.');
  const events = queue(principalId);
  if (events.length >= 100) throw clientError('field_audit_queue_full_inspection', 'Offline audit queue is full. Reconnect before inspecting another reference.');
  events.push({ id: crypto.randomUUID(), kind: 'reference_inspection', referenceId,
    clientOccurredAt: new Date().toISOString(), snapshotHash: hash, resultIds: [record.id] });
  localStorage.setItem(QUEUE, JSON.stringify({ principalId, events }));
  return { record, snapshot };
}
