import { z } from 'zod';
import type { PublicReceipt } from './automation';
import type { CollectionContext } from './collection';

export class SourceHistoryError extends Error {
  readonly code = 'source_history_error';
  constructor(message: string, readonly status = 409) { super(message); }
}
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface SourceContext {
  substanceId: string; provider: string; kind: string; url: string; adapterVersion: string; sourceProfileHash: string; collection?:CollectionContext;
}
export interface SourceHistoryGroup {
  context: SourceContext; contextHash: string; anchor: number; observations: number; versions: number;
  firstObservedAt: string; lastObservedAt: string; legacyObservations: number;
}
export interface SourceObservation {
  sequence: number; recordId: string; contentHash: string; receipt: PublicReceipt;
  origin: 'recorded' | 'legacy_first_receipt';
}
export interface SourceHistoryEntry extends SourceObservation {
  transition: 'FIRST_LINKED' | 'UNCHANGED' | 'CHANGED';
  versionFirstObservedAt: string; versionLastObservedAt: string; versionObservations: number;
}
export interface SourceHistoryPage {
  context: SourceContext; contextHash: string; entries: SourceHistoryEntry[]; nextBefore: number | null;
}
export type JsonPresence = { present: false } | { present: true; value: JsonValue };
export interface SourceChange { path: string; kind: 'added' | 'removed' | 'changed'; before: JsonPresence; after: JsonPresence }
export interface JsonDifference {
  algorithm: 'json-pointer-structural-1'; changes: SourceChange[]; visitedNodes: number;
  truncated: boolean; limitReached: 'changes' | 'nodes' | 'depth' | null;
}
const labels = z.enum(['title','introduction','coverage','legacy','source','older','newer','compare','export','refresh',
  'loadGroups','loadOlder','empty','choose','observations','versions','firstSeen','lastChecked','versionFirst','versionLast',
  'context','timeline','details','raw','before','after','path','change','absent','equal','different','truncated','loading',
  'profile','noComparison','arrayMeaning','sameObservation','error','counts','snapshot']);
export const SourceHistoryProfileSchema = z.object({
  version: z.literal('source-history-ui-1'),
  labels: z.record(labels, z.string().min(1).max(2000)),
  transitions: z.record(z.enum(['FIRST_LINKED','UNCHANGED','CHANGED']), z.object({
    label: z.string().min(1), icon: z.string().min(1), color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  }).strict()),
  changes: z.record(z.enum(['added','removed','changed']), z.string().min(1)),
  limits: z.object({ groups: z.number().int().min(1).max(200), observations: z.number().int().min(2).max(200),
    changes: z.number().int().min(1).max(2000), nodes: z.number().int().min(1).max(200000), depth: z.number().int().min(1).max(128),
    previewCharacters: z.number().int().min(80).max(10000) }).strict(),
}).strict();
export type SourceHistoryProfile = z.infer<typeof SourceHistoryProfileSchema> & { contentHash: string };
export interface SourceComparisonBody {
  version: 'source-comparison-1'; context: SourceContext; contextHash: string; profile: SourceHistoryProfile;
  from: SourceObservation & { value: JsonValue }; to: SourceObservation & { value: JsonValue };
  equal: boolean; difference: JsonDifference;
}
export interface SourceComparison { body: SourceComparisonBody; contentHash: string }

/** Structural comparison only. Arrays are positional; null, absent, strings and numbers stay distinct. */
export function compareJson(before: JsonValue, after: JsonValue, limits: { changes: number; nodes: number; depth: number }): JsonDifference {
  for (const value of [limits.changes,limits.nodes,limits.depth]) if (!Number.isSafeInteger(value) || value < 1) throw new SourceHistoryError('Invalid comparison limit');
  const result: JsonDifference = { algorithm: 'json-pointer-structural-1', changes: [], visitedNodes: 0, truncated: false, limitReached: null };
  type Item = { path: string; before: JsonPresence; after: JsonPresence; depth: number };
  const stack: Item[] = [{ path: '', before: { present: true, value: before }, after: { present: true, value: after }, depth: 0 }];
  const truncate = (why: JsonDifference['limitReached']) => { result.truncated = true; result.limitReached = why; };
  const pointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
  while (stack.length) {
    if (result.visitedNodes >= limits.nodes) { truncate('nodes'); break; }
    const item = stack.pop()!; result.visitedNodes++;
    const a = item.before.present ? item.before.value : undefined, b = item.after.present ? item.after.value : undefined;
    if (item.before.present && item.after.present && a === b) continue;
    const containers = a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b);
    if (containers) {
      if (item.depth >= limits.depth) { truncate('depth'); break; }
      const keys = Array.isArray(a) ? Array.from({ length: Math.max(a.length, (b as JsonValue[]).length) }, (_, i) => String(i))
        : [...new Set([...Object.keys(a), ...Object.keys(b!)])].sort();
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i];
        stack.push({ path: `${item.path}/${pointer(key)}`, depth: item.depth + 1,
          before: Object.hasOwn(a, key) ? { present: true, value: (a as any)[key] } : { present: false },
          after: Object.hasOwn(b!, key) ? { present: true, value: (b as any)[key] } : { present: false } });
      }
      continue;
    }
    if (result.changes.length >= limits.changes) { truncate('changes'); break; }
    result.changes.push({ path: item.path, kind: !item.before.present ? 'added' : !item.after.present ? 'removed' : 'changed', before: item.before, after: item.after });
  }
  return result;
}
