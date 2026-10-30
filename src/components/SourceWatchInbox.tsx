import {useEffect,useRef,useState} from 'react';
import type {SourceWatchSummary,SourceWatchBatch,SourceWatchProfile} from '../../shared/source_watch';
import type {SourceComparison} from '../../shared/source_history';
import type {CollectionProfile} from '../../shared/collection';
import defaults from '../../config/source-watch-ui.json';
import {automationApi as api,buttonClass,formClass,sectionClass} from '../lib/automation_client';
import text from '../../config/ui/source-watch.json';
import {useUiText} from '../lib/ui_text';
import {configText} from '../lib/config_text';
import {useSourceHistoryText} from '../lib/source_history_text';
import {SourceComparisonView} from './SourceComparisonView';

export function SourceWatchInbox({initialId=''}:{initialId?:string}){
  const [profile,setProfile]=useState<SourceWatchProfile|null>(null),[watches,setWatches]=useState<SourceWatchSummary[]>([]);
  const [collectionProfile,setCollectionProfile]=useState<CollectionProfile|null>(null);
  const [selected,setSelected]=useState(''),[batch,setBatch]=useState<SourceWatchBatch|null>(null),[comparison,setComparison]=useState<SourceComparison|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);const generation=useRef(0),labels=(profile??defaults).labels;
  const {lang,errorText}=useUiText(text),h=useSourceHistoryText();
  /** Watch-profile labels are hashed server configuration (config/source-watch-ui.json); only their display is translated. */
  const L=(key:keyof typeof labels)=>configText(text,lang,'pl',`label_${key.replace(/[A-Z]/g,c=>`_${c.toLowerCase()}`)}`,labels[key]);
  const purpose=(id:string)=>h.purpose(id,collectionProfile?.purposes[id as keyof CollectionProfile['purposes']]?.label);
  async function request<T>(work:()=>Promise<T>,apply:(value:T)=>void){
    const token=++generation.current;setBusy(true);setError(null);
    try{const value=await work();if(token===generation.current)apply(value);}
    catch(e){if(token===generation.current)setError(e);}
    finally{if(token===generation.current)setBusy(false);}
  }
  function refresh(preferred=selected){
    setBatch(null);setComparison(null);
    void request(async()=>{
      const [p,r]=await Promise.all([api<{profile:SourceWatchProfile;collectionProfile:CollectionProfile}>('/api/memory/watches/profile'),api<{watches:SourceWatchSummary[]}>('/api/memory/watches')]);
      const b=r.watches.some(w=>w.id===preferred)?await api<SourceWatchBatch>(`/api/memory/watches/${encodeURIComponent(preferred)}`):null;
      return {p,r,b};
    },({p,r,b})=>{
      setProfile(p.profile);setCollectionProfile(p.collectionProfile);setWatches(r.watches);setSelected(b?.watch.id??'');setBatch(b);
    });
  }
  useEffect(()=>{refresh(initialId);return ()=>{generation.current++;};},[]);
  function open(id:string){
    setSelected(id);setBatch(null);setComparison(null);
    if(!id){generation.current++;setBusy(false);return;}
    void request(()=>api<SourceWatchBatch>(`/api/memory/watches/${encodeURIComponent(id)}`),setBatch);
  }
  function update(kind:'read'|'enabled'){
    if(!batch)return;
    const id=batch.watch.id,body=kind==='read'?{revision:batch.watch.revision,through:batch.through}:{revision:batch.watch.revision,enabled:!batch.watch.enabled};
    setComparison(null);
    void request(async()=>{
      await api(`/api/memory/watches/${encodeURIComponent(id)}/${kind}`,body);
      return Promise.all([api<SourceWatchBatch>(`/api/memory/watches/${encodeURIComponent(id)}`),api<{watches:SourceWatchSummary[]}>('/api/memory/watches')]);
    },([b,r])=>{setBatch(b);setWatches(r.watches);});
  }
  return <section id="source-watch-inbox" className={sectionClass} data-testid="source-watch-inbox" aria-busy={busy}>
    <div className="flex flex-wrap gap-3 items-center justify-between"><h2 className="font-semibold">{L('title')}</h2>
      <button className="underline text-sm" disabled={busy} onClick={()=>refresh()}>{L('refresh')}</button></div>
    <p className="text-sm">{L('introduction')}</p><p className="text-xs text-slate-600">{L('scope')}</p>
    {error!==null&&<p role="alert" className="text-red-800 break-words">{L('error')}: {errorText(error)}</p>}
    {busy&&<p role="status" className="text-sm">{L('loading')}</p>}
    {!watches.length&&!busy&&<p>{L('empty')}</p>}
    {!!watches.length&&<><p className="text-sm">{L('changes')}: {watches.filter(w=>w.enabled).reduce((sum,w)=>sum+w.changesSinceReview,0)}</p>
      <label className="block text-sm">{L('watch')}<select className={formClass} aria-label={L('watch')} value={selected} disabled={busy} onChange={e=>open(e.target.value)}>
        <option value="">{L('choose')}</option>{watches.map(w=><option key={w.id} value={w.id}>{w.substanceName} · {w.context.provider} · {w.context.kind} · {purpose(w.context.collection?.purpose??'unspecified')} · {w.contextHash.slice(0,8)} · {w.changesSinceReview} · {w.enabled?L('active'):L('paused')}</option>)}
      </select></label>
      {selected&&!batch&&!busy&&<button className="underline text-sm" onClick={()=>open(selected)}>{L('openInbox')}</button>}</>}
    {batch&&<div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-center"><b>{batch.watch.substanceName}</b><span>{batch.watch.enabled?L('active'):L('paused')}</span>
        <button className="underline text-sm" disabled={busy} onClick={()=>update('enabled')}>{batch.watch.enabled?L('pause'):L('resume')}</button></div>
      <p className="text-xs">{L('pauseMeaning')}</p>
      <details><summary className="text-sm">{L('details')}</summary><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify({watch:batch.watch,
        profileHash:profile?.contentHash,through:batch.through,latestSequence:batch.latestSequence,hasMore:batch.hasMore},null,2)}</pre></details>
      {batch.watch.enabled&&<>
        <p className="text-sm">{L('changes')}: {batch.changesSinceReview} · {L('checks')}: {batch.checksSinceReview}</p>
        <p className="text-xs">{L('ordering')}</p>
        {!batch.entries.length&&<p>{L('unchanged')}</p>}
        <ol className="space-y-3">{batch.entries.map(entry=><li key={entry.to.sequence} className="border-t pt-3 space-y-2 text-sm">
          <p>{L('from')}: #{entry.from.sequence} · <time>{entry.from.receipt.fetchedAt}</time><br/>{L('to')}: #{entry.to.sequence} · <time>{entry.to.receipt.fetchedAt}</time></p>
          <button className={buttonClass} disabled={busy} onClick={()=>{setComparison(null);void request(()=>api<SourceComparison>(
            `/api/memory/substances/${encodeURIComponent(batch.watch.context.substanceId)}/compare?from=${entry.from.sequence}&to=${entry.to.sequence}&context=${batch.watch.contextHash}`),setComparison);}}>{L('compare')}</button>
        </li>)}</ol>
        {comparison&&<SourceComparisonView comparison={comparison}/>}
        {batch.hasMore&&<p className="text-sm">{L('more')}</p>}
        <p className="text-xs">{L('readMeaning')}</p>
        <button className={buttonClass} disabled={busy||batch.through===batch.watch.reviewedThrough} onClick={()=>update('read')}>{L('markRead')}</button>
      </>}
    </div>}
  </section>;
}
