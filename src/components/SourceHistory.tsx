import { useEffect, useRef, useState } from 'react';
import type { SourceComparison, SourceHistoryEntry, SourceHistoryGroup, SourceHistoryPage, SourceHistoryProfile } from '../../shared/source_history';
import defaults from '../../config/source-history-ui.json';
import {SourceComparisonView} from './SourceComparisonView';
import {SourceWatchButton} from './SourceWatchButton';
import type { CollectionProfile } from '../../shared/collection';
import { automationApi as api, buttonClass, formClass, sectionClass } from '../lib/automation_client';

export function SourceHistory({ substanceId,onWatch }: { substanceId: string;onWatch?:(id:string)=>void }) {
  const [profile,setProfile] = useState<SourceHistoryProfile|null>(null);
  const [collectionProfile,setCollectionProfile]=useState<CollectionProfile|null>(null);
  const [groups,setGroups] = useState<SourceHistoryGroup[]>([]), [nextGroup,setNextGroup] = useState<number|null>(null);
  const [selected,setSelected] = useState(''), [history,setHistory] = useState<SourceHistoryPage|null>(null);
  const [from,setFrom] = useState(''), [to,setTo] = useState(''), [comparison,setComparison] = useState<SourceComparison|null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const generation = useRef(0), labels = (profile ?? defaults).labels;
  const base = `/api/memory/substances/${encodeURIComponent(substanceId)}`;
  async function request<T>(work: () => Promise<T>, apply: (result: T) => void) {
    const token = ++generation.current; setBusy(true); setError('');
    try { const result = await work(); if (generation.current === token) apply(result); }
    catch (e) { if (generation.current === token) setError((e as Error).message); }
    finally { if (generation.current === token) setBusy(false); }
  }
  const clearSelection = () => { setSelected(''); setHistory(null); setFrom(''); setTo(''); setComparison(null); };
  function refresh() {
    clearSelection(); setGroups([]); setNextGroup(null);
    void request(() => Promise.all([api<{profile:SourceHistoryProfile;collectionProfile:CollectionProfile}>('/api/memory/history/profile'),api<{groups:SourceHistoryGroup[];nextOffset:number|null}>(`${base}/history`)]), ([p,g]) => {
      setProfile(p.profile); setCollectionProfile(p.collectionProfile); setGroups(g.groups); setNextGroup(g.nextOffset);
    });
  }
  useEffect(() => { refresh(); return () => { generation.current++; }; }, [substanceId]);
  function open(anchor: string) {
    setSelected(anchor); setHistory(null); setFrom(''); setTo(''); setComparison(null);
    if (!anchor) { generation.current++; setBusy(false); return; }
    void request(() => api<SourceHistoryPage>(`${base}/history/${anchor}`), page => {
      setHistory(page); setTo(String(page.entries[0]?.sequence ?? ''));
      const earlier = page.entries.find(e => e.contentHash !== page.entries[0]?.contentHash) ?? page.entries[1];
      setFrom(String(earlier?.sequence ?? ''));
    });
  }
  const group = groups.find(g => String(g.anchor) === selected);
  const label = (entry: SourceHistoryEntry) => `${entry.receipt.fetchedAt} · #${entry.sequence} · ${entry.contentHash.slice(0,12)}`;
  return <section className={sectionClass} data-testid="source-history" aria-busy={busy}>
    <div className="flex flex-wrap gap-3 items-center justify-between"><h2 className="font-semibold">{labels.title}</h2><button className="text-sm underline" disabled={busy} onClick={refresh}>{labels.refresh}</button></div>
    <p className="text-sm">{labels.introduction}</p><p className="text-xs text-slate-600">{labels.coverage}</p>
    {error && <p role="alert" className="text-red-800 break-words">{labels.error}: {error}</p>}
    {busy && <p role="status" className="text-sm">{labels.loading}</p>}
    {!groups.length && !busy && <p>{labels.empty}</p>}
    {!!groups.length && <label className="block text-sm">{labels.source}<select aria-label={labels.source} className={formClass} value={selected} disabled={busy} onChange={e => open(e.target.value)}>
      <option value="">{labels.choose}</option>{groups.map(g => <option key={g.contextHash} value={g.anchor}>{g.context.provider} · {g.context.kind} · {collectionProfile?.purposes[g.context.collection?.purpose??'unspecified'].label} · {g.contextHash.slice(0,8)}</option>)}
    </select></label>}
    {nextGroup !== null && <button className="text-sm underline" disabled={busy} onClick={() => void request(() => api<{groups:SourceHistoryGroup[];nextOffset:number|null}>(`${base}/history?offset=${nextGroup}`), g => {
      setGroups(old => [...new Map([...old,...g.groups].map(item => [item.contextHash,item])).values()]); setNextGroup(g.nextOffset);
    })}>{labels.loadGroups}</button>}
    {group && <div className="space-y-2 text-sm">
      <SourceWatchButton key={group.contextHash} substanceId={substanceId} anchor={group.anchor} contextHash={group.contextHash} disabled={busy} onSubscribed={onWatch}/>
      {collectionProfile&&<p>{collectionProfile.label}: <b>{collectionProfile.purposes[group.context.collection?.purpose??'unspecified'].label}</b></p>}
      <p>{group.observations} {labels.observations} · {group.versions} {labels.versions}</p>
      <p>{labels.firstSeen}: <time>{group.firstObservedAt}</time><br/>{labels.lastChecked}: <time>{group.lastObservedAt}</time></p>
      {group.legacyObservations > 0 && <p className="rounded bg-amber-50 p-2 text-amber-950">{labels.legacy}</p>}
      <details><summary>{labels.context}</summary><a href={group.context.url} className="underline break-all" target="_blank" rel="noreferrer">{group.context.url}</a>
        <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify({contextHash:group.contextHash,...group.context},null,2)}</pre></details>
    </div>}
    {history && profile && <>
      <div className="grid lg:grid-cols-2 gap-3">{(['from','to'] as const).map(side => <label className="block text-sm" key={side}>{side === 'from' ? labels.older : labels.newer}
        <select aria-label={side === 'from' ? labels.older : labels.newer} className={formClass} value={side === 'from' ? from : to} disabled={busy} onChange={e => {
          (side === 'from' ? setFrom : setTo)(e.target.value); setComparison(null);
        }}><option value="">—</option>{history.entries.map(e => <option key={e.sequence} value={e.sequence}>{label(e)}</option>)}</select></label>)}</div>
      <button className={buttonClass} disabled={busy || !from || !to || from === to} onClick={() => { setComparison(null); void request(() => api<SourceComparison>(`${base}/compare?from=${from}&to=${to}&context=${history.contextHash}`),setComparison); }}>{labels.compare}</button>
      {history.entries.length < 2 || from === to ? <p className="text-sm">{labels.sameObservation}</p> : !comparison && <p className="text-sm text-slate-600">{labels.noComparison}</p>}
      {comparison && <SourceComparisonView comparison={comparison}/>}
      <details><summary>{labels.timeline} · {history.entries.length}</summary>
        <ol className="space-y-3 mt-3">{history.entries.map(entry => { const status = profile.transitions[entry.transition]; return <li key={entry.sequence} className="border-t pt-2 text-sm space-y-1">
          <p className="break-words">{label(entry)}</p><p style={{color:status.color}}><span aria-hidden="true">{status.icon}</span> {status.label}</p>
          <p className="text-xs">{entry.versionObservations} {labels.observations}<br/>{labels.versionFirst}: {entry.versionFirstObservedAt}<br/>{labels.versionLast}: {entry.versionLastObservedAt}</p>
          {entry.origin === 'legacy_first_receipt' && <p className="text-xs text-amber-950">{labels.legacy}</p>}
          <a className="underline" href={`/api/memory/receipts/${encodeURIComponent(entry.receipt.id)}/raw`}>{labels.raw}</a>
          <details><summary>{labels.details}</summary><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(entry,null,2)}</pre></details>
        </li>; })}</ol>
      </details>
      {history.nextBefore !== null && <button className="text-sm underline" disabled={busy} onClick={() => void request(() => api<SourceHistoryPage>(`${base}/history/${selected}?before=${history.nextBefore}`), older => {
        setHistory(current => current && current.contextHash === older.contextHash ? {...older,entries:[...current.entries,...older.entries]} : older);
      })}>{labels.loadOlder}</button>}
    </>}
  </section>;
}
