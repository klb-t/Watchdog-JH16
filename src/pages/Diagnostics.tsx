import { useEffect, useState, useSyncExternalStore } from 'react';
import { requestDiagnostics, subscribeDiagnostics } from '../lib/client_diagnostics';
export function Diagnostics() {
  const requests = useSyncExternalStore(subscribeDiagnostics, requestDiagnostics);
  const [state, setState] = useState<any>(null), [trace, setTrace] = useState<any>(null), [error, setError] = useState('');
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(`/api/diagnostics/${path}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Diagnostics request failed (${response.status}).`);
    return response.json();
  };
  const refresh = async () => { try { setState(await api('state')); setError(''); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { void refresh(); }, []);
  async function inspect(date: string, id: string) { try { setTrace(await api(`traces/${date}/${id}`)); } catch (e) { setError((e as Error).message); } }
  return <div className="field-page"><h1>Developer diagnostics</h1><p className="text-slate-600 mt-2">Trace requests, inspect validation and failures, and download a redacted diagnostic bundle.</p>
    {error && <p role="alert" className="field-error">{error}</p>}
    <div className="field-panel flex flex-wrap gap-4 items-end"><label className="field-control">Recorder mode<select aria-label="Recorder mode" value={state?.mode ?? ''} onChange={async e => { try { await api('mode', { mode: e.target.value }); await refresh(); } catch (e) { setError((e as Error).message); } }}>
      {!state && <option value="">Loading…</option>}{state?.modes.map((m: string) => <option key={m}>{m}</option>)}</select></label><button className="field-button" onClick={refresh}>Refresh traces</button>
      <p className="text-sm">TRACE records detailed steps. ERRORS keeps failures. NORMAL writes concise server logs. Mode changes apply to this running instance and are audited.</p></div>
    <section className="field-panel"><h2>Recent requests from this browser</h2><p className="text-sm">Metadata only; no query strings, bodies, credentials or response data.</p>
      <div className="overflow-auto"><table className="field-table"><thead><tr><th>Request</th><th>Status</th><th>Duration</th><th>Trace</th></tr></thead><tbody>{requests.map((r, i) => <tr key={`${r.at}-${i}`}><td>{r.method} {r.path}</td><td>{r.status ?? r.error}</td><td>{r.durationMs} ms</td>
        <td>{r.traceId ? <button className="underline" onClick={() => inspect(r.at.slice(0, 10), r.traceId!)}>{r.traceId}</button> : 'No server trace'}</td></tr>)}</tbody></table></div></section>
    <div className="grid lg:grid-cols-[1fr_2fr] gap-4"><section className="field-panel"><h2>Recorded traces</h2><ul className="space-y-2 mt-3">{state?.traces.map((t: any) => <li key={`${t.date}-${t.id}`}><button className="text-left text-sm underline break-all" onClick={() => inspect(t.date, t.id)}>{t.hasErrors ? '⚠ ' : ''}{t.date} · {t.id}</button></li>)}</ul>
      {state?.traces.length === 0 && <p className="text-sm mt-3">No persisted traces. Enable TRACE or ERRORS, then reproduce the operation.</p>}</section>
      <section className="field-panel">{trace ? <><h2>Trace {trace.id}</h2><a className="field-button mt-3" href={`/api/diagnostics/traces/${trace.date}/${trace.id}/bundle`}>Download diagnostic ZIP</a>
        {trace.truncated && <p className="field-warning">Preview is limited to the first 4 MB of each trace file. The ZIP contains the complete trace.</p>}
        <p className="text-sm mt-3">{trace.events.length} events · {trace.errors.length} error envelopes</p><pre className="text-xs mt-3 max-h-[40rem] overflow-auto bg-slate-50 p-3">{JSON.stringify(trace, null, 2)}</pre></> : <p>Select a request or recorded trace.</p>}</section></div>
  </div>;
}
