import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MemorySubstance } from '../../shared/automation';
import { automationApi as api, formClass, sectionClass } from '../lib/automation_client';
import { useAccess } from '../lib/access';
export function SubstanceMemory() {
  const access = useAccess(), [query, setQuery] = useState(''), [list, setList] = useState<{id: string; name: string}[]>([]);
  const [selected, setSelected] = useState<MemorySubstance | null>(null), [error, setError] = useState('');
  const [target, setTarget] = useState(''), [measure, setMeasure] = useState('all'), [human, setHuman] = useState(false), [limit, setLimit] = useState(100);
  useEffect(() => { let active = true; setSelected(null); setList([]);
    const timer = setTimeout(() => api(`/api/memory/substances?q=${encodeURIComponent(query)}`).then(r => { if (active) setList(r.substances); }).catch(e => active && setError(e.message)), 200);
    return () => { active = false; clearTimeout(timer); };
  }, [query, access.principalId]);
  const open = async (id: string) => { setError(''); try { setSelected((await api(`/api/memory/substances/${encodeURIComponent(id)}`)).substance); setLimit(100); } catch (e) { setError((e as Error).message); } };
  const activities = selected?.activities.filter(a => (measure === 'all' || a.value.measure === measure) && (!human || a.value.organism === 'Homo sapiens') &&
    `${a.value.targetName} ${a.value.targetId} ${a.value.assayDescription}`.toLowerCase().includes(target.toLowerCase())) ?? [];
  return <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-5" data-testid="substance-memory-page">
    <header><h1 className="text-2xl font-semibold">Pamięć substancji</h1><p className="mt-2">Kartoteki oparte na identyfikatorach chemicznych, z oddzielnymi pomiarami i źródłami.</p>
      <p className="mt-2 text-sm text-amber-900">Dane receptorowe opisują doświadczenia i wymagają interpretacji. Nie ustalają składu przyjętej tabletki, dawkowania ani leczenia.</p></header>
    {error && <p role="alert" className="text-red-800 break-words">{error}</p>}
    <div className="grid md:grid-cols-[minmax(180px,260px)_minmax(0,1fr)] gap-4">
      <section className={sectionClass}><label className="block">Nazwa, synonim lub CID<input className={formClass} value={query} onChange={e => setQuery(e.target.value)} /></label>
        {!list.length && <p className="text-sm">Brak pasujących kartotek. <Link className="underline" to="/automation">Pobierz dane ze źródeł</Link>.</p>}
        <div className="max-h-96 overflow-auto space-y-1">{list.map(s => <button key={s.id} className={`block text-left w-full rounded p-2 text-sm break-words ${selected?.id === s.id ? 'bg-indigo-100' : 'hover:bg-slate-100'}`} onClick={() => open(s.id)}>{s.name}<span className="block text-xs text-slate-500">{s.id}</span></button>)}</div>
      </section>
      <div className="min-w-0 space-y-4">{selected ? <>
        <section className={sectionClass}><h2 className="font-semibold text-xl break-words">{selected.name}</h2>
          <dl className="text-sm break-all">{selected.identifiers.map(i => <div key={`${i.namespace}:${i.value}`}><dt className="inline font-semibold">{i.namespace}: </dt><dd className="inline">{i.value}</dd></div>)}</dl>
          <details><summary>Nazwy i języki · {selected.aliases.length}</summary><p className="text-xs">Język nazwy nie określa miejsca występowania substancji.</p><div className="flex flex-wrap gap-2 mt-2">{selected.aliases.map(a => <span className="text-xs bg-slate-100 rounded p-1" key={`${a.name}:${a.language}:${a.source}`}>{a.name} [{a.language ?? 'język niepodany'}]</span>)}</div></details>
        </section>
        <section className={sectionClass}><h2 className="font-semibold">Pomiary względem receptorów i innych celów molekularnych</h2>
          <div className="grid sm:grid-cols-3 gap-2"><label>Cel lub opis doświadczenia<input className={formClass} value={target} onChange={e => setTarget(e.target.value)} /></label><label>Miara<select className={formClass} value={measure} onChange={e => setMeasure(e.target.value)}>{['all', 'Ki', 'Kd', 'IC50', 'EC50'].map(m => <option key={m} value={m}>{m === 'all' ? 'Wszystkie osobno' : m}</option>)}</select></label><label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={human} onChange={e => setHuman(e.target.checked)} />Wyłącznie Homo sapiens</label></div>
          <p className="text-xs text-slate-600">{activities.length} zapisanych pomiarów / wersji. Zachowane relacje &lt;, &gt; i = oraz jednostki źródła. Brak pomiaru nie oznacza braku działania. Wyniki nie są uśredniane ani utożsamiane między miarami.</p>
          {!activities.length && <p>Brak pomiarów odpowiadających filtrom w pobranej części bazy.</p>}
          {activities.slice(0, limit).map(a => <article className="border-t pt-3 space-y-1 text-sm" key={a.id}>
            <div className="flex flex-wrap gap-2"><b>{a.value.targetName ?? a.value.targetId}</b><span>{a.value.measure} {a.value.relation ?? '?'} {a.value.value ?? 'brak wartości'} {a.value.unit ?? 'brak jednostki'}</span></div>
            <p>{a.value.organism ?? 'organizm niepodany'} · {a.value.assayId} · {a.value.targetId}</p>
            <div className="flex flex-wrap gap-2"><span className="rounded bg-blue-100 text-blue-900 px-2">CURATED_SECONDARY</span><span className="rounded bg-amber-100 text-amber-950 px-2">{a.approvalState}</span></div>
            <p>{a.value.assayDescription}</p><details><summary>Warunki, jakość i pochodzenie</summary><p>{a.value.flags.join(' · ')}</p><p>{a.value.journal} {a.value.year} · {a.value.documentId}</p>
              <p><a className="underline" href={a.citation.sourceUrl} target="_blank" rel="noreferrer">Dane źródłowe ChEMBL</a> · <a className="underline" href={`/api/memory/receipts/${a.citation.receiptId}/raw`}>Zapisana odpowiedź API</a></p>
              <pre className="text-xs whitespace-pre-wrap break-all bg-slate-50 p-2">{JSON.stringify(a.value, null, 2)}</pre></details>
          </article>)}
          {activities.length > limit && <button className="underline" onClick={() => setLimit(n => n + 100)}>Pokaż kolejne 100 pomiarów</button>}
        </section>
        <section className={sectionClass}><h2 className="font-semibold">Chemia, bibliografia, Wikipedia i historia pobrań</h2>
          {selected.records.map(r => <details className="border-t pt-2 text-sm" key={r.id}><summary>{r.provider} · {r.kind} · {r.receipt.fetchedAt}</summary>
            <p className="text-xs break-words">{r.receipt.license}</p><a className="underline" href={r.receipt.url} target="_blank" rel="noreferrer">Źródło</a> · <a className="underline" href={`/api/memory/receipts/${r.receipt.id}/raw`}>Zapisane dane</a>
            {r.kind === 'entity' && <div className="flex flex-wrap gap-2 my-2">{Object.entries(r.value.sitelinks ?? {}).filter(([key]) => /^[a-z-]+wiki$/.test(key)).slice(0, 80).map(([key, site]: any) => <a key={key} className="underline" target="_blank" rel="noreferrer" href={`https://${key.slice(0, -4)}.wikipedia.org/wiki/${encodeURIComponent(site.title)}`}>{key.slice(0, -4)}</a>)}</div>}
            <pre className="text-xs whitespace-pre-wrap break-all max-h-80 overflow-auto p-2 bg-slate-50">{JSON.stringify(r.value, null, 2)}</pre></details>)}
        </section>
      </> : <p className="text-slate-600">Wybierz substancję. Dostęp do zapisanych kartotek nie wymaga nowego pobrania ani klucza API.</p>}</div>
    </div>
  </div>;
}
