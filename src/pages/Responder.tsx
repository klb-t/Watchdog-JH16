import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAccess, AccessBoundary } from '../lib/access';
import { defaultFieldProfile, FieldSafety, EvidenceBadge } from '../components/FieldEvidence';
import { fieldApi, HttpFailure, offlineFieldLookup, offlineFieldReference, pendingFieldAudit, readFieldCache, syncField } from '../lib/field_client';
import { FieldLookupResults } from '../components/FieldResults';
import { FieldLinkedReference } from '../components/FieldLinkedReference';
import { fieldSnapshotWindowIsCurrent } from '../../shared/field_snapshot';
import type { FieldQuery, FieldResult, FieldSnapshot, EvidenceDisplayMode, ReferenceRecord } from '../../shared/field';

const initial: FieldQuery = { mode: 'pill', term: '', color: '', shape: '', scoreLine: '', symptomIds: [], regionId: 'NL',
  from: null, to: null, includeBroaderContext: false, language: 'nl', expansionMode: 'STRICT_CANONICAL' };
export function responderQueryFromSearch(search: URLSearchParams): FieldQuery {
  const mode = search.get('mode');
  return { ...initial, mode: mode === 'market' || mode === 'symptoms' ? mode : 'pill', term: (search.get('term') ?? '').slice(0, 100) };
}
export function Responder() {
  const [searchParams] = useSearchParams();
  const linkedReferenceId = searchParams.get('reference') ?? undefined;
  const [query, setQuery] = useState<FieldQuery>(() => responderQueryFromSearch(searchParams));
  const linkedMode = searchParams.get('mode'), linkedTerm = searchParams.get('term');
  useEffect(() => { setQuery(responderQueryFromSearch(searchParams)); }, [linkedMode, linkedTerm]);
  const [profile, setProfile] = useState(defaultFieldProfile);
  return <><FieldSafety profile={profile} regionId={query.regionId} /><AccessBoundary capability="responder.lookup">
    <ResponderContent query={query} setQuery={setQuery} profile={profile} setProfile={setProfile} linkedReferenceId={linkedReferenceId} />
  </AccessBoundary></>;
}
function ResponderContent({ query, setQuery, profile, setProfile, linkedReferenceId }: {
  query: FieldQuery; setQuery: (q: FieldQuery) => void; profile: typeof defaultFieldProfile; setProfile: (p: typeof defaultFieldProfile) => void; linkedReferenceId?: string;
}) {
  const access = useAccess();
  const [display, setDisplay] = useState<EvidenceDisplayMode>(profile.evidenceDisplay?.defaultMode ?? 'full');
  const [snapshot, setSnapshot] = useState<FieldSnapshot | null>(null);
  const [result, setResult] = useState<FieldResult | null>(null);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('Loading reference profile…'), [error, setError] = useState('');
  const [offline, setOffline] = useState(false), [pending, setPending] = useState(0);
  const [offlineInspection, setOfflineInspection] = useState<{ record: ReferenceRecord; snapshot: FieldSnapshot } | null>(null);
  const [inspectionError, setInspectionError] = useState('');
  const [, tickSnapshotClock] = useState(0);
  const change = <K extends keyof FieldQuery>(key: K, value: FieldQuery[K]) => { setQuery({ ...query, [key]: value }); setResult(null); };
  async function synchronize() {
    setBusy(true); setError('');
    try {
      const next = await syncField(access.principalId!); setSnapshot(next); setProfile(next.profile);
      setOffline(false); setPending(pendingFieldAudit(access.principalId!));
      setStatus(`${next.records.length} approved references synchronized. Offline access expires ${next.expiresAt}.`);
    } catch (e) {
      if (e instanceof HttpFailure) { setSnapshot(null); setOfflineInspection(null); setOffline(false); setResult(null); setError(e.message); }
      else try {
        const saved = await readFieldCache(access.principalId!); setSnapshot(saved.snapshot); setProfile(saved.snapshot.profile);
        setOffline(true); setPending(pendingFieldAudit(access.principalId!)); setStatus('Offline snapshot available. Source updates and revocations cannot be checked until reconnection.');
      } catch (cacheError) { setStatus('Online search is available when connected; offline cache is unavailable.'); setError(`${(e as Error).message} ${(cacheError as Error).message}`); }
    } finally { setBusy(false); }
  }
  useEffect(() => { void synchronize(); }, [access.principalId]);
  useEffect(() => { setResult(null); }, [query]);
  useEffect(() => {
    let current = true; setOfflineInspection(null); setInspectionError('');
    if (offline && linkedReferenceId && access.principalId) {
      void offlineFieldReference(access.principalId, linkedReferenceId).then(value => {
        if (current) { setOfflineInspection(value); setPending(pendingFieldAudit(access.principalId!)); }
      }).catch(e => { if (current) setInspectionError((e as Error).message); });
    }
    return () => { current = false; };
  }, [offline, linkedReferenceId, access.principalId, snapshot?.generatedAt]);
  useEffect(() => {
    const expiresAt = offline ? offlineInspection?.snapshot.expiresAt : snapshot?.expiresAt;
    if (!expiresAt) return;
    const refresh = () => tickSnapshotClock(value => value + 1);
    const timer = setTimeout(refresh, Math.max(0, Date.parse(expiresAt) - Date.now()) + 1);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [offline, offlineInspection?.snapshot.expiresAt, snapshot?.expiresAt]);
  async function search(event: FormEvent) {
    event.preventDefault(); setBusy(true); setResult(null); setError('');
    try {
      const response = await fieldApi('lookup', query); setResult(response.result); setOffline(false);
      setStatus(`Live lookup · ${response.snapshotGeneratedAt} · trace ${response.traceId}`);
    } catch (e) {
      if (e instanceof HttpFailure) {
        if ([401, 403].includes(e.status)) { setSnapshot(null); setOfflineInspection(null); setOffline(false); }
        setError(e.message);
      }
      else try {
        const response = await offlineFieldLookup(access.principalId!, query);
        setResult(response.result); setSnapshot(response.snapshot); setOffline(true);
        setPending(pendingFieldAudit(access.principalId!)); setStatus(`Offline lookup · snapshot ${response.snapshot.generatedAt} · expires ${response.snapshot.expiresAt}`);
      } catch (cacheError) { setError((cacheError as Error).message); }
    } finally { setBusy(false); }
  }
  const inspectionSnapshot = offline ? offlineInspection?.snapshot : snapshot;
  const inspectionWindowCurrent = Boolean(inspectionSnapshot && access.principalId && fieldSnapshotWindowIsCurrent(inspectionSnapshot, access.principalId));
  const linkedReference = inspectionWindowCurrent && linkedReferenceId ? (offline ? offlineInspection?.record.id === linkedReferenceId ? offlineInspection.record : undefined : snapshot?.records.find(r => r.id === linkedReferenceId)) : undefined;
  const symptoms = [...new Map((snapshot?.records ?? []).flatMap(r => r.document.kind === 'assertion' &&
    r.document.predicate === 'ASSOCIATED_WITH_SYMPTOM' && r.document.object ? [[r.document.object.id, r.document.object] as const] : [])).values()];
  return <div className="field-page">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1>Responder reference</h1>
      <p className="text-slate-600">Find candidate samples and their sourced substance information.</p></div>
      <button type="button" className="field-button" disabled={busy} onClick={synchronize}>Synchronize offline references</button></div>
    <p role="status" className={`mt-3 text-sm ${offline ? 'field-warning' : 'text-slate-600'}`}>{status}</p>
    {offline && <p className="field-warning">Offline: {pending} reference audit events pending upload. Reconnect and synchronize to submit them.</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    {linkedReferenceId && <p className="field-panel text-sm">Linked reference: <span className="break-all">{linkedReferenceId}</span>. Search descriptors are prefilled; choose the context and run a lookup to compare reference candidates.</p>}
    {linkedReference && inspectionSnapshot && <FieldLinkedReference record={linkedReference} snapshot={inspectionSnapshot} profile={profile} display={display} />}
    {linkedReferenceId && inspectionError && <p className="field-error" role="alert">{inspectionError}</p>}
    {linkedReferenceId && inspectionSnapshot && !inspectionWindowCurrent && <p className="field-warning">Exact reference inspection is unavailable because the synchronized snapshot expired or belongs to another account. Reconnect and synchronize.</p>}
    {linkedReferenceId && !offline && snapshot && inspectionWindowCurrent && !linkedReference && <p className="field-warning">The linked reference is not present in the currently synchronized approved snapshot. It may be unavailable, changed or no longer approved.</p>}
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
    <div className="field-panel"><label className="field-control">Evidence display profile<select aria-label="Evidence display profile" value={display} onChange={e => setDisplay(e.target.value as EvidenceDisplayMode)}><option value="full">Full six evidence kinds</option><option value="compact">Compact responder buckets, retaining every evidence kind</option></select></label>
      <p className="mt-3 text-sm">{profile.evidenceDisplay?.explanation ?? 'Evidence colors describe how a reference was established. Approval and category remain separate.'}</p>
      <details className="mt-3"><summary>Evidence legend — independent from section order and review status</summary>
      <div className="flex flex-wrap gap-2 mt-3">{Object.keys(profile.tiers).map(tier => <EvidenceBadge key={tier} tier={tier as any} profile={profile} display={display} />)}</div>
      <p className="mt-3 text-sm">Each fact keeps its own tier. Human approval accepts the mapping; it does not turn a prediction into a measurement. Both display profiles retain the full evidence label and icon.</p></details></div>
    {result && <FieldLookupResults result={result} profile={profile} display={display} canReview={access.capabilities.includes('evidence.review')} linkedReferenceId={linkedReferenceId} />}
  </div>;
}
