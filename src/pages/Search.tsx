import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAccess } from '../lib/access';
import { searchMetadata } from '../lib/search_client';
import { clientError } from '../lib/api_error';
import { SEARCH_CAPABILITIES, SEARCH_KINDS, type SearchKind, type SearchResponse } from '../../shared/search';
import { EvidenceBadge } from '../components/FieldEvidence';
import { EVIDENCE_TIERS, type EvidenceTier } from '../../backend/watchdog_api/domain/evidence_tier';
import text from '../../config/ui/search.json';
import { useUiText } from '../lib/ui_text';
import { configText } from '../lib/config_text';

export function Search() {
  const access = useAccess();
  return <SearchContent key={`${access.principalId ?? 'pending'}:${access.capabilities.join('|')}`} />;
}
function SearchContent() {
  const access = useAccess(), [params, setParams] = useSearchParams();
  const { t, tCode, errorText, lang } = useUiText(text);
  const [term, setTerm] = useState(params.get('q') ?? ''), [data, setData] = useState<SearchResponse | null>(null), [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(false);
  const requestedKind = params.get('kind') ?? 'all', kind: SearchKind | 'all' = SEARCH_KINDS.includes(requestedKind as SearchKind) ? requestedKind as SearchKind : 'all';
  const parsedOffset = Number(params.get('offset') ?? 0), offset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
  const validQuery = (requestedKind === 'all' || SEARCH_KINDS.includes(requestedKind as SearchKind)) && Number.isSafeInteger(parsedOffset) && parsedOffset >= 0;
  const permitted = SEARCH_CAPABILITIES.some(capability => access.capabilities.includes(capability));
  useEffect(() => { setTerm(params.get('q') ?? ''); }, [params.get('q')]);
  useEffect(() => {
    setData(null); setError(null); if (access.loading || !permitted) return;
    if (!validQuery) { setLoading(false); setError(clientError('invalid_address', 'Invalid data kind or page number in the address.')); return; }
    const controller = new AbortController(); setLoading(true);
    searchMetadata({ q: params.get('q') ?? '', kind, offset }, controller.signal).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(e => { if (!controller.signal.aborted) setError(e); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [access.loading, access.principalId, access.capabilities.join('|'), permitted, params.get('q'), kind, offset, validQuery]);
  const update = (q: string, nextKind: SearchKind | 'all', nextOffset = 0) => setParams({ q, kind: nextKind, offset: String(nextOffset) });
  const submit = (event: FormEvent) => { event.preventDefault(); update(term, kind); };
  /** Profile labels are hashed server configuration (config/search.json); only their display is translated. */
  const kindLabel = (value: SearchKind) => data ? configText(text, lang, 'pl', `kind_${value}`, data.profile.labels[value]) : value;
  if (access.loading) return <p className="p-6" role="status">{t('checking_access')}</p>;
  if (!permitted) return <div className="p-6"><h1 className="text-xl font-semibold">{t('unavailable_title')}</h1><p>{t('unavailable_body')}</p><Link className="underline" to="/setup">{t('account_link')}</Link></div>;
  return <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-5 min-w-0" data-testid="unified-search-page">
    <header><h1 className="text-2xl font-semibold break-words">{t('title')}</h1><p className="text-slate-600 mt-2">{t('intro')}</p></header>
    <form className="flex flex-wrap gap-3 items-end" onSubmit={submit}><label className="flex-1 min-w-48">{t('query_label')}<input className="block w-full border rounded p-2 mt-1" value={term} onChange={e => setTerm(e.target.value)} maxLength={data?.profile.limits.queryCharacters ?? 160} autoComplete="off"/></label>
      <div className="min-w-0"><label htmlFor="search-kind">{t('kind_label')}</label><select id="search-kind" aria-label={t('kind_label')} className="block border rounded p-2 mt-1 max-w-full" value={kind} onChange={e => update(term, e.target.value as SearchKind | 'all')}><option value="all">{t('all_kinds')}</option>{data?.availableKinds.map(value => <option key={value} value={value}>{kindLabel(value)}</option>)}</select></div>
      <button className="rounded bg-indigo-600 text-white px-4 py-2" type="submit">{t('submit')}</button></form>
    {loading && <p role="status">{t('searching')}</p>}{error !== null && <p role="alert" className="text-red-800 break-words">{errorText(error)}</p>}
    {data && <><p className="text-sm text-slate-600">{configText(text, lang, 'pl', 'cfg_scope', data.profile.scope)}</p><p role="status">{t('results_count', { total: data.total, range: data.results.length ? `${data.query.offset + 1}–${data.query.offset + data.results.length}` : t('results_none_shown') })}</p>
      {!data.results.length && <p>{t('no_results')}</p>}
      <div className="space-y-3">{data.results.map(hit => <article key={`${hit.kind}:${hit.id}`} className="rounded border bg-white p-4 space-y-2 min-w-0">
        <div className="flex flex-wrap justify-between gap-2"><Link className="font-semibold underline break-words min-w-0" to={hit.href}>{hit.label}</Link><span className="text-sm text-slate-600">{kindLabel(hit.kind)}</span></div>
        <p className="text-sm break-words">{hit.details.join(' · ')}</p><p className="text-xs break-all">{hit.id}{hit.status ? ` · ${hit.status}` : ''} · {tCode('visibility_', hit.visibility)}</p>
        {hit.contentHash && <details className="text-xs"><summary>{t('version_identity')}</summary><p className="break-all">{t('sha256', { hash: hit.contentHash })}</p></details>}
        {!!hit.provenance.length && <details className="text-sm"><summary>{t('provenance', { count: hit.provenance.length })}</summary><ul className="mt-2 space-y-2">{hit.provenance.map(source => <li key={source.recordId} className="break-words"><div className="flex flex-wrap gap-2 items-center"><span>{source.publisher}</span>{EVIDENCE_TIERS.includes(source.evidenceTier as EvidenceTier) ? <EvidenceBadge tier={source.evidenceTier as EvidenceTier}/> : <span>{t('tier_unmarked')}</span>}<span>{source.approvalState ?? t('approval_unmarked')}</span></div><p className="text-xs break-all">{source.recordId} · {source.contentHash}</p>{source.url && <a className="underline" href={source.url} target="_blank" rel="noreferrer">{t('open_source')}</a>}</li>)}</ul></details>}
      </article>)}</div>
      <nav className="flex flex-wrap gap-4" aria-label={t('pages_label')}>{offset > 0 && <button className="underline" onClick={() => update(data.query.q, kind, Math.max(0, offset - data.query.limit))}>{t('previous')}</button>}{data.nextOffset !== null && <button className="underline" onClick={() => update(data.query.q, kind, data.nextOffset!)}>{t('next')}</button>}</nav>
      {data.paginationBoundaryReached && <p role="status" className="text-amber-900">{t('pagination_boundary')}</p>}
      <p className="text-xs text-slate-500 break-all">{t('profile_footer', { version: data.profile.version, hash: data.profile.contentHash })}</p>
    </>}
  </div>;
}
