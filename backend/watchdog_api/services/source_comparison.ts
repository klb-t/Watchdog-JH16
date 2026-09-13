import { z } from 'zod';
import { canonicalHash } from '../domain/canonical';
import { compareJson, SourceHistoryError, SourceHistoryProfileSchema } from '../../../shared/source_history';
import type { SourceComparison } from '../../../shared/source_history';
import {CollectionContextSchema} from '../../../shared/collection';

/** An expected hash supplied separately is the trust anchor; an editable checksum alone is not authenticity. */
export function verifySourceComparison(input: unknown, expectedHash: string): SourceComparison {
  const hash = z.string().regex(/^[a-f0-9]{64}$/), text = z.string().min(1);
  const receipt = z.object({ id:text,provider:text,url:z.url(),fetchedAt:z.iso.datetime(),sha256:hash,httpStatus:z.number().int().min(200).max(299),
    bytes:z.number().int().nonnegative(),adapterVersion:text,jobId:text,license:text,collection:CollectionContextSchema.optional() }).strict();
  const snapshot = z.object({ sequence:z.number().int().positive(),recordId:text,contentHash:hash,origin:z.enum(['recorded','legacy_first_receipt']),receipt,value:z.json() }).strict();
  const shape = z.object({ contentHash:hash,body:z.object({version:z.literal('source-comparison-1'),
    context:z.object({substanceId:text,provider:text,kind:text,url:z.url(),adapterVersion:text,sourceProfileHash:hash,collection:CollectionContextSchema.optional()}).strict(),
    contextHash:hash,profile:SourceHistoryProfileSchema.extend({contentHash:hash}),from:snapshot,to:snapshot,equal:z.boolean(),difference:z.unknown(),
  }).strict() }).strict().parse(input);
  if (shape.contentHash !== hash.parse(expectedHash) || canonicalHash(shape.body) !== expectedHash)
    throw new SourceHistoryError('Comparison hash differs from the expected export');
  const b = shape.body, {contentHash:profileHash,...profile} = b.profile;
  if (canonicalHash(profile) !== profileHash || canonicalHash(b.context) !== b.contextHash)
    throw new SourceHistoryError('Comparison profile or context hash mismatch');
  for (const s of [b.from,b.to]) {
    const valueHash = canonicalHash({id:b.context.substanceId,provider:b.context.provider,kind:b.context.kind,value:s.value});
    if (valueHash !== s.contentHash || s.recordId !== `reference-${valueHash}` || s.receipt.provider !== b.context.provider ||
      s.receipt.url !== b.context.url || s.receipt.adapterVersion !== b.context.adapterVersion || canonicalHash(s.receipt.collection??null)!==canonicalHash(b.context.collection??null))
      throw new SourceHistoryError('Snapshot identity or source context mismatch');
  }
  if (b.from.sequence === b.to.sequence || b.equal !== (b.from.contentHash === b.to.contentHash) ||
    canonicalHash(b.difference) !== canonicalHash(compareJson(b.from.value,b.to.value,b.profile.limits)))
    throw new SourceHistoryError('Stored differences do not reproduce from the snapshots');
  return shape as SourceComparison;
}
