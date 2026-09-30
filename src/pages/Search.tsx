import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAccess } from '../lib/access';
import { searchMetadata } from '../lib/search_client';
import { SEARCH_CAPABILITIES, SEARCH_KINDS, type SearchKind, type SearchResponse } from '../../shared/search';
import { EvidenceBadge } from '../components/FieldEvidence';
import { EVIDENCE_TIERS, type EvidenceTier } from '../../backend/watchdog_api/domain/evidence_tier';

export function Search() {
  const access = useAccess();
  return <SearchContent key={`${access.principalId ?? 'pending'}:${access.capabilities.join('|')}`} />;
}
function SearchContent() {
  const access = useAccess(), [params, setParams] = useSearchParams();
  const [term, setTerm] = useState(params.get('q') ?? ''), [data, setData] = useState<SearchResponse | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const requestedKind = params.get('kind') ?? 'all', kind: SearchKind | 'all' = SEARCH_KINDS.includes(requestedKind as SearchKind) ? requestedKind as SearchKind : 'all';
  const parsedOffset = Number(params.get('offset') ?? 0), offset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
  const validQuery = (requestedKind === 'all' || SEARCH_KINDS.includes(requestedKind as SearchKind)) && Number.isSafeInteger(parsedOffset) && parsedOffset >= 0;
  const permitted = SEARCH_CAPABILITIES.some(capability => access.capabilities.includes(capability));
  useEffect(() => { setTerm(params.get('q') ?? ''); }, [params.get('q')]);
  useEffect(() => {
    setData(null); setError(''); if (access.loading || !permitted) return;
    if (!validQuery) { setLoading(false); setError('Nieprawidłowy rodzaj danych lub numer strony w adresie. Wpisz zapytanie ponownie.'); return; }
    const controller = new AbortController(); setLoading(true);
    searchMetadata({ q: params.get('q') ?? '', kind, offset }, controller.signal).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(e => { if (!controller.signal.aborted) setError((e as Error).message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [access.loading, access.principalId, access.capabilities.join('|'), permitted, params.get('q'), kind, offset, validQuery]);
  const update = (q: string, nextKind: SearchKind | 'all', nextOffset = 0) => setParams({ q, kind: nextKind, offset: String(nextOffset) });
  const submit = (event: FormEvent) => { event.preventDefault(); update(term, kind); };
  if (access.loading) return <p className="p-6" role="status">Sprawdzanie dostępu…</p>;
  if (!permitted) return <div className="p-6"><h1 className="text-xl font-semibold">Wyszukiwanie niedostępne</h1><p>Twoje profile nie mają dostępu do zapisanych danych.</p><Link className="underline" to="/setup">Konto i dostęp</Link></div>;
  return <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-5" data-testid="unified-search-page">
    <header><h1 className="text-2xl font-semibold">Baza i wyszukiwanie</h1><p className="text-slate-600 mt-2">Wspólne wyszukiwanie zapisanych kartotek i własnej pracy.</p></header>
    <form className="flex flex-wrap gap-3 items-end" onSubmit={submit}><label className="flex-1 min-w-48">Nazwa, identyfikator lub opis metadanych<input className="block w-full border rounded p-2 mt-1" value={term} onChange={e => setTerm(e.target.value)} maxLength={data?.profile.limits.queryCharacters ?? 160} autoComplete="off"/></label>
      <div><label htmlFor="search-kind">Rodzaj</label><select id="search-kind" aria-label="Rodzaj" className="block border rounded p-2 mt-1" value={kind} onChange={e => update(term, e.target.value as SearchKind | 'all')}><option value="all">Wszystkie dostępne</option>{data?.availableKinds.map(value => <option key={value} value={value}>{data.profile.labels[value]}</option>)}</select></div>
      <button className="rounded bg-indigo-600 text-white px-4 py-2" type="submit">Szukaj</button></form>
    {loading && <p role="status">Przeszukiwanie metadanych…</p>}{error && <p role="alert" className="text-red-800">{error}</p>}
    {data && <><p className="text-sm text-slate-600">{data.profile.scope}</p><p role="status">{data.total} wyników · wyświetlono {data.results.length ? `${data.query.offset + 1}–${data.query.offset + data.results.length}` : '0'}</p>
      {!data.results.length && <p>Brak pasujących zapisanych metadanych. Zmień zapytanie lub rodzaj danych.</p>}
      <div className="space-y-3">{data.results.map(hit => <article key={`${hit.kind}:${hit.id}`} className="rounded border bg-white p-4 space-y-2">
        <div className="flex flex-wrap justify-between gap-2"><Link className="font-semibold underline break-words" to={hit.href}>{hit.label}</Link><span className="text-sm text-slate-600">{data.profile.labels[hit.kind]}</span></div>
        <p className="text-sm break-words">{hit.details.join(' · ')}</p><p className="text-xs break-all">{hit.id}{hit.status ? ` · ${hit.status}` : ''} · {hit.visibility}</p>
        {hit.contentHash && <details className="text-xs"><summary>Tożsamość zapisanej wersji</summary><p className="break-all">SHA-256: {hit.contentHash}</p></details>}
        {!!hit.provenance.length && <details className="text-sm"><summary>Pochodzenie · {hit.provenance.length} zapisów źródłowych</summary><ul className="mt-2 space-y-2">{hit.provenance.map(source => <li key={source.recordId} className="break-words"><div className="flex flex-wrap gap-2 items-center"><span>{source.publisher}</span>{EVIDENCE_TIERS.includes(source.evidenceTier as EvidenceTier) ? <EvidenceBadge tier={source.evidenceTier as EvidenceTier}/> : <span>Rodzaj dowodu nieoznaczony</span>}<span>{source.approvalState ?? 'Stan nieoznaczony'}</span></div><p className="text-xs break-all">{source.recordId} · {source.contentHash}</p>{source.url && <a className="underline" href={source.url} target="_blank" rel="noreferrer">Otwórz źródło</a>}</li>)}</ul></details>}
      </article>)}</div>
      <nav className="flex gap-4" aria-label="Strony wyników">{offset > 0 && <button className="underline" onClick={() => update(data.query.q, kind, Math.max(0, offset - data.query.limit))}>Poprzednie</button>}{data.nextOffset !== null && <button className="underline" onClick={() => update(data.query.q, kind, data.nextOffset!)}>Następne</button>}</nav>
      {data.paginationBoundaryReached && <p role="status" className="text-amber-900">Pozostałe wyniki przekraczają limit stron tego profilu. Zawęź zapytanie lub rodzaj danych, aby do nich dotrzeć.</p>}
      <p className="text-xs text-slate-500 break-all">Profil wyszukiwania: {data.profile.version} · {data.profile.contentHash}</p>
    </>}
  </div>;
}
