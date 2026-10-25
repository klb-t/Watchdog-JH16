import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Stored results of an exploratory Google Trends calibration run. Values are
 * read from the run's analysis results; nothing is computed in the browser.
 */
const fmt = (v: number | null | undefined, d = 3) => v === null || v === undefined ? '—' : Number(v).toFixed(d);

export function TrendsCalibrationPanel({ runId }: { runId: string }) {
  const [rows, setRows] = useState<any[] | null>(null), [config, setConfig] = useState<any>(null);
  useEffect(() => {
    fetch(`/api/runs/${runId}/results`).then(r => r.json()).then(d => setRows(d.analysis_results ?? [])).catch(() => setRows([]));
    fetch(`/api/runs/${runId}`).then(r => r.json()).then(d => setConfig(JSON.parse(d.run?.effective_config ?? '{}'))).catch(() => {});
  }, [runId]);
  if (!rows || !config || config.method_id !== 'jh16_trends_calibration') return null;
  const analyses = config.method_params.calibration.analyses as { id: string; label: string }[];
  const get = (k: string) => rows.find(r => r.metricKey === k && !r.entityId);
  const windows = Object.keys(config.method_params.calibration.windows).sort();
  const entities = [...new Set(rows.filter(r => r.entityId).map(r => r.entityId as string))].sort();
  const value = (e: string, w: string) => rows.find(r => r.entityId === e && r.metricKey === `trends_${w}`);
  return <section data-testid="trends-calibration" className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-3 min-w-0 overflow-hidden">
    <h2 className="font-semibold">Kalibracja Google Trends — region {config.region_id}</h2>
    <p className="text-sm">{config.attempt_meaning}. Konfiguracja {config.preset_id} {config.preset_version}; zakres {config.source_params.provider_params.date}.
      {' '}Porównanie z przebiegiem: {config.method_params.compare_run_id ? <Link className="underline" to={`/runs/${config.method_params.compare_run_id}/results`}>{config.method_params.compare_run_id.slice(0, 8)}</Link> : 'brak (A3/A4 nieobliczalne)'}.</p>
    <div className="overflow-x-auto max-w-full"><table className="w-full text-sm" data-testid="trends-analyses"><thead className="text-left text-slate-500"><tr><th>Analiza</th><th>Spearman</th><th>Pearson (log10)</th><th>n</th><th>Wyłączone</th></tr></thead>
      <tbody>{analyses.map(a => { const s = get(`${a.id}_spearman`), p = get(`${a.id}_pearson_log10`), n = get(`${a.id}_n`);
        return <tr key={a.id} className="border-t border-slate-100" data-testid={`trends-${a.id}`}><td className="py-1.5 pr-2">{a.id}: {a.label}</td><td className="font-mono">{s?.isMissing ? 'nieobliczalne' : fmt(s?.valueNumeric)}</td>
          <td className="font-mono">{p?.isMissing ? '—' : fmt(p?.valueNumeric)}</td><td className="font-mono">{n?.valueNumeric ?? '—'}</td><td className="text-xs">{(s?.statisticMetadata?.excluded ?? []).join(', ')}</td></tr>; })}</tbody></table></div>
    <details><summary className="text-sm font-medium cursor-pointer">Skalowane zainteresowanie (wspólna skala przez kotwice)</summary>
      <div className="overflow-x-auto max-w-full"><table className="text-xs mt-2 min-w-full"><thead className="text-left text-slate-500"><tr><th className="pr-2">Substancja</th>{windows.map(w => <th key={w} className="pr-2">{w}</th>)}</tr></thead>
        <tbody>{entities.map(e => <tr key={e} className="border-t border-slate-100"><td className="pr-2">{e}</td>{windows.map(w => { const v = value(e, w); return <td key={w} className="pr-2 font-mono">{v?.isMissing ? <i>brak</i> : fmt(v?.valueNumeric, 2)}</td>; })}</tr>)}</tbody></table></div>
      <p className="text-xs">Współczynniki skali: {(config.method_params.calibration.groups as any[]).map(g => `${g.id} ${fmt(get(`scale_${g.id}`)?.valueNumeric)}`).join(' · ')}</p></details>
  </section>;
}
