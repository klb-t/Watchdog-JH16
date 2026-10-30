import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import bundle from '../../config/ui/text-requests.json';
import { useUiText } from '../lib/ui_text';
import { responseError } from '../lib/api_error';

/**
 * Requests from a pasted text: paste a researcher's message, see what WatchDog
 * recognised (with the fragment behind each intent and the source of each
 * identifier), send it to start the literal part, accept proposals, answer
 * questions. The page shows server results; it computes nothing.
 */

const card = 'bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-3 min-w-0 overflow-hidden';
const short = (id: string) => id.slice(0, 8);
const post = async (url: string, body: unknown) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw responseError(r, d); return d; };
/** Page texts; a refusal with a stable reason gets its label, any other server text is shown as sent. */
function useText() {
  const u = useUiText(bundle);
  const refusal = (e: unknown) => { const reason = (e as { code?: unknown; vars?: Record<string, unknown> })?.code === 'request_refused' ? (e as { vars?: Record<string, unknown> }).vars?.reason : undefined;
    if (typeof reason === 'string') { const s = u.tCode('error_request_', reason); if (s !== reason) return s; } return u.errorText(e); };
  /** A configured rule intent by id; an id without a label keeps the stored label. */
  const intent = (id: string, stored: string) => { const s = u.tCode('intent_', id); return s === id ? stored : s; };
  return { ...u, refusal, intent };
}
const eur = (v: number) => v.toFixed(2).replace('.', ',');

function AnalysisView({ a, children }: { a: any; children?: any }) {
  const { t, intent } = useText();
  return <div className="space-y-4">
    <section className={card} data-testid="request-work"><h2 className="font-semibold">{t('work_title')}</h2>
      <ul className="text-sm list-disc ml-5">{a.identifiers.map((i: any) => <li key={i.value} className="break-all">{i.kind === 'url' ? t('id_url') : t('id_doi')}: {i.value}</li>)}</ul>
      {a.works.map((w: any) => <p key={w.doi} className="text-sm">{t('recognised')} <b>{t('doi', { doi: w.doi })}</b>{w.title ? ` — ${t('quoted', { text: w.title })}` : ''} <span className="text-slate-500">({w.via})</span></p>)}
      {a.full_text ? <p className="text-sm" data-testid="request-fulltext">{t('fulltext', { via: a.full_text.via, pmcid: a.full_text.pmcid, characters: a.full_text.characters, sections: a.full_text.sections.join(', ') || '—', tables: a.full_text.tables, parser: a.full_text.parser })}</p>
        : a.works.length > 0 && <p className="text-sm text-slate-600" data-testid="request-fulltext">{t('fulltext_none')}</p>}
      {a.identifiers.length > 0 && a.works.length === 0 && <p className="text-sm text-amber-900">{t('work_unresolved')}</p>}
      {a.target ? <p className="text-sm" data-testid="request-target">{t('target_in_register')} <Link className="underline" to={`/replications/${a.target.target_id}`}>{a.target.title}</Link>.</p>
        : a.intake ? <p className="text-sm" data-testid="request-intake">{t('intake_note', { coverage: a.intake.coverage === 'full_text' ? t('coverage_full_text') : t('coverage_identifier_only') })}</p> : null}
      <details className="text-xs"><summary className="cursor-pointer">{t('retrievals', { count: a.retrievals.length })}</summary><ul className="space-y-1 mt-1">{a.retrievals.map((r: any, i: number) =>
        <li key={i} className="break-all">{r.purpose}: {r.url} · {r.status === null ? t('retrieval_error', { error: r.error }) : `${t('retrieval_ok', { status: r.status, bytes: r.bytes })}${r.sha256 ? t('retrieval_sha', { sha: r.sha256.slice(0, 12) }) : ''}`}{r.note ? ` · ${r.note}` : ''}</li>)}</ul></details></section>
    <section className={card} data-testid="request-intents"><h2 className="font-semibold">{t('intents_title')}</h2>
      {a.intents.length === 0 ? <p className="text-sm">{t('intents_none')}</p> :
        <ul className="text-sm space-y-1">{a.intents.map((i: any) => <li key={i.id}><b>{intent(i.id, i.label)}</b> — {t('quoted', { text: i.fragment })} <span className="text-xs text-slate-500">({i.source === 'rule' ? t('intent_rule', { rule: i.rule }) : t('intent_model', { rule: i.rule })})</span></li>)}</ul>}
      <p className="text-xs text-slate-600" data-testid="request-model">{t('model_reading', { state: a.model.status === 'disabled' ? t('model_disabled', { reason: a.model.reason }) : a.model.status === 'used' ? t('model_used') : t('model_failed', { reason: a.model.reason }) })}</p>
      {a.model.notes.length > 0 && <ul className="text-sm list-disc ml-5">{a.model.notes.map((n: any) => <li key={n.statement}>{n.statement} <span className="text-xs text-slate-500">— {t('quoted', { text: n.quote })} {t('model_note_source')}</span></li>)}</ul>}</section>
    {children}
  </div>;
}

export function TextRequestsPage() {
  const [text, setText] = useState(''), [a, setA] = useState<any>(null), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [consent, setConsent] = useState(false), [list, setList] = useState<any[]>([]);
  const nav = useNavigate(), { t, refusal } = useText();
  useEffect(() => { fetch('/api/text-requests').then(r => r.ok ? r.json() : { requests: [] }).then(d => setList(d.requests)); }, []);
  const preview = async () => { setBusy(true); setError(null); setA(null); setConsent(false); try { setA((await post('/api/text-requests/preview', { text })).analysis); } catch (e) { setError(e); } finally { setBusy(false); } };
  const submit = async () => { setBusy(true); setError(null); try { const d = await post('/api/text-requests', { text, expectedPlanHash: a.plan_hash, consent: true }); nav(`/requests/${d.request.id}`); } catch (e) { setError(e); } finally { setBusy(false); } };
  return <div className="p-4 sm:p-8 max-w-4xl mx-auto space-y-5 min-w-0" data-testid="text-requests-page">
    <div><h1 className="text-2xl font-semibold">{t('page_title')}</h1>
      <p className="text-sm text-slate-600">{t('page_intro')}</p></div>
    <section className={card}><label className="block text-sm">{t('text_label')}<textarea className="border rounded w-full px-2 py-1" rows={7} value={text} onChange={e => { setText(e.target.value); setA(null); }} data-testid="request-text" /></label>
      <button className="px-3 py-1.5 rounded bg-slate-800 text-white disabled:opacity-50" disabled={!text.trim() || busy} onClick={preview} data-testid="request-preview">{busy && !a ? t('recognising') : t('recognise')}</button>
      {error !== null && <p role="alert" className="text-sm text-red-900">{refusal(error)}</p>}</section>
    {a && <AnalysisView a={a}>
      <section className={card} data-testid="request-plan"><h2 className="font-semibold">{t('plan_title')}</h2>
        <h3 className="text-sm font-medium">{t('literal_heading')}</h3>
        {a.literal.length === 0 ? <p className="text-sm">{a.target ? t('literal_none_target') : t('literal_none_intake')}</p> :
          <ul className="text-sm list-disc ml-5">{a.literal.map((x: any) => <li key={x.id}>{x.label} — {t('serp_requests', { count: x.requests ?? 0 })}</li>)}</ul>}
        <h3 className="text-sm font-medium">{t('proposals_heading')}</h3>
        {a.proposals.length === 0 ? <p className="text-sm">{t('none')}</p> : <ul className="text-sm list-disc ml-5">{a.proposals.map((x: any) => <li key={x.id}>{x.label}{x.unavailable ? <span className="text-amber-900"> — {t('unavailable', { reason: x.unavailable })}</span> : ` — ${t('requests_count', { count: x.requests ?? 0 })}`}</li>)}</ul>}
        <h3 className="text-sm font-medium">{t('questions_heading')}</h3>
        {a.questions.length === 0 ? <p className="text-sm">{t('none')}</p> : <ul className="text-sm list-disc ml-5">{a.questions.map((q: any) => <li key={q.id}>({q.to}) {q.text}</li>)}</ul>}
        <p className="text-sm" data-testid="request-cost">{t('cost', { requests: a.cost.literal_requests, eur: eur(a.cost.literal_eur), price: String(a.cost.eur_per_request).replace('.', ','), cap: eur(a.cost.daily_auto_spend_eur) })}</p>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} data-testid="request-consent" />{t('consent')}</label>
        <button className="px-3 py-1.5 rounded bg-indigo-600 text-white disabled:opacity-50" disabled={!consent || busy} onClick={submit} data-testid="request-submit">{t('submit')}</button></section>
    </AnalysisView>}
    {list.length > 0 && <section className={card}><h2 className="font-semibold">{t('previous')}</h2>
      <ul className="text-sm space-y-1">{list.map(r => <li key={r.id}><Link className="underline" to={`/requests/${r.id}`}>{r.created_at.slice(0, 16).replace('T', ' ')}</Link> — {r.excerpt}{r.target_id ? ` (${r.target_id})` : ''}</li>)}</ul></section>}
  </div>;
}

export function TextRequestPage() {
  const { id } = useParams<{ id: string }>();
  const [r, setR] = useState<any>(null), [error, setError] = useState<unknown>(null), [answers, setAnswers] = useState<Record<string, string>>({}), [msg, setMsg] = useState<unknown>(null);
  const { t, c, refusal } = useText();
  const load = () => fetch(`/api/text-requests/${id}`).then(async x => { const d = await x.json().catch(() => ({})); if (!x.ok) throw responseError(x, d); return d; }).then(d => setR(d.request)).catch(e => setError(e));
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [id]);
  if (error !== null) return <div className="p-8" role="alert">{refusal(error)}</div>;
  if (!r) return <div className="p-8">{c('loading')}</div>;
  const a = r.body.analysis, ev = (action: string, kind: string) => r.events.filter((e: any) => e.body.action === action && e.kind === kind);
  const act = async (action: string) => { setMsg(null); try { setR((await post(`/api/text-requests/${id}/accept`, { action, consent: true })).request); } catch (e) { setMsg(e); } };
  const answer = async (question: string) => { setMsg(null); try { setR((await post(`/api/text-requests/${id}/answer`, { question, answer: answers[question] ?? '' })).request); setAnswers({ ...answers, [question]: '' }); } catch (e) { setMsg(e); } };
  const state = (x: any) => {
    const launched = ev(x.id, 'launched')[0], failed = ev(x.id, 'failed').slice(-1)[0], deferred = ev(x.id, 'deferred')[0];
    if (launched) return <span data-testid={`state-${x.id}`}>{t('launched')} {(launched.body.runIds ?? []).map((rid: string) => { const run = r.runs.find((y: any) => y.run_id === rid);
      return <Link key={rid} className="underline font-mono mr-2" to={`/runs/${rid}/results`}>{short(rid)} {run?.status ?? ''}</Link>; })}</span>;
    if (failed) return <span className="text-red-900" data-testid={`state-${x.id}`}>{t('not_launched', { message: failed.body.message })}{x.launch && <button className="ml-2 underline" onClick={() => act(x.id)}>{t('retry')}</button>}</span>;
    if (x.unavailable) return <span className="text-amber-900" data-testid={`state-${x.id}`}>{t('unavailable', { reason: x.unavailable })}</span>;
    return <span data-testid={`state-${x.id}`}>{deferred ? t('waiting', { reason: deferred.body.code === 'daily_cap' ? t('deferred_daily_cap', { cap: deferred.body.cap_eur, spent: deferred.body.spent_eur, cost: deferred.body.cost_eur }) : deferred.body.reason }) : ''}<button className="px-2 py-0.5 rounded bg-indigo-600 text-white text-xs" onClick={() => act(x.id)} data-testid={`accept-${x.id}`}>{t('accept', { count: x.requests ?? 0, eur: eur((x.requests ?? 0) * a.cost.eur_per_request) })}</button></span>;
  };
  return <div className="p-4 sm:p-8 max-w-4xl mx-auto space-y-5 min-w-0" data-testid="text-request-page">
    <div className="text-sm text-slate-500"><Link to="/requests" className="underline">{t('breadcrumb')}</Link> / {short(r.id)}</div>
    <section className={card}><h1 className="text-xl font-semibold">{t('request_title', { date: r.created_at.slice(0, 16).replace('T', ' ') })}</h1>
      <blockquote className="text-sm whitespace-pre-wrap border-l-4 pl-3 text-slate-700 break-words" data-testid="request-quote">{r.body.text}</blockquote>
      <p className="text-xs text-slate-500 font-mono break-all">{t('fingerprint', { sha: r.text_sha256, plan: a.plan_hash.slice(0, 16), rules: a.config_version })}</p></section>
    <AnalysisView a={a}>
      <section className={card} data-testid="request-actions"><h2 className="font-semibold">{t('literal_title')}</h2>
        {a.literal.length === 0 ? <p className="text-sm">{t('none')}</p> : <ul className="text-sm space-y-2">{a.literal.map((x: any) => <li key={x.id}><b>{x.label}</b> — {state(x)}</li>)}</ul>}
        {ev('intake', 'launched')[0] && <p className="text-sm" data-testid="state-intake">{t('intake_state')} <Link className="underline" to="/research">{t('research_link')}</Link> {t('intake_document', { id: short(ev('intake', 'launched')[0].body.documentId) })}</p>}
        {a.target && <p className="text-sm">{t('target_results')} <Link className="underline" to={`/replications/${a.target.target_id}`}>{t('target_link', { id: a.target.target_id })}</Link>.</p>}</section>
      <section className={card} data-testid="request-proposals"><h2 className="font-semibold">{t('proposals_title')}</h2>
        {a.proposals.length === 0 ? <p className="text-sm">{t('none')}</p> : <ul className="text-sm space-y-2">{a.proposals.map((x: any) => <li key={x.id}><b>{x.label}</b> <span className="text-xs text-slate-500">{t('applies_to', { intents: x.matched_intents.join(', ') })}</span><div>{state(x)}</div></li>)}</ul>}
        {msg !== null && <p role="alert" className="text-sm">{refusal(msg)}</p>}</section>
      <section className={card} data-testid="request-questions"><h2 className="font-semibold">{t('questions_title')}</h2>
        {a.questions.length === 0 ? <p className="text-sm">{t('none')}</p> : <ul className="text-sm space-y-3">{a.questions.map((q: any) => { const done = r.events.filter((e: any) => e.kind === 'answered' && e.body.question === q.id);
          return <li key={q.id}><div>({q.to}) {q.text}</div>{done.map((e: any) => <div key={e.created_at} className="text-slate-700">{t('answer', { date: e.created_at.slice(0, 16).replace('T', ' '), answer: e.body.answer })}</div>)}
            <div className="flex gap-2 mt-1"><input className="border rounded px-2 py-1 flex-1 min-w-0" value={answers[q.id] ?? ''} onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })} aria-label={t('answer_label')} data-testid={`answer-${q.id}`} />
              <button className="px-2 py-1 rounded bg-slate-800 text-white text-xs disabled:opacity-50" disabled={!(answers[q.id] ?? '').trim()} onClick={() => answer(q.id)}>{t('save')}</button></div></li>; })}</ul>}</section>
    </AnalysisView>
  </div>;
}
