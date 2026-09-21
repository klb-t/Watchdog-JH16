import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {useAccess} from '../lib/access';
import {automationApi as api,buttonClass,formClass,sectionClass} from '../lib/automation_client';
import {AccessStatus,type SourceAccessOverview,type SourceAccessRow,type SourceAccessProfile,type AccessDecision,type AccessRequestDraft,type AccessRevision,type SourceCandidate,type SourceRequest} from '../../shared/source_access';

function download(name:string,text:string,type='application/json'){
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function SourceAccess(){const access=useAccess();return <Catalog key={access.principalId} editable={access.capabilities.includes('run.create')}/>;}
type Actions={busy:boolean;act:(fn:()=>Promise<unknown>,success?:string)=>Promise<void>};
function Catalog({editable}:{editable:boolean}){
  const [overview,setOverview]=useState<SourceAccessOverview|null>(null),[selected,setSelected]=useState<string|null>(null);
  const [search,setSearch]=useState(''),[family,setFamily]=useState(''),[channel,setChannel]=useState(''),[state,setState]=useState('');
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),epoch=useRef(0),alive=useRef(true);
  const refresh=async()=>{const token=++epoch.current,data=await api<SourceAccessOverview>('/api/source-access');if(alive.current&&token===epoch.current)setOverview(data);};
  useEffect(()=>{alive.current=true;refresh().catch(e=>alive.current&&setError(e.message));return()=>{alive.current=false;epoch.current++;};},[]);
  const act:Actions['act']=async(fn,success='')=>{setBusy(true);setError('');setMessage('');try{await fn();if(alive.current){setMessage(success);await refresh();}}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}};
  if(!overview)return <div className="p-6">{error?<p role="alert">{error}</p>:<p role="status">…</p>}</div>;
  const {profile,stats,rows}=overview,L=profile.labels,row=rows.find(r=>r.source.entry.id===selected);
  const filtered=rows.filter(r=>{const e=r.source.entry;return (!family||e.family===family)&&(!channel||e.channels.includes(channel as any))&&(!state||r.accessState===state)&&`${e.id} ${e.label} ${e.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase());});
  return <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-5" data-testid="source-access-page">
    <header><h1 className="text-2xl font-semibold">{L.title}</h1><p className="mt-2 text-slate-600">{L.intro}</p></header>
    {error&&<p role="alert" className="p-3 bg-red-50 text-red-800 break-words">{error}</p>}{message&&<p role="status" className="text-emerald-800">{message}</p>}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{(['total','implemented','candidates','withData'] as const).map(k=><div key={k} className={sectionClass}><strong className="text-2xl block" data-testid={`source-stat-${k}`}>{stats[k]}</strong><span className="text-sm">{L[k]}</span></div>)}</div>
    <details className={sectionClass}><summary>{L.accessStats}</summary><div className="grid sm:grid-cols-2 gap-2 text-sm">{Object.entries(stats.access).map(([k,v])=><button key={k} className="text-left underline" disabled={busy} onClick={()=>{setState(k);setSelected(null);}}>{profile.states[k as keyof typeof profile.states]}: {v}</button>)}</div><p>{L.documentedApi}: {stats.documentedApi} · {L.unreviewedTerms}: {stats.unreviewedTerms} · {L.drafts}: {stats.drafts}</p></details>
    <p className="text-sm text-slate-600">{L.scopeNote}</p>
    <div className="flex flex-wrap gap-4 text-sm"><button className="underline" disabled={busy} onClick={()=>act(refresh)}>{L.refresh}</button><button className="underline" onClick={()=>download('watchdog-source-access.json',JSON.stringify(overview,null,2))}>{L.export}</button>{editable&&<><Link className="underline" to="/automation">{L.automation}</Link><Link className="underline" to="/research">{L.workshop}</Link></>}</div>
    {row?<><button className="underline" disabled={busy} onClick={()=>setSelected(null)}>{L.close}</button><SourceDetail key={`${row.sourceHash}:${row.access?.id??''}`} row={row} profile={profile} editable={editable} busy={busy} act={act}/></>:<>
      <section className={`${sectionClass} grid sm:grid-cols-2 lg:grid-cols-4 gap-3`}><label>{L.search}<input className={formClass} value={search} onChange={e=>setSearch(e.target.value)}/></label>
        {([[L.family,family,setFamily,profile.families],[L.channel,channel,setChannel,profile.channels],[L.accessFilter,state,setState,profile.states]] as const).map(([label,value,set,options])=><label key={label}>{label}<select className={formClass} value={value} onChange={e=>set(e.target.value)}><option value="">{L.all}</option>{Object.entries(options).map(([id,text])=><option key={id} value={id}>{text}</option>)}</select></label>)}
      </section>
      <div className="grid md:grid-cols-2 gap-3">{filtered.map(r=><article className={sectionClass} key={r.source.entry.id} data-testid={`source-card-${r.source.entry.id}`}><button className="text-lg font-semibold text-indigo-800 underline text-left" disabled={busy} onClick={()=>{setSelected(r.source.entry.id);setMessage('');setError('');}}>{r.source.entry.label}</button><p className="text-sm">{profile.families[r.source.entry.family]} · {r.source.entry.channels.map(c=>profile.channels[c]).join(' · ')}</p><p className="text-sm">{L.integration}: <strong>{profile.acquisition[r.acquisition]}</strong></p><p className="text-sm">{L.access}: {profile.states[r.accessState]}</p><p className="text-xs text-slate-600">{L.requests}: {r.activity.requests} · {L.failed}: {r.activity.failed}</p></article>)}</div>{!filtered.length&&<p>{L.empty}</p>}
      {editable&&<CandidateForm profile={profile} busy={busy} act={act}/>}
    </>}
    <details className={sectionClass}><summary>{L.details}</summary><p className="text-sm">{L.defaultNote}</p><p className="text-sm">{L.llmNote}</p></details>
    <details className={sectionClass}><summary>{L.debug}</summary><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify({profileHash:profile.contentHash,generatedAt:overview.generatedAt,acquisition:stats.acquisition},null,2)}</pre></details>
  </div>;
}
function SourceDetail({row,profile,editable,busy,act}:{row:SourceAccessRow;profile:SourceAccessProfile;editable:boolean}&Actions){
  const L=profile.labels,entry=row.source.entry;
  const [decision,setDecision]=useState<AccessDecision>(row.access?.decision??{status:'unreviewed',scope:'catalog_only',basis:'',reference:'',validUntil:null}),[until,setUntil]=useState(row.access?.decision.validUntil?.slice(0,16)??'');
  const [request,setRequest]=useState<SourceRequest>({purpose:'',data:'',operations:'',retention:'',applicant:'',commercial:'undecided'});
  const [history,setHistory]=useState<{history:AccessRevision[];drafts:AccessRequestDraft[];moreHistory:boolean;moreDrafts:boolean}|null>(null),[historyError,setHistoryError]=useState(''),[revision,setRevision]=useState(0),[draft,setDraft]=useState<AccessRequestDraft|null>(null);
  useEffect(()=>{let active=true;api(`/api/source-access/${entry.id}/history`).then(v=>{if(active)setHistory(v);}).catch(e=>active&&setHistoryError(e.message));return()=>{active=false;};},[entry.id,revision]);
  return <section className={sectionClass} data-testid="source-detail"><h2 className="text-xl font-semibold">{entry.label}</h2><p>{entry.description}</p><a className="underline break-all" href={entry.homepage} target="_blank" rel="noreferrer">{entry.homepage}</a>
    <p>{L.integration}: <b>{profile.acquisition[row.acquisition]}</b> · {profile.states[row.accessState]}</p>{row.source.adapter&&<p className="text-sm">{row.source.adapter.purpose}<br/>{row.source.adapter.license}</p>}
    <div className="grid sm:grid-cols-2 gap-2 text-sm"><p>{L.requests}: {row.activity.requests} · {L.successful}: {row.activity.successful} · {L.failed}: {row.activity.failed}</p><p>{L.lastAttempt}: {row.activity.lastAttempt??L.noDate}<br/>{L.lastSuccess}: {row.activity.lastSuccess??L.noDate}</p></div>{row.activity.lastError&&<p className="text-amber-800">{row.activity.lastError}</p>}
    <h3 className="font-semibold">{L.evidence}</h3>{!entry.evidence.length&&<p className="text-sm">{L.noEvidence}</p>}{entry.evidence.map((e,i)=><article key={i} className="border-l-2 pl-3 text-sm"><a className="underline break-all" href={e.url} target="_blank" rel="noreferrer">{L[e.kind]}</a> · {e.checkedOn?`${L.checked} ${e.checkedOn}`:L.unchecked}<p>{e.note}</p></article>)}
    {editable&&<div className="grid lg:grid-cols-2 gap-5">
      <form onSubmit={e=>{e.preventDefault();void act(()=>api(`/api/source-access/${entry.id}/assessments`,{sourceHash:row.sourceHash,previousId:row.access?.id??null,decision:{...decision,validUntil:until?new Date(`${until}Z`).toISOString():null}}),L.saved);}}><fieldset disabled={busy} className="space-y-3"><legend className="font-semibold">{L.decision}</legend>
        <label className="block">{L.status}<select className={formClass} value={decision.status} onChange={e=>setDecision({...decision,status:e.target.value as AccessDecision['status']})}>{AccessStatus.options.map(s=><option key={s} value={s}>{profile.states[s]}</option>)}</select></label>
        <label className="block">{L.decisionScope}<select className={formClass} value={decision.scope} onChange={e=>setDecision({...decision,scope:e.target.value as AccessDecision['scope']})}><option value="catalog_only">{L.catalog_only}</option>{row.source.adapter?.implemented&&<option value="public_adapter">{L.public_adapter}</option>}</select></label>
        <label className="block">{L.basis}<textarea className={formClass} required minLength={10} maxLength={4000} value={decision.basis} onChange={e=>setDecision({...decision,basis:e.target.value})}/></label><label className="block">{L.reference}<input className={formClass} required maxLength={2000} value={decision.reference} onChange={e=>setDecision({...decision,reference:e.target.value})}/></label>
        <label className="block">{L.validUntil}<input className={formClass} type="datetime-local" value={until} onChange={e=>setUntil(e.target.value)}/></label><p className="text-xs text-slate-600">{L.decisionNote}</p><button className={buttonClass}>{L.save}</button>
      </fieldset></form>
      <form onSubmit={e=>{e.preventDefault();void act(async()=>{const result=await api(`/api/source-access/${entry.id}/drafts`,{sourceHash:row.sourceHash,request});setDraft(result.draft);setRevision(r=>r+1);},L.unsent);}}><fieldset disabled={busy} className="space-y-3"><legend className="font-semibold">{L.draft}</legend><p className="text-sm">{L.draftNote}</p>
        {(['purpose','data','operations','retention','applicant'] as const).map(k=><label key={k} className="block">{L[k]}<textarea className={formClass} required minLength={k==='purpose'?10:k==='applicant'?2:3} maxLength={k==='retention'?1000:k==='applicant'?500:2000} value={request[k]} onChange={e=>setRequest({...request,[k]:e.target.value})}/></label>)}
        <label className="block">{L.commercial}<select className={formClass} value={request.commercial} onChange={e=>setRequest({...request,commercial:e.target.value as SourceRequest['commercial']})}>{Object.entries(profile.commercial).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><button className={buttonClass}>{L.makeDraft}</button>
      </fieldset></form>
    </div>}
    {draft&&<article className="bg-slate-50 p-3 space-y-2"><p>{L.unsent}</p><pre className="whitespace-pre-wrap break-words text-sm">{draft.text}</pre><button className="underline" onClick={()=>download(`source-request-${entry.id}.txt`,draft.text,'text/plain')}>{L.downloadDraft}</button></article>}
    <details><summary>{L.history}</summary>{historyError&&<p role="alert">{historyError}</p>}{history?.history.map(r=><article key={r.id} className="border-t py-2 text-sm break-words"><b>{profile.states[r.decision.status]}</b> · {r.createdAt}<p>{r.decision.basis}</p><p>{r.decision.reference}</p><details><summary>{L.debug}</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(r,null,2)}</pre></details></article>)}
      {history?.drafts.map(d=><article key={d.id} className="border-t py-2 text-sm"><p>{L.unsent} · {d.createdAt}</p><button className="underline" onClick={()=>download(`source-request-${entry.id}-${d.id}.txt`,d.text,'text/plain')}>{L.downloadDraft}</button></article>)}{(history?.moreHistory||history?.moreDrafts)&&<p>{L.olderHistory}</p>}
    </details><details><summary>{L.debug}</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify({sourceHash:row.sourceHash,accessHash:row.access?.contentHash??null,source:row.source},null,2)}</pre></details>
  </section>;
}
function CandidateForm({profile,busy,act}:{profile:SourceAccessProfile}&Actions){
  const L=profile.labels,[candidate,setCandidate]=useState<SourceCandidate>({label:'',homepage:'',family:'community',channels:['manual'],description:''});
  return <details className={sectionClass}><summary>{L.addCandidate}</summary><p className="text-sm">{L.customNote}</p><form onSubmit={e=>{e.preventDefault();void act(async()=>{await api('/api/source-access/candidates',candidate);setCandidate({...candidate,label:'',homepage:'',description:''});},L.added);}}><fieldset disabled={busy} className="space-y-3">
    <label className="block">{L.label}<input className={formClass} required minLength={2} maxLength={160} value={candidate.label} onChange={e=>setCandidate({...candidate,label:e.target.value})}/></label><label className="block">{L.homepage}<input className={formClass} type="url" required maxLength={2000} value={candidate.homepage} onChange={e=>setCandidate({...candidate,homepage:e.target.value})}/></label>
    <label className="block">{L.family}<select className={formClass} value={candidate.family} onChange={e=>setCandidate({...candidate,family:e.target.value as SourceCandidate['family']})}>{Object.entries(profile.families).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
    <fieldset><legend>{L.channel}</legend><div className="flex flex-wrap gap-3">{Object.entries(profile.channels).map(([id,label])=><label key={id}><input type="checkbox" checked={candidate.channels.includes(id as any)} onChange={e=>setCandidate({...candidate,channels:e.target.checked?[...candidate.channels,id as any]:candidate.channels.filter(c=>c!==id)})}/> {label}</label>)}</div></fieldset>
    <label className="block">{L.description}<textarea className={formClass} required minLength={10} maxLength={2000} value={candidate.description} onChange={e=>setCandidate({...candidate,description:e.target.value})}/></label><button className={buttonClass}>{L.add}</button>
  </fieldset></form></details>;
}
