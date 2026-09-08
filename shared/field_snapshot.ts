import { z } from 'zod';
import { canonicalJson } from './canonical_json';
import { validateFieldProfile, validateReferenceDocument, ReferenceDocumentSchema } from './field_validation';
import type { FieldSnapshot } from './field';

export async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const snapshotShape = z.object({ version: z.literal('field-snapshot-1'), generatedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(), principalId: z.string().min(1), profile: z.unknown(),
  records: z.array(z.object({ id: z.string().min(1), document: ReferenceDocumentSchema,
    contentHash: hash, approvedHash: hash, approvedBy: z.string().min(1), approvedAt: z.iso.datetime(),
    approvalState: z.literal('APPROVED'), importedAt: z.iso.datetime(), rawSha256: hash }).strict()).max(10000),
}).strict();
/** Integrity and local authorization-window check, not a signature or proof of publisher truth.
 * Revocation can only be learned on reconnect; the explicit expiry bounds that delay. */
export async function verifySnapshot(input: unknown, expectedHash: string, principalId: string, now = Date.now()): Promise<FieldSnapshot> {
  snapshotShape.parse(input);
  const snapshot = input as FieldSnapshot;
  validateFieldProfile(snapshot.profile);
  if (snapshot.principalId !== principalId || await digest(snapshot) !== expectedHash) throw new Error('Offline snapshot identity or integrity mismatch.');
  const created = Date.parse(snapshot.generatedAt), expires = Date.parse(snapshot.expiresAt);
  if (created > now + 60_000 || expires <= now || expires <= created || expires - created > snapshot.profile.offlineMaxHours * 3_600_000)
    throw new Error('Offline snapshot expired or its clock window is invalid. Reconnect to synchronize.');
  if (new Set(snapshot.records.map(r => r.id)).size !== snapshot.records.length) throw new Error('Duplicate snapshot records.');
  for (const record of snapshot.records) {
    validateReferenceDocument(record.document);
    if (await digest(record.document) !== record.contentHash || record.approvedHash !== record.contentHash)
      throw new Error('A cached reference changed after approval. Reconnect to synchronize.');
  }
  return snapshot;
}
