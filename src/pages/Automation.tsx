import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AutomationJob, JobRequest, PaperRecord, ScheduleRecord, Recurrence } from '../../shared/automation';
import { automationApi as api, formClass, buttonClass, sectionClass } from '../lib/automation_client';
import { useAccess } from '../lib/access';
import {withCollectionPurpose,type CollectionProfile} from '../../shared/collection';
import bundle from '../../config/ui/automation.json';
import { useUiText } from '../lib/ui_text';

export function Automation() {
  const access = useAccess(), { t, tCode, errorText } = useUiText(bundle);
  /** A label by code; the configuration's own text (or the code) when the bundle has none. */
  const label = (prefix: string, code: string, fallback?: string) => { const s = tCode(prefix, code); return s === code ? fallback ?? code : s; };
  const [profile, setProfile] = useState<any>(null), [jobs, setJobs] = useState<AutomationJob[]>([]), [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  const [collectionProfile,setCollectionProfile]=useState<CollectionProfile|null>(null);
  const purposeLabel=(request:JobRequest)=>{const id=('collection' in request?request.collection?.purpose:undefined)??'unspecified';return collectionProfile?label('purpose_',id,collectionProfile.purposes[id].label):undefined;};
  const [papers, setPapers] = useState<PaperRecord[]>([]), [status, setStatus] = useState<any>(null), [error, setError] = useState<unknown>(null);
  const [request, setRequest] = useState<JobRequest | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState<'' | 'queued' | 'schedule_saved' | 'paused_msg' | 'resumed_msg'>('');
  // null: the default name for the selected job, in the reader's language; it is what gets saved unless edited.
  const [nameInput, setName] = useState<string | null>(null), [recurrence, setRecurrence] = useState<Recurrence>({ kind: 'daily_utc', hour: 6, minute: 0 });
  const [detail, setDetail] = useState<any>(null), [filter, setFilter] = useState('');
  const refresh = async () => {
    const [j, s, p, state] = await Promise.all([api('/api/automation/jobs'), api('/api/automation/schedules'), api('/api/automation/papers'), api('/api/automation/status')]);
    setJobs(j.jobs); setSchedules(s.schedules); setPapers(p.papers); setStatus(state);
  };
  useEffect(() => { let active = true; setProfile(null); setJobs([]); setPapers([]); setDetail(null);
    api('/api/automation/profile').then(p => { if (active) { setProfile(p); setRequest(p.defaults.paperJob); } }).catch(e => active && setError(e));
    api('/api/automation/collection-profile').then(p=>{if(active)setCollectionProfile(p.profile);}).catch(e=>active&&setError(e));
    refresh().catch(e => active && setError(e)); return () => { active = false; };
  }, [access.principalId]);
  const pending = jobs.some(j => ['QUEUED', 'RUNNING'].includes(j.status));
  useEffect(() => { if (!pending) return; const timer = setInterval(() => refresh().catch(e => setError(e)), 5000); return () => clearInterval(timer); }, [pending, access.principalId]);
  const act = async (fn: () => Promise<any>, success: typeof message = '') => { setBusy(true); setError(null); setMessage(''); try { await fn(); setMessage(success); await refresh(); } catch (e) { setError(e); } finally { setBusy(false); } };
  const name = nameInput ?? tCode('default_name_', request?.kind ?? 'paper_scan');
  const changeKind = (kind: string) => { setRequest(structuredClone(kind === 'paper_review' ? { kind, documentId: null, includeDiscoveredAbstracts: true, maxRequests: 1 } : kind === 'catalog_refresh' ? { kind, provider: 'openrouter', maxRequests: 1 } : kind === 'paper_scan' ? profile.defaults.paperJob : profile.defaults.substanceJob)); setName(null); };
  const patch = (update: any) => setRequest(r => r ? { ...r, ...update } : null);
  const scheduleToggle = (s: ScheduleRecord) => act(() => api(`/api/automation/schedules/${s.id}`, { consent: true, profileHash: profile.contentHash, expectedHash: s.contentHash,
    schedule: { name: s.name, recurrence: s.recurrence, request: s.request, enabled: !s.enabled } }), s.enabled ? 'paused_msg' : 'resumed_msg');
  return <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-5" data-testid="automation-page">
    <header><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="mt-2 text-slate-600">{t('intro')}</p>
      <p className="text-sm mt-2">{t('server_note')}</p></header>
    {error !== null && <p role="alert" className="text-red-800 bg-red-50 p-3 rounded break-words">{errorText(error)}</p>}
    {message && <p role="status" className="text-emerald-800">{t(message)}</p>}
    {!profile || !request ? <p role="status">{t('loading_profiles')}</p> : <>
      <div className="grid lg:grid-cols-2 gap-4">
        <section className={sectionClass}><h2 className="font-semibold">{t('plan_title')}</h2>
          <label className="block">{t('task')}<select aria-label={t('task')} className={formClass} value={request.kind} disabled={busy} onChange={e => changeKind(e.target.value)}>
            <option value="paper_scan">{t('kind_paper_scan')}</option>{access.capabilities.includes('method.propose') && <option value="paper_review">{t('kind_paper_review')}</option>}<option value="catalog_refresh">{t('kind_catalog_refresh')}</option>{access.capabilities.includes('evidence.import') && <option value="substance_refresh">{t('kind_substance_refresh')}</option>}</select></label>
          {collectionProfile && (request.kind==='paper_scan'||request.kind==='substance_refresh') && <fieldset className="space-y-2" data-testid="collection-purpose">
            <label className="block">{label('collection_', 'label', collectionProfile.label)}<select aria-label={label('collection_', 'label', collectionProfile.label)} className={formClass} value={request.collection?.purpose??'unspecified'} disabled={busy}
              onChange={e=>setRequest(withCollectionPurpose(request,e.target.value as keyof CollectionProfile['purposes']))}>
              {Object.entries(collectionProfile.purposes).map(([id,p])=><option key={id} value={id}>{label('purpose_',id,p.label)}</option>)}
            </select></label><p className="text-sm">{label('purpose_desc_',request.collection?.purpose??'unspecified',collectionProfile.purposes[request.collection?.purpose??'unspecified'].description)}</p>
            <details><summary className="text-xs">{label('collection_', 'explanation', collectionProfile.explanation)}</summary><p className="text-xs text-slate-600">{label('collection_', 'scope_note', collectionProfile.scopeNote)}</p></details>
          </fieldset>}
          {request.kind === 'paper_scan' && <>
            <label className="block">{t('scope')}<select className={formClass} value={request.scope} onChange={e => patch({ scope: e.target.value })} data-testid="discovery-scope"><option value="substances">{t('scope_substances')}</option><option value="all_science">{t('scope_all_science')}</option></select></label>
            <label className="block">{t('lookback')}<input type="number" min={1} max={90} className={formClass} value={request.lookbackDays} onChange={e => patch({ lookbackDays: Number(e.target.value) })} /></label>
            <p className="text-xs text-slate-600">{t('paper_scan_note')}</p>
          </>}
          {request.kind === 'paper_review' && <label className="flex gap-2 text-sm"><input type="checkbox" checked={request.includeDiscoveredAbstracts} onChange={e => patch({ includeDiscoveredAbstracts: e.target.checked })} />{t('include_abstracts')}</label>}
          {request.kind === 'substance_refresh' && <>
            <label className="block">{t('names')}<textarea className={formClass} rows={4} value={request.names.join('\n')} onChange={e => patch({ names: e.target.value.split('\n') })} /></label>
            <button className="underline text-sm" onClick={() => patch({ names: profile.substanceSeeds })}>{t('insert_seeds', { count: profile.substanceSeeds.length })}</button>
            <p className="text-xs text-slate-600">{t('substance_note')}</p>
          </>}
          {'providers' in request && <fieldset><legend>{t('sources')}</legend><div className="flex flex-wrap gap-3">{(request.kind === 'paper_scan' ? ['arxiv', 'europe_pmc'] : ['pubchem', 'chembl', 'wikidata', 'europe_pmc']).map(p => <label key={p} className="text-sm flex items-center gap-1"><input type="checkbox" checked={(request.providers as string[]).includes(p)} disabled={p === 'pubchem'}
            onChange={e => patch({ providers: e.target.checked ? [...request.providers, p] : request.providers.filter(id => id !== p) })} />{p}</label>)}</div></fieldset>}
          <div className="grid grid-cols-2 gap-3"><label className="min-w-0">{t('max_requests')}<input className={formClass} type="number" min={1} disabled={request.kind === 'catalog_refresh'} max={request.kind === 'paper_review' ? 5 : request.kind === 'paper_scan' ? 40 : 200} value={request.maxRequests} onChange={e => patch({ maxRequests: Number(e.target.value) })} /></label>
            {'pageLimit' in request && <label className="min-w-0">{t('max_pages')}<input className={formClass} type="number" min={1} max={request.kind === 'paper_scan' ? 20 : 10} value={request.pageLimit} onChange={e => patch({ pageLimit: Number(e.target.value) })} /></label>}</div>
          <p className="text-sm">{request.kind === 'paper_review' ? t('review_note') : t('fetch_note')}</p>
          <button className={buttonClass} disabled={busy} data-testid="automation-run" onClick={() => act(() => api('/api/automation/jobs', { request, profileHash: profile.contentHash, consent: true }), 'queued')}>{t('run_now')}</button>
        </section>
        <section className={sectionClass}><h2 className="font-semibold">{t('schedule_title')}</h2>
          <label className="block">{t('name')}<input className={formClass} value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="block">{t('recurrence')}<select className={formClass} value={recurrence.kind} onChange={e => setRecurrence(e.target.value === 'daily_utc' ? { kind: 'daily_utc', hour: 6, minute: 0 } : { kind: 'interval', minutes: 1440 })}><option value="daily_utc">{t('daily_utc')}</option><option value="interval">{t('interval')}</option></select></label>
          {recurrence.kind === 'daily_utc' ? <label className="block">{t('hour_utc')}<input className={formClass} type="time" value={`${String(recurrence.hour).padStart(2, '0')}:${String(recurrence.minute).padStart(2, '0')}`} onChange={e => { const [hour, minute] = e.target.value.split(':').map(Number); setRecurrence({ kind: 'daily_utc', hour, minute }); }} /></label>
            : <label className="block">{t('interval_minutes')}<input className={formClass} type="number" min={15} max={525600} value={recurrence.minutes} onChange={e => setRecurrence({ kind: 'interval', minutes: Number(e.target.value) })} /></label>}
          <p className="text-sm">{t('schedule_note')}</p>
          <button className={buttonClass} disabled={busy} data-testid="schedule-create" onClick={() => act(() => api('/api/automation/schedules', { consent: true, profileHash: profile.contentHash, schedule: { name, recurrence, request, enabled: true } }), 'schedule_saved')}>{t('schedule_create')}</button>
          <p className="text-sm">{t('worker', { state: status?.enabled ? t('worker_active') : t('worker_api') })}</p>
          {schedules.map(s => <article key={s.id} className="border-t pt-3 text-sm"><b className="break-words">{s.name}</b><p>{t('schedule_state', { state: s.enabled ? t('schedule_enabled') : t('schedule_paused'), date: s.nextDueAt })}</p>
            <p>{t('schedule_limit', { what: s.request.kind === 'paper_scan' ? label('scope_', s.request.scope) : label('kind_', s.request.kind), count: s.request.maxRequests })}</p>
            {(s.request.kind==='paper_scan'||s.request.kind==='substance_refresh')&&<p>{purposeLabel(s.request)}</p>}
            <button className="underline mr-3" disabled={busy} onClick={() => scheduleToggle(s)}>{s.enabled ? t('pause') : t('resume')}</button>
            <button className="underline" onClick={() => { setRequest(s.request); setRecurrence(s.recurrence); setName(t('copy_name', { name: s.name })); }}>{t('copy_to_plan')}</button></article>)}
        </section>
      </div>
      <section className={sectionClass}><div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">{t('recent_jobs')}</h2><button className="underline text-sm" onClick={() => act(refresh)}>{t('refresh')}</button></div>
        {!jobs.length && <p>{t('no_jobs')}</p>}
        {jobs.map(j => <article key={j.id} className="border-t pt-3 flex flex-wrap gap-3 text-sm items-center"><span className="font-semibold">{label('job_status_', j.status.toLowerCase(), j.status)}</span><span>{label('kind_', j.request.kind)}</span><time>{j.createdAt}</time>
          {(j.request.kind==='paper_scan'||j.request.kind==='substance_refresh')&&<span>{purposeLabel(j.request)}</span>}
          {j.error && <span className="text-amber-800 break-words min-w-0">{j.error}</span>}<button className="underline" onClick={() => act(async () => setDetail(await api(`/api/automation/jobs/${j.id}`)))}>{t('results')}</button>
          {['RUNNING', 'QUEUED'].includes(j.status) && <button className="underline" onClick={() => act(() => api(`/api/automation/jobs/${j.id}/cancel`, {}))}>{t('stop')}</button>}</article>)}
        {detail && <details open><summary className="break-all">{t('job_details', { id: detail.job.id })}</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-96 overflow-auto p-3 bg-slate-50">{JSON.stringify(detail, null, 2)}</pre></details>}
      </section>
      <section className={sectionClass}><h2 className="font-semibold">{t('papers_title', { count: papers.length })}</h2>
        <p className="text-sm">{t('papers_note')}</p>
        <label className="block">{t('filter')}<input className={formClass} value={filter} onChange={e => setFilter(e.target.value)} /></label>
        {papers.filter(p => `${p.title} ${p.screening.hints.join(' ')}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 80).map(p => <article className="border-t pt-3 text-sm space-y-2" key={p.id}>
          <a className="font-semibold underline" href={p.url} target="_blank" rel="noreferrer">{p.title}</a><p>{p.provider} · {p.publishedAt ?? t('no_date')} · {t('discovered')}</p>
          <Link className="underline" to={`/research?discovery=${encodeURIComponent(p.id)}`}>{t('to_workshop')}</Link>
          <p>{t('hints', { hints: p.screening.hints.join(', ') || t('hints_none') })}</p>
          <details><summary>{t('blockers')}</summary><ul className="list-disc pl-5">{p.screening.blockers.map(b => <li key={b}>{b}</li>)}</ul>{p.abstract && <p className="mt-2">{p.abstract}</p>}</details>
        </article>)}
      </section>
      <details className={sectionClass}><summary>{t('source_profiles')}</summary>{profile.sources.map((s: any) => <article key={s.id} className="border-t pt-2 text-sm"><a className="underline font-semibold" href={s.documentation} target="_blank" rel="noreferrer">{label('source_label_', s.id, s.label)}</a> · {s.implemented ? t('adapter_works') : t('adapter_pending')}<p>{label('source_purpose_', s.id, s.purpose)}</p><p className="text-slate-600">{label('source_license_', s.id, s.license)}</p></article>)}</details>
      <p><Link className="underline" to="/memory">{t('open_memory')}</Link> · <Link className="underline" to="/setup">{t('setup')}</Link></p>
    </>}
  </div>;
}
