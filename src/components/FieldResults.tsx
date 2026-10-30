import { Link } from 'react-router-dom';
import type { EvidenceDisplayMode, FieldProfile, FieldResult, SampleCandidate } from '../../shared/field';
import { EvidenceBadge, RecordEvidence, SubstanceReference, useFieldText } from './FieldEvidence';

function SampleReference({ candidate: c, profile, display, linkedReferenceId }: { candidate: SampleCandidate; profile: FieldProfile; display: EvidenceDisplayMode; linkedReferenceId?: string }) {
  const { t, tCode } = useFieldText();
  const d = c.record.document;
  return <article className={`field-panel min-w-0 ${linkedReferenceId === c.record.id ? 'ring-2 ring-indigo-600' : ''}`} data-reference-id={c.record.id} data-linked-reference={linkedReferenceId === c.record.id ? 'true' : undefined}>
    <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold text-lg break-words min-w-0">{d.name}</h3><EvidenceBadge tier={c.matchTier} prefix={t('match_prefix')} profile={profile} display={display} /></div>
    <p className="text-sm mt-2 break-words">{d.region.name} · {tCode('scope_', c.regionScope)} · {tCode('time_basis_', d.timeBasis)}: {d.observedOn ?? t('date_unknown')}</p>
    <p className="text-sm mt-1 break-words">{t('appearance', { value: [d.appearance.colors.join('/'), d.appearance.shape, d.appearance.logo, d.appearance.scoreLine].filter(Boolean).join(' · ') || t('not_reported') })}</p>
    {d.origin === 'published_alert' && <p className="field-warning">{t('published_alert_note')}</p>}
    <div className="overflow-x-auto my-3"><table className="field-table"><thead><tr><th>{t('col_component')}</th><th>{t('col_amount')}</th><th>{t('col_note')}</th></tr></thead>
      <tbody>{d.components.map(component => <tr key={component.substance.id}><td>{component.substance.name}</td><td>{component.amount === null ? t('not_reported') : `${component.amount} ${component.unit}`}</td><td>{component.note ?? '—'}</td></tr>)}</tbody></table></div>
    {!d.components.length && <p className="field-warning">{t('no_components')}</p>}
    {d.unknownComponents.map((unknown, i) => <p key={i} className="field-warning">{t('unknown_component', { value: unknown })}</p>)}
    <RecordEvidence record={c.record} profile={profile} display={display} />
    {c.substances.map(card => <SubstanceReference key={card.substance.id} card={card} profile={profile} display={display} />)}
  </article>;
}

export function FieldLookupResults({ result, profile, display, canReview = false, linkedReferenceId }: {
  result: FieldResult; profile: FieldProfile; display: EvidenceDisplayMode; canReview?: boolean; linkedReferenceId?: string;
}) {
  const { t } = useFieldText();
  const sampleMode = result.query.mode !== 'symptoms';
  const g = result.globalSummary;
  return <section className="mt-5 min-w-0" aria-label={t('results_label')}>
    <h2 className="break-words">{t('results_heading', { count: result.candidates.length + result.symptomCandidates.length })}{sampleMode ? t('results_heading_archive', { count: result.globalCandidates.length }) : ''}</h2>
    <p className="field-warning">{t('results_not_identification')}</p>
    {sampleMode && <><p className="text-sm">{t('regional_result', { labs: result.labSampleCount, alerts: result.publishedAlertCount, visual: result.visualReportCount })}</p>
      {result.excludedUndated > 0 && <p className="field-warning">{t('regional_undated_excluded', { count: result.excludedUndated })}</p>}
      {result.flags.includes('AMBIGUOUS_MARKET_LABEL') && <p className="field-warning">{t('flag_ambiguous_market_label')}</p>}
      {result.flags.includes('MULTIPLE_SOURCE_VERSIONS') && <p className="field-warning">{t('flag_multiple_source_versions')}</p>}
      {result.distribution.length > 0 && <div className="field-panel" aria-label={t('local_denominator_label')}><h3 className="font-semibold">{t('local_composition_heading')}</h3>
        <p className="text-sm">{t('local_denominator', { count: result.labSampleCount })}</p>
        <ul className="mt-2">{result.distribution.map(d => <li key={d.substance.id}>{t('distribution_item', { name: d.substance.name, count: d.labSampleCount, total: result.labSampleCount })}</li>)}</ul></div>}
    </>}
    {result.candidates.map(c => <SampleReference key={c.record.id} candidate={c} profile={profile} display={display} linkedReferenceId={linkedReferenceId} />)}
    {sampleMode && <section className="field-panel" aria-label={t('global_context')}><h3 className="font-semibold">{t('global_context')}</h3>
      <p className="text-sm">{t('global_summary', { records: g.recordCount, sources: g.distinctSourceRecordCount, labs: g.labSampleCount, alerts: g.publishedAlertCount, visual: g.visualReportCount })}</p>
      <p className="text-sm mt-2">{t('global_meaning')}</p>
      {result.query.mode === 'market' && <p className="text-sm mt-2">{t('global_market_note')}</p>}
      {result.flags.includes('AMBIGUOUS_GLOBAL_MARKET_LABEL') && <p className="field-warning">{t('flag_ambiguous_global_market_label')}</p>}
      {result.globalExcludedUndated > 0 && <p className="field-warning">{t('global_undated_excluded', { count: result.globalExcludedUndated })}</p>}
      {g.distribution.length > 0 && <div className="mt-3" aria-label={t('global_denominator_label')}><h4 className="font-medium">{t('global_composition_heading')}</h4>
        <p className="text-sm">{t('global_denominator', { count: g.labSampleCount })}</p>
        <ul className="mt-2">{g.distribution.map(d => <li key={d.substance.id}>{t('distribution_item', { name: d.substance.name, count: d.labSampleCount, total: g.labSampleCount })}</li>)}</ul></div>}
      {!result.globalCandidates.length && <p className="mt-3 text-sm">{t('global_none')}</p>}
      {result.globalCandidates.map(c => <SampleReference key={c.record.id} candidate={c} profile={profile} display={display} linkedReferenceId={linkedReferenceId} />)}
    </section>}
    {result.symptomCandidates.map(c => <article className="field-panel min-w-0" key={c.card.substance.id}><h3 className="break-words">{t('symptom_candidate', { name: c.card.substance.name, count: c.matchedSymptomIds.length })}</h3>
      <p className="field-warning">{t('symptom_not_diagnosis')}</p>
      {c.supportingAssertions.map(f => <p key={f.record.id} className="break-words">{f.record.document.object?.name}: <a href={f.record.document.citation.url}>{f.record.document.citation.publisher}</a></p>)}
      <SubstanceReference card={c.card} profile={profile} display={display} /></article>)}
    {!result.candidates.length && !result.symptomCandidates.length && <div className="field-panel"><p>{t('no_matches')}</p>
      {canReview && <Link to="/evidence">{t('review_mappings')}</Link>}</div>}
  </section>;
}
