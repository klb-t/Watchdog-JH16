import { Fragment, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAccess } from '../lib/access';

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
const STATUS: Record<string, [string, string]> = { shown: ['wykazana', 'bg-red-50 text-red-900 border-red-200'], probable: ['prawdopodobna (hipoteza zgodna z danymi, nie wykazana)', 'bg-amber-50 text-amber-900 border-amber-200'],
  unresolved: ['nierozstrzygnięta', 'bg-slate-100 text-slate-800 border-slate-300'], excluded: ['wykluczona', 'bg-emerald-50 text-emerald-900 border-emerald-200'] };
const RUN_STATE: Record<string, string> = { COMPLETED: 'ukończony', FAILED: 'nieudany', RUNNING: 'w toku', QUEUED: 'w kolejce', CANCELLED: 'anulowany' };
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

type Tab = 'overview' | 'measure' | 'runs' | 'protocol' | 'discrepancies' | 'calibration' | 'registry' | 'evidence' | 'manuscript';
// A target evaluated by the general reference-correlation path (any target besides the JH16 special case).
const isGeneric = (data: any) => data.dossier?.evaluation_kind === 'reference_correlation';

export function ReplicationTarget() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null), [error, setError] = useState(''), [tab, setTab] = useState<Tab>('overview');
  useEffect(() => { fetch(`/api/replications/${id}`).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))).then(setData).catch(e => setError(e.message)); }, [id]);
  if (error) return <div className="p-8" role="alert">Nie można wczytać replikacji: {error}</div>;
  if (!data) return <div className="p-8">Wczytywanie…</div>;
  const generic = isGeneric(data), reload = () => fetch(`/api/replications/${id}`).then(r => r.json()).then(setData);
  const tabs: [Tab, string][] = [['overview', 'Przegląd'], ...(generic && data.dossier.measurement ? [['measure', 'Nowy pomiar'] as [Tab, string]] : []), ['runs', `Przebiegi (${data.runs.length})`], ['protocol', `Protokół (${data.protocols.length})`], ['discrepancies', 'Rozbieżności'],
    ...(generic ? [] : [['calibration', 'Kalibracja'] as [Tab, string]]), ['registry', 'Rejestr kryteriów'], ['evidence', 'Dowody'], ['manuscript', 'Projekt pracy']];
  return <div className="p-4 sm:p-8 max-w-6xl mx-auto space-y-5 min-w-0" data-testid="replication-target">
    <div className="text-sm text-slate-500"><Link to="/replications" className="underline">Replikacje</Link> / {data.target.target_id}</div>
    <div><h1 className="text-xl sm:text-2xl font-semibold">{data.target.title}</h1>
      <p className="text-sm text-slate-600">{data.target.citation.authors.join(', ')} · {data.target.citation.journal} {data.target.citation.year} · doi:{data.target.identifier}</p></div>
    <div className="flex flex-wrap gap-2" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} data-testid={`tab-${k}`}
      className={`rounded px-3 py-2 text-sm ${tab === k ? 'bg-indigo-100 text-indigo-900' : 'bg-slate-100'}`} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === 'overview' && (generic ? <GenericOverview data={data} /> : <Overview data={data} />)}
    {tab === 'measure' && <Measurement data={data} reload={reload} />}
    {tab === 'runs' && (generic ? <GenericRuns data={data} /> : <Runs data={data} />)}
    {tab === 'protocol' && <Protocols data={data} reload={reload} />}
    {tab === 'discrepancies' && <Discrepancies data={data} />}
    {tab === 'calibration' && <Calibration data={data} />}
    {tab === 'registry' && (generic ? <GenericRegistry data={data} /> : <Registry data={data} />)}
    {tab === 'evidence' && <EvidenceGraphView id={id!} base={data.dossier.evidence_base_url} />}
    {tab === 'manuscript' && <ManuscriptView id={id!} />}
  </div>;
}

const hi = (r: any, s: string) => r.evaluation?.hi_vs_reference?.find((x: any) => x.statistic === s);
const verdict = (r: any, k: string) => r.evaluation?.verdicts?.find((v: any) => v.claim_key === k)?.verdict ?? '—';

function ProvenanceBadge({ r }: { r: any }) {
  const color: Record<string, string> = { recomputation_of_published_data: 'bg-sky-50 text-sky-900 border-sky-200', new_fetch: 'bg-indigo-50 text-indigo-900 border-indigo-200',
    enhanced_variant: 'bg-violet-50 text-violet-900 border-violet-200', recomputation_of_stored_data: 'bg-slate-100 text-slate-800 border-slate-300', exploratory_calibration: 'bg-amber-50 text-amber-900 border-amber-200' };
  return <><span className={`text-xs px-2 py-0.5 rounded border ${color[r.provenance] ?? ''}`} data-testid={`provenance-${r.run_id}`}>{r.provenance_label}{r.variant ? ` · ${r.variant}` : ''}</span>
    {r.shared && <span className="ml-1 text-xs px-2 py-0.5 rounded border bg-slate-50 text-slate-700 border-slate-300" data-testid={`shared-${r.run_id}`}>udostępniony (tylko odczyt)</span>}</>;
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
          <td><ProvenanceBadge r={r} />{r.data_role?.role === 'confirmation' && <span className="ml-1 text-xs px-2 py-0.5 rounded border bg-emerald-50 text-emerald-900 border-emerald-200" data-testid={`role-${r.run_id}`}>potwierdzające</span>}
            {r.role_config?.data_role === 'confirmation' && r.data_role?.role !== 'confirmation' && <span className="ml-1 text-xs text-red-800" title={r.data_role?.reason}>nieuznane jako potwierdzające: {r.data_role?.reason}</span>}</td><td className="text-xs">{r.acquired_utc ? `${r.acquired_utc[0].slice(0, 16).replace('T', ' ')}` : '—'}</td>
          <td className="font-mono text-xs">{r.git_commit?.slice(0, 7) ?? 'brak'}</td><td className="font-mono">{fmt(hi(r, 'pearson')?.value)}</td>
          <td className="font-mono">{fmt(r.evaluation?.pi_vs_published?.value)}</td><td className="font-mono">{fmt(r.calibration?.A1?.spearman)}</td>
          <td className="text-xs" title={r.status}>{RUN_STATE[r.status] ?? r.status}{r.evaluation && !r.evaluation.complete ? ` · braki: ${r.evaluation.missing_entities.length}` : ''}</td></tr>)}</tbody></table></div>
      <p className="text-xs text-slate-600">Zaznacz przebiegi JH16, aby je porównać. Kliknięcie substancji w porównaniu pokazuje zapytania i surowe odpowiedzi dostawcy.</p></section>
    {chosen.length > 0 && <Compare runs={chosen} onEntity={setEntity} />}
    {entity && chosen.length > 0 && <Drill runs={chosen} entity={entity} />}
    <SharePanel data={data} />
  </div>;
}

function Compare({ runs, onEntity }: { runs: any[]; onEntity: (e: string) => void }) {
  const entities = runs[0].evaluation.entities.map((e: any) => e.entity_id) as string[];
  const val = (r: any, e: string, k: string) => r.evaluation.entities.find((x: any) => x.entity_id === e)?.[k] ?? null;
  // A missing coefficient is drawn as no bar and labelled, never as zero.
  const pearsons: (number | null)[] = runs.map(r => hi(r, 'pearson')?.value ?? null), W = 520, H = 160, max = Math.max(1, ...pearsons.filter((v): v is number => v !== null).map(Math.abs));
  return <section className={card} data-testid="compare">
    <h2 className="font-semibold">Porównanie {runs.length} przebiegów</h2>
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-xl" role="img" aria-label="Pearson Hi wobec oceny Nutta w porównywanych przebiegach">
      <line x1={40} x2={W - 10} y1={H / 2} y2={H / 2} stroke="currentColor" opacity={0.4} />
      {runs.map((r, i) => { const x = 50 + i * ((W - 70) / runs.length), w = Math.max(8, (W - 90) / runs.length - 8), v = pearsons[i];
        if (v === null) return <g key={r.run_id}><text x={x + w / 2} y={H / 2 - 4} fontSize={10} textAnchor="middle" className="fill-slate-500">brak</text>
          <text x={x + w / 2} y={H - 2} fontSize={9} textAnchor="middle" className="fill-slate-500">{short(r.run_id)}</text></g>;
        const h = Math.abs(v) / max * (H / 2 - 20);
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

const NOT_TESTED: Record<string, string> = { 'p-value not available': 'brak wartości p', 'sequence stopped at an earlier hypothesis': 'sekwencja zatrzymana wcześniej' };
const notTested = (reason: string) => reason.startsWith('gate closed') ? 'bramka zamknięta' : NOT_TESTED[reason] ?? reason;

function protocolDesign(p: any) {
  if (!p.body.families) return `rodzina: ${p.body.family.map((f: any) => f.label).join('; ')} · korekta ${p.body.multiplicity}`;
  return `${p.body.families.map((f: any) => `${f.id} „${f.label}”: ${f.endpoints.map((e: any) => e.label).join(' → ')} (${f.multiplicity})`).join(' · ')} · bramkowanie ${p.body.gating === 'serial' ? 'szeregowe' : 'niezależne'}`;
}

function Protocols({ data, reload }: { data: any; reload: () => void }) {
  const endpoints = data.dossier.endpoints ?? [], opts = data.protocol_options;
  // Family 0 = outside the protocol. Within a family, lower priority numbers are tested first.
  const [assign, setAssign] = useState<Record<string, { family: number; priority: number }>>(Object.fromEntries(endpoints.map((e: any, i: number) => [e.claim_key, { family: 1, priority: i + 1 }])));
  const [meta, setMeta] = useState<{ label: string; multiplicity: string }[]>(endpoints.map((_: any, i: number) => ({ label: i === 0 ? 'Główna' : `Rodzina ${i + 1}`, multiplicity: opts.default_multiplicity })));
  const [primary, setPrimary] = useState<string[]>(endpoints.slice(0, 1).map((e: any) => e.claim_key));
  const [name, setName] = useState(`${data.target.target_id.toUpperCase()} — potwierdzenie`), [gating, setGating] = useState(opts.default_gating), [alpha, setAlpha] = useState(opts.default_alpha), [rationale, setRationale] = useState(''), [msg, setMsg] = useState('');
  const used = [...new Set(Object.values(assign).map(a => a.family).filter(f => f > 0))].sort((a, b) => a - b);
  const families = used.map(n => ({ label: meta[n - 1].label, multiplicity: meta[n - 1].multiplicity,
    endpoints: endpoints.map((e: any) => e.claim_key).filter((k: string) => assign[k].family === n).sort((a: string, b: string) => assign[a].priority - assign[b].priority || a.localeCompare(b)) }));
  const inProtocol = (k: string) => assign[k].family > 0;
  const freeze = async () => { setMsg(''); const r = await fetch(`/api/replications/${data.target.target_id}/protocols`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent: true, name, primary: primary.filter(inProtocol), families, gating, alpha: Number(alpha), rationale, expectedDossierHash: data.hashes.dossier }) });
    const d = await r.json(); if (!r.ok) setMsg(d.message ?? `HTTP ${r.status}`); else { setMsg(`Zamrożono: ${d.protocol.content_hash.slice(0, 16)}`); reload(); } };
  const set = (k: string, patch: Partial<{ family: number; priority: number }>) => setAssign({ ...assign, [k]: { ...assign[k], ...patch } });
  const togglePrimary = (k: string, on: boolean) => setPrimary(on ? [...new Set([...primary, k])] : primary.filter(x => x !== k));
  return <div className="space-y-4">
    <section className={card}><h2 className="font-semibold">Protokoły zamrożone przed danymi potwierdzającymi</h2>
      <p className="text-sm">Przebieg jest potwierdzający tylko wtedy, gdy: jest nowym pomiarem metodą wierną, powstał po zamrożeniu protokołu i cytuje go w swojej konfiguracji (id i hash). Wszystkie inne przebiegi są eksploracyjne. Wybierzesz to w kreatorze, w kroku 2 („Rola nowych danych JH16”).</p>
      {data.protocols.length === 0 && <p className="text-sm">Brak protokołów.</p>}
      {data.protocols.map((p: any) => <div key={p.id} className="border-t pt-2 space-y-1" data-testid={`protocol-${p.id}`}>
        <div className="text-sm"><b>{p.name}</b> · zamrożony {p.frozen_at.slice(0, 16).replace('T', ' ')} UTC · sha256 <code>{p.content_hash.slice(0, 16)}</code></div>
        <div className="text-xs">Główne: {p.body.primary.join(', ')} · {protocolDesign(p)} · alfa {p.body.alpha} · {p.body.rationale}</div>
        {p.evaluation.confirmation_runs.length === 0 ? <p className="text-sm" data-testid="no-confirmation">Brak przebiegów potwierdzających (eksploracyjnych: {p.evaluation.exploratory_runs}).</p> :
        <div className={scroll}><table className="w-full text-sm" data-testid="protocol-results"><thead className="text-left text-slate-500"><tr><th>Przebieg</th><th>Rodzina.priorytet</th><th>Porównanie</th><th>Główne</th><th>Werdykt</th><th>p</th><th>p skorygowane</th><th>&lt; alfa</th></tr></thead>
          <tbody>{p.evaluation.confirmation_runs.flatMap((r: any) => r.endpoints.map((e: any) => <tr key={r.run_id + e.claim_key} className="border-t border-slate-100"><td className="font-mono"><Link className="underline" to={`/runs/${r.run_id}/results`}>{short(r.run_id)}</Link></td>
            <td className="font-mono">{e.priority === null ? e.family_id : `${e.family_id}.${e.priority}`}</td><td>{e.label}</td><td>{e.primary ? 'tak' : 'nie'}</td><td>{e.verdict}</td><td className="font-mono">{fmtP(e.p_raw)}</td><td className="font-mono">{fmtP(e.p_adjusted)}</td>
            <td>{e.tested === false ? <span title={e.not_tested_reason}>nietestowane: {notTested(e.not_tested_reason)}</span> : e.significant ? 'tak' : 'nie'}</td></tr>))}</tbody></table></div>}
      </div>)}</section>
    <section className={card} data-testid="protocol-form"><h2 className="font-semibold">Zamroź nowy protokół</h2>
      <label className="block text-sm">Nazwa<input className="border rounded px-2 py-1 w-full" value={name} onChange={e => setName(e.target.value)} /></label>
      <fieldset className="text-sm space-y-1"><legend className="font-medium">Porównania: rodzina, priorytet, punkt główny</legend>
        <p className="text-xs text-slate-600">Rodziny są testowane w kolejności numerów; w rodzinie mniejszy priorytet idzie pierwszy (znaczenie ma przy korekcie „Sekwencja ustalona” i przy bramkowaniu szeregowym).</p>
        {endpoints.map((e: any) => <div key={e.claim_key} className="flex flex-wrap items-center gap-3" data-testid={`endpoint-${e.claim_key}`}>
          <span className="min-w-[12rem]">{e.label} ({e.hypothesis})</span>
          <label>Rodzina <select className="border rounded" value={assign[e.claim_key].family} onChange={x => set(e.claim_key, { family: Number(x.target.value) })} data-testid={`family-${e.claim_key}`}>
            <option value={0}>poza protokołem</option>{endpoints.map((_: any, i: number) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
          <label>Priorytet <input className="border rounded w-14 px-1" type="number" min="1" value={assign[e.claim_key].priority} onChange={x => set(e.claim_key, { priority: Number(x.target.value) })} data-testid={`priority-${e.claim_key}`} /></label>
          <label className="flex gap-1"><input type="checkbox" disabled={!inProtocol(e.claim_key)} checked={inProtocol(e.claim_key) && primary.includes(e.claim_key)} onChange={x => togglePrimary(e.claim_key, x.target.checked)} />główny</label></div>)}</fieldset>
      {used.map(n => <div key={n} className="flex flex-wrap gap-3 text-sm" data-testid={`family-settings-${n}`}><b>Rodzina {n}</b>
        <label>Nazwa <input className="border rounded px-1" value={meta[n - 1].label} onChange={x => setMeta(meta.map((m, i) => i === n - 1 ? { ...m, label: x.target.value } : m))} /></label>
        <label>Korekta <select className="border rounded" value={meta[n - 1].multiplicity} onChange={x => setMeta(meta.map((m, i) => i === n - 1 ? { ...m, multiplicity: x.target.value } : m))} data-testid={`multiplicity-${n}`}>
          {opts.multiplicity_procedures.map((m: any) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label></div>)}
      <div className="flex flex-wrap gap-3 text-sm">
        {used.length > 1 && <label>Bramkowanie między rodzinami <select className="border rounded" value={gating} onChange={e => setGating(e.target.value)} data-testid="gating">{opts.gating_procedures.map((g: any) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>}
        <label>Alfa <input className="border rounded w-20 px-1" type="number" step="0.001" min="0" max="1" value={alpha} onChange={e => setAlpha(e.target.value)} /></label></div>
      <p className="text-xs text-slate-600" data-testid="protocol-preview">Zostanie zamrożone: {families.length ? families.map((f, i) => `${i + 1}. ${f.label}: ${f.endpoints.join(' → ')} (${f.multiplicity})`).join('; ') : 'brak porównań'}{families.length > 1 ? `; bramkowanie ${gating}` : ''}.</p>
      <label className="block text-sm">Uzasadnienie (wymagane)<textarea className="border rounded w-full px-2 py-1" rows={3} value={rationale} onChange={e => setRationale(e.target.value)} data-testid="protocol-rationale" /></label>
      <button className="px-3 py-1.5 rounded bg-indigo-600 text-white disabled:opacity-50" disabled={!rationale.trim() || !families.length || !primary.some(inProtocol)} onClick={freeze} data-testid="freeze-protocol">Zamroź protokół (nieodwracalne)</button>
      {msg && <p role="status" className="text-sm">{msg}</p>}</section>
  </div>;
}

function Discrepancies({ data }: { data: any }) {
  const base = data.dossier.evidence_base_url;
  return <section className={card} data-testid="discrepancies"><h2 className="font-semibold">Rozbieżności i ich przyczyny</h2>
    <div className="flex flex-wrap gap-2 text-xs">{Object.entries(STATUS).map(([k, [l, c]]) => <span key={k} className={`px-2 py-0.5 rounded border ${c}`}>{l}</span>)}</div>
    <div className={scroll}><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th>Możliwa przyczyna</th><th>Test rozróżniający</th><th>Status</th><th>Dowód</th></tr></thead>
      <tbody>{data.dossier.diagnosis.map((d: any, i: number) => <tr key={d.cause} className="border-t border-slate-100 align-top" data-testid={`diagnosis-${d.status}`}><td className="py-1.5 pr-2">{d.cause}</td><td className="pr-2">{d.test}</td>
        <td className="pr-2"><span className={`text-xs px-2 py-0.5 rounded border ${STATUS[d.status]?.[1] ?? ''}`}>{STATUS[d.status]?.[0] ?? d.status}</span></td>
        <td className="text-xs">{(d.evidence ?? []).map((e: any) => e.path ? <a key={e.path} className="underline block" href={`${base}${e.path}`} target="_blank" rel="noreferrer">{e.label}</a>
          : e.runs_kind ? <RunsEvidence key={e.label} label={e.label} ids={data.diagnosis_evidence_runs?.[i] ?? []} /> : <span key={e.label} className="block">{e.label}</span>)}{!(d.evidence ?? []).length && '—'}</td></tr>)}</tbody></table></div>
    <h3 className="font-medium text-sm">Ograniczenia</h3><ul className="text-sm list-disc ml-5">{data.dossier.limitations.map((l: string) => <li key={l}>{l}</li>)}</ul></section>;
}

// Evidence that names a kind of run lists the complete runs of that kind stored here, or says there are none.
function RunsEvidence({ label, ids }: { label: string; ids: string[] }) {
  return <span className="block" data-testid="runs-evidence">{label}: {ids.length ? ids.map(id => <Link key={id} className="underline mr-1 font-mono" to={`/runs/${id}/results`}>{short(id)}</Link>)
    : <span className="text-amber-900">brak kompletnych przebiegów tego rodzaju w tej instalacji (luka w zakładce „Dowody”)</span>}</span>;
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

// ---------------------------------------------------------------- general targets
const claimFor = (data: any, comparison: string) => (data.dossier.endpoints ?? []).find((e: any) => e.p_value === `comparisons.${comparison}`)?.claim_key ?? null;
const reading = (r: any, comparison: string) => r.evaluation?.readings?.find((x: any) => x.comparison === comparison)?.reading;
const pubFor = (data: any, id: string) => (data.published?.reported_statistics ?? []).find((x: any) => x.id === id);
const pubText = (x: any) => x ? `r = ${fmt(x.value, 2)} (n = ${x.n}${x.p !== undefined ? `, p = ${x.p}` : x.p_below !== undefined ? `, p < ${x.p_below}` : ''})` : '—';

function GenericOverview({ data }: { data: any }) {
  const primary = data.runs.filter((r: any) => data.primary_run_ids.includes(r.run_id) && r.evaluation?.comparisons);
  return <div className="space-y-4">
    <section className={card}><h2 className="font-semibold">Hipotezy</h2>
      <ul className="text-sm space-y-1">{data.dossier.hypotheses.map((h: any) => <li key={h.id}><b>{h.id}</b> ({h.kind === 'primary' ? 'główna' : 'opisowa'}): {h.statement}</li>)}</ul></section>
    <section className={card} data-testid="overview-verdicts"><h2 className="font-semibold">Werdykty i zgodność z publikacją</h2>
      {primary.length === 0 ? <p className="text-sm">Brak kompletnych przebiegów. Nowy pomiar uruchomisz w zakładce „Nowy pomiar”.</p> :
      <div className={scroll}><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th>Przebieg</th><th>Porównanie</th><th>Publikacja</th><th>Nowy pomiar</th><th>n</th><th>Werdykt</th><th>Odczyt hipotezy</th></tr></thead>
        <tbody>{primary.flatMap((r: any) => r.evaluation.comparisons.map((c: any) => { const k = claimFor(data, c.id); return <tr key={r.run_id + c.id} className="border-t border-slate-100" data-testid={`overview-row-${r.run_id}`}>
          <td className="py-1.5 pr-2"><ProvenanceBadge r={r} /> <Link className="underline font-mono text-xs" to={`/runs/${r.run_id}/results`}>{short(r.run_id)}</Link></td><td className="pr-2">{c.label}</td><td className="pr-2">{pubText(pubFor(data, c.id))}</td>
          <td className="font-mono pr-2">{c.statistic} {fmt(c.value)} (p {fmtP(c.p_two_sided)})</td><td className="font-mono">{c.n}{c.required_n ? `/${c.required_n}` : ''}</td>
          <td>{k ? verdict(r, k) : '—'}</td><td>{READING[reading(r, c.id)] ?? '—'}</td></tr>; }))}</tbody></table></div>}
      <p className="text-xs text-slate-600">„reproduced” = wartość w paśmie ustalonym przed danymi (zakładka „Rejestr kryteriów”).</p></section>
    {(data.dossier.not_replicated ?? []).length > 0 && <section className={card} data-testid="not-replicated"><h2 className="font-semibold">Czego nie powtórzono</h2>
      <ul className="text-sm space-y-1">{data.dossier.not_replicated.map((x: any) => <li key={x.endpoint}><b>{x.endpoint}</b>: {x.reason}</li>)}</ul></section>}
    {(data.dossier.assessment ?? []).length > 0 && <section className={card} data-testid="assessment"><h2 className="font-semibold">Ocena</h2>
      <ul className="text-sm space-y-1">{data.dossier.assessment.map((a: any) => <li key={a.statement}>{a.statement} <span className="text-xs text-slate-500">— {a.author}</span></li>)}</ul></section>}
    <section className={card}><h2 className="font-semibold">Odstępstwa od metody oryginalnej</h2>
      <div className={scroll}><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th>Element</th><th>Oryginał</th><th>Replikacja</th><th>Powód</th></tr></thead>
        <tbody>{data.dossier.deviations.map((d: any) => <tr key={d.item} className="border-t border-slate-100"><td className="pr-2">{d.item}</td><td className="pr-2">{d.original}</td><td className="pr-2">{d.replication}</td><td>{d.reason}</td></tr>)}</tbody></table></div></section>
  </div>;
}

function Measurement({ data, reload }: { data: any; reload: () => void }) {
  const [m, setM] = useState<any>(null), [error, setError] = useState(''), [approved, setApproved] = useState(false), [role, setRole] = useState('exploratory'), [msg, setMsg] = useState(''), [runId, setRunId] = useState(''), [status, setStatus] = useState('');
  const id = data.target.target_id;
  useEffect(() => { fetch(`/api/replications/${id}/measurement`).then(async r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))).then(d => setM(d.measurement)).catch(e => setError(e.message)); }, [id]);
  useEffect(() => { if (!runId) return; const t = setInterval(async () => { const r = (await (await fetch(`/api/runs/${runId}`)).json()).run; setStatus(r.status);
    if (['COMPLETED', 'FAILED'].includes(r.status)) { clearInterval(t); reload(); } }, 1500); return () => clearInterval(t); }, [runId]);
  if (error) return <p role="alert">{error}</p>;
  if (!m) return <p>Wczytywanie…</p>;
  const launch = async () => { setMsg(''); const protocolId = role.startsWith('protocol:') ? role.slice('protocol:'.length) : undefined;
    const r = await fetch(`/api/replications/${id}/measurement`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: true, expectedPresetHash: m.preset_hash, dataRole: protocolId ? 'confirmation' : 'exploratory', ...(protocolId ? { protocolId } : {}) }) });
    const d = await r.json(); if (!r.ok) setMsg(d.message ?? `HTTP ${r.status}`); else { setRunId(d.runId); setStatus('QUEUED'); } };
  return <section className={card} data-testid="measurement"><h2 className="font-semibold">Nowy pomiar: {m.label}</h2>
    <dl className="text-sm grid grid-cols-1 sm:grid-cols-[12rem_1fr] gap-x-3 gap-y-1">
      <dt className="text-slate-500">Źródło</dt><dd>{m.source_id} · {Object.entries(m.provider_params).map(([k, v]) => `${k}=${v}`).join(', ')}</dd>
      {m.queries.map((q: any) => <Fragment key={q.dimension}><dt className="text-slate-500">Zapytanie „{q.dimension}”</dt><dd className="break-words">{q.terms.join(' + ')}</dd></Fragment>)}
      <dt className="text-slate-500">Metoda</dt><dd>{m.method_id}: {m.comparisons.map((c: any) => `${c.label} (${c.statistic}; referencja ${c.reference_ref}, sha256 ${c.reference_hash.slice(0, 12)})`).join('; ')}</dd>
      <dt className="text-slate-500">Koszt</dt><dd data-testid="measurement-cost">{m.requests} zapytanie SerpApi; limit dzienny {m.daily_limit}, dziś zostało {m.left_today}</dd>
      <dt className="text-slate-500">Preset</dt><dd className="font-mono text-xs break-all">{m.preset_id} {m.preset_version} · sha256 {m.preset_hash}</dd></dl>
    <label className="block text-sm">Rola nowych danych <select className="border rounded" value={role} onChange={e => setRole(e.target.value)} data-testid="measurement-role">
      <option value="exploratory">eksploracyjne (domyślnie)</option>{data.protocols.map((p: any) => <option key={p.id} value={`protocol:${p.id}`}>potwierdzające wg protokołu „{p.name}” ({p.frozen_at.slice(0, 16).replace('T', ' ')})</option>)}</select></label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} data-testid="approve-preset" />Zatwierdzam ten preset (hash powyżej) i jego metodę dla tego pomiaru</label>
    {m.blocked && <p className="text-sm text-amber-900" data-testid="measurement-blocked">{m.blocked}</p>}
    <button className="px-3 py-1.5 rounded bg-indigo-600 text-white disabled:opacity-50" disabled={!approved || !!m.blocked || !!runId} onClick={launch} data-testid="launch-measurement">Uruchom pomiar</button>
    {msg && <p role="alert" className="text-sm">{msg}</p>}
    {runId && <p role="status" className="text-sm" data-testid="measurement-status">Przebieg <Link className="underline font-mono" to={`/runs/${runId}/results`}>{short(runId)}</Link>: {status}</p>}</section>;
}

function GenericRuns({ data }: { data: any }) {
  const [selected, setSelected] = useState<string | null>(null), [entity, setEntity] = useState<string | null>(null);
  const ids: string[] = [...new Set<string>(data.runs.flatMap((r: any) => (r.evaluation?.comparisons ?? []).map((c: any) => c.id)))];
  const chosen = data.runs.find((r: any) => r.run_id === selected && r.evaluation?.comparisons);
  return <div className="space-y-4"><section className={card}>
    <div className={scroll}><table className="w-full text-sm" data-testid="runs-table"><thead className="text-left text-slate-500"><tr><th></th><th>Przebieg</th><th>Pochodzenie</th><th>Pobranie (UTC)</th><th>Kod</th>{ids.map(i => <th key={i}>{i}</th>)}<th>Stan</th></tr></thead>
      <tbody>{data.runs.map((r: any) => <tr key={r.run_id} className="border-t border-slate-100" data-testid={`run-row-${r.run_id}`}>
        <td>{r.evaluation?.comparisons && <input type="radio" name="run" aria-label={`pokaż ${short(r.run_id)}`} checked={selected === r.run_id} onChange={() => { setSelected(r.run_id); setEntity(null); }} />}</td>
        <td className="font-mono py-1.5"><Link className="underline" to={`/runs/${r.run_id}/results`}>{short(r.run_id)}</Link></td>
        <td><ProvenanceBadge r={r} />{r.data_role?.role === 'confirmation' && <span className="ml-1 text-xs px-2 py-0.5 rounded border bg-emerald-50 text-emerald-900 border-emerald-200" data-testid={`role-${r.run_id}`}>potwierdzające</span>}
          {r.role_config?.data_role === 'confirmation' && r.data_role?.role !== 'confirmation' && <span className="ml-1 text-xs text-red-800">nieuznane jako potwierdzające: {r.data_role?.reason}</span>}</td>
        <td className="text-xs">{r.acquired_utc ? r.acquired_utc[0].slice(0, 16).replace('T', ' ') : '—'}</td><td className="font-mono text-xs">{r.git_commit?.slice(0, 7) ?? 'brak'}</td>
        {ids.map(i => { const c = r.evaluation?.comparisons?.find((x: any) => x.id === i); return <td key={i} className="font-mono">{c ? `${fmt(c.value)} · n${c.n}` : '—'}</td>; })}
        <td className="text-xs" title={r.status}>{RUN_STATE[r.status] ?? r.status}{r.evaluation && !r.evaluation.complete ? ' · niekompletny' : ''}</td></tr>)}</tbody></table></div>
    <p className="text-xs text-slate-600">Wybierz przebieg, aby zobaczyć pomiar i referencję dla każdego podmiotu; kliknięcie podmiotu pokazuje zapytanie i surową odpowiedź.</p></section>
    {chosen && chosen.evaluation.comparisons.map((c: any) => <Scatter key={c.id} c={c} onEntity={setEntity} />)}
    {chosen && entity && <Drill runs={[chosen]} entity={entity} />}
    <SharePanel data={data} /></div>;
}

/** Measured vs reference for one comparison: the evidence behind a correlation, drawn from the stored evaluation. */
function Scatter({ c, onEntity }: { c: any; onEntity: (e: string) => void }) {
  const W = 360, H = 240, P = 36, xs = c.entities.map((e: any) => e.measured), ys = c.entities.map((e: any) => e.reference);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  // Points sit inside a margin so the extremes are not drawn on the axes.
  const sx = (v: number) => P + 8 + (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0)) * (W - P - 24), sy = (v: number) => H - P - 8 - (y1 === y0 ? 0.5 : (v - y0) / (y1 - y0)) * (H - P - 24);
  return <section className={card} data-testid={`scatter-${c.id}`}><h2 className="font-semibold">{c.label}</h2>
    <p className="text-sm">{c.statistic} {fmt(c.value)} (p {fmtP(c.p_two_sided)}), n = {c.n}{c.missing_entities.length ? `; brak pomiaru: ${c.missing_entities.join(', ')}` : ''}</p>
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md" role="img" aria-label={`${c.label}: pomiar wobec referencji, ${c.n} punktów`}>
      <line x1={P} y1={H - P} x2={W - 4} y2={H - P} stroke="currentColor" opacity={0.4} /><line x1={P} y1={4} x2={P} y2={H - P} stroke="currentColor" opacity={0.4} />
      <text x={W / 2} y={H - 6} fontSize={10} textAnchor="middle" className="fill-slate-600">pomiar ({fmt(x0, 0)}–{fmt(x1, 0)})</text>
      <text x={10} y={H / 2} fontSize={10} textAnchor="middle" transform={`rotate(-90 10 ${H / 2})`} className="fill-slate-600">referencja ({fmt(y0, 1)}–{fmt(y1, 1)})</text>
      {c.entities.map((e: any) => <g key={e.entity_id} className="cursor-pointer" onClick={() => onEntity(e.entity_id)}><circle cx={sx(e.measured)} cy={sy(e.reference)} r={4} className="fill-indigo-500" opacity={0.8} />
        <title>{`${e.entity_id}: pomiar ${e.measured}, referencja ${e.reference}`}</title></g>)}</svg>
    <details className="text-xs"><summary className="cursor-pointer">Tabela ({c.entities.length})</summary><div className={scroll}><table className="min-w-full"><thead className="text-left text-slate-500"><tr><th className="pr-2">Podmiot</th><th className="pr-2">Pomiar</th><th>Referencja</th></tr></thead>
      <tbody>{c.entities.map((e: any) => <tr key={e.entity_id} className="border-t border-slate-100 cursor-pointer hover:bg-indigo-50" onClick={() => onEntity(e.entity_id)} data-testid={`entity-${e.entity_id}`}><td className="pr-2 underline">{e.entity_id}</td><td className="pr-2 font-mono">{e.measured}</td><td className="font-mono">{e.reference}</td></tr>)}</tbody></table></div></details></section>;
}

/** Read-only sharing of one's own runs with an address or by link (services/run_shares.ts). */
function SharePanel({ data }: { data: any }) {
  const access = useAccess();
  const own = data.runs.filter((r: any) => !r.shared);
  const [sel, setSel] = useState<string[]>(() => own.filter((r: any) => data.primary_run_ids.includes(r.run_id)).map((r: any) => r.run_id));
  const [kind, setKind] = useState<'email' | 'link'>('email'), [target, setTarget] = useState(''), [note, setNote] = useState(''), [days, setDays] = useState('30');
  const [shares, setShares] = useState<any[]>([]), [msg, setMsg] = useState(''), [link, setLink] = useState('');
  const load = () => fetch('/api/run-shares').then(r => r.ok ? r.json() : { shares: [] }).then(d => setShares(d.shares));
  useEffect(() => { void load(); }, []);
  if (!own.length || !access.capabilities.includes('run.create')) return null;
  const ids = new Set(own.map((r: any) => r.run_id)), mine = shares.filter(x => ids.has(x.run_id) && !x.via_share_id);
  const groups = [...mine.reduce((m: Map<string, any[]>, x: any) => m.set(x.target_kind === 'link' ? `link:${x.token_hash}` : `${x.target_kind}:${x.target}:${x.created_at}`, [...(m.get(x.target_kind === 'link' ? `link:${x.token_hash}` : `${x.target_kind}:${x.target}:${x.created_at}`) ?? []), x]), new Map()).values()];
  const share = async () => { setMsg(''); setLink('');
    const r = await fetch('/api/run-shares', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run_ids: sel, kind, target: kind === 'email' ? target : undefined, note, expires_in_days: days ? Number(days) : null }) });
    const d = await r.json(); if (!r.ok) { setMsg(d.error?.message ?? `HTTP ${r.status}`); return; }
    if (d.link_path) setLink(new URL(d.link_path, window.location.origin).href); else setMsg(`Udostępniono ${d.shares.length} przebiegów dla ${target}.`);
    void load(); };
  const revoke = async (id: string) => { await fetch(`/api/run-shares/${id}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); void load(); };
  return <section className={card} data-testid="share-panel"><h2 className="font-semibold">Udostępnij przebiegi (tylko do odczytu)</h2>
    <p className="text-sm text-slate-600">Osoba z dostępem zobaczy wybrane przebiegi: wyniki, ocenę, surowe odpowiedzi i miejsce w Replikacjach. Nie może ich zmienić ani udostępnić dalej. Przeliczenie zabiera ze sobą przebieg źródłowy. Odwołanie działa od razu.</p>
    <div className="max-h-48 overflow-auto text-sm space-y-1">{own.map((r: any) => <label key={r.run_id} className="flex gap-2 items-center"><input type="checkbox" checked={sel.includes(r.run_id)}
      onChange={e => setSel(e.target.checked ? [...sel, r.run_id] : sel.filter(x => x !== r.run_id))} data-testid={`share-run-${r.run_id}`} /><span className="font-mono">{short(r.run_id)}</span> {r.provenance_label}</label>)}</div>
    <div className="flex flex-wrap gap-3 text-sm items-end">
      <label>Komu <select className="border rounded" value={kind} onChange={e => setKind(e.target.value as any)} data-testid="share-kind"><option value="email">adres e-mail (konto)</option><option value="link">link (dla zalogowanych, którzy go dostaną)</option></select></label>
      {kind === 'email' && <label>Adres <input className="border rounded px-1" type="email" value={target} onChange={e => setTarget(e.target.value)} data-testid="share-target" /></label>}
      <label>Ważne (dni) <input className="border rounded w-16 px-1" type="number" min="1" max="365" value={days} onChange={e => setDays(e.target.value)} /></label>
      <label className="flex-1 min-w-[10rem]">Notatka <input className="border rounded px-1 w-full" value={note} onChange={e => setNote(e.target.value)} /></label></div>
    <button className="px-3 py-1.5 rounded bg-indigo-600 text-white disabled:opacity-50" disabled={!sel.length || (kind === 'email' && !target.trim())} onClick={share} data-testid="share-create">Udostępnij {sel.length} {sel.length === 1 ? 'przebieg' : 'przebiegów'}</button>
    {msg && <p role="status" className="text-sm">{msg}</p>}
    {link && <p className="text-sm break-all" data-testid="share-link">Link (widoczny tylko teraz, skopiuj go): <code>{link}</code></p>}
    {groups.length > 0 && <div className={scroll}><table className="w-full text-sm" data-testid="share-list"><thead className="text-left text-slate-500"><tr><th>Komu</th><th>Przebiegi</th><th>Od</th><th>Do</th><th>Stan</th><th></th></tr></thead>
      <tbody>{groups.map((g: any[]) => { const x = g[0], active = !x.revoked_at && (!x.expires_at || x.expires_at > new Date().toISOString());
        return <tr key={x.id} className="border-t border-slate-100"><td className="pr-2">{x.target_kind === 'link' ? 'link' : x.target}</td><td className="font-mono text-xs pr-2">{g.map(y => short(y.run_id)).join(' ')}</td>
          <td className="text-xs pr-2">{x.created_at.slice(0, 10)}</td><td className="text-xs pr-2">{x.expires_at?.slice(0, 10) ?? 'bez terminu'}</td><td className="text-xs pr-2">{x.revoked_at ? 'odwołane' : active ? 'aktywne' : 'wygasło'}</td>
          <td>{active && <button className="underline text-xs" onClick={() => void Promise.all(g.map(y => revoke(y.id)))} data-testid={`share-revoke-${x.id}`}>odwołaj</button>}</td></tr>; })}</tbody></table></div>}
  </section>;
}

function GenericRegistry({ data }: { data: any }) {
  const i = data.interpretation;
  return <section className={card} data-testid="registry"><h2 className="font-semibold">Rejestr kryteriów (ustalone przed danymi)</h2>
    <div className={scroll}><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th>Twierdzenie</th><th>Statystyka</th><th>Wartość w publikacji</th><th>Kryterium</th></tr></thead>
      <tbody>{data.target.claims.map((c: any) => <tr key={c.claim_key} className="border-t border-slate-100"><td className="py-1.5 pr-2 font-mono">{c.claim_key}</td><td>{c.statistic}</td><td className="font-mono">{c.claimed_value_numeric}</td>
        <td>{c.tolerance_kind === 'interval' ? `[${c.tolerance_value}; ${c.interval_upper}]` : `≥ ${c.tolerance_value}`}</td></tr>)}</tbody></table></div>
    <ul className="text-sm list-disc ml-5">{data.target.claims.map((c: any) => <li key={c.claim_key}>{c.notes}</li>)}</ul>
    {(i?.hypotheses ?? []).map((h: any) => <p key={h.id} className="text-sm">Odczyt {h.id}: wspierają, gdy {h.statistic} &gt; {h.supports.value_above} i p &lt; {h.supports.p_two_sided_below}; przeczą, gdy {h.statistic} ≤ {h.contradicts.value_at_most}; inaczej nie rozstrzygają; wymagane n = {i.required_complete_n?.[h.comparison] ?? '—'}.</p>)}
    {(i?.exploratory_sensitivity ?? []).map((x: any) => <p key={x.id} className="text-sm">Eksploracyjnie (bez werdyktu): {x.id}: {x.reason}.</p>)}
    <p className="text-sm">Prerejestracja: <a className="underline" href={`${data.dossier.evidence_base_url}${data.dossier.protocol.document}`} target="_blank" rel="noreferrer">{data.dossier.protocol.document}</a>{data.dossier.protocol.registered_in_commit && <> (commit <code>{data.dossier.protocol.registered_in_commit}</code>)</>}.</p>
    <p className="text-xs font-mono break-all">sha256 kryteriów {data.hashes.claims} · interpretacji {data.hashes.interpretation} · dossier {data.hashes.dossier}</p></section>;
}

// ---------------------------------------------------------------- evidence graph
const KIND: [string, string][] = [['hypothesis', 'Hipotezy'], ['claim', 'Kryteria'], ['protocol', 'Protokoły'], ['run', 'Przebiegi'], ['file', 'Pliki i odniesienia'], ['cause', 'Przyczyny rozbieżności'], ['section', 'Sekcje pracy']];
const EDGE: Record<string, string> = { tested_by: 'testowana przez', fixes: 'ustala', evaluates: 'ocenia', confirms: 'potwierdza wg', uses: 'używane przez', supports: 'popiera', cited_in: 'cytowane w' };
const GAP: Record<string, string> = { 'no complete run evaluates this claim yet': 'żaden kompletny przebieg jeszcze nie ocenia tego kryterium',
  'no pre-registered claim tests this hypothesis': 'żadne wcześniej zarejestrowane kryterium nie testuje tej hipotezy', };
const gapText = (p: string) => GAP[p] ?? (p.match(/^a diagnosis marked '(\w+)' names no evidence$/) ? `wpis diagnozy ze statusem „${STATUS[p.match(/'(\w+)'/)![1]]?.[0] ?? p}” nie wskazuje dowodu`
  : p.match(/^table (\d+) has no source$/) ? `tabela ${p.match(/\d+/)![0]} nie wskazuje źródła` : p);

function EvidenceGraphView({ id, base }: { id: string; base: string }) {
  const [g, setG] = useState<any>(null), [error, setError] = useState(''), [sel, setSel] = useState<string | null>(null), [manifests, setManifests] = useState(false);
  useEffect(() => { fetch(`/api/replications/${id}/evidence-graph`).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))).then(d => setG(d.graph)).catch(e => setError(e.message)); }, [id]);
  if (error) return <p role="alert">{error}</p>;
  if (!g) return <p>Składanie grafu dowodów…</p>;
  const shown = g.nodes.filter((n: any) => manifests || !n.id.startsWith('file:manifest:')), ids = new Set(shown.map((n: any) => n.id));
  const edges = g.edges.filter((e: any) => ids.has(e.from) && ids.has(e.to));
  const COLW = 170, ROWH = 30, TOP = 28, NW = 150, NH = 22;
  const cols = KIND.map(([k]) => shown.filter((n: any) => n.kind === k)).filter(c => c.length);
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((c, i) => c.forEach((n: any, j: number) => pos.set(n.id, { x: 8 + i * COLW, y: TOP + j * ROWH })));
  const W = 16 + cols.length * COLW, H = TOP + Math.max(...cols.map(c => c.length)) * ROWH + 8;
  const near = sel ? new Set([sel, ...edges.filter((e: any) => e.from === sel || e.to === sel).flatMap((e: any) => [e.from, e.to])]) : null;
  const node = sel ? g.nodes.find((n: any) => n.id === sel) : null, label = (nid: string) => g.nodes.find((n: any) => n.id === nid)?.label ?? nid;
  const link = (n: any) => n?.ref?.run_id ? <Link className="underline" to={`/runs/${n.ref.run_id}/results`}>wyniki przebiegu</Link> : n?.ref?.path ? <a className="underline" href={`${base}${n.ref.path}`} target="_blank" rel="noreferrer">otwórz plik</a> : null;
  return <div className="space-y-4">
    <section className={card} data-testid="evidence-gaps"><h2 className="font-semibold">Luki w dowodach ({g.gaps.length})</h2>
      {g.gaps.length === 0 ? <p className="text-sm">Każde kryterium ma kompletny przebieg, każda przyczyna wykazana, prawdopodobna lub wykluczona wskazuje dowód, każda tabela pracy — źródło.</p> :
      <ul className="text-sm list-disc ml-5">{g.gaps.map((x: any) => <li key={x.node + x.problem}><button className="underline" onClick={() => setSel(x.node)}>{label(x.node)}</button>: {gapText(x.problem)}</li>)}</ul>}
      <p className="text-xs text-slate-500 font-mono break-all">sha256 grafu {g.graph_hash} · węzły {g.nodes.length} · krawędzie {g.edges.length}</p></section>
    <section className={card} data-testid="evidence-graph"><div className="flex flex-wrap gap-3 items-center"><h2 className="font-semibold">Graf dowodów</h2>
      <label className="text-sm flex gap-1"><input type="checkbox" checked={manifests} onChange={e => setManifests(e.target.checked)} data-testid="show-manifests" />pokaż manifesty przebiegów</label></div>
      <p className="text-xs text-slate-600">Kliknij węzeł, aby zobaczyć jego połączenia. Graf powstaje z konfiguracji, zapisanych przebiegów i źródeł podanych w projekcie pracy; nie liczy żadnej statystyki.</p>
      <div className={scroll}><svg width={W} height={H} role="img" aria-label={`Graf dowodów: ${shown.length} węzłów, ${edges.length} krawędzi`}>
        {cols.map((c, i) => <text key={i} x={8 + i * COLW} y={14} fontSize={11} className="fill-slate-500">{KIND.find(([k]) => k === c[0].kind)![1]}</text>)}
        {edges.map((e: any, i: number) => { const a = pos.get(e.from)!, b = pos.get(e.to)!, fwd = a.x <= b.x;
          const x1 = fwd ? a.x + NW : a.x, x2 = fwd ? b.x : b.x + NW, y1 = a.y + NH / 2, y2 = b.y + NH / 2, mx = (x1 + x2) / 2, on = !near || (near.has(e.from) && near.has(e.to) && (e.from === sel || e.to === sel));
          return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="currentColor" className={on ? 'text-indigo-400' : 'text-slate-200'} strokeWidth={on && near ? 1.6 : 0.8} />; })}
        {shown.map((n: any) => { const p = pos.get(n.id)!, gap = g.gaps.some((x: any) => x.node === n.id), dim = near && !near.has(n.id);
          return <g key={n.id} className="cursor-pointer" onClick={() => setSel(n.id === sel ? null : n.id)} data-testid={`node-${n.id}`} opacity={dim ? 0.3 : 1}>
            <rect x={p.x} y={p.y} width={NW} height={NH} rx={5} className={n.id === sel ? 'fill-indigo-100 stroke-indigo-600' : gap ? 'fill-amber-50 stroke-amber-500' : 'fill-white stroke-slate-300'} />
            <text x={p.x + 6} y={p.y + 15} fontSize={10} className="fill-slate-800">{n.label.length > 24 ? n.label.slice(0, 23) + '…' : n.label}</text><title>{`${n.label}${n.detail ? ` — ${n.detail}` : ''}`}</title></g>; })}
      </svg></div></section>
    {node && <section className={card} data-testid="evidence-node"><h2 className="font-semibold">{node.label}</h2>
      {node.detail && <p className="text-sm break-words">{node.detail}</p>}{link(node)}
      <ul className="text-sm space-y-1">{edges.filter((e: any) => e.from === sel || e.to === sel).map((e: any, i: number) => <li key={i}>
        {e.from === sel ? <>→ {EDGE[e.kind]} <button className="underline" onClick={() => setSel(e.to)}>{label(e.to)}</button></> : <>← <button className="underline" onClick={() => setSel(e.from)}>{label(e.from)}</button> {EDGE[e.kind]}</>}{e.label ? <span className="text-slate-500"> ({e.label})</span> : null}</li>)}</ul></section>}
  </div>;
}

function ManuscriptView({ id }: { id: string }) {
  const [data, setData] = useState<any>(null), [error, setError] = useState(''), [edition, setEdition] = useState<string>(''), [busy, setBusy] = useState(false), [note, setNote] = useState('');
  const load = (ed = edition) => fetch(`/api/replications/${id}/manuscript${ed ? `?edition=${ed}` : ''}`).then(async r => r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).message ?? `HTTP ${r.status}`)))
    .then(d => { setData(d); setError(''); }).catch(e => setError(e.message));
  useEffect(() => { load(); }, [id]);
  const srcLabel = (s: any) => s.run_id ? <Link key={s.run_id} className="underline mr-2" to={`/runs/${s.run_id}/results`}>przebieg {short(s.run_id)}</Link> : <span key={s.path ?? s.config} className="mr-2">{s.path ?? `konfiguracja ${s.config}`}</span>;
  const edit = async () => { setBusy(true); setNote(''); try {
    const r = await fetch(`/api/replications/${id}/manuscript/edit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.message ?? `HTTP ${r.status}`);
    setNote(`Redakcja ${d.edition.model}: zmienione ${d.edition.edited}, odrzucone ${d.edition.rejected}, koszt ok. ${d.edition.estimated_cost_usd.toFixed(4)} USD.`);
    setEdition(d.edition.id); await load(d.edition.id);
  } catch (e) { setNote((e as Error).message); } finally { setBusy(false); } };
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p>Składanie pracy z zapisanych wyników…</p>;
  const m = data.manuscript, q = edition ? `&edition=${edition}` : '';
  const changed = (data.edition?.units ?? []).filter((u: any) => u.status !== 'unchanged');
  return <article className={`${card} space-y-4`} data-testid="manuscript">
    <div className="flex flex-wrap gap-3 items-center"><a className="underline text-sm" href={`/api/replications/${id}/manuscript?format=md${q}`} data-testid="manuscript-md">Pobierz Markdown</a>
      <a className="underline text-sm" href={`/api/replications/${id}/manuscript?format=html${q}`} data-testid="manuscript-html">Pobierz HTML</a>
      <label className="text-sm">Wersja <select className="border rounded px-1" value={edition} data-testid="edition-select" onChange={e => { setEdition(e.target.value); load(e.target.value); }}>
        <option value="">bez redakcji (z wyników)</option>{data.editions.map((e: any) => <option key={e.id} value={e.id}>{e.created_at.slice(0, 16).replace('T', ' ')} · {e.model}</option>)}</select></label></div>
    <details className="text-sm" data-testid="editing"><summary className="cursor-pointer">Redakcja językowa przez model ({data.editing.model}, region {data.editing.location})</summary>
      <p className="mt-2">Model dostaje tylko zdania (tabele nie są wysyłane) i może zmienić styl, nie fakty. Każde zdanie musi zachować te same liczby, identyfikatory i hashe; inaczej zostaje oryginał. Dzienny limit {data.editing.daily_budget_usd} USD, dziś wydano {data.editing.spent_today_usd.toFixed(4)} USD (ceny z konfiguracji: {data.editing.pricing.input}/{data.editing.pricing.output} USD za mln tokenów).</p>
      <button className="mt-2 px-3 py-1.5 rounded bg-indigo-600 text-white disabled:opacity-50" disabled={busy || !data.editing.enabled} onClick={edit} data-testid="edit-manuscript">{busy ? 'Redagowanie…' : 'Zezwól i zredaguj'}</button>
      {!data.editing.enabled && <p className="mt-2 text-amber-900" data-testid="editing-disabled">Wyłączone w konfiguracji: {data.editing.disabled_reason}</p>}
      {note && <p role="status" className="mt-2">{note}</p>}</details>
    <h2 className="text-xl font-semibold">{m.title}</h2>
    <p className="text-xs text-slate-600">Złożone {m.generated_at} z zapisanych wyników (kod {m.code_version?.slice(0, 7) ?? '—'}, dane wejściowe {m.input_hash.slice(0, 16)}). Każdy blok wskazuje źródło. {m.edition ? <b data-testid="edition-label">Redakcja językowa: {m.edition.model}, zmienione zdania {m.edition.edited}, odrzucone {m.edition.rejected} (propozycja modelu; liczby sprawdzone).</b> : 'Tekst nie był redagowany przez model językowy.'}</p>
    {changed.length > 0 && <details className="text-xs" data-testid="edition-changes"><summary className="cursor-pointer">Zmiany redakcji ({changed.length})</summary>
      <ul className="space-y-2 mt-2">{changed.map((u: any) => <li key={u.id} className="border-t pt-1"><b>{u.status === 'edited' ? 'zmienione' : `odrzucone: ${u.reason}`}</b><div className="text-slate-500">przed: {u.original}</div>{u.status === 'edited' && <div>po: {u.edited}</div>}</li>)}</ul></details>}
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
