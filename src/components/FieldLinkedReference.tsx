import type { EvidenceDisplayMode, FieldProfile, FieldSnapshot, ReferenceRecord } from '../../shared/field';
import { RecordEvidence, useFieldText } from './FieldEvidence';

const clinical = new Set(['pharmacokinetics', 'pharmacodynamics', 'acute_toxicity', 'chronic_effects', 'interactions']);

/** Exact reference inspection from an already verified, principal-bound snapshot.
 * It is separate from appearance/symptom matching and preserves clinical eligibility. */
export function FieldLinkedReference({ record, snapshot, profile, display }: {
  record: ReferenceRecord; snapshot: Pick<FieldSnapshot, 'generatedAt' | 'expiresAt'>; profile: FieldProfile; display: EvidenceDisplayMode;
}) {
  const { t, tCode, categoryLabel } = useFieldText();
  const d = record.document;
  const clinicalEligible = d.kind !== 'assertion' || !clinical.has(d.category) || ['PRIMARY_EMPIRICAL', 'CURATED_SECONDARY'].includes(d.evidenceTier);
  const category = d.kind === 'assertion' ? profile.categories.find(c => c.id === d.category) : undefined;
  return <section className="field-panel ring-2 ring-indigo-600 min-w-0" aria-label={t('linked_reference')} data-reference-id={record.id}>
    <h2 className="font-semibold">{t('linked_reference')}</h2>
    <p className="text-sm text-slate-600 break-words">{t('linked_snapshot', { generated: snapshot.generatedAt, expires: snapshot.expiresAt })}</p>
    <p className="field-warning">{t('linked_archived_note')}</p>
    {d.kind === 'sample' ? <><h3 className="font-semibold break-words">{d.name}</h3>
      <p className="text-sm break-words">{t('linked_specimen', { region: d.region.name, basis: tCode('time_basis_', d.timeBasis), date: d.observedOn ?? t('date_unknown') })}</p>
      <p className="text-sm break-words">{t('appearance', { value: [d.appearance.colors.join('/'), d.appearance.shape, d.appearance.logo, d.appearance.scoreLine].filter(Boolean).join(' · ') || t('not_reported') })}</p>
      <p className="text-sm break-words">{t('linked_components', { value: d.components.map(c => c.substance.name).join(', ') || t('not_reported') })}</p>
      {d.unknownComponents.map((unknown, i) => <p className="field-warning" key={i}>{t('unknown_component', { value: unknown })}</p>)}
    </> : <><h3 className="font-semibold break-words">{d.subject.name}{d.object ? ` → ${d.object.name}` : ''}</h3>
      <p className="text-sm break-words">{category ? categoryLabel(category.id, category.label) : d.category} · {d.predicate} · {d.region?.name ?? t('no_regional_restriction')}</p>
      {clinicalEligible ? <><p lang={d.statement.language}>{d.statement.text}</p>
        <p className="text-sm">{t('linked_validity', { kind: d.statement.kind === 'source_excerpt' ? t('statement_source_excerpt') : t('statement_curator_summary'), language: d.statement.language, from: d.validFrom ?? t('unknown_start'), to: d.validTo ?? t('no_reported_end') })}</p>
      </> : <p className="field-warning">{t('linked_withheld')}</p>}
      {d.contradicts.length > 0 && <p className="field-warning break-words">{t('linked_conflicts', { value: d.contradicts.join(', ') })}</p>}
      {d.supersedes && <p className="text-sm break-words">{t('linked_supersedes', { value: d.supersedes })}</p>}
    </>}
    <RecordEvidence record={record} profile={profile} display={display} />
  </section>;
}
