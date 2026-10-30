import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useUiText } from '../lib/ui_text';
import text from '../../config/ui/trends-calibration.json';

/**
 * Stored results of an exploratory Google Trends calibration run. Values are
 * read from the run's analysis results; nothing is computed in the browser.
 */
/** A bundle sentence with React nodes (a link) in its {placeholders}. */
function rich(sentence: string, nodes: Record<string, ReactNode>): ReactNode {
  return sentence.split(/\{([a-z0-9_]+)\}/g).map((part, i) => i % 2 ? <Fragment key={i}>{part in nodes ? nodes[part] : `{${part}}`}</Fragment> : part);
}
const fmt = (v: number | null | undefined, d = 3) => v === null || v === undefined ? '—' : Number(v).toFixed(d);

export function TrendsCalibrationPanel({ runId }: { runId: string }) {
  const [rows, setRows] = useState<any[] | null>(null), [config, setConfig] = useState<any>(null);
  const { t } = useUiText(text);
  useEffect(() => {
    fetch(`/api/runs/${runId}/results`).then(r => r.json()).then(d => setRows(d.analysis_results ?? [])).catch(() => setRows([]));
    // An analysis-only recomputation reads its counts, region and window from the source run.
    const configOf = (id: string) => fetch(`/api/runs/${id}`).then(r => r.json()).then(d => JSON.parse(d.run?.effective_config ?? '{}'));
    configOf(runId).then(async own => {
      const source = own.source_run_id ? await configOf(own.source_run_id).catch(() => ({})) : own;
      setConfig({ ...own, region_id: source.region_id, source_params: source.source_params, recomputedFrom: own.source_run_id ?? null });
    }).catch(() => {});
  }, [runId]);
  if (!rows || !config || config.method_id !== 'jh16_trends_calibration') return null;
  const analyses = config.method_params.calibration.analyses as { id: string; label: string }[];
  const get = (k: string) => rows.find(r => r.metricKey === k && !r.entityId);
  const windows = Object.keys(config.method_params.calibration.windows).sort();
  const entities = [...new Set(rows.filter(r => r.entityId).map(r => r.entityId as string))].sort();
  const value = (e: string, w: string) => rows.find(r => r.entityId === e && r.metricKey === `trends_${w}`);
  return <section data-testid="trends-calibration" className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-3 min-w-0 overflow-hidden">
    <h2 className="font-semibold">{t('title', { region: config.region_id ?? '?' })}</h2>
    {config.recomputedFrom && <p className="text-sm" data-testid="trends-recomputed">{rich(t('recomputed'), { run: <Link className="underline" to={`/runs/${config.recomputedFrom}/results`}>{config.recomputedFrom.slice(0, 8)}</Link> })}</p>}
    <p className="text-sm">{t('exploratory', { calibration_id: config.method_params.calibration.calibration_id, version: config.method_params.calibration.version, range: config.source_params?.provider_params?.date ?? config.method_params.calibration.provider_params?.date ?? '?' })}
      {' '}{rich(t('compare_run'), { compare: config.method_params.compare_run_id ? <Link className="underline" to={`/runs/${config.method_params.compare_run_id}/results`}>{config.method_params.compare_run_id.slice(0, 8)}</Link> : t('compare_none') })}</p>
    <div className="overflow-x-auto max-w-full"><table className="w-full text-sm" data-testid="trends-analyses"><thead className="text-left text-slate-500"><tr><th>{t('col_analysis')}</th><th>{t('col_spearman')}</th><th>{t('col_pearson_log10')}</th><th>{t('col_n')}</th><th>{t('col_excluded')}</th></tr></thead>
      <tbody>{analyses.map(a => { const s = get(`${a.id}_spearman`), p = get(`${a.id}_pearson_log10`), n = get(`${a.id}_n`);
        return <tr key={a.id} className="border-t border-slate-100" data-testid={`trends-${a.id}`}><td className="py-1.5 pr-2">{a.id}: {a.label}</td><td className="font-mono">{s?.isMissing ? t('not_computable') : fmt(s?.valueNumeric)}</td>
          <td className="font-mono">{p?.isMissing ? '—' : fmt(p?.valueNumeric)}</td><td className="font-mono">{n?.valueNumeric ?? '—'}</td><td className="text-xs">{(s?.statisticMetadata?.excluded ?? []).join(', ')}</td></tr>; })}</tbody></table></div>
    <details><summary className="text-sm font-medium cursor-pointer">{t('scaled_interest')}</summary>
      <div className="overflow-x-auto max-w-full"><table className="text-xs mt-2 min-w-full"><thead className="text-left text-slate-500"><tr><th className="pr-2">{t('col_substance')}</th>{windows.map(w => <th key={w} className="pr-2">{w}</th>)}</tr></thead>
        <tbody>{entities.map(e => <tr key={e} className="border-t border-slate-100"><td className="pr-2">{e}</td>{windows.map(w => { const v = value(e, w); return <td key={w} className="pr-2 font-mono">{v?.isMissing ? <i>{t('missing')}</i> : fmt(v?.valueNumeric, 2)}</td>; })}</tr>)}</tbody></table></div>
      <p className="text-xs">{t('scale_factors', { factors: (config.method_params.calibration.groups as any[]).map(g => `${g.id} ${fmt(get(`scale_${g.id}`)?.valueNumeric)}`).join(' · ') })}</p></details>
  </section>;
}
