import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

/**
 * Replications: one entry per registered target. The target page shows the
 * hypotheses and verdicts, agreement with the paper, discrepancies with their
 * status, calibration, the pre-registration, every stored run with the
 * provenance of its numbers, a comparison of selected runs down to the
 * provider responses, and the manuscript assembled from those results.
 * Values are read from the server; the page computes no statistic.
 */

const fmt = (v: number | null | undefined, d = 3) => v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(d);
const fmtP = (v: number | null | undefined) => v === null || v === undefined ? '—' : v < 0.001 ? Number(v).toExponential(2) : Number(v).toFixed(4);
const READING: Record<string, string> = { supports: 'wspierają', contradicts: 'przeczą', undecided: 'nie rozstrzygają', not_computable: 'nie da się ocenić' };
const STATUS: Record<string, [string, string]> = { shown: ['wykazana', 'bg-red-50 text-red-900 border-red-200'], probable: ['prawdopodobna', 'bg-amber-50 text-amber-900 border-amber-200'],
  unresolved: ['nierozstrzygnięta', 'bg-slate-100 text-slate-800 border-slate-300'], excluded: ['wykluczona', 'bg-emerald-50 text-emerald-900 border-emerald-200'] };
const card = 'bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-3 min-w-0 overflow-hidden';
const scroll = 'overflow-x-auto max-w-full';
const short = (id: string) => id.slice(0, 8);

export function Replications() {
  const [targets, setTargets] = useState<any[] | null>(null), [error, setError] = useState('');
  useEffect(() => { fetch('/api/replications').then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))).then(d => setTargets(d.targets)).catch(e => setError(e.message)); }, []);
  return <div className="p-4 sm:p-8 max-w-5xl mx-auto space-y-6" data-testid="replications-page">
    <div><h1 className="text-2xl font-semibold">Replikacje</h1><p className="text-sm text-slate-600">Każda praca zarejestrowana w konfiguracji z kryteriami ustalonymi przed danymi. Wyniki, rozbieżności i projekt pracy powstają z zapisanych przebiegów.</p></div>
    {error && <p role="alert" className="text-red-900">{error}</p>}
    {targets?.length === 0 && <p>Brak zarejestrowanych prac.</p>}
    {targets?.map(t => <Link key={t.target_id} to={`/replications/${t.target_id}`} className={`${card} block hover:border-indigo-300`} data-testid={`replication-${t.target_id}`}>
      <div className="font-semibold">{t.title}</div>
      <div className="text-sm text-slate-600">{t.citation.authors.join(', ')} · {t.citation.journal} {t.citation.year} · doi:{t.identifier}</div>
      <div className="text-sm">{t.has_dossier ? `${t.runs} przebiegów w tej instalacji` : 'bez opisu replikacji (dossier) — pokazywane są tylko kryteria'}</div>
    </Link>)}
  </div>;
}

type Tab = 'overview' | 'runs' | 'discrepancies' | 'calibration' | 'registry' | 'manuscript';

export function ReplicationTarget() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null), [error, setError] = useState(''), [tab, setTab] = useState<Tab>('overview');
  useEffect(() => { fetch(`/api/replications/${id}`).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))).then(setData).catch(e => setError(e.message)); }, [id]);
  if (error) return <div className="p-8" role="alert">Nie można wczytać replikacji: {error}</div>;
  if (!data) return <div className="p-8">Wczytywanie…</div>;
  const tabs: [Tab, string][] = [['overview', 'Przegląd'], ['runs', `Przebiegi (${data.runs.length})`], ['discrepancies', 'Rozbieżności'], ['calibration', 'Kalibracja'], ['registry', 'Rejestr kryteriów'], ['manuscript', 'Projekt pracy']];
  return <div className="p-4 sm:p-8 max-w-6xl mx-auto space-y-5 min-w-0" data-testid="replication-target">
    <div className="text-sm text-slate-500"><Link to="/replications" className="underline">Replikacje</Link> / {data.target.target_id}</div>
    <div><h1 className="text-xl sm:text-2xl font-semibold">{data.target.title}</h1>
      <p className="text-sm text-slate-600">{data.target.citation.authors.join(', ')} · {data.target.citation.journal} {data.target.citation.year} · doi:{data.target.identifier}</p></div>
    <div className="flex flex-wrap gap-2" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} data-testid={`tab-${k}`}
      className={`rounded px-3 py-2 text-sm ${tab === k ? 'bg-indigo-100 text-indigo-900' : 'bg-slate-100'}`} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === 'overview' && <Overview data={data} />}
    {tab === 'runs' && <Runs data={data} />}
    {tab === 'discrepancies' && <Discrepancies data={data} />}
    {tab === 'calibration' && <Calibration data={data} />}
    {tab === 'registry' && <Registry data={data} />}
    {tab === 'manuscript' && <ManuscriptView id={id!} />}
  </div>;
}

const hi = (r: any, s: string) => r.evaluation?.hi_vs_reference?.find((x: any) => x.statistic === s);
const verdict = (r: any, k: string) => r.evaluation?.verdicts?.find((v: any) => v.claim_key === k)?.verdict ?? '—';

function ProvenanceBadge({ r }: { r: any }) {
  const color: Record<string, string> = { recomputation_of_published_data: 'bg-sky-50 text-sky-900 border-sky-200', new_fetch: 'bg-indigo-50 text-indigo-900 border-indigo-200',
    enhanced_variant: 'bg-violet-50 text-violet-900 border-violet-200', recomputation_of_stored_data: 'bg-slate-100 text-slate-800 border-slate-300', exploratory_calibration: 'bg-amber-50 text-amber-900 border-amber-200' };
  return <span className={`text-xs px-2 py-0.5 rounded border ${color[r.provenance] ?? ''}`} data-testid={`provenance-${r.run_id}`}>{r.provenance_label}{r.variant ? ` · ${r.variant}` : ''}</span>;
}

function Overview({ data }: { data: any }) {
  const primary = data.runs.filter((r: any) => data.primary_run_ids.includes(r.run_id) && r.evaluation);
  const rep = data.published?.reported_statistics;
  return <div className="space-y-4">
    <section className={card}><h2 className="font-semibold">Hipotezy</h2>
      <ul className="text-sm space-y-1">{data.dossier.hypotheses.map((h: any) => <li key={h.id}><b>{h.id}</b> ({h.kind === 'primary' ? 'główna' : 'opisowa'}): {h.statement}</li>)}</ul>
      {rep && <p className="text-sm">Publikacja: współczynnik {rep.correlation_coefficient_percent}%, p = {rep.p_value}, n = {rep.n}.</p>}</section>
    <section className={card} data-testid="overview-verdicts"><h2 className="font-semibold">Werdykty i zgodność z publikacją (najnowsze kompletne przebiegi każdego rodzaju)</h2>
      {primary.length === 0 ? <p className="text-sm">Brak kompletnych przebiegów. Uruchom przeliczenie danych z publikacji (Nowe badanie) albo nowy pomiar (Ustawienia → kreator).</p> :
      <div className={scroll}><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th>Pochodzenie liczb</th><th>Pearson Hi (p)</th><th>Spearman Hi</th><th>Pi vs Tab. 1</th><th>H-harm</th><th>Ranking</th><th>Odczyt hipotezy</th><th></th></tr></thead>
        <tbody>{primary.map((r: any) => <tr key={r.run_id} className="border-t border-slate-100" data-testid={`overview-row-${r.run_id}`}><td className="py-1.5 pr-2"><ProvenanceBadge r={r} /></td>
          <td className="font-mono">{fmt(hi(r, 'pearson')?.value)} ({fmtP(hi(r, 'pearson')?.p_two_sided)})</td><td className="font-mono">{fmt(hi(r, 'spearman')?.value)}</td>
          <td className="font-mono">{fmt(r.evaluation.pi_vs_published.value)}</td><td>{verdict(r, 'harm_index_vs_reference_pearson')}</td><td>{verdict(r, 'popularity_ranking_stability')}</td>
          <td>{READING[r.evaluation.hypothesis_harm.reading]}</td><td><Link className="underline" to={`/runs/${r.run_id}/results`}>wyniki</Link></td></tr>)}</tbody></table></div>}
      <p className="text-xs text-slate-600">„reproduced” = w progu ustalonym przed danymi. Przeliczenie danych z publikacji sprawdza obliczenia, nie jest niezależną replikacją.</p></section>
    {(data.dossier.assessment ?? []).length > 0 && <section className={card} data-testid="assessment"><h2 className="font-semibold">Ocena</h2>
      <ul className="text-sm space-y-1">{data.dossier.assessment.map((a: any) => <li key={a.statement}>{a.statement} <span className="text-xs text-slate-500">— {a.author}{(a.evidence ?? []).map((e: any) => <a key={e.path} className="underline ml-1" href={`${data.dossier.evidence_base_url}${e.path}`} target="_blank" rel="noreferrer">{e.label}</a>)}</span></li>)}</ul></section>}
    <section className={card}><h2 className="font-semibold">Odstępstwa od metody oryginalnej</h2>
      <div className={scroll}><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th>Element</th><th>Oryginał</th><th>Replikacja</th><th>Powód</th></tr></thead>
        <tbody>{data.dossier.deviations.map((d: any) => <tr key={d.item} className="border-t border-slate-100"><td className="pr-2">{d.item}</td><td className="pr-2">{d.original}</td><td className="pr-2">{d.replication}</td><td>{d.reason}</td></tr>)}</tbody></table></div></section>
  </div>;
}

function Runs({ data }: { data: any }) {
  const kinds = [...new Set(data.runs.map((r: any) => r.provenance))] as string[];
  const [shown, setShown] = useState<string[]>(kinds), [onlyComplete, setOnlyComplete] = useState(false), [selected, setSelected] = useState<string[]>([]), [entity, setEntity] = useState<string | null>(null);
  const rows = data.runs.filter((r: any) => shown.includes(r.provenance) && (!onlyComplete || (r.status === 'COMPLETED' && (r.evaluation ? r.evaluation.complete : !!r.calibration))));
  const chosen = data.runs.filter((r: any) => selected.includes(r.run_id) && r.evaluation);
  return <div className="space-y-4">
    <section className={card}>
      <div className="flex flex-wrap gap-3 text-sm" data-testid="run-filters">{kinds.map(k => <label key={k} className="flex gap-1 items-center"><input type="checkbox" checked={shown.includes(k)}
        onChange={e => setShown(e.target.checked ? [...shown, k] : shown.filter(x => x !== k))} />{data.dossier.provenance_labels[k] ?? k}</label>)}
        <label className="flex gap-1 items-center"><input type="checkbox" checked={onlyComplete} onChange={e => setOnlyComplete(e.target.checked)} data-testid="only-complete" />tylko kompletne</label></div>
      <div className={scroll}><table className="w-full text-sm" data-testid="runs-table"><thead className="text-left text-slate-500"><tr><th></th><th>Przebieg</th><th>Pochodzenie</th><th>Pobranie (UTC)</th><th>Kod</th><th>Pearson Hi</th><th>Pi vs Tab. 1</th><th>A1 (Trends)</th><th>Stan</th></tr></thead>
        <tbody>{rows.map((r: any) => <tr key={r.run_id} className="border-t border-slate-100" data-testid={`run-row-${r.run_id}`}>
          <td>{r.evaluation && <input type="checkbox" aria-label={`porównaj ${short(r.run_id)}`} checked={selected.includes(r.run_id)} onChange={e => setSelected(e.target.checked ? [...selected, r.run_id] : selected.filter(x => x !== r.run_id))} />}</td>
          <td className="font-mono py-1.5"><Link className="underline" to={`/runs/${r.run_id}/results`}>{short(r.run_id)}</Link>{r.source_run_id && <span className="text-xs"> ← {short(r.source_run_id)}</span>}</td>
          <td><ProvenanceBadge r={r} /></td><td className="text-xs">{r.acquired_utc ? `${r.acquired_utc[0].slice(0, 16).replace('T', ' ')}` : '—'}</td>
          <td className="font-mono text-xs">{r.git_commit?.slice(0, 7) ?? 'brak'}</td><td className="font-mono">{fmt(hi(r, 'pearson')?.value)}</td>
          <td className="font-mono">{fmt(r.evaluation?.pi_vs_published?.value)}</td><td className="font-mono">{fmt(r.calibration?.A1?.spearman)}</td>
          <td className="text-xs">{r.status}{r.evaluation && !r.evaluation.complete ? ` · braki: ${r.evaluation.missing_entities.length}` : ''}</td></tr>)}</tbody></table></div>
      <p className="text-xs text-slate-600">Zaznacz przebiegi JH16, aby je porównać. Kliknięcie substancji w porównaniu pokazuje zapytania i surowe odpowiedzi dostawcy.</p></section>
    {chosen.length > 0 && <Compare runs={chosen} onEntity={setEntity} />}
    {entity && chosen.length > 0 && <Drill runs={chosen} entity={entity} />}
  </div>;
}

function Compare({ runs, onEntity }: { runs: any[]; onEntity: (e: string) => void }) {
  const entities = runs[0].evaluation.entities.map((e: any) => e.entity_id) as string[];
  const val = (r: any, e: string, k: string) => r.evaluation.entities.find((x: any) => x.entity_id === e)?.[k] ?? null;
  const pearsons = runs.map(r => hi(r, 'pearson')?.value ?? 0), W = 520, H = 160, max = Math.max(1, ...pearsons.map(Math.abs));
  return <section className={card} data-testid="compare">
    <h2 className="font-semibold">Porównanie {runs.length} przebiegów</h2>
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-xl" role="img" aria-label="Pearson Hi wobec oceny Nutta w porównywanych przebiegach">
      <line x1={40} x2={W - 10} y1={H / 2} y2={H / 2} stroke="currentColor" opacity={0.4} />
      {runs.map((r, i) => { const x = 50 + i * ((W - 70) / runs.length), w = Math.max(8, (W - 90) / runs.length - 8), v = pearsons[i], h = Math.abs(v) / max * (H / 2 - 20);
        return <g key={r.run_id}><rect x={x} y={v >= 0 ? H / 2 - h : H / 2} width={w} height={h} className={v >= 0 ? 'fill-indigo-500' : 'fill-rose-500'} />
          <text x={x + w / 2} y={v >= 0 ? H / 2 - h - 4 : H / 2 + h + 12} fontSize={10} textAnchor="middle" className="fill-slate-700">{fmt(v, 2)}</text>
          <text x={x + w / 2} y={H - 2} fontSize={9} textAnchor="middle" className="fill-slate-500">{short(r.run_id)}</text></g>; })}
      <text x={4} y={14} fontSize={10} className="fill-slate-600">Pearson Hi–Nutt</text>
    </svg>
    <div className={scroll}><table className="text-xs min-w-full"><thead className="text-left text-slate-500"><tr><th className="pr-2">Substancja</th>{runs.map(r => <th key={r.run_id} className="pr-2">Hi % {short(r.run_id)}</th>)}{runs.map(r => <th key={r.run_id + 'pi'} className="pr-2">Pi % {short(r.run_id)}</th>)}<th>Nutt</th></tr></thead>
      <tbody>{entities.map(e => <tr key={e} className="border-t border-slate-100 hover:bg-indigo-50 cursor-pointer" onClick={() => onEntity(e)} data-testid={`compare-${e}`}><td className="pr-2 underline">{e}</td>
        {runs.map(r => { const v = val(r, e, 'Hi'), f = (r.evaluation.entities.find((x: any) => x.entity_id === e)?.flags ?? []).length; return <td key={r.run_id} className={`pr-2 font-mono ${f ? 'text-amber-700' : ''}`}>{v === null ? 'brak' : Math.abs(v) >= 1000 ? Number(v).toExponential(2) : fmt(v, 1)}{f ? '*' : ''}</td>; })}
        {runs.map(r => <td key={r.run_id + 'pi'} className="pr-2 font-mono">{fmt(val(r, e, 'Pi'), 2)}</td>)}<td className="font-mono">{val(runs[0], e, 'reference_score')}</td></tr>)}</tbody></table></div>
    <p className="text-xs text-slate-600">* wartość z flagą jakości (np. liczba równa osiągalnym wynikom, Hi powyżej 100%).</p></section>;
}

function Drill({ runs, entity }: { runs: any[]; entity: string }) {
  const [obs, setObs] = useState<Record<string, any[]>>({});
  useEffect(() => { Promise.all(runs.map(r => fetch(`/api/runs/${r.source_run_id ?? r.run_id}/results`).then(x => x.json()).then(d => [r.run_id, d.observations.filter((o: any) => o.entityId === entity)] as const)))
    .then(list => setObs(Object.fromEntries(list))); }, [runs.map(r => r.run_id).join(','), entity]);
  return <section className={card} data-testid="drill"><h2 className="font-semibold">{entity}: zapytania i odpowiedzi dostawcy</h2>
    <div className={scroll}><table className="text-xs min-w-full"><thead className="text-left text-slate-500"><tr><th className="pr-2">Przebieg</th><th className="pr-2">Wymiar</th><th className="pr-2">Wysłane zapytanie</th><th className="pr-2">Liczba</th><th className="pr-2">Flagi / brak</th><th>Surowa odpowiedź</th></tr></thead>
      <tbody>{runs.flatMap(r => (obs[r.run_id] ?? []).map((o: any, i: number) => <tr key={r.run_id + i} className="border-t border-slate-100"><td className="pr-2 font-mono">{short(r.run_id)}</td><td className="pr-2">{o.queryRole}</td>
        <td className="pr-2 font-mono">{o.queryText}</td><td className="pr-2 font-mono">{o.isMissing ? 'brak' : Number(o.numericValue).toLocaleString('pl-PL')}</td>
        <td className="pr-2">{o.isMissing ? o.missingReason : o.qualityFlags.join(', ')}</td>
        <td>{o.rawArtifactId ? <a className="underline" href={`/api/artifacts/${o.rawArtifactId}`} target="_blank" rel="noreferrer">pobierz</a> : '—'}</td></tr>))}</tbody></table></div>
    <p className="text-xs text-slate-600">Surowa odpowiedź to bajty zapisane przed obliczeniami (sha256 w manifeście przebiegu); klucz dostawcy nie jest w niej zapisany.</p></section>;
}

function Discrepancies({ data }: { data: any }) {
  const base = data.dossier.evidence_base_url;
  return <section className={card} data-testid="discrepancies"><h2 className="font-semibold">Rozbieżności i ich przyczyny</h2>
    <div className="flex flex-wrap gap-2 text-xs">{Object.entries(STATUS).map(([k, [l, c]]) => <span key={k} className={`px-2 py-0.5 rounded border ${c}`}>{l}</span>)}</div>
    <div className={scroll}><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th>Możliwa przyczyna</th><th>Test rozróżniający</th><th>Status</th><th>Dowód</th></tr></thead>
      <tbody>{data.dossier.diagnosis.map((d: any) => <tr key={d.cause} className="border-t border-slate-100 align-top" data-testid={`diagnosis-${d.status}`}><td className="py-1.5 pr-2">{d.cause}</td><td className="pr-2">{d.test}</td>
        <td className="pr-2"><span className={`text-xs px-2 py-0.5 rounded border ${STATUS[d.status]?.[1] ?? ''}`}>{STATUS[d.status]?.[0] ?? d.status}</span></td>
        <td className="text-xs">{(d.evidence ?? []).map((e: any) => e.path ? <a key={e.path} className="underline block" href={`${base}${e.path}`} target="_blank" rel="noreferrer">{e.label}</a> : <span key={e.label} className="block">{e.label}</span>)}{!(d.evidence ?? []).length && '—'}</td></tr>)}</tbody></table></div>
    <h3 className="font-medium text-sm">Ograniczenia</h3><ul className="text-sm list-disc ml-5">{data.dossier.limitations.map((l: string) => <li key={l}>{l}</li>)}</ul></section>;
}

function Calibration({ data }: { data: any }) {
  const cal = data.runs.filter((r: any) => r.calibration && r.status === 'COMPLETED');
  if (!cal.length) return <section className={card}><p className="text-sm">Brak przebiegów kalibracji. Uruchom ją w Ustawieniach → kreator → krok 2 „Kalibracja przez Google Trends”.</p></section>;
  const ids = Object.keys(cal[0].calibration);
  return <section className={card} data-testid="calibration"><h2 className="font-semibold">Kalibracja eksploracyjna (Google Trends)</h2>
    <p className="text-sm">Względne zainteresowanie wyszukiwaniem, nie liczba wyników; porównania rang (Spearman), bez werdyktów. Próbka Trends zmienia się między pobraniami.</p>
    <div className={scroll}><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th>Przebieg</th><th>Region</th>{ids.map(i => <th key={i}>{i}</th>)}</tr></thead>
      <tbody>{cal.map((r: any) => <tr key={r.run_id} className="border-t border-slate-100"><td className="font-mono py-1.5"><Link className="underline" to={`/runs/${r.run_id}/results`}>{short(r.run_id)}</Link></td><td>{r.variant}</td>
        {ids.map(i => <td key={i} className="font-mono">{r.calibration[i].spearman === null ? 'nieobliczalne' : fmt(r.calibration[i].spearman)}<span className="text-xs text-slate-500"> n{r.calibration[i].n}</span></td>)}</tr>)}</tbody></table></div>
    <p className="text-xs text-slate-600">A1: czerwiec 2014 vs Pi z Tabeli 1 · A2: zmiana 2012→2014 vs Tabela 2 · A3: ostatnie 12 mies. vs Pi porównywanego przebiegu · A3b: bez liczb „osiągalne wyniki” · A4: zmiana 2014→dziś.</p></section>;
}

function Registry({ data }: { data: any }) {
  return <section className={card} data-testid="registry"><h2 className="font-semibold">Rejestr kryteriów (ustalone przed danymi)</h2>
    <div className={scroll}><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th>Twierdzenie</th><th>Statystyka</th><th>Wartość w publikacji</th><th>Kryterium</th></tr></thead>
      <tbody>{data.target.claims.map((c: any) => <tr key={c.claim_key} className="border-t border-slate-100"><td className="py-1.5 pr-2 font-mono">{c.claim_key}</td><td>{c.statistic}</td><td className="font-mono">{c.claimed_value_numeric}</td>
        <td>{c.tolerance_kind === 'interval' ? `[${c.tolerance_value}; ${c.interval_upper}]` : `≥ ${c.tolerance_value}`}</td></tr>)}</tbody></table></div>
    <p className="text-sm">Pasma zarejestrowano w commicie <code>{data.target._pre_registration?.bands_proposed_in_commit?.slice(0, 7)}</code>; reguła odczytu hipotezy: {data.interpretation?.version} (commit <code>{data.interpretation?._pre_registration?.registered_in_commit}</code>); protokół: <a className="underline" href={`${data.dossier.evidence_base_url}${data.dossier.protocol.document}`} target="_blank" rel="noreferrer">{data.dossier.protocol.document}</a>.</p>
    {data.interpretation && <p className="text-sm">Odczyt H-harm: wspierają, gdy Pearson ≥ {data.interpretation.hypothesis_harm.supports.pearson_min} i p &lt; {data.interpretation.hypothesis_harm.supports.p_two_sided_below}; przeczą, gdy Pearson &lt; {data.interpretation.hypothesis_harm.contradicts.pearson_below} i Spearman &lt; {data.interpretation.hypothesis_harm.contradicts.spearman_below}; wymagane n = {data.interpretation.required_complete_n}.</p>}
    <p className="text-xs font-mono break-all">sha256 kryteriów {data.hashes.claims} · interpretacji {data.hashes.interpretation} · dossier {data.hashes.dossier}</p></section>;
}

function ManuscriptView({ id }: { id: string }) {
  const [m, setM] = useState<any>(null), [error, setError] = useState('');
  useEffect(() => { fetch(`/api/replications/${id}/manuscript`).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))).then(d => setM(d.manuscript)).catch(e => setError(e.message)); }, [id]);
  const srcLabel = useMemo(() => (s: any) => s.run_id ? <Link key={s.run_id} className="underline mr-2" to={`/runs/${s.run_id}/results`}>przebieg {short(s.run_id)}</Link> : <span key={s.path ?? s.config} className="mr-2">{s.path ?? `konfiguracja ${s.config}`}</span>, []);
  if (error) return <p role="alert">{error}</p>;
  if (!m) return <p>Składanie pracy z zapisanych wyników…</p>;
  return <article className={`${card} space-y-4`} data-testid="manuscript">
    <div className="flex flex-wrap gap-2"><a className="underline text-sm" href={`/api/replications/${id}/manuscript?format=md`} data-testid="manuscript-md">Pobierz Markdown</a><a className="underline text-sm" href={`/api/replications/${id}/manuscript?format=html`} data-testid="manuscript-html">Pobierz HTML</a></div>
    <h2 className="text-xl font-semibold">{m.title}</h2>
    <p className="text-xs text-slate-600">Złożone {m.generated_at} z zapisanych wyników (kod {m.code_version?.slice(0, 7) ?? '—'}, dane wejściowe {m.input_hash.slice(0, 16)}). Każdy blok wskazuje źródło. Tekst nie był redagowany przez model językowy.</p>
    {m.sections.map((s: any) => <section key={s.id} data-testid={`ms-${s.id}`} className="space-y-2"><h3 className="font-semibold">{s.title}</h3>
      {s.blocks.map((b: any, i: number) => <div key={i}>
        {b.type === 'p' && <p className="text-sm">{b.text}</p>}
        {b.type === 'list' && <ul className="text-sm list-disc ml-5">{b.items.map((x: string) => <li key={x}>{x}</li>)}</ul>}
        {b.type === 'table' && <div className={scroll}><table className="text-xs min-w-full"><thead className="text-left text-slate-500"><tr>{b.columns.map((c: string) => <th key={c} className="pr-2">{c}</th>)}</tr></thead>
          <tbody>{b.rows.map((r: any[], j: number) => <tr key={j} className="border-t border-slate-100">{r.map((c, k) => <td key={k} className="pr-2">{c === null ? '—' : String(c)}</td>)}</tr>)}</tbody></table></div>}
        {b.sources?.length > 0 && <p className="text-xs text-slate-500">Źródło: {b.sources.map(srcLabel)}</p>}
      </div>)}</section>)}
  </article>;
}
