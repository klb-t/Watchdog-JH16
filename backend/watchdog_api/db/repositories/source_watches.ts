import type {Database} from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {SOURCE_WATCH_RULE,type SourceWatch,type SourceWatchBatch} from '../../../../shared/source_watch';
import {SourceHistoryError} from '../../../../shared/source_history';
import {ReferenceHistoryRepository} from './reference_history';
import {AuditRepository} from './audit';

export class SourceWatchRepository {
  constructor(private readonly db:Database,private readonly history:ReferenceHistoryRepository){}
  private decode(row:any):SourceWatch{
    const reference=this.db.prepare(`SELECT r.substance_id,s.canonical_name FROM substance_reference_observations o
      JOIN substance_reference_records r ON r.id=o.record_id JOIN substances s ON s.id=r.substance_id WHERE o.sequence=?`).get(row.context_anchor) as any;
    if(!reference)throw new SourceHistoryError('Watched source is unavailable');
    const {context,contextHash}=this.history.contextAt(reference.substance_id,row.context_anchor);
    if(contextHash!==row.context_hash||row.rule!==SOURCE_WATCH_RULE)throw new SourceHistoryError('Source watch identity mismatch');
    return {id:row.id,contextAnchor:row.context_anchor,contextHash,context,substanceName:reference.canonical_name,
      rule:row.rule,enabled:!!row.enabled,reviewedThrough:row.reviewed_through,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at};
  }
  get(owner:string,id:string):SourceWatch{
    const row=this.db.prepare('SELECT * FROM source_watches WHERE id=? AND owner_principal_id=?').get(id,owner);
    if(!row)throw new SourceHistoryError('Source watch not found',404);return this.decode(row);
  }
  list(owner:string):SourceWatch[]{
    return this.db.prepare('SELECT * FROM source_watches WHERE owner_principal_id=? ORDER BY created_at,id').all(owner).map(row=>this.decode(row));
  }
  summaries(owner:string){
    return this.db.transaction(()=>this.list(owner).map(watch=>{
      const counts=this.history.changes(watch.context.substanceId,watch.contextAnchor,watch.reviewedThrough,1);
      return {...watch,checksSinceReview:counts.checksSinceReview,changesSinceReview:counts.changesSinceReview};
    }))();
  }
  subscribe(owner:string,substanceId:string,anchor:number,expectedContextHash:string,maxWatches:number):SourceWatch{
    return this.db.transaction(()=>{
      const {contextHash}=this.history.contextAt(substanceId,anchor);
      if(contextHash!==expectedContextHash)throw new SourceHistoryError('Source context changed; reload before watching');
      const existing=this.db.prepare('SELECT * FROM source_watches WHERE owner_principal_id=? AND context_hash=? ORDER BY created_at,id LIMIT 1').get(owner,contextHash);
      if(existing)return this.decode(existing);
      const count=this.db.prepare('SELECT COUNT(*) AS n FROM source_watches WHERE owner_principal_id=?').get(owner) as any;
      if(count.n>=maxWatches)throw new SourceHistoryError('Source watch limit reached');
      const through=this.history.changes(substanceId,anchor,anchor,1).latestSequence,id=randomUUID(),now=new Date().toISOString();
      this.db.prepare('INSERT INTO source_watches VALUES (?,?,?,?,?,1,?,1,?,?)').run(id,owner,anchor,contextHash,SOURCE_WATCH_RULE,through,now,now);
      new AuditRepository(this.db).append(owner,'source_watch.subscribe','source_watch',id,'source-watch',{contextHash,through,rule:SOURCE_WATCH_RULE});
      return this.get(owner,id);
    }).immediate();
  }
  batch(owner:string,id:string,limit:number):SourceWatchBatch{
    return this.db.transaction(()=>{
      const watch=this.get(owner,id);
      return {watch,...this.history.changes(watch.context.substanceId,watch.contextAnchor,watch.reviewedThrough,limit)};
    })();
  }
  update(owner:string,id:string,input:{revision:number;enabled?:boolean;through?:number}):SourceWatch{
    return this.db.transaction(()=>{
      const watch=this.get(owner,id);
      if(input.revision!==watch.revision)throw new SourceHistoryError('Source watch changed; reload before saving');
      const through=input.through??watch.reviewedThrough;
      if(!Number.isSafeInteger(through)||through<watch.reviewedThrough)throw new SourceHistoryError('Reading cursor cannot move backward');
      if(this.history.contextAt(watch.context.substanceId,through).contextHash!==watch.contextHash)throw new SourceHistoryError('Reading cursor belongs to a different source context');
      if(!watch.enabled&&input.through!==undefined)throw new SourceHistoryError('Resume the source watch before marking it read');
      this.db.prepare('UPDATE source_watches SET enabled=?,reviewed_through=?,revision=revision+1,updated_at=? WHERE id=? AND owner_principal_id=?')
        .run(Number(input.enabled??watch.enabled),through,new Date().toISOString(),id,owner);
      new AuditRepository(this.db).append(owner,input.through===undefined?'source_watch.toggle':'source_watch.read','source_watch',id,'source-watch',
        {contextHash:watch.contextHash,previousRevision:watch.revision,previousThrough:watch.reviewedThrough,through,enabled:input.enabled??watch.enabled});
      return this.get(owner,id);
    }).immediate();
  }
}
