import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AssistantTask, PersonalSettings, ResearchPlanInput, SettingsRecord } from '../../shared/settings';
import { automationApi as api, formClass, buttonClass, sectionClass } from '../lib/automation_client';
import { useAccess } from '../lib/access';
import { ModelProfilesPanel } from './ModelProfilesPanel';

export function ConfigurationWizard() {
  const access = useAccess();
  const [data, setData] = useState<any>(null), [record, setRecord] = useState<SettingsRecord | null>(null), [value, setValue] = useState<PersonalSettings | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [key, setKey] = useState('');
  const [keyProvider, setKeyProvider] = useState('openrouter'), [step, setStep] = useState(1), [plan, setPlan] = useState<any>(null), [approved, setApproved] = useState(false);
  const [options, setOptions] = useState<Omit<ResearchPlanInput, 'settingsHash'>>({ name: 'JH16 i eksploracja wielojęzyczna', baseline: 'fixture', refreshMemory: true, scanPapers: true, dailyScan: false, paperScope: 'substances' });
  const [task, setTask] = useState<AssistantTask>('method_proposal'), [prompt, setPrompt] = useState(''), [proposal, setProposal] = useState<any>(null), [launch, setLaunch] = useState<any>(null);
  const load = async () => { const next = await api('/api/settings'); setData(next); setRecord(next.settings); setValue(next.settings.value); };
  useEffect(() => { let active = true; setData(null); setKey(''); setPlan(null); setProposal(null); setLaunch(null);
    if (!access.principalId) return () => { active = false; };
    api('/api/settings').then(next => { if (active) { setData(next); setRecord(next.settings); setValue(next.settings.value); } }).catch(e => active && setError(e.message));
    return () => { active = false; };
  }, [access.principalId]);
  const act = async (fn: () => Promise<any>, ok = '') => { setBusy(true); setError(''); setMessage(''); try { await fn(); setMessage(ok); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const save = async (next = value!) => {
    const response = await api('/api/settings', { value: next, expectedHash: record!.hash }); setRecord(response.settings); setValue(response.settings.value);
    window.dispatchEvent(new Event('watchdog-settings-changed')); return response.settings as SettingsRecord;
  };
  if (!data || !value || !record) return <div className={sectionClass}>{error ? <p role="alert">{error}</p> : <p>Wczytywanie konfiguratora…</p>}</div>;
  const standard = value.mode !== 'simple', expert = ['expert', 'debug'].includes(value.mode);
  const patchAssistant = (update: any) => setValue({ ...value, assistant: { ...value.assistant, ...update } });
  const patchResearch = (update: any) => setValue({ ...value, research: { ...value.research, ...update } });
  const prepare = () => act(async () => { const saved = await save(); const r = await api('/api/settings/plans', { ...options, settingsHash: saved.hash }); setPlan(r.plan); setApproved(false); setLaunch(null); setStep(3); });
  return <section className="space-y-4" data-testid="configuration-wizard">
    <div className={sectionClass}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-xl">Uruchom swój Watchdog</h2><label className="text-sm">Tryb interfejsu<select className={formClass} value={value.mode} onChange={e => setValue({ ...value, mode: e.target.value as PersonalSettings['mode'] })} data-testid="interface-mode"><option value="simple">Prosty</option><option value="standard">Standardowy</option><option value="expert">Ekspert</option><option value="debug">Ekspert + debug</option></select></label></div>
      <p className="text-sm">Bez klucza zbierzesz publiczne dane i uruchomisz kontrolę JH16 na danych historycznych. Własny klucz LLM dodaje propozycje zapytań i metod; klucz SerpApi pozwala zbierać nowe wyniki wyszukiwania.</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Etapy konfiguracji">{[[1, '1 · Połączenia i koszt'], [2, '2 · Zakres badań'], [3, '3 · Plan i uruchomienie']].map(([n, label]) => <button key={n} className={`rounded px-3 py-2 text-sm ${step === n ? 'bg-indigo-100 text-indigo-900' : 'bg-slate-100'}`} onClick={() => setStep(Number(n))}>{label}</button>)}</div>
    </div>
    {error && <p role="alert" className="p-3 bg-red-50 text-red-900 break-words">{error}</p>}
    {message && <p role="status" className="text-emerald-800">{message}</p>}
    {step === 1 && <div className={sectionClass}>
      {access.capabilities.includes('provider.view') && <>
        <h3 className="font-semibold">Własne połączenia</h3>
        <div className="grid sm:grid-cols-2 gap-3"><label>Dostawca klucza<select className={formClass} value={keyProvider} onChange={e => { setKeyProvider(e.target.value); setKey(''); }}>{data.providers.providers.map((p: any) => <option key={p.id} value={p.id}>{p.label} · LLM</option>)}<option value="serpapi">SerpApi · liczby wyników Google</option></select></label>
          <label>Klucz API<input type="password" className={formClass} value={key} autoComplete="off" spellCheck={false} onChange={e => setKey(e.target.value)} data-testid="personal-api-key" /></label></div>
        <p className="text-xs text-slate-600">Klucz trafia do szyfrowanego magazynu Twojego konta na serwerze. Nie jest zapisywany w ustawieniach ani w przeglądarce. Zapis nie sprawdza jeszcze akceptacji klucza przez dostawcę.</p>
        <button className={buttonClass} disabled={busy || !key} onClick={() => { const submitted = key; setKey(''); void act(async () => {
          await api('/api/settings/credentials', { provider: keyProvider, apiKey: submitted, consent: true });
          if (keyProvider !== 'serpapi') await save({ ...value, assistant: { ...value.assistant, enabled: true, provider: keyProvider, modelPins: {} } });
          await load();
        }, 'Klucz zapisany. Pole zostało wyczyszczone.'); }}>{keyProvider !== 'serpapi' ? 'Zapisz klucz i włącz LLM w ramach budżetu' : 'Zapisz klucz SerpApi'}</button>
        <div className="flex flex-wrap gap-3 text-sm">{data.credentials.filter((c: any) => c.status !== 'absent' || c.provider === keyProvider).map((c: any) => <div key={c.provider}><b>{c.provider}</b>: {c.status === 'present' ? 'zapisany' : c.status === 'invalid' ? 'nie można odczytać' : 'brak klucza'} {c.status !== 'absent' && <button className="underline" disabled={busy} onClick={() => act(async () => { await api('/api/settings/credentials/remove', { provider: c.provider }); await load(); }, 'Klucz usunięty.')}>Usuń</button>}</div>)}</div>
      </>}
      <h3 className="font-semibold pt-2">Koszt pracy modeli</h3>
      <label className="block">Domyślny dostawca LLM<select className={formClass} value={value.assistant.provider} onChange={e => patchAssistant({ provider: e.target.value, modelPins: {} })}>{data.providers.providers.map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={value.assistant.enabled} onChange={e => patchAssistant({ enabled: e.target.checked })} />Pozwól korzystać z mojego LLM w zapisanym budżecie</label>
      {!standard && <label className="block">Tanio → większy dopuszczalny koszt · {value.assistant.economy}/100<input type="range" min={0} max={100} className="w-full" value={value.assistant.economy} onChange={e => patchAssistant({ economy: Number(e.target.value) })} data-testid="cost-slider" /></label>}
      <p className="text-xs">Dobór jest osobny dla każdego zadania. Porównywalne testy i historia działania wpływają na wybór w ramach budżetu. Bez testów jakość pozostaje nieznana. W tym trybie system wybiera wyłącznie z modeli wybranego dostawcy, mieszczących się w limitach.</p>
      <label className="block">Dzienny limit LLM (USD)<input className={formClass} type="number" min={0} max={1000} step="0.1" value={value.assistant.dailyBudgetUsd} onChange={e => patchAssistant({ dailyBudgetUsd: Number(e.target.value) })} /></label>
      {standard && <div className="grid sm:grid-cols-2 gap-3"><label>Limit jednego wywołania (USD)<input className={formClass} type="number" min={0} max={50} step="0.01" value={value.assistant.requestBudgetUsd} onChange={e => patchAssistant({ requestBudgetUsd: Number(e.target.value) })} /></label>
        <label>Dzienny limit zapytań SerpApi<input className={formClass} type="number" min={0} max={10000} value={value.searchDailyRequestLimit} onChange={e => setValue({ ...value, searchDailyRequestLimit: Number(e.target.value) })} /></label>
        <label>Gęstość interfejsu<select aria-label="Gęstość interfejsu" className={formClass} value={value.density} onChange={e => setValue({ ...value, density: e.target.value as any })}><option value="comfortable">Wygodny</option><option value="compact">Kompaktowy</option></select></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={value.assistant.allowFree} onChange={e => patchAssistant({ allowFree: e.target.checked })} />Uwzględniaj modele z ceną zero</label></div>}
      <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy} data-testid="settings-save" onClick={() => act(async () => { await save(); await load(); }, 'Ustawienia zapisane.')}>Zapisz ustawienia</button>
        {access.capabilities.includes('provider.view') && <button className="underline text-sm" disabled={busy} onClick={() => act(async () => { await api('/api/settings/catalog/refresh', { consent: true }); await load(); }, 'Publiczny katalog modeli i cen odświeżony.')}>Odśwież katalog modeli i cen</button>}
        <button className="underline text-sm" onClick={() => setStep(2)}>Dalej: zakres badań</button></div>
      <p className="text-xs">Dziś zarezerwowane lub oszacowane: {data.budget.reservedOrEstimatedUsd.toFixed(6)} USD. Niepewne rozliczenie pozostaje zarezerwowane. To kontrola wydatków aplikacji, nie faktura dostawcy.</p>
      <details open={standard}><summary>Dobór modeli dla zapisanej konfiguracji</summary>
        {!data.catalog && <p className="text-sm">Katalog pobierze się przed pierwszą propozycją LLM. Możesz go też odświeżyć powyżej, bez płatnego wywołania.</p>}
        {data.routes.map((r: any) => <div key={r.task} className="border-t pt-2 mt-2 text-xs break-words"><b>{data.profile.tasks.find((t: any) => t.id === r.task)?.label}</b>{r.route && <p>{r.route.provider} · {r.route.reason}</p>}<p>{r.route ? `${r.route.model.id} · maks. ${r.route.maxOutputTokens} tokenów odpowiedzi · przykładowa rezerwacja ${(r.route.reserveMicroUsd / 1000000).toFixed(6)} USD` : r.blocked}</p></div>)}
        {expert && data.catalog && data.profile.tasks.map((t: any) => <label className="block mt-2 text-sm" key={t.id}>{t.label}: przypnij model<select className={formClass} value={value.assistant.modelPins[t.id as AssistantTask] ?? ''} onChange={e => patchAssistant({ modelPins: { ...value.assistant.modelPins, [t.id]: e.target.value || null } })}><option value="">Automatycznie według kosztu</option>{data.catalog.models.map((m: any) => <option key={m.id} value={m.id}>{m.id}</option>)}</select></label>)}
      </details>
    </div>}
    {step === 1 && standard && access.capabilities.includes('provider.view') && <ModelProfilesPanel data={data} value={value} onPatch={patchAssistant} onSaved={load} />}
    {step === 2 && <div className={sectionClass}>
      <h3 className="font-semibold">Niezależne wymiary badania</h3><p className="text-sm">JH16 pozostaje zablokowanym punktem odniesienia. Poniższy zakres dotyczy nowych, oddzielnych planów eksploracyjnych.</p>
      <fieldset><legend className="font-medium">Języki</legend><div className="flex flex-wrap gap-3">{data.profile.languageProfiles.map((l: any) => <label className="flex gap-1 text-sm" key={l.id}><input type="checkbox" checked={value.research.languages.includes(l.id)} onChange={e => patchResearch({ languages: e.target.checked ? [...value.research.languages, l.id] : value.research.languages.filter(x => x !== l.id) })} />{l.label}</label>)}</div></fieldset>
      <fieldset><legend className="font-medium">Geografia</legend><div className="flex flex-wrap gap-3">{data.profile.geographyProfiles.map((g: any) => <label className="flex gap-1 text-sm" key={g.id}><input type="checkbox" checked={value.research.geographies.includes(g.id)} onChange={e => patchResearch({ geographies: e.target.checked ? [...value.research.geographies, g.id] : value.research.geographies.filter(x => x !== g.id) })} />{g.label}</label>)}</div></fieldset>
      <p className="text-xs">Brak wybranego obszaru oznacza nieokreśloną geografię. Kraj ustawiony w wyszukiwarce również nie ustala miejsca używania substancji.</p>
      <label className="block">Dialekty / warianty do zbadania (rozdziel przecinkiem)<input className={formClass} value={value.research.dialects.join(',')} onChange={e => patchResearch({ dialects: e.target.value ? e.target.value.split(',') : [] })} /></label>
      <div className="flex flex-wrap gap-3"><label className="flex gap-1 text-sm"><input type="checkbox" checked={value.research.slang} onChange={e => patchResearch({ slang: e.target.checked })} />Eksploracyjne warianty slangowe</label><label className="flex gap-1 text-sm"><input type="checkbox" checked={value.research.sentiment} onChange={e => patchResearch({ sentiment: e.target.checked })} />Plan analizy kontekstu i sentymentu</label></div>
      <h3 className="font-semibold">Co uruchomić po przejrzeniu planu</h3>
      <label className="block">Nazwa planu<input className={formClass} value={options.name} onChange={e => setOptions({ ...options, name: e.target.value })} /></label>
      <label className="block">Punkt odniesienia<select className={formClass} value={options.baseline} onChange={e => setOptions({ ...options, baseline: e.target.value as any })}><option value="fixture">JH16: kontrola pipeline na historycznych danych</option><option value="live_serp">JH16: nowe pomiary przez własny SerpApi</option><option value="none">Bez uruchamiania JH16 w tym planie</option></select></label>
      {access.capabilities.includes('evidence.import') && <label className="flex gap-2 text-sm"><input type="checkbox" checked={options.refreshMemory} onChange={e => setOptions({ ...options, refreshMemory: e.target.checked })} />Zasil kartoteki: kofeina, ketamina, nalokson · maks. 60 publicznych zapytań</label>}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={options.scanPapers} onChange={e => setOptions({ ...options, scanPapers: e.target.checked })} />Przejrzyj arXiv i Europe PMC · maks. 8 zapytań</label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={options.dailyScan} onChange={e => setOptions({ ...options, dailyScan: e.target.checked })} />Ponawiaj przegląd codziennie o 06:00 UTC</label>
      <label className="block">Zakres publikacji<select className={formClass} value={options.paperScope} onChange={e => setOptions({ ...options, paperScope: e.target.value as any })}><option value="substances">Substancje psychoaktywne</option><option value="all_science">Wszystkie dziedziny wybranych repozytoriów</option></select></label>
      <button className={buttonClass} disabled={busy || !access.capabilities.includes('run.create')} data-testid="prepare-research-plan" onClick={prepare}>Zapisz konfigurację i przygotuj plan</button>
    </div>}
    {step === 3 && <div className={sectionClass}>
      <h3 className="font-semibold">Plan do przejrzenia</h3>
      {!plan ? <p>Przygotuj plan w kroku 2. Zapis ustawień sam nie uruchamia pobierania ani płatnego LLM.</p> : <>
        <p className="font-medium">{plan.body.name}</p><p className="text-sm">Języki: {plan.body.extensions.languages.join(', ')} · obszary: {plan.body.extensions.geographies.join(', ') || 'nieokreślone'}</p>
        <p className="text-sm">Zadania publiczne: {plan.body.jobs.map((j: any) => `${j.kind} (limit ${j.maxRequests})`).join(', ') || 'brak'} · codzienny przegląd: {plan.body.dailyScan ? 'tak' : 'nie'}</p>
        {plan.body.baseline && <details open><summary>JH16 · przejrzyj dokładną metodę ({plan.body.baseline.plannedQueries} zapytań)</summary>
          <p className="text-sm my-2">{plan.body.baseline.attemptMeaning}</p>{plan.body.baseline.method.steps.map((s: any) => <p className="text-xs mb-2" key={s.id}><b>{s.id} · {s.primitive}</b> {s.rationale}</p>)}
          <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} data-testid="approve-wizard-method" />Przejrzałem tę metodę i zezwalam na jej wykonanie.</label>
        </details>}
        <p className="text-sm">Rozszerzenia językowe, slang, sentyment i alternatywy „harm” pozostają planem eksploracyjnym. Potwierdzanie wymaga zamrożenia hipotez, rodziny porównań i procedury statystycznej oraz oddzielnych danych, których nie użyto do ulepszania propozycji.</p>
        <details><summary>Pełny zapis i identyfikator planu</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-80 overflow-auto">{JSON.stringify(plan, null, 2)}</pre></details>
        <button className={buttonClass} disabled={busy || !!launch || !!plan.body.baseline && !approved} data-testid="launch-research-plan" onClick={() => act(async () => {
          const result = await api(`/api/settings/plans/${plan.id}/launch`, { expectedHash: plan.hash, approvedMethodHash: plan.body.baseline?.methodHash ?? null, consent: true }); setLaunch(result.launch);
          await save({ ...value, onboardingComplete: true });
        }, 'Plan uruchomiony. Postęp jest zapisywany na serwerze.')}>Zezwól i uruchom ten plan</button>
        {launch && <p className="text-sm">{launch.runId && <Link className="underline mr-3" to={`/runs/${launch.runId}/results`}>Wyniki JH16</Link>}<Link className="underline mr-3" to="/automation">Kolejka i harmonogram</Link><Link className="underline" to="/memory">Kartoteki substancji</Link></p>}
      </>}
    </div>}
    {standard && access.capabilities.includes('method.propose') && <details className={sectionClass}><summary>Asystent: propozycje do dalszych badań</summary>
      <label className="block">Profil zadania<select className={formClass} value={task} onChange={e => setTask(e.target.value as AssistantTask)}>{data.profile.tasks.map((t: any) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
      <label className="block">Polecenie<textarea className={formClass} rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} /></label>
      <button className="underline text-sm" onClick={() => setPrompt(`Zaproponuj oddzielny plan rozszerzenia JH16, zachowując oryginał do porównania. Języki: ${value.research.languages.join(', ')}. Geografia: ${value.research.geographies.join(', ') || 'nieokreślona'}. Dialekty: ${value.research.dialects.join(', ') || 'do rozpoznania'}. Slang: ${value.research.slang}. Sentyment: ${value.research.sentiment}. Zaproponuj falsyfikowalne alternatywy harm. Opisz dane potrzebne do eksploracji i niezależnego potwierdzenia, kontrolę wielokrotnego testowania i sposób rejestrowania wszystkich prób. Nie podawaj wyników ani danych pomiarowych.`)}>Wstaw zakres zapisanej eksploracji</button>
      <button className={buttonClass} disabled={busy || !prompt || !value.assistant.enabled} onClick={() => act(async () => { await save(); setProposal((await api('/api/settings/assistant', { task, prompt, consent: true })).proposal); await load(); })}>Wygeneruj propozycję w ramach mojego budżetu</button>
      {proposal && <div className="text-sm whitespace-pre-wrap break-words"><p className="font-semibold">PROPOSED · {proposal.model}</p>{proposal.text}<details><summary>Pochodzenie i koszt</summary><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify({ route: proposal.route, usage: proposal.usage, reservationId: proposal.reservationId }, null, 2)}</pre></details></div>}
    </details>}
    {value.mode === 'debug' && <details className={sectionClass}><summary>Diagnostyka konfiguracji</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-80 overflow-auto">{JSON.stringify({ settingsHash: record.hash, routingHash: data.profile.contentHash, catalogHash: data.catalog?.hash, budget: data.budget, routes: data.routes }, null, 2)}</pre>
      {access.capabilities.includes('diagnostics.view') && <Link className="underline" to="/diagnostics">Otwórz Flight Recorder</Link>}<p className="text-xs">Tryb interfejsu nie zmienia uprawnień konta.</p></details>}
  </section>;
}
