import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AutomationJob, JobRequest, PaperRecord, ScheduleRecord, Recurrence } from '../../shared/automation';
import { automationApi as api, formClass, buttonClass, sectionClass } from '../lib/automation_client';
import { useAccess } from '../lib/access';

export function Automation() {
  const access = useAccess();
  const [profile, setProfile] = useState<any>(null), [jobs, setJobs] = useState<AutomationJob[]>([]), [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  const [papers, setPapers] = useState<PaperRecord[]>([]), [status, setStatus] = useState<any>(null), [error, setError] = useState('');
  const [request, setRequest] = useState<JobRequest | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [name, setName] = useState('Codzienny przegląd publikacji'), [recurrence, setRecurrence] = useState<Recurrence>({ kind: 'daily_utc', hour: 6, minute: 0 });
  const [detail, setDetail] = useState<any>(null), [filter, setFilter] = useState('');
  const refresh = async () => {
    const [j, s, p, state] = await Promise.all([api('/api/automation/jobs'), api('/api/automation/schedules'), api('/api/automation/papers'), api('/api/automation/status')]);
    setJobs(j.jobs); setSchedules(s.schedules); setPapers(p.papers); setStatus(state);
  };
  useEffect(() => { let active = true; setProfile(null); setJobs([]); setPapers([]); setDetail(null);
    api('/api/automation/profile').then(p => { if (active) { setProfile(p); setRequest(p.defaults.paperJob); } }).catch(e => active && setError(e.message));
    refresh().catch(e => active && setError(e.message)); return () => { active = false; };
  }, [access.principalId]);
  const pending = jobs.some(j => ['QUEUED', 'RUNNING'].includes(j.status));
  useEffect(() => { if (!pending) return; const timer = setInterval(() => refresh().catch(e => setError(e.message)), 5000); return () => clearInterval(timer); }, [pending, access.principalId]);
  const act = async (fn: () => Promise<any>, success = '') => { setBusy(true); setError(''); setMessage(''); try { await fn(); setMessage(success); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const changeKind = (kind: string) => { setRequest(structuredClone(kind === 'paper_review' ? { kind, documentId: null, includeDiscoveredAbstracts: true, maxRequests: 1 } : kind === 'catalog_refresh' ? { kind, provider: 'openrouter', maxRequests: 1 } : kind === 'paper_scan' ? profile.defaults.paperJob : profile.defaults.substanceJob)); setName(kind === 'paper_review' ? 'Przegląd metodologii przez LLM' : kind === 'catalog_refresh' ? 'Aktualizacja katalogu modeli i cen' : kind === 'paper_scan' ? 'Codzienny przegląd publikacji' : 'Aktualizacja kartotek substancji'); };
  const patch = (update: any) => setRequest(r => r ? { ...r, ...update } : null);
  const scheduleToggle = (s: ScheduleRecord) => act(() => api(`/api/automation/schedules/${s.id}`, { consent: true, profileHash: profile.contentHash, expectedHash: s.contentHash,
    schedule: { name: s.name, recurrence: s.recurrence, request: s.request, enabled: !s.enabled } }), s.enabled ? 'Harmonogram wstrzymany.' : 'Harmonogram wznowiony.');
  return <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-5" data-testid="automation-page">
    <header><h1 className="text-2xl font-semibold">Automatyzacja i odkrywanie badań</h1><p className="mt-2 text-slate-600">Zadania jednorazowe i cykliczne, źródła bez klucza oraz kandydaci do replikacji.</p>
      <p className="text-sm mt-2">Działa na serwerze z trwałym dyskiem, również po zamknięciu przeglądarki. Wyłączony serwer nie zbiera danych; po uruchomieniu zaległe terminy łączą się w jedno zadanie.</p></header>
    {error && <p role="alert" className="text-red-800 bg-red-50 p-3 rounded break-words">{error}</p>}
    {message && <p role="status" className="text-emerald-800">{message}</p>}
    {!profile || !request ? <p role="status">Wczytywanie profili…</p> : <>
      <div className="grid lg:grid-cols-2 gap-4">
        <section className={sectionClass}><h2 className="font-semibold">Plan zbierania</h2>
          <label className="block">Zadanie<select className={formClass} value={request.kind} onChange={e => changeKind(e.target.value)}>
            <option value="paper_scan">Przegląd prac naukowych</option>{access.capabilities.includes('method.propose') && <option value="paper_review">Ocena metodologii nowych prac przez LLM</option>}<option value="catalog_refresh">Katalog modeli i cen OpenRouter</option>{access.capabilities.includes('evidence.import') && <option value="substance_refresh">Pamięć substancji</option>}</select></label>
          {request.kind === 'paper_scan' && <>
            <label className="block">Zakres<select className={formClass} value={request.scope} onChange={e => patch({ scope: e.target.value })} data-testid="discovery-scope"><option value="substances">Substancje psychoaktywne</option><option value="all_science">Wszystkie dziedziny w wybranych repozytoriach</option></select></label>
            <label className="block">Okno wyszukiwania (dni)<input type="number" min={1} max={90} className={formClass} value={request.lookbackDays} onChange={e => patch({ lookbackDays: Number(e.target.value) })} /></label>
            <p className="text-xs text-slate-600">arXiv: nowe i zaktualizowane metadane. Europe PMC: data pierwszego indeksowania. Powtórzone rekordy deduplikują się; zmiana treści tworzy nową wersję.</p>
          </>}
          {request.kind === 'paper_review' && <label className="flex gap-2 text-sm"><input type="checkbox" checked={request.includeDiscoveredAbstracts} onChange={e => patch({ includeDiscoveredAbstracts: e.target.checked })} />Uwzględniaj abstrakty odkryte przez arXiv i Europe PMC</label>}
          {request.kind === 'substance_refresh' && <>
            <label className="block">Dokładne nazwy chemiczne (jedna w wierszu)<textarea className={formClass} rows={4} value={request.names.join('\n')} onChange={e => patch({ names: e.target.value.split('\n') })} /></label>
            <button className="underline text-sm" onClick={() => patch({ names: profile.substanceSeeds })}>Wstaw zestaw {profile.substanceSeeds.length} substancji</button>
            <p className="text-xs text-slate-600">Identyfikacja przez PubChem CID i pełny InChIKey. Nazwa handlowa, grupa leków i konkretna cząsteczka nie są automatycznie utożsamiane.</p>
          </>}
          {'providers' in request && <fieldset><legend>Źródła</legend><div className="flex flex-wrap gap-3">{(request.kind === 'paper_scan' ? ['arxiv', 'europe_pmc'] : ['pubchem', 'chembl', 'wikidata', 'europe_pmc']).map(p => <label key={p} className="text-sm flex items-center gap-1"><input type="checkbox" checked={(request.providers as string[]).includes(p)} disabled={p === 'pubchem'}
            onChange={e => patch({ providers: e.target.checked ? [...request.providers, p] : request.providers.filter(id => id !== p) })} />{p}</label>)}</div></fieldset>}
          <div className="grid grid-cols-2 gap-3"><label>Maks. zapytań<input className={formClass} type="number" min={1} disabled={request.kind === 'catalog_refresh'} max={request.kind === 'paper_review' ? 5 : request.kind === 'paper_scan' ? 40 : 200} value={request.maxRequests} onChange={e => patch({ maxRequests: Number(e.target.value) })} /></label>
            {'pageLimit' in request && <label>Maks. stron na źródło<input className={formClass} type="number" min={1} max={request.kind === 'paper_scan' ? 20 : 10} value={request.pageLimit} onChange={e => patch({ pageLimit: Number(e.target.value) })} /></label>}</div>
          <p className="text-sm">{request.kind === 'paper_review' ? 'Ten plan korzysta z Twojego LLM i zapisanego budżetu. Wybiera najnowsze jeszcze nieanalizowane teksty; abstrakt pozostaje niepełnym źródłem metodologii.' : 'Pobieranie zatrzyma się na ustawionym limicie. Częściowe pokrycie będzie oznaczone. Nie są wykonywane płatne zapytania ani pobierany kod z publikacji.'}</p>
          <button className={buttonClass} disabled={busy} data-testid="automation-run" onClick={() => act(() => api('/api/automation/jobs', { request, profileHash: profile.contentHash, consent: true }), 'Zadanie dodane do kolejki.')}>Uruchom ten plan teraz</button>
        </section>
        <section className={sectionClass}><h2 className="font-semibold">Harmonogram</h2>
          <label className="block">Nazwa<input className={formClass} value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="block">Powtarzanie<select className={formClass} value={recurrence.kind} onChange={e => setRecurrence(e.target.value === 'daily_utc' ? { kind: 'daily_utc', hour: 6, minute: 0 } : { kind: 'interval', minutes: 1440 })}><option value="daily_utc">Codziennie, czas UTC</option><option value="interval">Co ustalony odstęp</option></select></label>
          {recurrence.kind === 'daily_utc' ? <label className="block">Godzina UTC<input className={formClass} type="time" value={`${String(recurrence.hour).padStart(2, '0')}:${String(recurrence.minute).padStart(2, '0')}`} onChange={e => { const [hour, minute] = e.target.value.split(':').map(Number); setRecurrence({ kind: 'daily_utc', hour, minute }); }} /></label>
            : <label className="block">Odstęp w minutach<input className={formClass} type="number" min={15} max={525600} value={recurrence.minutes} onChange={e => setRecurrence({ kind: 'interval', minutes: Number(e.target.value) })} /></label>}
          <p className="text-sm">Zapisanie włącza cykliczne wykonanie planu widocznego obok. Możesz je wstrzymać w każdej chwili. Bieżące uprawnienia są sprawdzane również podczas pracy.</p>
          <button className={buttonClass} disabled={busy} data-testid="schedule-create" onClick={() => act(() => api('/api/automation/schedules', { consent: true, profileHash: profile.contentHash, schedule: { name, recurrence, request, enabled: true } }), 'Harmonogram zapisany i włączony.')}>Zapisz i włącz harmonogram</button>
          <p className="text-sm">Proces wykonawczy: {status?.enabled ? 'aktywny' : 'uruchamiany przez zadanie API / proces serwera'}</p>
          {schedules.map(s => <article key={s.id} className="border-t pt-3 text-sm"><b>{s.name}</b><p>{s.enabled ? 'Włączony' : 'Wstrzymany'} · następny termin {s.nextDueAt}</p>
            <p>{s.request.kind === 'paper_scan' ? s.request.scope : s.request.kind} · limit {s.request.maxRequests} zapytań</p>
            <button className="underline mr-3" disabled={busy} onClick={() => scheduleToggle(s)}>{s.enabled ? 'Wstrzymaj' : 'Wznów'}</button>
            <button className="underline" onClick={() => { setRequest(s.request); setRecurrence(s.recurrence); setName(`${s.name} — nowa wersja`); }}>Skopiuj do planu</button></article>)}
        </section>
      </div>
      <section className={sectionClass}><div className="flex justify-between gap-3"><h2 className="font-semibold">Ostatnie zadania</h2><button className="underline text-sm" onClick={() => act(refresh)}>Odśwież</button></div>
        {!jobs.length && <p>Brak uruchomień. Samo otwarcie strony nie pobiera danych z zewnętrznych źródeł.</p>}
        {jobs.map(j => <article key={j.id} className="border-t pt-3 flex flex-wrap gap-3 text-sm items-center"><span className="font-semibold">{j.status}</span><span>{j.request.kind}</span><time>{j.createdAt}</time>
          {j.error && <span className="text-amber-800">{j.error}</span>}<button className="underline" onClick={() => act(async () => setDetail(await api(`/api/automation/jobs/${j.id}`)))}>Wyniki i pochodzenie</button>
          {['RUNNING', 'QUEUED'].includes(j.status) && <button className="underline" onClick={() => act(() => api(`/api/automation/jobs/${j.id}/cancel`, {}))}>Zatrzymaj</button>}</article>)}
        {detail && <details open><summary>Szczegóły zadania {detail.job.id}</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-96 overflow-auto p-3 bg-slate-50">{JSON.stringify(detail, null, 2)}</pre></details>}
      </section>
      <section className={sectionClass}><h2 className="font-semibold">Odkryte prace · {papers.length} zapisanych wersji</h2>
        <p className="text-sm">Wskazówki z tytułu i abstraktu pomagają wybrać prace do sprawdzenia. Nie są oceną prawdziwości, kompletności danych ani gotowości do replikacji.</p>
        <label className="block">Filtruj tytuł lub wskazówkę<input className={formClass} value={filter} onChange={e => setFilter(e.target.value)} /></label>
        {papers.filter(p => `${p.title} ${p.screening.hints.join(' ')}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 80).map(p => <article className="border-t pt-3 text-sm space-y-2" key={p.id}>
          <a className="font-semibold underline" href={p.url} target="_blank" rel="noreferrer">{p.title}</a><p>{p.provider} · {p.publishedAt ?? 'data niepodana'} · DISCOVERED</p>
          <Link className="underline" to={`/research?discovery=${encodeURIComponent(p.id)}`}>Przenieś do warsztatu replikacji</Link>
          <p>Wskazówki: {p.screening.hints.join(', ') || 'brak rozpoznanych w metadanych'}</p>
          <details><summary>Co trzeba sprawdzić przed replikacją</summary><ul className="list-disc pl-5">{p.screening.blockers.map(b => <li key={b}>{b}</li>)}</ul>{p.abstract && <p className="mt-2">{p.abstract}</p>}</details>
        </article>)}
      </section>
      <details className={sectionClass}><summary>Profile źródeł i zakres danych</summary>{profile.sources.map((s: any) => <article key={s.id} className="border-t pt-2 text-sm"><a className="underline font-semibold" href={s.documentation} target="_blank" rel="noreferrer">{s.label}</a> · {s.implemented ? 'adapter działa' : 'adapter do dodania'}<p>{s.purpose}</p><p className="text-slate-600">{s.license}</p></article>)}</details>
      <p><Link className="underline" to="/memory">Otwórz pamięć substancji</Link> · <Link className="underline" to="/setup">Konfiguracja</Link></p>
    </>}
  </div>;
}
