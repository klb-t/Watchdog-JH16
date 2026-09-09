import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAccess, AccessBoundary } from '../lib/access';
import { defaultFieldProfile, FieldSafety, EvidenceBadge, RecordEvidence, SubstanceReference } from '../components/FieldEvidence';
import { fieldApi, HttpFailure, offlineFieldLookup, pendingFieldAudit, readFieldCache, syncField } from '../lib/field_client';
import type { FieldQuery, FieldResult, FieldSnapshot } from '../../shared/field';

const initial: FieldQuery = { mode: 'pill', term: '', color: '', shape: '', scoreLine: '', symptomIds: [], regionId: 'NL',
  from: null, to: null, includeBroaderContext: false, language: 'nl', expansionMode: 'STRICT_CANONICAL' };
export function Responder() {
  const [query, setQuery] = useState<FieldQuery>(initial);
  const [profile, setProfile] = useState(defaultFieldProfile);
  return <><FieldSafety profile={profile} regionId={query.regionId} /><AccessBoundary capability="responder.lookup">
    <ResponderContent query={query} setQuery={setQuery} profile={profile} setProfile={setProfile} />
  </AccessBoundary></>;
}
function ResponderContent({ query, setQuery, profile, setProfile }: {
  query: FieldQuery; setQuery: (q: FieldQuery) => void; profile: typeof defaultFieldProfile; setProfile: (p: typeof defaultFieldProfile) => void;
}) {
  const access = useAccess();
  const [snapshot, setSnapshot] = useState<FieldSnapshot | null>(null);
  const [result, setResult] = useState<FieldResult | null>(null);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('Loading reference profile…'), [error, setError] = useState('');
  const [offline, setOffline] = useState(false), [pending, setPending] = useState(0);
  const change = <K extends keyof FieldQuery>(key: K, value: FieldQuery[K]) => { setQuery({ ...query, [key]: value }); setResult(null); };
  async function synchronize() {
    setBusy(true); setError('');
    try {
      const next = await syncField(access.principalId!); setSnapshot(next); setProfile(next.profile);
      setOffline(false); setPending(pendingFieldAudit(access.principalId!));
      setStatus(`${next.records.length} approved references synchronized. Offline access expires ${next.expiresAt}.`);
    } catch (e) {
      if (e instanceof HttpFailure) { setSnapshot(null); setResult(null); setError(e.message); }
      else try {
        const saved = await readFieldCache(access.principalId!); setSnapshot(saved.snapshot); setProfile(saved.snapshot.profile);
        setOffline(true); setPending(pendingFieldAudit(access.principalId!)); setStatus('Offline snapshot available. Source updates and revocations cannot be checked until reconnection.');
      } catch (cacheError) { setStatus('Online search is available when connected; offline cache is unavailable.'); setError(`${(e as Error).message} ${(cacheError as Error).message}`); }
    } finally { setBusy(false); }
  }
  useEffect(() => { void synchronize(); }, [access.principalId]);
  async function search(event: FormEvent) {
    event.preventDefault(); setBusy(true); setResult(null); setError('');
    try {
      const response = await fieldApi('lookup', query); setResult(response.result); setOffline(false);
      setStatus(`Live lookup · ${response.snapshotGeneratedAt} · trace ${response.traceId}`);
    } catch (e) {
      if (e instanceof HttpFailure) setError(e.message);
      else try {
        const response = await offlineFieldLookup(access.principalId!, query);
        setResult(response.result); setSnapshot(response.snapshot); setOffline(true);
        setPending(pendingFieldAudit(access.principalId!)); setStatus(`Offline lookup · snapshot ${response.snapshot.generatedAt} · expires ${response.snapshot.expiresAt}`);
      } catch (cacheError) { setError((cacheError as Error).message); }
    } finally { setBusy(false); }
  }
  const symptoms = [...new Map((snapshot?.records ?? []).flatMap(r => r.document.kind === 'assertion' &&
    r.document.predicate === 'ASSOCIATED_WITH_SYMPTOM' && r.document.object ? [[r.document.object.id, r.document.object] as const] : [])).values()];
  return <div className="field-page">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1>Responder reference</h1>
      <p className="text-slate-600">Find candidate samples and their sourced substance information.</p></div>
      <button type="button" className="field-button" disabled={busy} onClick={synchronize}>Synchronize offline references</button></div>
    <p role="status" className={`mt-3 text-sm ${offline ? 'field-warning' : 'text-slate-600'}`}>{status}</p>
    {offline && <p className="field-warning">Offline: {pending} lookup audit events pending upload. Reconnect and synchronize to submit them.</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <form className="field-panel" onSubmit={search}>
      <div className="flex flex-wrap gap-2 mb-4" aria-label="Search mode">{(['pill', 'market', 'symptoms'] as const).map(mode =>
        <button key={mode} type="button" className="field-button" aria-pressed={query.mode === mode} onClick={() => change('mode', mode)}>
          {{ pill: 'Appearance', market: 'Market name', symptoms: 'Symptoms' }[mode]}</button>)}</div>
      <p className="text-sm text-slate-600 mb-3">Use descriptors only. Do not enter names, dates of birth, addresses or patient details.</p>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {<label className="field-control">{query.mode === 'symptoms' ? 'Symptom name (source vocabulary)' : query.mode === 'market' ? 'Market group or localized label' : 'Pill name or logo'}
          <input value={query.term} maxLength={100} onChange={e => change('term', e.target.value)} autoComplete="off" /></label>}
        {query.mode === 'pill' && <><label className="field-control">Color<select aria-label="Color" value={query.color} onChange={e => change('color', e.target.value)}><option value="">Any color</option>{profile.colors.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
          <label className="field-control">Shape<input value={query.shape} maxLength={100} onChange={e => change('shape', e.target.value)} /></label>
          <label className="field-control">Score line / reverse inscription<input value={query.scoreLine} maxLength={100} onChange={e => change('scoreLine', e.target.value)} /></label></>}
        <label className="field-control">Region<select aria-label="Region" value={query.regionId} onChange={e => change('regionId', e.target.value)}>{profile.regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label className="field-control">From date<input type="date" value={query.from ?? ''} onChange={e => change('from', e.target.value || null)} /></label>
        <label className="field-control">To / status as of date<input type="date" value={query.to ?? ''} onChange={e => change('to', e.target.value || null)} /></label>
        {query.mode === 'market' && <><label className="field-control">Label language<select aria-label="Label language" value={query.language} onChange={e => change('language', e.target.value)}>{['nl', 'en', 'pl'].map(l => <option key={l}>{l}</option>)}</select></label>
          <label className="field-control">Label expansion<select aria-label="Label expansion" value={query.expansionMode} onChange={e => change('expansionMode', e.target.value as FieldQuery['expansionMode'])}>
            <option value="STRICT_CANONICAL">Canonical group only</option><option value="LOCALIZED_SYNONYMS">Reviewed localized market labels</option></select></label></>}
      </div>
      {query.mode === 'symptoms' && <fieldset className="mt-4"><legend className="font-medium">Sourced symptom associations</legend>
        <div className="flex flex-wrap gap-4 mt-2">{symptoms.map(s => <label key={s.id}><input type="checkbox" checked={query.symptomIds.includes(s.id)}
          onChange={e => change('symptomIds', e.target.checked ? [...query.symptomIds, s.id] : query.symptomIds.filter(id => id !== s.id))} /> {s.name}</label>)}</div>
        {!symptoms.length && <p>No approved symptom vocabulary is available. Import and review sourced associations first.</p>}</fieldset>}
      <div className="flex flex-wrap items-center justify-between gap-4 mt-4"><label className="text-sm"><input type="checkbox" checked={query.includeBroaderContext} onChange={e => change('includeBroaderContext', e.target.checked)} /> Include explicitly labelled broader regional context</label>
        <button className="field-button primary" disabled={busy || query.mode === 'symptoms' && !query.symptomIds.length && !query.term}>{busy ? 'Working…' : 'Find references'}</button></div>
    </form>
    <details className="field-panel"><summary>Evidence legend — independent from section order and review status</summary>
      <div className="flex flex-wrap gap-2 mt-3">{Object.keys(profile.tiers).map(tier => <EvidenceBadge key={tier} tier={tier as any} profile={profile} />)}</div>
      <p className="mt-3 text-sm">Each fact keeps its own tier. Human approval accepts the mapping; it does not turn a prediction into a measurement.</p></details>
    {result && <section className="mt-5" aria-label="Lookup results">
      <h2>{result.candidates.length + result.symptomCandidates.length} reference candidates</h2>
      <p className="field-warning">Appearance and market names do not identify the substance taken. These records concern other specimens or source reports.</p>
      <p className="text-sm">{result.labSampleCount} distinct laboratory samples in selected region · {result.publishedAlertCount} published alerts · {result.visualReportCount} visual reports. Source coverage is incomplete.</p>
      {result.excludedUndated > 0 && <p className="field-warning">{result.excludedUndated} undated records excluded by your date filter.</p>}
      {result.flags.includes('AMBIGUOUS_MARKET_LABEL') && <p className="field-warning">This label belongs to multiple reviewed market groups. All matching groups remain visible.</p>}
      {result.flags.includes('MULTIPLE_SOURCE_VERSIONS') && <p className="field-warning">Multiple versions of the same source record are shown. They are not independent specimens.</p>}
      {result.distribution.length > 0 && <div className="field-panel"><h3 className="font-semibold">Composition occurrences in tested reference samples</h3>
        <p className="text-sm">Denominator: {result.labSampleCount} distinct sampled records. Mixed samples can contain more than one substance. This is not market prevalence.</p>
        <ul className="mt-2">{result.distribution.map(d => <li key={d.substance.id}>{d.substance.name}: {d.labSampleCount} / {result.labSampleCount} samples</li>)}</ul></div>}
      {result.candidates.map(c => <article className="field-panel" key={c.record.id}>
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold text-lg">{c.record.document.name}</h3><EvidenceBadge tier={c.matchTier} prefix="Match" profile={profile} /></div>
        <p className="text-sm mt-2">{c.record.document.region.name} · {c.regionScope === 'broader_context' ? 'Broader context — not local sample evidence' : 'Within selected region'} · {c.record.document.timeBasis}: {c.record.document.observedOn ?? 'Date unknown'}</p>
        <p className="text-sm mt-1">Appearance: {[c.record.document.appearance.colors.join('/'), c.record.document.appearance.shape, c.record.document.appearance.logo, c.record.document.appearance.scoreLine].filter(Boolean).join(' · ') || 'Not reported'}</p>
        {c.record.document.origin === 'published_alert' && <p className="field-warning">Published source alert — specimen method and sampling coverage may be unavailable.</p>}
        <div className="overflow-x-auto my-3"><table className="field-table"><thead><tr><th>Reported component</th><th>Reported amount</th><th>Source note</th></tr></thead>
          <tbody>{c.record.document.components.map(component => <tr key={component.substance.id}><td>{component.substance.name}</td><td>{component.amount === null ? 'Not reported' : `${component.amount} ${component.unit}`}</td><td>{component.note ?? '—'}</td></tr>)}</tbody></table></div>
        {!c.record.document.components.length && <p className="field-warning">No identified components reported.</p>}
        {c.record.document.unknownComponents.map((unknown, i) => <p key={i} className="field-warning">Unknown component: {unknown}</p>)}
        <RecordEvidence record={c.record} profile={profile} />
        {c.substances.map(card => <SubstanceReference key={card.substance.id} card={card} profile={profile} />)}
      </article>)}
      {result.symptomCandidates.map(c => <article className="field-panel" key={c.card.substance.id}><h3>{c.card.substance.name} · {c.matchedSymptomIds.length} matching sourced associations</h3>
        <p className="field-warning">Association overlap, not a diagnosis or probability.</p>
        {c.supportingAssertions.map(f => <p key={f.record.id}>{f.record.document.object?.name}: <a href={f.record.document.citation.url}>{f.record.document.citation.publisher}</a></p>)}
        <SubstanceReference card={c.card} profile={profile} /></article>)}
      {!result.candidates.length && !result.symptomCandidates.length && <div className="field-panel"><p>No approved matching references. This does not exclude exposure or risk.</p>
        {access.capabilities.includes('evidence.review') && <Link to="/evidence">Review source mappings</Link>}</div>}
    </section>}
  </div>;
}
