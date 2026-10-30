import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { responseError } from '../lib/api_error';
import { useUiText } from '../lib/ui_text';
import text from '../../config/ui/jh16-evaluation.json';

/**
 * The stored JH16 evaluation of a run: how Hi compares with the reference harm
 * scores, the pre-registered verdicts and the reading of the hypothesis.
 * Everything shown is read from the run's evaluation artifact; nothing here is
 * computed in the browser.
 * Interface words come from config/ui/jh16-evaluation.json; the attempt meaning,
 * the hypothesis rule, claim keys, verdict codes and rationales, flags and
 * missing-reason codes are stored data, shown as stored.
 */

const fmt = (v: number | null | undefined, digits = 4) => v === null || v === undefined ? '—' : Number(v).toFixed(digits);
const fmtP = (v: number | null | undefined) => v === null || v === undefined ? '—' : v < 0.001 ? Number(v).toExponential(2) : Number(v).toFixed(4);
const fmtCount = (v: number | null) => v === null ? null : v.toLocaleString('pl-PL');
const fmtPct = (v: number | null) => v === null ? null : Math.abs(v) >= 1000 ? Number(v).toExponential(3) : Number(v).toFixed(2);

// Hypothesis-reading codes; their labels are `reading_<code>` in the bundle.
const READING: Record<string, string> = {
  supports: 'bg-emerald-50 text-emerald-900 border-emerald-300',
  contradicts: 'bg-red-50 text-red-900 border-red-300',
  undecided: 'bg-amber-50 text-amber-900 border-amber-300',
  not_computable: 'bg-slate-100 text-slate-800 border-slate-300',
};
// Stable comparison ids: they name the rows in data-testid and are not shown.
const CMP = { hi: 'Hi vs Nutt', pi: 'Pi vs Nutt', published: 'Pi vs Tabela 1' };

const usePageText = () => useUiText(text);
/** A bundle sentence with React nodes (a bold value, a code span) in its {placeholders}. */
function rich(sentence: string, nodes: Record<string, ReactNode>): ReactNode {
  return sentence.split(/\{([a-z0-9_]+)\}/g).map((part, i) => i % 2 ? <Fragment key={i}>{part in nodes ? nodes[part] : `{${part}}`}</Fragment> : part);
}
/** JSON of a response; a refusal becomes a coded error (`errorText` shows it in the reader's language). */
const getJson = (url: string) => fetch(url).then(async r => { const d = await r.json().catch(() => null); if (!r.ok) throw responseError(r, d); return d; });

function StatRows({ id, label, stats }: { id: string; label: string; stats: any[] }) {
  return <>{stats.map(s => <tr key={id + s.statistic} className="border-t border-slate-100">
    <td className="py-1.5 pr-3">{label}</td><td className="pr-3">{s.statistic}</td>
    <td className="pr-3 font-mono" data-testid={`stat-${id}-${s.statistic}`}>{fmt(s.value)}</td>
    <td className="pr-3 font-mono">{fmtP(s.p_two_sided)}</td><td className="font-mono">{s.n}</td></tr>)}</>;
}

/** Hi (x) against the reference score (y). Log x when Hi spans more than three decades. */
function Scatter({ rows }: { rows: any[] }) {
  const { t } = usePageText();
  const pts = rows.filter(r => r.Hi !== null && r.Hi > 0 && r.reference_score !== null);
  if (pts.length < 2) return null;
  const xs = pts.map(p => p.Hi), log = Math.max(...xs) / Math.min(...xs) > 1000;
  const fx = (v: number) => log ? Math.log10(v) : v;
  const x0 = Math.min(...xs.map(fx)), x1 = Math.max(...xs.map(fx)), y1 = Math.max(...pts.map(p => p.reference_score));
  const W = 600, H = 260, m = 36, right = 90;
  const px = (v: number) => m + (x1 === x0 ? 0.5 : (fx(v) - x0) / (x1 - x0)) * (W - m - right);
  const py = (v: number) => H - m - (v / y1) * (H - 2 * m);
  return <figure className="mt-3">
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-2xl" role="img" aria-label={t('scatter_aria')}>
      <line x1={m} y1={H - m} x2={W - right} y2={H - m} stroke="currentColor" opacity={0.4} />
      <line x1={m} y1={m / 2} x2={m} y2={H - m} stroke="currentColor" opacity={0.4} />
      {pts.map(p => <g key={p.entity_id}><circle cx={px(p.Hi)} cy={py(p.reference_score)} r={4} className={p.flags.length ? 'fill-amber-500' : 'fill-indigo-600'} />
        <text x={px(p.Hi) + 6} y={py(p.reference_score) - 4} fontSize={10} className="fill-slate-600">{p.entity_id.split(' ')[0]}</text></g>)}
      <text x={W / 2} y={H - 6} fontSize={11} textAnchor="middle" className="fill-slate-600">{t(log ? 'axis_hi_log' : 'axis_hi')}</text>
      <text x={12} y={H / 2} fontSize={11} textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`} className="fill-slate-600">{t('axis_reference')}</text>
    </svg>
    <figcaption className="text-xs text-slate-600">{t('scatter_caption')}</figcaption>
  </figure>;
}

export function Jh16EvaluationPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<any>(null), [error, setError] = useState<unknown>(null);
  const { t, tCode, errorText } = usePageText();
  useEffect(() => {
    getJson(`/api/runs/${runId}/evaluation`).then(setData).catch(setError);
  }, [runId]);
  if (error !== null) return <p role="alert" className="text-sm text-red-900">{t('load_failed', { error: errorText(error) })}</p>;
  if (!data?.evaluation) return null;
  const ev = data.evaluation, readingClass = READING[ev.hypothesis_harm.reading];
  const readingLabel = (code: string) => tCode('reading_', code);
  return <section data-testid="jh16-evaluation" className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4 min-w-0 overflow-hidden">
    <div>
      <h2 className="font-semibold text-slate-900">{t('title')}</h2>
      <p className="text-sm mt-1" data-testid="attempt-kind"><b>{t(ev.attempt_kind === 'pipeline_self_check' ? 'attempt_pipeline_self_check' : 'attempt_independent')}</b> — {ev.attempt_meaning}</p>
      {data.run.variant_id && <p className="text-sm mt-1" data-testid="variant">{rich(t('variant', { differences: data.run.variant_differences.join('; ') || '—' }), { variant: <b>{data.run.variant_id}</b> })}</p>}
      {Object.keys(data.run.provider_params ?? {}).length > 0 && <p className="text-xs">{rich(t('provider_params'), { params: <code>{JSON.stringify(data.run.provider_params)}</code> })}</p>}
      <p className="text-xs text-slate-600 mt-1">{t('reference_line', { set_key: ev.reference.set_key, version: ev.reference.version, claims_version: ev.claims_version,
        interpretation_version: ev.interpretation.version, commit: ev.interpretation.registered_in_commit })}</p>
    </div>
    {!ev.complete && <p role="status" data-testid="incomplete" className="text-sm p-3 rounded border border-slate-300 bg-slate-50">{t('incomplete', { entities: ev.missing_entities.join(', ') })}</p>}
    <div className={`p-3 rounded border text-sm ${readingClass}`} data-testid="hypothesis-reading" data-reading={ev.hypothesis_harm.reading}>
      <b>{t('hypothesis', { reading: readingLabel(ev.hypothesis_harm.reading) })}</b> <span className="text-xs">{t('rule', { rule: ev.hypothesis_harm.rule })}</span>
    </div>
    <div className="overflow-x-auto max-w-full"><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th>{t('col_comparison')}</th><th>{t('col_statistic')}</th><th>{t('col_value')}</th><th>{t('col_p_two_sided')}</th><th>{t('col_n')}</th></tr></thead><tbody>
      <StatRows id={CMP.hi} label={t('cmp_hi_nutt')} stats={ev.hi_vs_reference} />
      <StatRows id={CMP.pi} label={t('cmp_pi_nutt')} stats={ev.pi_vs_reference} />
      <StatRows id={CMP.published} label={t('cmp_pi_table1')} stats={[ev.pi_vs_published]} />
    </tbody></table></div>
    <div><h3 className="font-medium text-sm">{t('verdicts_title')}</h3>
      <ul className="text-sm space-y-1 mt-1">{ev.verdicts.map((v: any) => <li key={v.claim_key} data-testid={`verdict-${v.claim_key}`} data-verdict={v.verdict}><code>{v.claim_key}</code>: <b>{v.verdict}</b> — {v.rationale}</li>)}</ul>
      <p className="text-xs text-slate-600">{t('verdicts_note')}</p></div>
    <Scatter rows={ev.entities} />
    <details><summary className="text-sm font-medium cursor-pointer">{t('entities_summary')}</summary>
      <div className="overflow-x-auto max-w-full"><table className="text-xs mt-2 min-w-full" data-testid="entity-table"><thead className="text-left text-slate-500"><tr>
        <th className="pr-2">{t('col_substance')}</th><th className="pr-2">{t('col_ni')}</th><th className="pr-2">{t('col_ni_harm')}</th><th className="pr-2">{t('col_pi_pct')}</th><th className="pr-2">{t('col_hi_pct')}</th>
        <th className="pr-2">{t('col_pi_2014')}</th><th className="pr-2">{t('col_hi_2014')}</th><th className="pr-2">{t('col_nutt')}</th><th>{t('col_flags')}</th></tr></thead>
        <tbody>{ev.entities.map((e: any) => <tr key={e.entity_id} className="border-t border-slate-100" data-testid={`entity-${e.entity_id}`}>
          <td className="pr-2">{e.entity_id}</td>
          {[fmtCount(e.Ni), fmtCount(e.Ni_harm), fmtPct(e.Pi), fmtPct(e.Hi)].map((v, i) => <td key={i} className="pr-2 font-mono">{v ?? <i className="text-slate-500">{t('missing_not_zero')}</i>}</td>)}
          <td className="pr-2 font-mono">{e.published_Pi ?? '—'}</td><td className="pr-2 font-mono">{e.published_Hi ?? '—'}</td><td className="pr-2 font-mono">{e.reference_score ?? '—'}</td>
          <td>{[...e.flags, ...e.missing.map((m: any) => `${m.query_role}: ${m.reason}`)].join(', ')}</td></tr>)}</tbody></table></div>
    </details>
    {ev.exploratory.length > 0 && <details><summary className="text-sm font-medium cursor-pointer">{t('exploratory_summary')}</summary>
      <table className="w-full text-sm mt-2"><tbody>{ev.exploratory.map((x: any) => <StatRows key={x.id} id={`${x.id}${x.excluded.length ? ` (bez: ${x.excluded.join(', ')})` : ''}`}
        label={x.excluded.length ? t('exploratory_without', { id: x.id, excluded: x.excluded.join(', ') }) : x.id} stats={x.hi_vs_reference} />)}</tbody></table>
      <p className="text-xs text-slate-600">{ev.exploratory.map((x: any) => `${x.id}: ${x.reason}`).join(' · ')}</p></details>}
    {data.plan_runs.length > 0 && <div><h3 className="font-medium text-sm">{t('plan_runs_title')}</h3>
      <div className="overflow-x-auto max-w-full"><table className="w-full text-xs mt-1" data-testid="plan-runs"><thead className="text-left text-slate-500"><tr><th>{t('col_run')}</th><th>{t('col_variant')}</th><th>{t('col_pearson_hi')}</th><th>{t('col_spearman_hi')}</th><th>{t('cmp_pi_table1')}</th><th>{t('col_reading')}</th></tr></thead>
        <tbody>{data.plan_runs.map((r: any) => <tr key={r.run_id} className="border-t border-slate-100"><td><Link className="underline" to={`/runs/${r.run_id}/results`}>{r.run_id.slice(0, 8)}</Link> {tCode('status_', r.status)}</td>
          <td>{r.variant ?? t('variant_faithful')}</td><td className="font-mono">{fmt(r.hi_vs_reference?.[0]?.value, 3)}</td><td className="font-mono">{fmt(r.hi_vs_reference?.[1]?.value, 3)}</td>
          <td className="font-mono">{fmt(r.pi_vs_published?.value, 3)}</td><td>{r.reading ? readingLabel(r.reading) : '—'}</td></tr>)}</tbody></table></div></div>}
  </section>;
}
