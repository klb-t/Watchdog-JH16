import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

/**
 * Requests from a pasted text: paste a researcher's message, see what WatchDog
 * recognised (with the fragment behind each intent and the source of each
 * identifier), send it to start the literal part, accept proposals, answer
 * questions. The page shows server results; it computes nothing.
 */

const card = 'bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-3 min-w-0 overflow-hidden';
const short = (id: string) => id.slice(0, 8);
const post = async (url: string, body: unknown) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.message ?? `HTTP ${r.status}`); return d; };
const eur = (v: number) => v.toFixed(2).replace('.', ',');

function AnalysisView({ a, children }: { a: any; children?: any }) {
  return <div className="space-y-4">
    <section className={card} data-testid="request-work"><h2 className="font-semibold">Wskazana praca</h2>
      <ul className="text-sm list-disc ml-5">{a.identifiers.map((i: any) => <li key={i.value} className="break-all">{i.kind === 'url' ? 'adres' : 'DOI'}: {i.value}</li>)}</ul>
      {a.works.map((w: any) => <p key={w.doi} className="text-sm">Rozpoznano <b>doi:{w.doi}</b>{w.title ? ` — „${w.title}”` : ''} <span className="text-slate-500">({w.via})</span></p>)}
      {a.full_text ? <p className="text-sm" data-testid="request-fulltext">Pełny tekst: {a.full_text.via}, {a.full_text.pmcid}: {a.full_text.characters} znaków, sekcje {a.full_text.sections.join(', ') || '—'}, tabele {a.full_text.tables} (konwersja {a.full_text.parser}).</p>
        : a.works.length > 0 && <p className="text-sm text-slate-600" data-testid="request-fulltext">Pełnego tekstu w otwartym dostępie (Europe PMC) nie znaleziono.</p>}
      {a.identifiers.length > 0 && a.works.length === 0 && <p className="text-sm text-amber-900">Nie udało się jednoznacznie rozpoznać pracy. Wpisz w tekście jej DOI.</p>}
      {a.target ? <p className="text-sm" data-testid="request-target">Praca jest w rejestrze replikacji: <Link className="underline" to={`/replications/${a.target.target_id}`}>{a.target.title}</Link>.</p>
        : a.intake ? <p className="text-sm" data-testid="request-intake">Praca nie jest w rejestrze replikacji. Po wysłaniu trafi do „Tekst, metodologia i ekstrakcja” ({a.intake.coverage === 'full_text' ? 'z pełnym tekstem strony' : 'tylko identyfikator, bo strony nie udało się pobrać'}); tam zaproponujesz metodę do przeglądu.</p> : null}
      <details className="text-xs"><summary className="cursor-pointer">Pobrania ({a.retrievals.length})</summary><ul className="space-y-1 mt-1">{a.retrievals.map((r: any, i: number) =>
        <li key={i} className="break-all">{r.purpose}: {r.url} · {r.status === null ? `błąd: ${r.error}` : `HTTP ${r.status}, ${r.bytes} B${r.sha256 ? `, sha256 ${r.sha256.slice(0, 12)}` : ''}`}{r.note ? ` · ${r.note}` : ''}</li>)}</ul></details></section>
    <section className={card} data-testid="request-intents"><h2 className="font-semibold">O co prosi tekst</h2>
      {a.intents.length === 0 ? <p className="text-sm">Reguły nie rozpoznały żadnej prośby.</p> :
        <ul className="text-sm space-y-1">{a.intents.map((i: any) => <li key={i.id}><b>{i.label}</b> — „{i.fragment}” <span className="text-xs text-slate-500">({i.source === 'rule' ? `reguła ${i.rule}` : `propozycja modelu ${i.rule}`})</span></li>)}</ul>}
      <p className="text-xs text-slate-600" data-testid="request-model">Odczyt przez model: {a.model.status === 'disabled' ? `wyłączony (${a.model.reason})` : a.model.status === 'used' ? 'użyty; każda propozycja cytuje fragment, na którym się opiera' : `błąd (${a.model.reason})`}.</p>
      {a.model.notes.length > 0 && <ul className="text-sm list-disc ml-5">{a.model.notes.map((n: any) => <li key={n.statement}>{n.statement} <span className="text-xs text-slate-500">— „{n.quote}” (propozycja modelu)</span></li>)}</ul>}</section>
    {children}
  </div>;
}

export function TextRequestsPage() {
  const [text, setText] = useState(''), [a, setA] = useState<any>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [consent, setConsent] = useState(false), [list, setList] = useState<any[]>([]);
  const nav = useNavigate();
  useEffect(() => { fetch('/api/text-requests').then(r => r.ok ? r.json() : { requests: [] }).then(d => setList(d.requests)); }, []);
  const preview = async () => { setBusy(true); setError(''); setA(null); setConsent(false); try { setA((await post('/api/text-requests/preview', { text })).analysis); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const submit = async () => { setBusy(true); setError(''); try { const d = await post('/api/text-requests', { text, expectedPlanHash: a.plan_hash, consent: true }); nav(`/requests/${d.request.id}`); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <div className="p-4 sm:p-8 max-w-4xl mx-auto space-y-5 min-w-0" data-testid="text-requests-page">
    <div><h1 className="text-2xl font-semibold">Zlecenie z tekstu</h1>
      <p className="text-sm text-slate-600">Wklej wiadomość od badacza, np. cytat z maila z linkiem do pracy. WatchDog rozpozna pracę i prośby. Po wysłaniu sam uruchomi część dosłowną, w granicach dziennego limitu wydatków. Rozszerzenia czekają na Twoją akceptację, a pytania nie wstrzymują pracy.</p></div>
    <section className={card}><label className="block text-sm">Tekst<textarea className="border rounded w-full px-2 py-1" rows={7} value={text} onChange={e => { setText(e.target.value); setA(null); }} data-testid="request-text" /></label>
      <button className="px-3 py-1.5 rounded bg-slate-800 text-white disabled:opacity-50" disabled={!text.trim() || busy} onClick={preview} data-testid="request-preview">{busy && !a ? 'Rozpoznawanie…' : 'Rozpoznaj'}</button>
      {error && <p role="alert" className="text-sm text-red-900">{error}</p>}</section>
    {a && <AnalysisView a={a}>
      <section className={card} data-testid="request-plan"><h2 className="font-semibold">Co zostanie zrobione</h2>
        <h3 className="text-sm font-medium">Część dosłowna (startuje po wysłaniu)</h3>
        {a.literal.length === 0 ? <p className="text-sm">Brak: {a.target ? 'tekst nie prosi o działanie, które ta praca ma w rejestrze' : 'praca spoza rejestru trafi tylko do intake'}.</p> :
          <ul className="text-sm list-disc ml-5">{a.literal.map((x: any) => <li key={x.id}>{x.label} — {x.requests ?? 0} zapytań SerpApi</li>)}</ul>}
        <h3 className="text-sm font-medium">Propozycje (czekają na akceptację)</h3>
        {a.proposals.length === 0 ? <p className="text-sm">Brak.</p> : <ul className="text-sm list-disc ml-5">{a.proposals.map((x: any) => <li key={x.id}>{x.label}{x.unavailable ? <span className="text-amber-900"> — niedostępne: {x.unavailable}</span> : ` — ${x.requests ?? 0} zapytań`}</li>)}</ul>}
        <h3 className="text-sm font-medium">Pytania</h3>
        {a.questions.length === 0 ? <p className="text-sm">Brak.</p> : <ul className="text-sm list-disc ml-5">{a.questions.map((q: any) => <li key={q.id}>({q.to}) {q.text}</li>)}</ul>}
        <p className="text-sm" data-testid="request-cost">Koszt części dosłownej: {a.cost.literal_requests} zapytań SerpApi, ok. {eur(a.cost.literal_eur)} € (przyjęta cena {String(a.cost.eur_per_request).replace('.', ',')} € za zapytanie; limit automatu {eur(a.cost.daily_auto_spend_eur)} € dziennie, a działania ponad limit czekają na Twoje uruchomienie).</p>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} data-testid="request-consent" />Zgadzam się na uruchomienie części dosłownej opisanej powyżej</label>
        <button className="px-3 py-1.5 rounded bg-indigo-600 text-white disabled:opacity-50" disabled={!consent || busy} onClick={submit} data-testid="request-submit">Wyślij i rozpocznij</button></section>
    </AnalysisView>}
    {list.length > 0 && <section className={card}><h2 className="font-semibold">Poprzednie zlecenia</h2>
      <ul className="text-sm space-y-1">{list.map(r => <li key={r.id}><Link className="underline" to={`/requests/${r.id}`}>{r.created_at.slice(0, 16).replace('T', ' ')}</Link> — {r.excerpt}{r.target_id ? ` (${r.target_id})` : ''}</li>)}</ul></section>}
  </div>;
}

export function TextRequestPage() {
  const { id } = useParams<{ id: string }>();
  const [r, setR] = useState<any>(null), [error, setError] = useState(''), [answers, setAnswers] = useState<Record<string, string>>({}), [msg, setMsg] = useState('');
  const load = () => fetch(`/api/text-requests/${id}`).then(x => x.ok ? x.json() : Promise.reject(new Error(`HTTP ${x.status}`))).then(d => setR(d.request)).catch(e => setError(e.message));
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [id]);
  if (error) return <div className="p-8" role="alert">{error}</div>;
  if (!r) return <div className="p-8">Wczytywanie…</div>;
  const a = r.body.analysis, ev = (action: string, kind: string) => r.events.filter((e: any) => e.body.action === action && e.kind === kind);
  const act = async (action: string) => { setMsg(''); try { setR((await post(`/api/text-requests/${id}/accept`, { action, consent: true })).request); } catch (e) { setMsg((e as Error).message); } };
  const answer = async (question: string) => { setMsg(''); try { setR((await post(`/api/text-requests/${id}/answer`, { question, answer: answers[question] ?? '' })).request); setAnswers({ ...answers, [question]: '' }); } catch (e) { setMsg((e as Error).message); } };
  const state = (x: any) => {
    const launched = ev(x.id, 'launched')[0], failed = ev(x.id, 'failed').slice(-1)[0], deferred = ev(x.id, 'deferred')[0];
    if (launched) return <span data-testid={`state-${x.id}`}>uruchomione: {(launched.body.runIds ?? []).map((rid: string) => { const run = r.runs.find((y: any) => y.run_id === rid);
      return <Link key={rid} className="underline font-mono mr-2" to={`/runs/${rid}/results`}>{short(rid)} {run?.status ?? ''}</Link>; })}</span>;
    if (failed) return <span className="text-red-900" data-testid={`state-${x.id}`}>nie uruchomiono: {failed.body.message}{x.launch && <button className="ml-2 underline" onClick={() => act(x.id)}>spróbuj ponownie</button>}</span>;
    if (x.unavailable) return <span className="text-amber-900" data-testid={`state-${x.id}`}>niedostępne: {x.unavailable}</span>;
    return <span data-testid={`state-${x.id}`}>{deferred ? `czeka: ${deferred.body.reason}. ` : ''}<button className="px-2 py-0.5 rounded bg-indigo-600 text-white text-xs" onClick={() => act(x.id)} data-testid={`accept-${x.id}`}>Akceptuj i uruchom ({x.requests ?? 0} zapytań, ok. {eur((x.requests ?? 0) * a.cost.eur_per_request)} €)</button></span>;
  };
  return <div className="p-4 sm:p-8 max-w-4xl mx-auto space-y-5 min-w-0" data-testid="text-request-page">
    <div className="text-sm text-slate-500"><Link to="/requests" className="underline">Zlecenia z tekstu</Link> / {short(r.id)}</div>
    <section className={card}><h1 className="text-xl font-semibold">Zlecenie z {r.created_at.slice(0, 16).replace('T', ' ')} UTC</h1>
      <blockquote className="text-sm whitespace-pre-wrap border-l-4 pl-3 text-slate-700 break-words" data-testid="request-quote">{r.body.text}</blockquote>
      <p className="text-xs text-slate-500 font-mono break-all">sha256 tekstu {r.text_sha256} · plan {a.plan_hash.slice(0, 16)} · reguły {a.config_version}</p></section>
    <AnalysisView a={a}>
      <section className={card} data-testid="request-actions"><h2 className="font-semibold">Część dosłowna</h2>
        {a.literal.length === 0 ? <p className="text-sm">Brak.</p> : <ul className="text-sm space-y-2">{a.literal.map((x: any) => <li key={x.id}><b>{x.label}</b> — {state(x)}</li>)}</ul>}
        {ev('intake', 'launched')[0] && <p className="text-sm" data-testid="state-intake">Praca w intake: <Link className="underline" to="/research">Tekst, metodologia i ekstrakcja</Link> (dokument {short(ev('intake', 'launched')[0].body.documentId)}).</p>}
        {a.target && <p className="text-sm">Wyniki, rozbieżności, dowody i projekt pracy: <Link className="underline" to={`/replications/${a.target.target_id}`}>Replikacje → {a.target.target_id}</Link>.</p>}</section>
      <section className={card} data-testid="request-proposals"><h2 className="font-semibold">Propozycje rozszerzeń</h2>
        {a.proposals.length === 0 ? <p className="text-sm">Brak.</p> : <ul className="text-sm space-y-2">{a.proposals.map((x: any) => <li key={x.id}><b>{x.label}</b> <span className="text-xs text-slate-500">(dotyczy: {x.matched_intents.join(', ')})</span><div>{state(x)}</div></li>)}</ul>}
        {msg && <p role="alert" className="text-sm">{msg}</p>}</section>
      <section className={card} data-testid="request-questions"><h2 className="font-semibold">Pytania (nie wstrzymują pracy)</h2>
        {a.questions.length === 0 ? <p className="text-sm">Brak.</p> : <ul className="text-sm space-y-3">{a.questions.map((q: any) => { const done = r.events.filter((e: any) => e.kind === 'answered' && e.body.question === q.id);
          return <li key={q.id}><div>({q.to}) {q.text}</div>{done.map((e: any) => <div key={e.created_at} className="text-slate-700">Odpowiedź ({e.created_at.slice(0, 16).replace('T', ' ')}): {e.body.answer}</div>)}
            <div className="flex gap-2 mt-1"><input className="border rounded px-2 py-1 flex-1 min-w-0" value={answers[q.id] ?? ''} onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })} data-testid={`answer-${q.id}`} />
              <button className="px-2 py-1 rounded bg-slate-800 text-white text-xs disabled:opacity-50" disabled={!(answers[q.id] ?? '').trim()} onClick={() => answer(q.id)}>Zapisz</button></div></li>; })}</ul>}</section>
    </AnalysisView>
  </div>;
}
