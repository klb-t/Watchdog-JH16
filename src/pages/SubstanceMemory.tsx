import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { MemorySubstance } from '../../shared/automation';
import { automationApi as api, formClass, sectionClass } from '../lib/automation_client';
import { useAccess } from '../lib/access';
import { SourceHistory } from '../components/SourceHistory';
import { SourceWatchInbox } from '../components/SourceWatchInbox';
import text from '../../config/ui/substance-memory.json';
import { useUiText } from '../lib/ui_text';
export function SubstanceMemory() {
  const [params] = useSearchParams(), requestedSubstance = params.get('substance');
  const { t, errorText } = useUiText(text);
  const access = useAccess(), [query, setQuery] = useState(''), [list, setList] = useState<{id: string; name: string}[]>([]);
  const [selected, setSelected] = useState<MemorySubstance | null>(null), [error, setError] = useState<unknown>(null);
  const selectionRequest = useRef(0);
  const [watchFocus,setWatchFocus]=useState({id:'',version:0});
  const [target, setTarget] = useState(params.get('target') ?? ''), [measure, setMeasure] = useState('all'), [human, setHuman] = useState(false), [limit, setLimit] = useState(100);
  useEffect(() => { setTarget(params.get('target') ?? ''); }, [params.get('target')]);
  useEffect(() => { let active = true; selectionRequest.current++; setSelected(null); setList([]);
    const timer = setTimeout(() => api(`/api/memory/substances?q=${encodeURIComponent(query)}`).then(r => { if (active) setList(r.substances); }).catch(e => active && setError(e)), 200);
    return () => { active = false; selectionRequest.current++; clearTimeout(timer); };
  }, [query, access.principalId]);
  const open = async (id: string) => { const request = ++selectionRequest.current; setError(null); setSelected(null);
    try { const result = await api(`/api/memory/substances/${encodeURIComponent(id)}`); if (selectionRequest.current === request) { setSelected(result.substance); setLimit(100); } }
    catch (e) { if (selectionRequest.current === request) setError(e); } };
  useEffect(() => {
    if (!requestedSubstance || !access.principalId) return;
    void open(requestedSubstance);
    return () => { selectionRequest.current++; };
  }, [requestedSubstance, access.principalId]);
  const activities = selected?.activities.filter(a => (measure === 'all' || a.value.measure === measure) && (!human || a.value.organism === 'Homo sapiens') &&
    `${a.value.targetName} ${a.value.targetId} ${a.value.assayDescription}`.toLowerCase().includes(target.toLowerCase())) ?? [];
  return <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-5 min-w-0" data-testid="substance-memory-page">
    <header><h1 className="text-2xl font-semibold break-words">{t('title')}</h1><p className="mt-2">{t('intro')}</p>
      <p className="mt-2 text-sm text-amber-900">{t('receptor_caution')}</p></header>
    {error !== null && <p role="alert" className="text-red-800 break-words">{errorText(error)}</p>}
    <SourceWatchInbox key={`${access.principalId}:${watchFocus.version}`} initialId={watchFocus.id}/>
    <div className="grid md:grid-cols-[minmax(180px,260px)_minmax(0,1fr)] gap-4">
      <section className={sectionClass}><label className="block">{t('search_label')}<input className={formClass} value={query} onChange={e => setQuery(e.target.value)} /></label>
        {!list.length && <p className="text-sm">{t('no_records')} <Link className="underline" to="/automation">{t('fetch_link')}</Link>.</p>}
        <div className="max-h-96 overflow-auto space-y-1">{list.map(s => <button key={s.id} className={`block text-left w-full rounded p-2 text-sm break-words ${selected?.id === s.id ? 'bg-indigo-100' : 'hover:bg-slate-100'}`} onClick={() => open(s.id)}>{s.name}<span className="block text-xs text-slate-500">{s.id}</span></button>)}</div>
      </section>
      <div className="min-w-0 space-y-4">{selected ? <>
        <section className={sectionClass}><h2 className="font-semibold text-xl break-words">{selected.name}</h2>
          <dl className="text-sm break-all">{selected.identifiers.map(i => <div key={`${i.namespace}:${i.value}`}><dt className="inline font-semibold">{i.namespace}: </dt><dd className="inline">{i.value}</dd></div>)}</dl>
          <details><summary>{t('names_languages', { count: selected.aliases.length })}</summary><p className="text-xs">{t('name_language_note')}</p><div className="flex flex-wrap gap-2 mt-2">{selected.aliases.map(a => <span className="text-xs bg-slate-100 rounded p-1 break-words" key={`${a.name}:${a.language}:${a.source}`}>{a.name} [{a.language ?? t('language_missing')}]</span>)}</div></details>
        </section>
        <section className={sectionClass}><h2 className="font-semibold">{t('measurements_heading')}</h2>
          <div className="grid sm:grid-cols-3 gap-2"><label>{t('target_filter')}<input className={formClass} value={target} onChange={e => setTarget(e.target.value)} /></label><label>{t('measure')}<select className={formClass} value={measure} onChange={e => setMeasure(e.target.value)}>{['all', 'Ki', 'Kd', 'IC50', 'EC50'].map(m => <option key={m} value={m}>{m === 'all' ? t('measure_all') : m}</option>)}</select></label><label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={human} onChange={e => setHuman(e.target.checked)} />{t('human_only')}</label></div>
          <p className="text-xs text-slate-600">{t('measurements_note', { count: activities.length })}</p>
          {!activities.length && <p>{t('no_measurements')}</p>}
          {activities.slice(0, limit).map(a => <article className="border-t pt-3 space-y-1 text-sm" key={a.id}>
            <div className="flex flex-wrap gap-2"><b className="break-words">{a.value.targetName ?? a.value.targetId}</b><span>{a.value.measure} {a.value.relation ?? '?'} {a.value.value ?? t('value_missing')} {a.value.unit ?? t('unit_missing')}</span></div>
            <p className="break-words">{a.value.organism ?? t('organism_missing')} · {a.value.assayId} · {a.value.targetId}</p>
            <div className="flex flex-wrap gap-2"><span className="rounded bg-blue-100 text-blue-900 px-2">{t('activity_tier')}</span><span className="rounded bg-amber-100 text-amber-950 px-2">{a.approvalState}</span></div>
            <p className="break-words">{a.value.assayDescription}</p><details><summary>{t('conditions')}</summary><p className="break-words">{a.value.flags.join(' · ')}</p><p>{a.value.journal} {a.value.year} · {a.value.documentId}</p>
              <p><a className="underline" href={a.citation.sourceUrl} target="_blank" rel="noreferrer">{t('chembl_source')}</a> · <a className="underline" href={`/api/memory/receipts/${a.citation.receiptId}/raw`}>{t('saved_response')}</a></p>
              <pre className="text-xs whitespace-pre-wrap break-all bg-slate-50 p-2">{JSON.stringify(a.value, null, 2)}</pre></details>
          </article>)}
          {activities.length > limit && <button className="underline" onClick={() => setLimit(n => n + 100)}>{t('show_more')}</button>}
        </section>
        <SourceHistory key={`${access.principalId}:${selected.id}`} substanceId={selected.id} onWatch={id=>setWatchFocus(v=>({id,version:v.version+1}))}/>
        <section className={sectionClass}><h2 className="font-semibold">{t('records_heading')}</h2>
          {selected.records.map(r => <details className="border-t pt-2 text-sm" key={r.id}><summary className="break-words">{r.provider} · {r.kind} · {r.receipt.fetchedAt}</summary>
            <p className="text-xs break-words">{r.receipt.license}</p><a className="underline" href={r.receipt.url} target="_blank" rel="noreferrer">{t('source')}</a> · <a className="underline" href={`/api/memory/receipts/${r.receipt.id}/raw`}>{t('saved_data')}</a>
            {r.kind === 'entity' && <div className="flex flex-wrap gap-2 my-2">{Object.entries(r.value.sitelinks ?? {}).filter(([key]) => /^[a-z-]+wiki$/.test(key)).slice(0, 80).map(([key, site]: any) => <a key={key} className="underline" target="_blank" rel="noreferrer" href={`https://${key.slice(0, -4)}.wikipedia.org/wiki/${encodeURIComponent(site.title)}`}>{key.slice(0, -4)}</a>)}</div>}
            <pre className="text-xs whitespace-pre-wrap break-all max-h-80 overflow-auto p-2 bg-slate-50">{JSON.stringify(r.value, null, 2)}</pre></details>)}
        </section>
      </> : <p className="text-slate-600">{t('choose_substance')}</p>}</div>
    </div>
  </div>;
}
