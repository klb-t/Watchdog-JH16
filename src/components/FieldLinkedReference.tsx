import type { EvidenceDisplayMode, FieldProfile, FieldSnapshot, ReferenceRecord } from '../../shared/field';
import { RecordEvidence } from './FieldEvidence';

const clinical = new Set(['pharmacokinetics', 'pharmacodynamics', 'acute_toxicity', 'chronic_effects', 'interactions']);

/** Exact reference inspection from an already verified, principal-bound snapshot.
 * It is separate from appearance/symptom matching and preserves clinical eligibility. */
export function FieldLinkedReference({ record, snapshot, profile, display }: {
  record: ReferenceRecord; snapshot: Pick<FieldSnapshot, 'generatedAt' | 'expiresAt'>; profile: FieldProfile; display: EvidenceDisplayMode;
}) {
  const d = record.document;
  const clinicalEligible = d.kind !== 'assertion' || !clinical.has(d.category) || ['PRIMARY_EMPIRICAL', 'CURATED_SECONDARY'].includes(d.evidenceTier);
  return <section className="field-panel ring-2 ring-indigo-600" aria-label="Linked source reference" data-reference-id={record.id}>
    <h2 className="font-semibold">Linked source reference</h2>
    <p className="text-sm text-slate-600">Synchronized snapshot: {snapshot.generatedAt} · expires {snapshot.expiresAt}. Synchronize again to check current source mappings and revocations.</p>
    <p className="field-warning">This displays an archived mapping. It does not identify an exposure, run a clinical lookup or establish a diagnosis.</p>
    {d.kind === 'sample' ? <><h3 className="font-semibold">{d.name}</h3>
      <p className="text-sm">Reference specimen/report: {d.region.name} · {d.timeBasis}: {d.observedOn ?? 'Date unknown'}</p>
      <p className="text-sm">Appearance: {[d.appearance.colors.join('/'), d.appearance.shape, d.appearance.logo, d.appearance.scoreLine].filter(Boolean).join(' · ') || 'Not reported'}</p>
      <p className="text-sm">Reported components of this reference: {d.components.map(c => c.substance.name).join(', ') || 'Not reported'}. Appearance does not identify another specimen.</p>
      {d.unknownComponents.map((unknown, i) => <p className="field-warning" key={i}>Unknown component: {unknown}</p>)}
    </> : <><h3 className="font-semibold">{d.subject.name}{d.object ? ` → ${d.object.name}` : ''}</h3>
      <p className="text-sm">{profile.categories.find(c => c.id === d.category)?.label ?? d.category} · {d.predicate} · {d.region?.name ?? 'No regional restriction reported by source'}</p>
      {clinicalEligible ? <><p lang={d.statement.language}>{d.statement.text}</p>
        <p className="text-sm">{d.statement.kind === 'source_excerpt' ? 'Source excerpt' : 'Curator summary'} · language: {d.statement.language} · validity: {d.validFrom ?? 'unknown start'} to {d.validTo ?? 'no reported end'}</p>
      </> : <p className="field-warning">This mapping is retained for provenance. The responder clinical view does not display modeled, raw or speculative clinical statements.</p>}
      {d.contradicts.length > 0 && <p className="field-warning">This source mapping records conflicting references: {d.contradicts.join(', ')}. Sources remain separate.</p>}
      {d.supersedes && <p className="text-sm">Supersedes reference: {d.supersedes}</p>}
    </>}
    <RecordEvidence record={record} profile={profile} display={display} />
  </section>;
}
