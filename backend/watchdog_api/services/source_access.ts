import {canonicalHash} from '../domain/canonical';
import {sourceSnapshot} from '../config/source_access';
import type {AutomationProfile} from '../config/automation';
import {SourceAccessRepository} from '../db/repositories/source_access';
import {accessState,acquisitionState,SourceAccessError,SourceRequestSchema,type SourceAccessProfile,type SourceAccessOverview,type SourceAccessRow} from '../../../shared/source_access';

export class SourceAccessService{
  constructor(readonly repo:SourceAccessRepository,readonly profile:SourceAccessProfile,readonly automation:AutomationProfile){
    if(automation.sources.some(s=>!profile.sources.some(entry=>entry.id===s.id)))throw new SourceAccessError('A runtime source is missing from the access catalog');
  }
  private entries(owner:string){return [...this.profile.sources,...this.repo.candidates(owner)].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);}
  snapshot(owner:string,id:string){
    const entry=this.entries(owner).find(s=>s.id===id);if(!entry)throw new SourceAccessError('Source not found',404);
    return sourceSnapshot(entry,this.automation);
  }
  overview(owner:string,now=new Date()):SourceAccessOverview{
    const activity=this.repo.activity(owner),drafts=this.repo.draftCounts(owner);
    const rows:SourceAccessRow[]=this.entries(owner).map(entry=>{
      const source=sourceSnapshot(entry,this.automation),sourceHash=canonicalHash(source),access=this.repo.latest(owner,entry.id),state=accessState(access,sourceHash,now);
      return {source,sourceHash,custom:entry.id.startsWith('custom-'),access,accessState:state,acquisition:acquisitionState(source,access,state),
        activity:activity[entry.id]??{requests:0,successful:0,failed:0,lastAttempt:null,lastSuccess:null,lastError:null},draftCount:drafts[entry.id]??0};
    });
    const stats:SourceAccessOverview['stats']={total:rows.length,implemented:0,candidates:0,documentedApi:0,unreviewedTerms:0,withData:0,drafts:0,
      access:{unreviewed:0,permission_needed:0,requested:0,permitted:0,denied:0,expired:0,stale:0},acquisition:{profile_default:0,permitted:0,held:0,not_implemented:0}};
    for(const row of rows){
      row.source.adapter?.implemented?stats.implemented++:stats.candidates++;
      if(row.source.entry.channels.includes('api')&&row.source.entry.evidence.some(e=>e.kind==='technical'&&e.checkedOn&&e.channels.includes('api')))stats.documentedApi++;
      if(!row.source.entry.evidence.some(e=>e.kind==='terms'&&e.checkedOn))stats.unreviewedTerms++;
      if(row.activity.successful>0)stats.withData++;
      stats.drafts+=row.draftCount;stats.access[row.accessState]++;stats.acquisition[row.acquisition]++;
    }
    return {profile:this.profile,rows,stats,generatedAt:now.toISOString()};
  }
  draft(owner:string,id:string,expectedHash:string,input:unknown){
    const source=this.snapshot(owner,id);if(canonicalHash(source)!==expectedHash)throw new SourceAccessError('Source profile changed; reload before drafting');
    const parsed=SourceRequestSchema.parse(input),fields:Record<string,string>={...parsed,source:source.entry.label,homepage:source.entry.homepage,commercial:this.profile.commercial[parsed.commercial]};
    const text=this.profile.requestTemplate.replace(/\{([a-zA-Z]+)\}/g,(_all,key:string)=>{
      if(!(key in fields))throw new SourceAccessError('Request template has an unknown field');return fields[key];
    });
    return this.repo.saveDraft(owner,source,parsed,text,canonicalHash({template:this.profile.requestTemplate,commercial:this.profile.commercial}));
  }
  /** Existing public defaults survive upgrade; a saved owner assessment can restrict, never invent an adapter. */
  assertAcquisition(owner:string,id:string,now=new Date()){
    const revision=this.repo.latest(owner,id);
    if(!revision)return;
    const source=this.snapshot(owner,id),state=accessState(revision,canonicalHash(source),now);
    if(acquisitionState(source,revision,state)!=='permitted')throw new SourceAccessError(`SOURCE_ACCESS_HELD:${id}:${state}`);
  }
}
