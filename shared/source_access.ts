import {z} from 'zod';

export const SafeSourceUrl = z.string().max(2000).url().refine(value=>{
  const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;
},'Use an HTTPS link without credentials');
export const SourceFamily = z.enum(['chemical','pharmacology','literature','community','drug_checking','institutional','signals','encyclopedia']);
export const SourceChannel = z.enum(['api','rss','download','html','manual']);
export const SourceCandidateSchema = z.object({
  label:z.string().trim().min(2).max(160),family:SourceFamily,homepage:SafeSourceUrl,
  channels:z.array(SourceChannel).min(1).max(5).refine(a=>new Set(a).size===a.length),
  description:z.string().trim().min(10).max(2000),
}).strict();
export type SourceCandidate=z.infer<typeof SourceCandidateSchema>;
export const SourceEntrySchema=SourceCandidateSchema.extend({
  id:z.string().regex(/^[a-z0-9_-]{2,100}$/),
  evidence:z.array(z.object({kind:z.enum(['technical','terms']),channels:z.array(SourceChannel).max(5),url:SafeSourceUrl,checkedOn:z.iso.date().nullable(),note:z.string().min(1).max(2000)}).strict()).max(10),
}).strict();
export type SourceEntry=z.infer<typeof SourceEntrySchema>;
export const AccessStatus=z.enum(['unreviewed','permission_needed','requested','permitted','denied']);
export const AccessDecisionSchema=z.object({
  status:AccessStatus,scope:z.enum(['catalog_only','public_adapter']),
  basis:z.string().trim().min(10).max(4000),reference:z.string().trim().min(1).max(2000),
  validUntil:z.iso.datetime().nullable(),
}).strict();
export type AccessDecision=z.infer<typeof AccessDecisionSchema>;
export interface AccessRevision {
  id:string;sourceId:string;sourceHash:string;source:SourceSnapshot;previousId:string|null;
  decision:AccessDecision;createdAt:string;contentHash:string;
}
export interface SourceSnapshot {
  entry:SourceEntry;
  adapter:null|{id:string;implemented:boolean;keyRequired:boolean;documentation:string;license:string;purpose:string;origin?:string;pathPrefix?:string;minIntervalMs?:number};
}
export type AccessState=z.infer<typeof AccessStatus>|'expired'|'stale';
export type AcquisitionState='profile_default'|'permitted'|'held'|'not_implemented';
export interface SourceActivity {requests:number;successful:number;failed:number;lastAttempt:string|null;lastSuccess:string|null;lastError:string|null}
export interface SourceAccessRow {
  source:SourceSnapshot;sourceHash:string;custom:boolean;access:AccessRevision|null;accessState:AccessState;
  acquisition:AcquisitionState;activity:SourceActivity;draftCount:number;
}
export const SourceRequestSchema=z.object({
  purpose:z.string().trim().min(10).max(2000),data:z.string().trim().min(3).max(2000),
  operations:z.string().trim().min(3).max(2000),retention:z.string().trim().min(3).max(1000),
  applicant:z.string().trim().min(2).max(500),commercial:z.enum(['undecided','noncommercial','commercial']),
}).strict();
export type SourceRequest=z.infer<typeof SourceRequestSchema>;
export interface AccessRequestDraft {
  id:string;sourceId:string;sourceHash:string;source:SourceSnapshot;input:SourceRequest;text:string;
  templateHash:string;createdAt:string;contentHash:string;sent:false;
}
export const SourceAccessProfileSchema=z.object({
  version:z.literal('source-access-1'),labels:z.record(z.string(),z.string().min(1)),
  families:z.record(SourceFamily,z.string()),channels:z.record(SourceChannel,z.string()),
  states:z.record(z.enum([...AccessStatus.options,'expired','stale']),z.string()),
  acquisition:z.record(z.enum(['profile_default','permitted','held','not_implemented']),z.string()),
  commercial:z.record(z.enum(['undecided','noncommercial','commercial']),z.string()),
  requestTemplate:z.string().min(100),limits:z.object({customSources:z.number().int().min(1).max(1000),history:z.number().int().min(1).max(500)}).strict(),
  sources:z.array(SourceEntrySchema).max(1000),
}).strict();
export type SourceAccessProfile=z.infer<typeof SourceAccessProfileSchema>&{contentHash:string};
export interface SourceAccessOverview {
  profile:SourceAccessProfile;rows:SourceAccessRow[];generatedAt:string;
  stats:{total:number;implemented:number;candidates:number;documentedApi:number;unreviewedTerms:number;withData:number;drafts:number;access:Record<AccessState,number>;acquisition:Record<AcquisitionState,number>};
}
export class SourceAccessError extends Error {readonly code='source_access_error';constructor(message:string,readonly status=409){super(message);}}

/** A saved permission is a user's documented assessment, not an inferred supplier grant. */
export function accessState(revision:AccessRevision|null,sourceHash:string,now:Date):AccessState{
  if(!revision)return 'unreviewed';
  if(revision.sourceHash!==sourceHash)return 'stale';
  if(revision.decision.validUntil&&Date.parse(revision.decision.validUntil)<=now.getTime())return 'expired';
  return revision.decision.status;
}
export function acquisitionState(source:SourceSnapshot,revision:AccessRevision|null,state:AccessState):AcquisitionState{
  if(!source.adapter?.implemented)return 'not_implemented';
  if(!revision)return 'profile_default';
  return state==='permitted'&&revision.decision.scope==='public_adapter'?'permitted':'held';
}
