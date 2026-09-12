import type { FieldProfile, ReferenceRecord, FactView, SubstanceCard } from '../../shared/field';
import type { EvidenceTier } from '../../backend/watchdog_api/domain/evidence_tier';
import tierDisplay from '../../config/evidence/tier-display.json';
import fallbackProfile from '../../config/field/responder.json';
export const defaultFieldProfile = { ...fallbackProfile, tiers: tierDisplay } as FieldProfile;

export function EvidenceBadge({ tier, profile = defaultFieldProfile, prefix }: { tier: EvidenceTier; profile?: FieldProfile; prefix?: string }) {
  const value = profile.tiers[tier] ?? profile.tiers.UNKNOWN;
  return <span className="evidence-badge" style={{ color: value.color, borderColor: value.color }}>
    <span aria-hidden="true">{value.icon}</span> {prefix ? `${prefix}: ` : ''}{value.label} · {value.bucket}
  </span>;
}
export function RecordEvidence({ record, profile = defaultFieldProfile }: { record: ReferenceRecord; profile?: FieldProfile }) {
  const age = Math.max(0, (Date.now() - Date.parse(record.document.citation.retrievedAt)) / 3_600_000);
  return <div className="space-y-2 text-sm">
    <div className="flex flex-wrap gap-2"><EvidenceBadge tier={record.document.evidenceTier} profile={profile} />
      <span className="evidence-badge">{record.approvalState === 'APPROVED' ? '✓ Approved mapping' : '◷ Proposed mapping'}</span>
      {record.document.qualityFlags.map(flag => <span className="evidence-badge" key={flag}>⚑ {flag}</span>)}
      {age > profile.staleAfterHours && <span className="evidence-badge text-amber-800">◷ Source refresh overdue</span>}
    </div>
    <p><a href={record.document.citation.url} target="_blank" rel="noreferrer">{record.document.citation.publisher} · {record.document.citation.title}</a></p>
    <p className="text-slate-600">Source retrieved {record.document.citation.retrievedAt.slice(0, 10)} · {record.document.citation.locator}</p>
    <details><summary>Provenance and review</summary><dl className="field-metadata">
      <dt>Source record</dt><dd>{record.document.citation.sourceRecordId}</dd>
      <dt>Content SHA-256</dt><dd>{record.contentHash}</dd>
      <dt>Imported mapping SHA-256</dt><dd>{record.rawSha256}</dd>
      <dt>Reviewed by</dt><dd>{record.approvedBy ?? 'Not reviewed'}</dd>
      <dt>Reviewed at</dt><dd>{record.approvedAt ?? 'Not reviewed'}</dd>
    </dl></details>
  </div>;
}
export function FieldSafety({ profile = defaultFieldProfile, regionId = 'NL' }: { profile?: FieldProfile; regionId?: string }) {
  const applicable = new Set<string>();
  let id: string | null = regionId;
  while (id && !applicable.has(id)) { applicable.add(id); id = profile.regions.find(r => r.id === id)?.parentId ?? null; }
  const contacts = profile.contacts.filter(c => applicable.has(c.regionId));
  return <aside className="field-safety" aria-label="Emergency guidance">
    <strong>Reference support · keep emergency care first</strong><p>{profile.disclaimer}</p>
    <div className="flex flex-wrap gap-x-6 gap-y-2 mt-2">{contacts.map(c => <div key={c.name}>
      <a href={c.phone ? `tel:${c.phone}` : c.url}>{c.name}{c.phone ? `: ${c.phone}` : ''}</a>
      <small className="block">{c.audience} · <a href={c.citationUrl}>verified {c.verifiedOn}</a></small>
    </div>)}</div>
    {!contacts.length && <p>No verified contacts configured for this region.</p>}
  </aside>;
}
function Fact({ fact, profile }: { fact: FactView; profile: FieldProfile }) {
  const d = fact.record.document;
  return <article className="field-fact" style={{ borderLeftColor: profile.tiers[d.evidenceTier].color }}>
    {fact.contradicted && <strong className="text-rose-800">⚠ Conflicting evidence — sources remain separate</strong>}
    <p className="font-medium">{d.subject.name}{d.object ? ` → ${d.object.name}` : ''}</p>
    <p lang={d.statement.language}>{d.statement.text}</p>
    <p className="text-sm text-slate-600">{d.statement.kind === 'source_excerpt' ? 'Source excerpt' : 'Curator summary'} · language: {d.statement.language}
      {d.validFrom || d.validTo ? ` · valid ${d.validFrom ?? 'unknown start'} to ${d.validTo ?? 'no reported end'}` : ''}</p>
    {['mechanism', 'severity', 'population'].map(key => <p key={key} className="text-sm">{key}: {d.statement[key as 'mechanism'] ?? 'Not reported by this source'}</p>)}
    <RecordEvidence record={fact.record} profile={profile} />
  </article>;
}
export function SubstanceReference({ card, profile }: { card: SubstanceCard; profile: FieldProfile }) {
  return <details className="field-substance"><summary><strong>{card.substance.name}</strong> · clinical and reference information</summary>
    {card.missingInteractions && <p className="field-warning">No approved interaction references available. Missing data does not mean absence of interaction.</p>}
    {card.sections.map((section, i) => <section key={section.id} className="mt-4" data-category={section.id}>
      <h4 className="font-semibold">{i + 1}. {section.label}</h4>
      {section.facts.length ? section.facts.map(f => <Fact key={f.record.id} fact={f} profile={profile} />) : <p className="text-sm text-slate-500">No approved reference in this category.</p>}
    </section>)}
  </details>;
}
