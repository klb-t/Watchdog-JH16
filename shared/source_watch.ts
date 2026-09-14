import {z} from 'zod';
import type {SourceContext,SourceObservation} from './source_history';

export const SOURCE_WATCH_RULE = 'source-record-change-1' as const;
export interface SourceWatch {
  id:string; contextAnchor:number; contextHash:string; context:SourceContext; substanceName:string;
  rule:typeof SOURCE_WATCH_RULE; enabled:boolean; reviewedThrough:number; revision:number;
  createdAt:string; updatedAt:string;
}
export interface SourceWatchBatch {
  watch:SourceWatch; through:number; latestSequence:number; checksSinceReview:number;
  changesSinceReview:number; hasMore:boolean;
  entries:{from:SourceObservation;to:SourceObservation}[];
}
export type SourceWatchSummary=SourceWatch&Pick<SourceWatchBatch,'checksSinceReview'|'changesSinceReview'>;
const labels=z.enum(['title','introduction','scope','ordering','subscribe','subscribed','openInbox',
  'empty','choose','watch','refresh','pause','resume','paused','active','pauseMeaning','changes',
  'checks','unchanged','more','compare','markRead','readMeaning','loading','error','details','from','to']);
export const SourceWatchProfileSchema=z.object({
  version:z.literal('source-watch-ui-1'),rule:z.literal(SOURCE_WATCH_RULE),
  ordering:z.literal('journal_sequence'),labels:z.record(labels,z.string().min(1).max(2000)),
  limits:z.object({watches:z.number().int().min(1).max(1000),changes:z.number().int().min(1).max(100)}).strict(),
}).strict();
export type SourceWatchProfile=z.infer<typeof SourceWatchProfileSchema>&{contentHash:string};
