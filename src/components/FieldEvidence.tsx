import type { FieldProfile, ReferenceRecord, FactView, SubstanceCard, EvidenceDisplayMode } from '../../shared/field';
import type { EvidenceTier } from '../../backend/watchdog_api/domain/evidence_tier';
import tierDisplay from '../../config/evidence/tier-display.json';
import fallbackProfile from '../../config/field/responder.json';
import text from '../../config/ui/responder.json';
import { useUiText } from '../lib/ui_text';
import { configText } from '../lib/config_text';
export const defaultFieldProfile = { ...fallbackProfile, tiers: tierDisplay } as FieldProfile;

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_');
/** The configured contacts have no id; their translations are found by the stored English text. */
const CONTACT_KEYS = ['emergency_services', 'nvic', 'drug_checking'] as const;

/**
 * Field texts in the reader's language. Wording that comes from the field profile
 * (config/field/responder.json, config/evidence/tier-display.json) is hashed into the
 * offline snapshot and stays as stored; it is translated for display only while the
 * profile text equals the English source in config/ui/responder.json.
 */
export function useFieldText() {
  const ui = useUiText(text);
  const profileText = (key: string, source: string) => configText(text, ui.lang, 'en', key, source);
  const contactText = (field: 'name' | 'audience', source: string) => {
    const en: Record<string, string> = text.languages.en;
    const key = CONTACT_KEYS.map(k => `contact_${field}_${k}`).find(k => en[k] === source);
    return key ? profileText(key, source) : source;
  };
  return { ...ui, profileText, contactText,
    tierLabel: (tier: string, source: string) => profileText(`tier_${slug(tier)}`, source),
    bucketLabel: (bucket: string) => profileText(`bucket_${slug(bucket)}`, bucket),
    categoryLabel: (id: string, source: string) => profileText(`category_${slug(id)}`, source),
    colorLabel: (id: string, source: string) => profileText(`color_${slug(id)}`, source),
  };
}

/** A reversible presentation choice. Evidence data, approval and categories are untouched. */
export function evidencePresentation(profile: FieldProfile, tier: EvidenceTier, display: EvidenceDisplayMode = profile.evidenceDisplay?.defaultMode ?? 'full') {
  const value = profile.tiers[tier] ?? profile.tiers.UNKNOWN;
  return { ...value, color: display === 'compact' ? profile.evidenceDisplay?.compactColors[value.bucket] ?? value.color : value.color };
}
export function EvidenceBadge({ tier, profile = defaultFieldProfile, prefix, display }: { tier: EvidenceTier; profile?: FieldProfile; prefix?: string; display?: EvidenceDisplayMode }) {
  const f = useFieldText();
  const mode = display ?? profile.evidenceDisplay?.defaultMode ?? 'full';
  const value = evidencePresentation(profile, tier, mode);
  const tierKey = profile.tiers[tier] ? tier : 'UNKNOWN';
  return <span className="evidence-badge" data-evidence-tier={tier} data-evidence-display={mode} style={{ color: value.color, borderColor: value.color }}>
    <span aria-hidden="true">{value.icon}</span> {prefix ? `${prefix}: ` : ''}{f.tierLabel(tierKey, value.label)}{mode === 'compact' ? ` · ${f.bucketLabel(value.bucket)}` : ''}
  </span>;
}
export function RecordEvidence({ record, profile = defaultFieldProfile, display }: { record: ReferenceRecord; profile?: FieldProfile; display?: EvidenceDisplayMode }) {
  const { t } = useFieldText();
  const age = Math.max(0, (Date.now() - Date.parse(record.document.citation.retrievedAt)) / 3_600_000);
  return <div className="space-y-2 text-sm min-w-0">
    <div className="flex flex-wrap gap-2"><EvidenceBadge tier={record.document.evidenceTier} profile={profile} display={display} />
      <span className="evidence-badge">{record.approvalState === 'APPROVED' ? t('approved_mapping') : t('proposed_mapping')}</span>
      {record.document.qualityFlags.map(flag => <span className="evidence-badge" key={flag}>⚑ {flag}</span>)}
      {age > profile.staleAfterHours && <span className="evidence-badge text-amber-800">{t('refresh_overdue')}</span>}
    </div>
    <p className="break-words"><a href={record.document.citation.url} target="_blank" rel="noreferrer">{record.document.citation.publisher} · {record.document.citation.title}</a></p>
    <p className="text-slate-600 break-words">{t('source_retrieved', { date: record.document.citation.retrievedAt.slice(0, 10), locator: record.document.citation.locator })}</p>
    <details><summary>{t('provenance_review')}</summary><dl className="field-metadata">
      <dt>{t('source_record')}</dt><dd>{record.document.citation.sourceRecordId}</dd>
      <dt>{t('content_sha')}</dt><dd>{record.contentHash}</dd>
      <dt>{t('imported_sha')}</dt><dd>{record.rawSha256}</dd>
      <dt>{t('reviewed_by')}</dt><dd>{record.approvedBy ?? t('not_reviewed')}</dd>
      <dt>{t('reviewed_at')}</dt><dd>{record.approvedAt ?? t('not_reviewed')}</dd>
    </dl></details>
  </div>;
}
export function FieldSafety({ profile = defaultFieldProfile, regionId = 'NL' }: { profile?: FieldProfile; regionId?: string }) {
  const f = useFieldText(), { t } = f;
  const applicable = new Set<string>();
  let id: string | null = regionId;
  while (id && !applicable.has(id)) { applicable.add(id); id = profile.regions.find(r => r.id === id)?.parentId ?? null; }
  const contacts = profile.contacts.filter(c => applicable.has(c.regionId));
  return <aside className="field-safety" aria-label={t('emergency_guidance')}>
    <strong>{t('safety_heading')}</strong><p>{f.profileText('cfg_disclaimer', profile.disclaimer)}</p>
    <div className="flex flex-wrap gap-x-6 gap-y-2 mt-2">{contacts.map(c => <div key={c.name} className="min-w-0 break-words">
      <a href={c.phone ? `tel:${c.phone}` : c.url}>{f.contactText('name', c.name)}{c.phone ? `: ${c.phone}` : ''}</a>
      <small className="block">{f.contactText('audience', c.audience)} · <a href={c.citationUrl}>{t('contact_verified', { date: c.verifiedOn })}</a></small>
    </div>)}</div>
    {!contacts.length && <p>{t('no_contacts')}</p>}
  </aside>;
}
function Fact({ fact, profile, display }: { fact: FactView; profile: FieldProfile; display?: EvidenceDisplayMode }) {
  const { t } = useFieldText();
  const d = fact.record.document;
  return <article className="field-fact" style={{ borderLeftColor: evidencePresentation(profile, d.evidenceTier, display).color }}>
    {fact.contradicted && <strong className="text-rose-800">{t('conflicting_evidence')}</strong>}
    <p className="font-medium">{d.subject.name}{d.object ? ` → ${d.object.name}` : ''}</p>
    <p lang={d.statement.language}>{d.statement.text}</p>
    <p className="text-sm text-slate-600">{t('statement_language', { kind: d.statement.kind === 'source_excerpt' ? t('statement_source_excerpt') : t('statement_curator_summary'), language: d.statement.language })}
      {d.validFrom || d.validTo ? t('statement_validity', { from: d.validFrom ?? t('unknown_start'), to: d.validTo ?? t('no_reported_end') }) : ''}</p>
    {(['mechanism', 'severity', 'population'] as const).map(key => <p key={key} className="text-sm">{t('statement_field', { field: t(`statement_${key}`), value: d.statement[key] ?? t('not_reported_by_source') })}</p>)}
    <RecordEvidence record={fact.record} profile={profile} display={display} />
  </article>;
}
export function SubstanceReference({ card, profile, display }: { card: SubstanceCard; profile: FieldProfile; display?: EvidenceDisplayMode }) {
  const { t, categoryLabel } = useFieldText();
  return <details className="field-substance"><summary><strong>{card.substance.name}</strong>{t('substance_summary')}</summary>
    {card.referenceRegion && <p className="text-sm text-slate-600">{t('reference_context', { name: card.referenceRegion.name })}</p>}
    {card.missingInteractions && <p className="field-warning">{t('missing_interactions')}</p>}
    {card.sections.map((section, i) => <section key={section.id} className="mt-4" data-category={section.id}>
      <h4 className="font-semibold">{i + 1}. {categoryLabel(section.id, section.label)}</h4>
      {section.facts.length ? section.facts.map(f => <Fact key={f.record.id} fact={f} profile={profile} display={display} />) : <p className="text-sm text-slate-500">{t('no_category_reference')}</p>}
    </section>)}
  </details>;
}
