import { Link } from 'react-router-dom';
import type { EvidenceDisplayMode, FieldProfile, FieldResult, SampleCandidate } from '../../shared/field';
import { EvidenceBadge, RecordEvidence, SubstanceReference } from './FieldEvidence';

function SampleReference({ candidate: c, profile, display, linkedReferenceId }: { candidate: SampleCandidate; profile: FieldProfile; display: EvidenceDisplayMode; linkedReferenceId?: string }) {
  return <article className={`field-panel ${linkedReferenceId === c.record.id ? 'ring-2 ring-indigo-600' : ''}`} data-reference-id={c.record.id} data-linked-reference={linkedReferenceId === c.record.id ? 'true' : undefined}>
    <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold text-lg">{c.record.document.name}</h3><EvidenceBadge tier={c.matchTier} prefix="Match" profile={profile} display={display} /></div>
    <p className="text-sm mt-2">{c.record.document.region.name} · {{ broader_context: 'Broader context — not local sample evidence', selected_region: 'Within selected region', global_context: 'Other region — not local sample evidence' }[c.regionScope]} · {c.record.document.timeBasis}: {c.record.document.observedOn ?? 'Date unknown'}</p>
    <p className="text-sm mt-1">Appearance: {[c.record.document.appearance.colors.join('/'), c.record.document.appearance.shape, c.record.document.appearance.logo, c.record.document.appearance.scoreLine].filter(Boolean).join(' · ') || 'Not reported'}</p>
    {c.record.document.origin === 'published_alert' && <p className="field-warning">Published source alert — specimen method and sampling coverage may be unavailable.</p>}
    <div className="overflow-x-auto my-3"><table className="field-table"><thead><tr><th>Reported component</th><th>Reported amount</th><th>Source note</th></tr></thead>
      <tbody>{c.record.document.components.map(component => <tr key={component.substance.id}><td>{component.substance.name}</td><td>{component.amount === null ? 'Not reported' : `${component.amount} ${component.unit}`}</td><td>{component.note ?? '—'}</td></tr>)}</tbody></table></div>
    {!c.record.document.components.length && <p className="field-warning">No identified components reported.</p>}
    {c.record.document.unknownComponents.map((unknown, i) => <p key={i} className="field-warning">Unknown component: {unknown}</p>)}
    <RecordEvidence record={c.record} profile={profile} display={display} />
    {c.substances.map(card => <SubstanceReference key={card.substance.id} card={card} profile={profile} display={display} />)}
  </article>;
}

export function FieldLookupResults({ result, profile, display, canReview = false, linkedReferenceId }: {
  result: FieldResult; profile: FieldProfile; display: EvidenceDisplayMode; canReview?: boolean; linkedReferenceId?: string;
}) {
  const sampleMode = result.query.mode !== 'symptoms';
  return <section className="mt-5" aria-label="Lookup results">
    <h2>{result.candidates.length + result.symptomCandidates.length} regional reference candidates{sampleMode ? ` · ${result.globalCandidates.length} additional archive candidates` : ''}</h2>
    <p className="field-warning">Appearance and market names do not identify the substance taken. These records concern other specimens or source reports.</p>
    {sampleMode && <><p className="text-sm">Regional result: {result.labSampleCount} distinct laboratory samples in selected region · {result.publishedAlertCount} published alerts · {result.visualReportCount} visual reports. Source coverage is incomplete.</p>
      {result.excludedUndated > 0 && <p className="field-warning">{result.excludedUndated} matching regional undated records excluded by your date filter.</p>}
      {result.flags.includes('AMBIGUOUS_MARKET_LABEL') && <p className="field-warning">This label belongs to multiple reviewed regional market groups. All matching groups remain visible.</p>}
      {result.flags.includes('MULTIPLE_SOURCE_VERSIONS') && <p className="field-warning">Multiple versions of the same source record are shown. They are not independent specimens.</p>}
      {result.distribution.length > 0 && <div className="field-panel" aria-label="Local composition denominator"><h3 className="font-semibold">Composition occurrences in local tested reference samples</h3>
        <p className="text-sm">Local denominator: {result.labSampleCount} distinct sampled records. Mixed samples can contain more than one substance. This is not market prevalence.</p>
        <ul className="mt-2">{result.distribution.map(d => <li key={d.substance.id}>{d.substance.name}: {d.labSampleCount} / {result.labSampleCount} samples</li>)}</ul></div>}
    </>}
    {result.candidates.map(c => <SampleReference key={c.record.id} candidate={c} profile={profile} display={display} linkedReferenceId={linkedReferenceId} />)}
    {sampleMode && <section className="field-panel" aria-label="Global archive context"><h3 className="font-semibold">Global archive context</h3>
      <p className="text-sm">All matching approved records in this archive: {result.globalSummary.recordCount} mappings · {result.globalSummary.distinctSourceRecordCount} distinct source records · {result.globalSummary.labSampleCount} distinct laboratory samples · {result.globalSummary.publishedAlertCount} alerts · {result.globalSummary.visualReportCount} visual reports.</p>
      <p className="text-sm mt-2">This includes regional matches. Global means the available archive, with incomplete coverage; it does not estimate worldwide occurrence or identify a current specimen. Additional records do not enter the local denominator.</p>
      {result.query.mode === 'market' && <p className="text-sm mt-2">Archive-wide label resolution retains the selected language. A reviewed label from another region can reveal a market group here; that does not establish local label usage or make it a chemical synonym.</p>}
      {result.flags.includes('AMBIGUOUS_GLOBAL_MARKET_LABEL') && <p className="field-warning">This label has multiple reviewed groups in the archive. Regional differences remain visible.</p>}
      {result.globalExcludedUndated > 0 && <p className="field-warning">{result.globalExcludedUndated} matching undated archive records excluded by your date filter.</p>}
      {result.globalSummary.distribution.length > 0 && <div className="mt-3" aria-label="Global composition denominator"><h4 className="font-medium">Composition occurrences across matching archived laboratory samples</h4>
        <p className="text-sm">Archive denominator: {result.globalSummary.labSampleCount} distinct sampled records. Source versions are counted once; mixed samples can contribute to several substances. This is not prevalence.</p>
        <ul className="mt-2">{result.globalSummary.distribution.map(d => <li key={d.substance.id}>{d.substance.name}: {d.labSampleCount} / {result.globalSummary.labSampleCount} samples</li>)}</ul></div>}
      {!result.globalCandidates.length && <p className="mt-3 text-sm">No additional approved matching records outside the regional result. Missing records do not exclude exposure or risk.</p>}
      {result.globalCandidates.map(c => <SampleReference key={c.record.id} candidate={c} profile={profile} display={display} linkedReferenceId={linkedReferenceId} />)}
    </section>}
    {result.symptomCandidates.map(c => <article className="field-panel" key={c.card.substance.id}><h3>{c.card.substance.name} · {c.matchedSymptomIds.length} matching sourced associations</h3>
      <p className="field-warning">Association overlap, not a diagnosis or probability.</p>
      {c.supportingAssertions.map(f => <p key={f.record.id}>{f.record.document.object?.name}: <a href={f.record.document.citation.url}>{f.record.document.citation.publisher}</a></p>)}
      <SubstanceReference card={c.card} profile={profile} display={display} /></article>)}
    {!result.candidates.length && !result.symptomCandidates.length && <div className="field-panel"><p>No approved matching references in the selected regional result. This does not exclude exposure or risk.</p>
      {canReview && <Link to="/evidence">Review source mappings</Link>}</div>}
  </section>;
}
