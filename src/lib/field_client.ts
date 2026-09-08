import type { FieldSnapshot, OfflineLookupEvent, FieldQuery, FieldResult } from '../../shared/field';
import { verifySnapshot } from '../../shared/field_snapshot';
import { validateFieldQuery } from '../../shared/field_validation';
import { lookupField } from '../../shared/field_lookup';

const CACHE = 'watchdog-field-snapshot-1', QUEUE = 'watchdog-field-audit-1';
export class HttpFailure extends Error { constructor(readonly status: number, message: string) { super(message); } }
export async function fieldApi(path: string, body?: unknown) {
  const response = await fetch(`/api/field/${path}`, { cache: 'no-store', ...(body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) {
    if ([401, 403].includes(response.status)) clearFieldCache();
    const payload = await response.json().catch(() => ({}));
    throw new HttpFailure(response.status, payload.message ?? payload.error ?? `Request failed (${response.status}).`);
  }
  return response.json().catch(() => { throw new HttpFailure(502, 'The server returned invalid reference data.'); });
}
export function clearFieldCache() { localStorage.removeItem(CACHE); localStorage.removeItem(QUEUE); }
export async function readFieldCache(principalId?: string) {
  const raw = localStorage.getItem(CACHE);
  if (!raw) throw new Error('No offline snapshot. Synchronize while connected.');
  const saved = JSON.parse(raw);
  const snapshot = await verifySnapshot(saved.snapshot, saved.hash, principalId ?? saved.snapshot?.principalId);
  return { snapshot, hash: saved.hash as string };
}
export async function syncField(principalId: string) {
  await flushFieldAudit(principalId);
  const data = await fieldApi('snapshot');
  const snapshot = await verifySnapshot(data.snapshot, data.hash, principalId);
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
  if (parsed.principalId !== principalId) throw new Error('Pending offline audit belongs to another account. Sign out before changing account.');
  return parsed.events;
}
export function pendingFieldAudit(principalId: string) { return queue(principalId).length; }
export async function flushFieldAudit(principalId: string) {
  const events = queue(principalId);
  if (!events.length) return;
  const { acceptedIds } = await fieldApi('offline-events', { events });
  // Keep events added while the request was in flight, as well as unacknowledged ones.
  localStorage.setItem(QUEUE, JSON.stringify({ principalId, events: queue(principalId).filter(e => !acceptedIds.includes(e.id)) }));
}
export async function offlineFieldLookup(principalId: string, input: FieldQuery): Promise<{ result: FieldResult; snapshot: FieldSnapshot }> {
  const query = validateFieldQuery(input);
  const { snapshot, hash } = await readFieldCache(principalId);
  const result = lookupField(snapshot, query);
  const events = queue(principalId);
  if (events.length >= 100) throw new Error('Offline audit queue is full. Reconnect before the next lookup.');
  events.push({ id: crypto.randomUUID(), clientOccurredAt: new Date().toISOString(), snapshotHash: hash,
    query, resultIds: [...result.candidates.map(c => c.record.id), ...result.symptomCandidates.map(c => c.card.substance.id)] });
  // Audit persists before any result reaches the UI. Never silently drop a lookup.
  localStorage.setItem(QUEUE, JSON.stringify({ principalId, events }));
  return { result, snapshot };
}
