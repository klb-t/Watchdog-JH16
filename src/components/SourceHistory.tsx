import { useEffect, useRef, useState } from 'react';
import type { SourceComparison, SourceHistoryEntry, SourceHistoryGroup, SourceHistoryPage, SourceHistoryProfile } from '../../shared/source_history';
import defaults from '../../config/source-history-ui.json';
import {SourceComparisonView} from './SourceComparisonView';
import {SourceWatchButton} from './SourceWatchButton';
import type { CollectionProfile } from '../../shared/collection';
import { automationApi as api, buttonClass, formClass, sectionClass } from '../lib/automation_client';
import { useSourceHistoryText } from '../lib/source_history_text';

export function SourceHistory({ substanceId,onWatch }: { substanceId: string;onWatch?:(id:string)=>void }) {
  const [profile,setProfile] = useState<SourceHistoryProfile|null>(null);
  const [collectionProfile,setCollectionProfile]=useState<CollectionProfile|null>(null);
  const [groups,setGroups] = useState<SourceHistoryGroup[]>([]), [nextGroup,setNextGroup] = useState<number|null>(null);
  const [selected,setSelected] = useState(''), [history,setHistory] = useState<SourceHistoryPage|null>(null);
  const [from,setFrom] = useState(''), [to,setTo] = useState(''), [comparison,setComparison] = useState<SourceComparison|null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState<unknown>(null);
  const generation = useRef(0), labels = (profile ?? defaults).labels;
  const h = useSourceHistoryText(), L = (key: keyof typeof labels) => h.label(key, labels[key]);
  const purpose = (id: string) => h.purpose(id, collectionProfile?.purposes[id as keyof CollectionProfile['purposes']]?.label);
  const base = `/api/memory/substances/${encodeURIComponent(substanceId)}`;
  async function request<T>(work: () => Promise<T>, apply: (result: T) => void) {
    const token = ++generation.current; setBusy(true); setError(null);
    try { const result = await work(); if (generation.current === token) apply(result); }
    catch (e) { if (generation.current === token) setError(e); }
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
    <div className="flex flex-wrap gap-3 items-center justify-between"><h2 className="font-semibold">{L('title')}</h2><button className="text-sm underline" disabled={busy} onClick={refresh}>{L('refresh')}</button></div>
    <p className="text-sm">{L('introduction')}</p><p className="text-xs text-slate-600">{L('coverage')}</p>
    {error !== null && <p role="alert" className="text-red-800 break-words">{L('error')}: {h.errorText(error)}</p>}
    {busy && <p role="status" className="text-sm">{L('loading')}</p>}
    {!groups.length && !busy && <p>{L('empty')}</p>}
    {!!groups.length && <label className="block text-sm">{L('source')}<select aria-label={L('source')} className={formClass} value={selected} disabled={busy} onChange={e => open(e.target.value)}>
      <option value="">{L('choose')}</option>{groups.map(g => <option key={g.contextHash} value={g.anchor}>{g.context.provider} · {g.context.kind} · {purpose(g.context.collection?.purpose??'unspecified')} · {g.contextHash.slice(0,8)}</option>)}
    </select></label>}
    {nextGroup !== null && <button className="text-sm underline" disabled={busy} onClick={() => void request(() => api<{groups:SourceHistoryGroup[];nextOffset:number|null}>(`${base}/history?offset=${nextGroup}`), g => {
      setGroups(old => [...new Map([...old,...g.groups].map(item => [item.contextHash,item])).values()]); setNextGroup(g.nextOffset);
    })}>{L('loadGroups')}</button>}
    {group && <div className="space-y-2 text-sm">
      <SourceWatchButton key={group.contextHash} substanceId={substanceId} anchor={group.anchor} contextHash={group.contextHash} disabled={busy} onSubscribed={onWatch}/>
      {collectionProfile&&<p>{h.collectionLabel(collectionProfile.label)}: <b>{purpose(group.context.collection?.purpose??'unspecified')}</b></p>}
      <p>{group.observations} {L('observations')} · {group.versions} {L('versions')}</p>
      <p>{L('firstSeen')}: <time>{group.firstObservedAt}</time><br/>{L('lastChecked')}: <time>{group.lastObservedAt}</time></p>
      {group.legacyObservations > 0 && <p className="rounded bg-amber-50 p-2 text-amber-950">{L('legacy')}</p>}
      <details><summary>{L('context')}</summary><a href={group.context.url} className="underline break-all" target="_blank" rel="noreferrer">{group.context.url}</a>
        <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify({contextHash:group.contextHash,...group.context},null,2)}</pre></details>
    </div>}
    {history && profile && <>
      <div className="grid lg:grid-cols-2 gap-3">{(['from','to'] as const).map(side => <label className="block text-sm" key={side}>{side === 'from' ? L('older') : L('newer')}
        <select aria-label={side === 'from' ? L('older') : L('newer')} className={formClass} value={side === 'from' ? from : to} disabled={busy} onChange={e => {
          (side === 'from' ? setFrom : setTo)(e.target.value); setComparison(null);
        }}><option value="">—</option>{history.entries.map(e => <option key={e.sequence} value={e.sequence}>{label(e)}</option>)}</select></label>)}</div>
      <button className={buttonClass} disabled={busy || !from || !to || from === to} onClick={() => { setComparison(null); void request(() => api<SourceComparison>(`${base}/compare?from=${from}&to=${to}&context=${history.contextHash}`),setComparison); }}>{L('compare')}</button>
      {history.entries.length < 2 || from === to ? <p className="text-sm">{L('sameObservation')}</p> : !comparison && <p className="text-sm text-slate-600">{L('noComparison')}</p>}
      {comparison && <SourceComparisonView comparison={comparison}/>}
      <details><summary>{L('timeline')} · {history.entries.length}</summary>
        <ol className="space-y-3 mt-3">{history.entries.map(entry => { const status = profile.transitions[entry.transition]; return <li key={entry.sequence} className="border-t pt-2 text-sm space-y-1">
          <p className="break-words">{label(entry)}</p><p style={{color:status.color}}><span aria-hidden="true">{status.icon}</span> {h.transition(entry.transition, status.label)}</p>
          <p className="text-xs">{entry.versionObservations} {L('observations')}<br/>{L('versionFirst')}: {entry.versionFirstObservedAt}<br/>{L('versionLast')}: {entry.versionLastObservedAt}</p>
          {entry.origin === 'legacy_first_receipt' && <p className="text-xs text-amber-950">{L('legacy')}</p>}
          <a className="underline" href={`/api/memory/receipts/${encodeURIComponent(entry.receipt.id)}/raw`}>{L('raw')}</a>
          <details><summary>{L('details')}</summary><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(entry,null,2)}</pre></details>
        </li>; })}</ol>
      </details>
      {history.nextBefore !== null && <button className="text-sm underline" disabled={busy} onClick={() => void request(() => api<SourceHistoryPage>(`${base}/history/${selected}?before=${history.nextBefore}`), older => {
        setHistory(current => current && current.contextHash === older.contextHash ? {...older,entries:[...current.entries,...older.entries]} : older);
      })}>{L('loadOlder')}</button>}
    </>}
  </section>;
}
