import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAccess, AccessBoundary } from '../lib/access';
import { defaultFieldProfile, FieldSafety, EvidenceBadge, useFieldText } from '../components/FieldEvidence';
import { fieldApi, HttpFailure, offlineFieldLookup, offlineFieldReference, pendingFieldAudit, readFieldCache, syncField } from '../lib/field_client';
import { FieldLookupResults } from '../components/FieldResults';
import { FieldLinkedReference } from '../components/FieldLinkedReference';
import { fieldSnapshotWindowIsCurrent } from '../../shared/field_snapshot';
import type { FieldQuery, FieldResult, FieldSnapshot, EvidenceDisplayMode, ReferenceRecord } from '../../shared/field';

type StatusKey = 'status_loading_profile' | 'status_synchronized' | 'status_offline_available' | 'status_online_only' | 'status_live_lookup' | 'status_offline_lookup';
/** The status line is stored as a key and its values, so a language switch re-renders it. */
type Status = { key: StatusKey; vars?: Record<string, string | number> };

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
  const f = useFieldText(), { t, errorText } = f;
  const [display, setDisplay] = useState<EvidenceDisplayMode>(profile.evidenceDisplay?.defaultMode ?? 'full');
  const [snapshot, setSnapshot] = useState<FieldSnapshot | null>(null);
  const [result, setResult] = useState<FieldResult | null>(null);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState<Status>({ key: 'status_loading_profile' }), [errors, setErrors] = useState<unknown[]>([]);
  const setError = (e: unknown) => setErrors(e ? [e] : []);
  const [offline, setOffline] = useState(false), [pending, setPending] = useState(0);
  const [offlineInspection, setOfflineInspection] = useState<{ record: ReferenceRecord; snapshot: FieldSnapshot } | null>(null);
  const [inspectionError, setInspectionError] = useState<unknown>(null);
  const [, tickSnapshotClock] = useState(0);
  const change = <K extends keyof FieldQuery>(key: K, value: FieldQuery[K]) => { setQuery({ ...query, [key]: value }); setResult(null); };
  async function synchronize() {
    setBusy(true); setError(null);
    try {
      const next = await syncField(access.principalId!); setSnapshot(next); setProfile(next.profile);
      setOffline(false); setPending(pendingFieldAudit(access.principalId!));
      setStatus({ key: 'status_synchronized', vars: { count: next.records.length, expires: next.expiresAt } });
    } catch (e) {
      if (e instanceof HttpFailure) { setSnapshot(null); setOfflineInspection(null); setOffline(false); setResult(null); setError(e); }
      else try {
        const saved = await readFieldCache(access.principalId!); setSnapshot(saved.snapshot); setProfile(saved.snapshot.profile);
        setOffline(true); setPending(pendingFieldAudit(access.principalId!)); setStatus({ key: 'status_offline_available' });
      } catch (cacheError) { setStatus({ key: 'status_online_only' }); setErrors([e, cacheError]); }
    } finally { setBusy(false); }
  }
  useEffect(() => { void synchronize(); }, [access.principalId]);
  useEffect(() => { setResult(null); }, [query]);
  useEffect(() => {
    let current = true; setOfflineInspection(null); setInspectionError(null);
    if (offline && linkedReferenceId && access.principalId) {
      void offlineFieldReference(access.principalId, linkedReferenceId).then(value => {
        if (current) { setOfflineInspection(value); setPending(pendingFieldAudit(access.principalId!)); }
      }).catch(e => { if (current) setInspectionError(e); });
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
    event.preventDefault(); setBusy(true); setResult(null); setError(null);
    try {
      const response = await fieldApi('lookup', query); setResult(response.result); setOffline(false);
      setStatus({ key: 'status_live_lookup', vars: { generated: response.snapshotGeneratedAt, trace: response.traceId } });
    } catch (e) {
      if (e instanceof HttpFailure) {
        if ([401, 403].includes(e.status)) { setSnapshot(null); setOfflineInspection(null); setOffline(false); }
        setError(e);
      }
      else try {
        const response = await offlineFieldLookup(access.principalId!, query);
        setResult(response.result); setSnapshot(response.snapshot); setOffline(true);
        setPending(pendingFieldAudit(access.principalId!)); setStatus({ key: 'status_offline_lookup', vars: { generated: response.snapshot.generatedAt, expires: response.snapshot.expiresAt } });
      } catch (cacheError) { setError(cacheError); }
    } finally { setBusy(false); }
  }
  const inspectionSnapshot = offline ? offlineInspection?.snapshot : snapshot;
  const inspectionWindowCurrent = Boolean(inspectionSnapshot && access.principalId && fieldSnapshotWindowIsCurrent(inspectionSnapshot, access.principalId));
  const linkedReference = inspectionWindowCurrent && linkedReferenceId ? (offline ? offlineInspection?.record.id === linkedReferenceId ? offlineInspection.record : undefined : snapshot?.records.find(r => r.id === linkedReferenceId)) : undefined;
  const symptoms = [...new Map((snapshot?.records ?? []).flatMap(r => r.document.kind === 'assertion' &&
    r.document.predicate === 'ASSOCIATED_WITH_SYMPTOM' && r.document.object ? [[r.document.object.id, r.document.object] as const] : [])).values()];
  return <div className="field-page min-w-0">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h1 className="break-words">{t('title')}</h1>
      <p className="text-slate-600">{t('intro')}</p></div>
      <button type="button" className="field-button" disabled={busy} onClick={synchronize}>{t('synchronize')}</button></div>
    <p role="status" className={`mt-3 text-sm break-words ${offline ? 'field-warning' : 'text-slate-600'}`}>{t(status.key, status.vars)}</p>
    {offline && <p className="field-warning">{t('offline_pending', { count: pending })}</p>}
    {errors.length > 0 && <p className="field-error break-words" role="alert">{errors.map(errorText).join(' ')}</p>}
    {linkedReferenceId && <p className="field-panel text-sm">{t('linked_prefix')} <span className="break-all">{linkedReferenceId}</span>{t('linked_suffix')}</p>}
    {linkedReference && inspectionSnapshot && <FieldLinkedReference record={linkedReference} snapshot={inspectionSnapshot} profile={profile} display={display} />}
    {linkedReferenceId && inspectionError !== null && <p className="field-error break-words" role="alert">{errorText(inspectionError)}</p>}
    {linkedReferenceId && inspectionSnapshot && !inspectionWindowCurrent && <p className="field-warning">{t('inspection_unavailable')}</p>}
    {linkedReferenceId && !offline && snapshot && inspectionWindowCurrent && !linkedReference && <p className="field-warning">{t('linked_absent')}</p>}
    <form className="field-panel min-w-0" onSubmit={search}>
      <div className="flex flex-wrap gap-2 mb-4" aria-label={t('search_mode')}>{(['pill', 'market', 'symptoms'] as const).map(mode =>
        <button key={mode} type="button" className="field-button" aria-pressed={query.mode === mode} onClick={() => change('mode', mode)}>
          {t(`mode_${mode}`)}</button>)}</div>
      <p className="text-sm text-slate-600 mb-3">{t('descriptors_only')}</p>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {<label className="field-control">{query.mode === 'symptoms' ? t('term_symptoms') : query.mode === 'market' ? t('term_market') : t('term_pill')}
          <input value={query.term} maxLength={100} onChange={e => change('term', e.target.value)} autoComplete="off" /></label>}
        {query.mode === 'pill' && <><label className="field-control">{t('color')}<select aria-label={t('color')} value={query.color} onChange={e => change('color', e.target.value)}><option value="">{t('any_color')}</option>{profile.colors.map(c => <option key={c.id} value={c.id}>{f.colorLabel(c.id, c.label)}</option>)}</select></label>
          <label className="field-control">{t('shape')}<input value={query.shape} maxLength={100} onChange={e => change('shape', e.target.value)} /></label>
          <label className="field-control">{t('score_line')}<input value={query.scoreLine} maxLength={100} onChange={e => change('scoreLine', e.target.value)} /></label></>}
        <label className="field-control">{t('region')}<select aria-label={t('region')} value={query.regionId} onChange={e => change('regionId', e.target.value)}>{profile.regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label className="field-control">{t('from_date')}<input type="date" value={query.from ?? ''} onChange={e => change('from', e.target.value || null)} /></label>
        <label className="field-control">{t('to_date')}<input type="date" value={query.to ?? ''} onChange={e => change('to', e.target.value || null)} /></label>
        {query.mode === 'market' && <><label className="field-control">{t('label_language')}<select aria-label={t('label_language')} value={query.language} onChange={e => change('language', e.target.value)}>{['nl', 'en', 'pl'].map(l => <option key={l}>{l}</option>)}</select></label>
          <label className="field-control">{t('label_expansion')}<select aria-label={t('label_expansion')} value={query.expansionMode} onChange={e => change('expansionMode', e.target.value as FieldQuery['expansionMode'])}>
            <option value="STRICT_CANONICAL">{t('expansion_strict')}</option><option value="LOCALIZED_SYNONYMS">{t('expansion_localized')}</option></select></label></>}
      </div>
      {query.mode === 'symptoms' && <fieldset className="mt-4"><legend className="font-medium">{t('symptom_associations')}</legend>
        <div className="flex flex-wrap gap-4 mt-2">{symptoms.map(s => <label key={s.id}><input type="checkbox" checked={query.symptomIds.includes(s.id)}
          onChange={e => change('symptomIds', e.target.checked ? [...query.symptomIds, s.id] : query.symptomIds.filter(id => id !== s.id))} /> {s.name}</label>)}</div>
        {!symptoms.length && <p>{t('no_symptom_vocabulary')}</p>}</fieldset>}
      <div className="flex flex-wrap items-center justify-between gap-4 mt-4"><label className="text-sm min-w-0"><input type="checkbox" checked={query.includeBroaderContext} onChange={e => change('includeBroaderContext', e.target.checked)} /> {t('include_broader')}</label>
        <button className="field-button primary" disabled={busy || query.mode === 'symptoms' && !query.symptomIds.length && !query.term}>{busy ? t('working') : t('find_references')}</button></div>
    </form>
    <div className="field-panel min-w-0"><label className="field-control">{t('display_profile')}<select aria-label={t('display_profile')} value={display} onChange={e => setDisplay(e.target.value as EvidenceDisplayMode)}><option value="full">{t('display_full')}</option><option value="compact">{t('display_compact')}</option></select></label>
      <p className="mt-3 text-sm">{profile.evidenceDisplay?.explanation ? f.profileText('cfg_explanation', profile.evidenceDisplay.explanation) : t('explanation_fallback')}</p>
      <details className="mt-3"><summary>{t('legend_summary')}</summary>
      <div className="flex flex-wrap gap-2 mt-3">{Object.keys(profile.tiers).map(tier => <EvidenceBadge key={tier} tier={tier as any} profile={profile} display={display} />)}</div>
      <p className="mt-3 text-sm">{t('legend_note')}</p></details></div>
    {result && <FieldLookupResults result={result} profile={profile} display={display} canReview={access.capabilities.includes('evidence.review')} linkedReferenceId={linkedReferenceId} />}
  </div>;
}
