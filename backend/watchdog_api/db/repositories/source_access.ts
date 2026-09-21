import type {Database} from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {canonicalHash} from '../../domain/canonical';
import {AuditRepository} from './audit';
import {AccessDecisionSchema,SourceCandidateSchema,SourceAccessError,type AccessRevision,type AccessRequestDraft,
  type SourceSnapshot,type SourceEntry,type SourceActivity,type SourceRequest} from '../../../../shared/source_access';

export class SourceAccessRepository {
  constructor(private readonly db:Database){}
  private decode<T>(row:any):T{
    const body=JSON.parse(row.body_json);
    if(canonicalHash(body)!==row.content_hash)throw new SourceAccessError('Source access record integrity mismatch');
    return {...body,contentHash:row.content_hash};
  }
  candidates(owner:string):SourceEntry[]{
    return this.db.prepare('SELECT * FROM source_candidates WHERE owner_principal_id=? ORDER BY id').all(owner).map(row=>{
      const {contentHash,...body}=this.decode<SourceEntry&{contentHash:string}>(row);return body;
    });
  }
  addCandidate(owner:string,input:unknown,limit:number):SourceEntry{
    const candidate=SourceCandidateSchema.parse(input);
    return this.db.transaction(()=>{
      if(this.candidates(owner).length>=limit)throw new SourceAccessError('Private source limit reached');
      const entry:SourceEntry={...candidate,id:`custom-${randomUUID()}`,evidence:[]},hash=canonicalHash(entry);
      this.db.prepare('INSERT INTO source_candidates VALUES (?,?,?,?,?)').run(entry.id,owner,JSON.stringify(entry),hash,new Date().toISOString());
      new AuditRepository(this.db).append(owner,'source_access.candidate','source_access',entry.id,'source-access',{hash});
      return entry;
    }).immediate();
  }
  latest(owner:string,sourceId:string):AccessRevision|null{
    const row=this.db.prepare('SELECT * FROM source_access_revisions WHERE owner_principal_id=? AND source_id=? ORDER BY sequence DESC LIMIT 1').get(owner,sourceId);
    return row?this.decode(row):null;
  }
  history(owner:string,sourceId:string,limit:number){
    const history=this.db.prepare('SELECT * FROM source_access_revisions WHERE owner_principal_id=? AND source_id=? ORDER BY sequence DESC LIMIT ?').all(owner,sourceId,limit+1);
    const drafts=this.db.prepare('SELECT * FROM source_access_drafts WHERE owner_principal_id=? AND source_id=? ORDER BY created_at DESC,id DESC LIMIT ?').all(owner,sourceId,limit+1);
    return {history:history.slice(0,limit).map(r=>this.decode<AccessRevision>(r)),drafts:drafts.slice(0,limit).map(r=>this.decode<AccessRequestDraft>(r)),moreHistory:history.length>limit,moreDrafts:drafts.length>limit};
  }
  decide(owner:string,source:SourceSnapshot,expectedSourceHash:string,previousId:string|null,input:unknown,now=new Date()):AccessRevision{
    const decision=AccessDecisionSchema.parse(input),sourceHash=canonicalHash(source);
    if(sourceHash!==expectedSourceHash)throw new SourceAccessError('Source profile changed; reload before recording access');
    if(decision.scope==='public_adapter'&&!source.adapter?.implemented)throw new SourceAccessError('There is no implemented public adapter for this scope');
    if(decision.validUntil&&Date.parse(decision.validUntil)<=now.getTime())throw new SourceAccessError('Validity must end in the future');
    return this.db.transaction(()=>{
      if((this.latest(owner,source.entry.id)?.id??null)!==previousId)throw new SourceAccessError('Access assessment changed; reload before recording');
      const body={id:randomUUID(),sourceId:source.entry.id,sourceHash,source,previousId,decision,createdAt:now.toISOString()},contentHash=canonicalHash(body);
      this.db.prepare('INSERT INTO source_access_revisions(id,owner_principal_id,source_id,previous_id,body_json,content_hash,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(body.id,owner,body.sourceId,previousId,JSON.stringify(body),contentHash,body.createdAt);
      new AuditRepository(this.db).append(owner,'source_access.assess','source_access',body.id,'source-access',{sourceId:body.sourceId,sourceHash,contentHash,previousId,status:decision.status,scope:decision.scope});
      return {...body,contentHash};
    }).immediate();
  }
  saveDraft(owner:string,source:SourceSnapshot,input:SourceRequest,text:string,templateHash:string):AccessRequestDraft{
    return this.db.transaction(()=>{
      const body={id:randomUUID(),sourceId:source.entry.id,sourceHash:canonicalHash(source),source,input,text,templateHash,createdAt:new Date().toISOString(),sent:false as const},contentHash=canonicalHash(body);
      this.db.prepare('INSERT INTO source_access_drafts VALUES (?,?,?,?,?,?)').run(body.id,owner,body.sourceId,JSON.stringify(body),contentHash,body.createdAt);
      new AuditRepository(this.db).append(owner,'source_access.draft','source_access',body.id,'source-access',{sourceId:body.sourceId,sourceHash:body.sourceHash,contentHash,sent:false});
      return {...body,contentHash};
    }).immediate();
  }
  draftCounts(owner:string):Record<string,number>{
    return Object.fromEntries((this.db.prepare('SELECT source_id,COUNT(*) AS n FROM source_access_drafts WHERE owner_principal_id=? GROUP BY source_id ORDER BY source_id').all(owner) as any[]).map(r=>[r.source_id,r.n]));
  }
  activity(owner:string):Record<string,SourceActivity>{
    const rows=this.db.prepare(`SELECT f.provider,COUNT(*) AS requests,
      SUM(CASE WHEN f.http_status BETWEEN 200 AND 299 AND f.raw_blob_id IS NOT NULL AND f.error_code IS NULL THEN 1 ELSE 0 END) AS successful,
      MAX(f.fetched_at) AS last_attempt,
      MAX(CASE WHEN f.http_status BETWEEN 200 AND 299 AND f.raw_blob_id IS NOT NULL AND f.error_code IS NULL THEN f.fetched_at ELSE NULL END) AS last_success
      FROM public_fetch_receipts f JOIN automation_jobs j ON j.id=f.job_id WHERE j.owner_principal_id=? GROUP BY f.provider ORDER BY f.provider`).all(owner) as any[];
    const latest=this.db.prepare(`SELECT f.error_code FROM public_fetch_receipts f JOIN automation_jobs j ON j.id=f.job_id
      WHERE j.owner_principal_id=? AND f.provider=? ORDER BY f.fetched_at DESC,f.rowid DESC LIMIT 1`);
    return Object.fromEntries(rows.map(r=>[r.provider,{requests:r.requests,successful:r.successful,failed:r.requests-r.successful,
      lastAttempt:r.last_attempt,lastSuccess:r.last_success,lastError:(latest.get(owner,r.provider) as any)?.error_code??null}]));
  }
  jobOwner(jobId:string):string{
    const row=this.db.prepare('SELECT owner_principal_id FROM automation_jobs WHERE id=?').get(jobId) as any;
    if(!row)throw new SourceAccessError('Job not found',404);return row.owner_principal_id;
  }
}
