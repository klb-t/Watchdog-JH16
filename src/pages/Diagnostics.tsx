import { useEffect, useState, useSyncExternalStore } from 'react';
import { requestDiagnostics, subscribeDiagnostics } from '../lib/client_diagnostics';
import { clientError } from '../lib/api_error';
import { useUiText } from '../lib/ui_text';
import text from '../../config/ui/diagnostics.json';
export function Diagnostics() {
  const { t, c, errorText } = useUiText(text);
  const requests = useSyncExternalStore(subscribeDiagnostics, requestDiagnostics);
  const [state, setState] = useState<any>(null), [trace, setTrace] = useState<any>(null), [error, setError] = useState<unknown>(null);
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(`/api/diagnostics/${path}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw clientError('diagnostics_request_failed', `Diagnostics request failed (${response.status}).`, { status: response.status });
    return response.json();
  };
  const refresh = async () => { try { setState(await api('state')); setError(null); } catch (e) { setError(e); } };
  useEffect(() => { void refresh(); }, []);
  async function inspect(date: string, id: string) { try { setTrace(await api(`traces/${date}/${id}`)); } catch (e) { setError(e); } }
  return <div className="field-page"><h1>{t('title')}</h1><p className="text-slate-600 mt-2">{t('intro')}</p>
    {error !== null && <p role="alert" className="field-error">{errorText(error)}</p>}
    <div className="field-panel flex flex-wrap gap-4 items-end"><label className="field-control">{t('recorder_mode')}<select aria-label={t('recorder_mode')} value={state?.mode ?? ''} onChange={async e => { try { await api('mode', { mode: e.target.value }); await refresh(); } catch (e) { setError(e); } }}>
      {!state && <option value="">{c('loading')}</option>}{state?.modes.map((m: string) => <option key={m}>{m}</option>)}</select></label><button className="field-button" onClick={refresh}>{t('refresh_traces')}</button>
      <p className="text-sm min-w-0 break-words">{t('modes_help')}</p></div>
    <section className="field-panel"><h2>{t('recent_title')}</h2><p className="text-sm">{t('recent_help')}</p>
      <div className="overflow-auto"><table className="field-table"><thead><tr><th>{t('col_request')}</th><th>{t('col_status')}</th><th>{t('col_duration')}</th><th>{t('col_trace')}</th></tr></thead><tbody>{requests.map((r, i) => <tr key={`${r.at}-${i}`}><td>{r.method} {r.path}</td><td>{r.status ?? r.error}</td><td>{t('duration_ms', { ms: r.durationMs })}</td>
        <td>{r.traceId ? <button className="underline" onClick={() => inspect(r.at.slice(0, 10), r.traceId!)}>{r.traceId}</button> : t('no_server_trace')}</td></tr>)}</tbody></table></div></section>
    <div className="grid lg:grid-cols-[1fr_2fr] gap-4"><section className="field-panel"><h2>{t('traces_title')}</h2><ul className="space-y-2 mt-3">{state?.traces.map((tr: any) => <li key={`${tr.date}-${tr.id}`}><button className="text-left text-sm underline break-all" onClick={() => inspect(tr.date, tr.id)}>{tr.hasErrors ? '⚠ ' : ''}{tr.date} · {tr.id}</button></li>)}</ul>
      {state?.traces.length === 0 && <p className="text-sm mt-3">{t('traces_empty')}</p>}</section>
      <section className="field-panel min-w-0">{trace ? <><h2 className="break-all">{t('trace_title', { id: trace.id })}</h2><a className="field-button mt-3" href={`/api/diagnostics/traces/${trace.date}/${trace.id}/bundle`}>{t('download_zip')}</a>
        {trace.truncated && <p className="field-warning">{t('truncated')}</p>}
        <p className="text-sm mt-3">{t('trace_counts', { events: trace.events.length, errors: trace.errors.length })}</p><pre className="text-xs mt-3 max-h-[40rem] overflow-auto bg-slate-50 p-3">{JSON.stringify(trace, null, 2)}</pre></> : <p>{t('select_prompt')}</p>}</section></div>
  </div>;
}
