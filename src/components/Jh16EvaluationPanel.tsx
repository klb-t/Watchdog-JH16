import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * The stored JH16 evaluation of a run: how Hi compares with the reference harm
 * scores, the pre-registered verdicts and the reading of the hypothesis.
 * Everything shown is read from the run's evaluation artifact; nothing here is
 * computed in the browser.
 */

const fmt = (v: number | null | undefined, digits = 4) => v === null || v === undefined ? '—' : Number(v).toFixed(digits);
const fmtP = (v: number | null | undefined) => v === null || v === undefined ? '—' : v < 0.001 ? Number(v).toExponential(2) : Number(v).toFixed(4);
const fmtCount = (v: number | null) => v === null ? null : v.toLocaleString('pl-PL');
const fmtPct = (v: number | null) => v === null ? null : Math.abs(v) >= 1000 ? Number(v).toExponential(3) : Number(v).toFixed(2);

const READING: Record<string, { label: string; className: string }> = {
  supports: { label: 'dane wspierają hipotezę', className: 'bg-emerald-50 text-emerald-900 border-emerald-300' },
  contradicts: { label: 'dane przeczą hipotezie', className: 'bg-red-50 text-red-900 border-red-300' },
  undecided: { label: 'dane nie rozstrzygają', className: 'bg-amber-50 text-amber-900 border-amber-300' },
  not_computable: { label: 'nie da się ocenić (niekompletne dane)', className: 'bg-slate-100 text-slate-800 border-slate-300' },
};

function StatRows({ label, stats }: { label: string; stats: any[] }) {
  return <>{stats.map(s => <tr key={label + s.statistic} className="border-t border-slate-100">
    <td className="py-1.5 pr-3">{label}</td><td className="pr-3">{s.statistic}</td>
    <td className="pr-3 font-mono" data-testid={`stat-${label}-${s.statistic}`}>{fmt(s.value)}</td>
    <td className="pr-3 font-mono">{fmtP(s.p_two_sided)}</td><td className="font-mono">{s.n}</td></tr>)}</>;
}

/** Hi (x) against the reference score (y). Log x when Hi spans more than three decades. */
function Scatter({ rows }: { rows: any[] }) {
  const pts = rows.filter(r => r.Hi !== null && r.Hi > 0 && r.reference_score !== null);
  if (pts.length < 2) return null;
  const xs = pts.map(p => p.Hi), log = Math.max(...xs) / Math.min(...xs) > 1000;
  const fx = (v: number) => log ? Math.log10(v) : v;
  const x0 = Math.min(...xs.map(fx)), x1 = Math.max(...xs.map(fx)), y1 = Math.max(...pts.map(p => p.reference_score));
  const W = 600, H = 260, m = 36, right = 90;
  const px = (v: number) => m + (x1 === x0 ? 0.5 : (fx(v) - x0) / (x1 - x0)) * (W - m - right);
  const py = (v: number) => H - m - (v / y1) * (H - 2 * m);
  return <figure className="mt-3">
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-2xl" role="img" aria-label="Hi względem oceny referencyjnej">
      <line x1={m} y1={H - m} x2={W - right} y2={H - m} stroke="currentColor" opacity={0.4} />
      <line x1={m} y1={m / 2} x2={m} y2={H - m} stroke="currentColor" opacity={0.4} />
      {pts.map(p => <g key={p.entity_id}><circle cx={px(p.Hi)} cy={py(p.reference_score)} r={4} className={p.flags.length ? 'fill-amber-500' : 'fill-indigo-600'} />
        <text x={px(p.Hi) + 6} y={py(p.reference_score) - 4} fontSize={10} className="fill-slate-600">{p.entity_id.split(' ')[0]}</text></g>)}
      <text x={W / 2} y={H - 6} fontSize={11} textAnchor="middle" className="fill-slate-600">Hi (%){log ? ', skala logarytmiczna' : ''}</text>
      <text x={12} y={H / 2} fontSize={11} textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`} className="fill-slate-600">ocena szkodliwości (Nutt 2010)</text>
    </svg>
    <figcaption className="text-xs text-slate-600">Punkty pomarańczowe mają flagę jakości (np. liczba równa osiągalnym wynikom, Hi powyżej 100%).</figcaption>
  </figure>;
}

export function Jh16EvaluationPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<any>(null), [error, setError] = useState('');
  useEffect(() => {
    fetch(`/api/runs/${runId}/evaluation`).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(setData).catch(e => setError(String(e.message ?? e)));
  }, [runId]);
  if (error) return <p role="alert" className="text-sm text-red-900">Nie można wczytać oceny: {error}</p>;
  if (!data?.evaluation) return null;
  const ev = data.evaluation, reading = READING[ev.hypothesis_harm.reading];
  return <section data-testid="jh16-evaluation" className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4 min-w-0 overflow-hidden">
    <div>
      <h2 className="font-semibold text-slate-900">JH16: ocena względem publikacji i hipotezy</h2>
      <p className="text-sm mt-1" data-testid="attempt-kind"><b>{ev.attempt_kind === 'pipeline_self_check' ? 'Ponowne przeliczenie danych z publikacji' : 'Niezależny pomiar'}</b> — {ev.attempt_meaning}</p>
      {data.run.variant_id && <p className="text-sm mt-1" data-testid="variant">Wariant rozszerzenia: <b>{data.run.variant_id}</b> (to nie jest replikacja). Różnice wobec metody wiernej: {data.run.variant_differences.join('; ') || '—'}</p>}
      {Object.keys(data.run.provider_params ?? {}).length > 0 && <p className="text-xs">Parametry dostawcy tego przebiegu: <code>{JSON.stringify(data.run.provider_params)}</code></p>}
      <p className="text-xs text-slate-600 mt-1">Odniesienie: {ev.reference.set_key} {ev.reference.version} · kryteria: rejestr {ev.claims_version}, interpretacja {ev.interpretation.version} (prerejestracja {ev.interpretation.registered_in_commit}).</p>
    </div>
    {!ev.complete && <p role="status" data-testid="incomplete" className="text-sm p-3 rounded border border-slate-300 bg-slate-50">Przebieg niekompletny: brak ważnej wartości dla {ev.missing_entities.join(', ')}. Werdykty wymagają wszystkich 16 substancji.</p>}
    <div className={`p-3 rounded border text-sm ${reading.className}`} data-testid="hypothesis-reading" data-reading={ev.hypothesis_harm.reading}>
      <b>Hipoteza H-harm (Hi koreluje z oceną ekspercką): {reading.label}.</b> <span className="text-xs">Reguła ustalona przed danymi: {ev.hypothesis_harm.rule}.</span>
    </div>
    <div className="overflow-x-auto max-w-full"><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th>Porównanie</th><th>Statystyka</th><th>Wartość</th><th>p (dwustronne)</th><th>n</th></tr></thead><tbody>
      <StatRows label="Hi vs Nutt" stats={ev.hi_vs_reference} />
      <StatRows label="Pi vs Nutt" stats={ev.pi_vs_reference} />
      <StatRows label="Pi vs Tabela 1" stats={[ev.pi_vs_published]} />
    </tbody></table></div>
    <div><h3 className="font-medium text-sm">Werdykty prerejestrowanych twierdzeń</h3>
      <ul className="text-sm space-y-1 mt-1">{ev.verdicts.map((v: any) => <li key={v.claim_key} data-testid={`verdict-${v.claim_key}`} data-verdict={v.verdict}><code>{v.claim_key}</code>: <b>{v.verdict}</b> — {v.rationale}</li>)}</ul>
      <p className="text-xs text-slate-600">Publikacja: Pearson 0,816 na 16 substancjach (2014-06-20). „reproduced” oznacza mieszczenie się w progu ustalonym przed pomiarem, nie identyczność danych.</p></div>
    <Scatter rows={ev.entities} />
    <details><summary className="text-sm font-medium cursor-pointer">Dane każdej substancji (liczby dostawcy, wskaźniki, publikacja)</summary>
      <div className="overflow-x-auto max-w-full"><table className="text-xs mt-2 min-w-full" data-testid="entity-table"><thead className="text-left text-slate-500"><tr>
        <th className="pr-2">Substancja</th><th className="pr-2">Ni</th><th className="pr-2">Ni_harm</th><th className="pr-2">Pi %</th><th className="pr-2">Hi %</th><th className="pr-2">Pi 2014</th><th className="pr-2">Hi 2014</th><th className="pr-2">Nutt</th><th>Flagi / braki</th></tr></thead>
        <tbody>{ev.entities.map((e: any) => <tr key={e.entity_id} className="border-t border-slate-100" data-testid={`entity-${e.entity_id}`}>
          <td className="pr-2">{e.entity_id}</td>
          {[fmtCount(e.Ni), fmtCount(e.Ni_harm), fmtPct(e.Pi), fmtPct(e.Hi)].map((v, i) => <td key={i} className="pr-2 font-mono">{v ?? <i className="text-slate-500">brak, nie zero</i>}</td>)}
          <td className="pr-2 font-mono">{e.published_Pi ?? '—'}</td><td className="pr-2 font-mono">{e.published_Hi ?? '—'}</td><td className="pr-2 font-mono">{e.reference_score ?? '—'}</td>
          <td>{[...e.flags, ...e.missing.map((m: any) => `${m.query_role}: ${m.reason}`)].join(', ')}</td></tr>)}</tbody></table></div>
    </details>
    {ev.exploratory.length > 0 && <details><summary className="text-sm font-medium cursor-pointer">Analizy eksploracyjne (nie zmieniają werdyktu)</summary>
      <table className="w-full text-sm mt-2"><tbody>{ev.exploratory.map((x: any) => <StatRows key={x.id} label={`${x.id}${x.excluded.length ? ` (bez: ${x.excluded.join(', ')})` : ''}`} stats={x.hi_vs_reference} />)}</tbody></table>
      <p className="text-xs text-slate-600">{ev.exploratory.map((x: any) => `${x.id}: ${x.reason}`).join(' · ')}</p></details>}
    {data.plan_runs.length > 0 && <div><h3 className="font-medium text-sm">Inne przebiegi tego planu</h3>
      <div className="overflow-x-auto max-w-full"><table className="w-full text-xs mt-1" data-testid="plan-runs"><thead className="text-left text-slate-500"><tr><th>Przebieg</th><th>Wariant</th><th>Pearson Hi</th><th>Spearman Hi</th><th>Pi vs Tabela 1</th><th>Odczyt</th></tr></thead>
        <tbody>{data.plan_runs.map((r: any) => <tr key={r.run_id} className="border-t border-slate-100"><td><Link className="underline" to={`/runs/${r.run_id}/results`}>{r.run_id.slice(0, 8)}</Link> {r.status}</td>
          <td>{r.variant ?? 'wierny'}</td><td className="font-mono">{fmt(r.hi_vs_reference?.[0]?.value, 3)}</td><td className="font-mono">{fmt(r.hi_vs_reference?.[1]?.value, 3)}</td>
          <td className="font-mono">{fmt(r.pi_vs_published?.value, 3)}</td><td>{r.reading ? READING[r.reading].label : '—'}</td></tr>)}</tbody></table></div></div>}
  </section>;
}
