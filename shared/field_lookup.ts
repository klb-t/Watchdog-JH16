/** Deterministic projection over a frozen, approved reference snapshot. No I/O,
 * learned scores, prevalence estimates or clinical generation. Shared offline. */
import { tierRank } from '../backend/watchdog_api/domain/evidence_tier';
import type { AssertionDocument, FieldQuery, FieldResult, FieldSnapshot, FactView, ReferenceRecord,
  SampleCandidate, SampleDocument, SubstanceCard, Entity } from './field';

export const normalizeDescriptor = (s: string) => s.normalize('NFKC').toLocaleLowerCase('en-US').trim().replace(/\s+/g, ' ');
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const clinical = new Set(['pharmacokinetics', 'pharmacodynamics', 'acute_toxicity', 'chronic_effects', 'interactions']);

export function lookupField(snapshot: FieldSnapshot, query: FieldQuery): FieldResult {
  const regions = new Map(snapshot.profile.regions.map(r => [r.id, r]));
  if (!regions.has(query.regionId)) throw new Error('Select a registered region.');
  const ancestors = (id: string): string[] => {
    const out: string[] = [], seen = new Set<string>();
    let current: string | null = id;
    while (current) {
      if (seen.has(current)) throw new Error('Region hierarchy contains a cycle.');
      seen.add(current); out.push(current); current = regions.get(current)?.parentId ?? null;
    }
    return out;
  };
  const selectedAncestors = ancestors(query.regionId);
  const scope = (id: string) => ancestors(id).includes(query.regionId) ? 'selected_region' as const
    : query.includeBroaderContext && selectedAncestors.includes(id) ? 'broader_context' as const : null;
  const approved = snapshot.records.filter(r => r.approvalState === 'APPROVED' && r.approvedHash === r.contentHash);
  const assertions = approved.filter(r => r.document.kind === 'assertion') as ReferenceRecord<AssertionDocument>[];
  const asOf = query.to ?? snapshot.generatedAt.slice(0, 10);
  const applicable = assertions.filter(r => {
    const d = r.document;
    if ((d.validFrom && d.validFrom > asOf) || (d.validTo && d.validTo < asOf)) return false;
    if (d.region && !selectedAncestors.includes(d.region.id)) return false;
    return !clinical.has(d.category) || ['PRIMARY_EMPIRICAL', 'CURATED_SECONDARY'].includes(d.evidenceTier);
  });
  const fact = (record: ReferenceRecord<AssertionDocument>): FactView => ({ record,
    contradicted: record.document.contradicts.length > 0 || applicable.some(other => other.document.contradicts.includes(record.id)) });
  const card = (substance: Entity): SubstanceCard => {
    const facts = applicable.filter(r => r.document.subject.id === substance.id ||
      r.document.predicate === 'INTERACTS_WITH' && r.document.object?.id === substance.id)
      .sort((a, b) => tierRank(a.document.evidenceTier) - tierRank(b.document.evidenceTier) || cmp(a.id, b.id)).map(fact);
    return { substance, sections: snapshot.profile.categories.map(category => ({ ...category,
      facts: facts.filter(f => f.record.document.category === category.id) })),
      missingInteractions: !facts.some(f => f.record.document.predicate === 'INTERACTS_WITH') };
  };
  const term = normalizeDescriptor(query.term);
  const colorProfile = snapshot.profile.colors.find(c => [c.id, c.label, ...c.aliases]
    .some(alias => normalizeDescriptor(alias) === normalizeDescriptor(query.color)));
  const desiredColor = colorProfile?.id ?? normalizeDescriptor(query.color);
  const samples = approved.filter(r => r.document.kind === 'sample') as ReferenceRecord<SampleDocument>[];
  // Resolve labels to explicit market groups in the chosen region and language.
  // A market group never becomes a chemical synonym. Ambiguity stays visible.
  const marketGroups = new Set(samples.filter(r => scope(r.document.region.id)).flatMap(r => {
    const m = r.document.market;
    if (!m) return [];
    const direct = normalizeDescriptor(m.group) === term;
    const localized = ['LOCALIZED_SYNONYMS', 'EXPERIMENTAL_SLANG_EXPANSION'].includes(query.expansionMode)
      && m.language === query.language && normalizeDescriptor(m.label) === term;
    return direct || localized ? [m.group] : [];
  }));
  let excludedUndated = 0;
  const candidates: SampleCandidate[] = [];
  if (query.mode !== 'symptoms') for (const record of samples) {
    const doc = record.document, regionScope = scope(doc.region.id);
    if (!regionScope) continue;
    if ((query.from || query.to) && !doc.observedOn) { excludedUndated++; continue; }
    if (doc.observedOn && (query.from && doc.observedOn < query.from || query.to && doc.observedOn > query.to)) continue;
    if (query.mode === 'market') {
      if (!doc.market) continue;
      if (term && !marketGroups.has(doc.market.group)) continue;
    } else {
      const name = normalizeDescriptor([doc.name, doc.appearance.logo ?? ''].join(' '));
      if (term && !term.split(' ').every(token => name.includes(token))) continue;
      if (desiredColor && !doc.appearance.colors.some(c => normalizeDescriptor(c) === desiredColor)) continue;
      if (query.shape && normalizeDescriptor(doc.appearance.shape ?? '') !== normalizeDescriptor(query.shape)) continue;
      if (query.scoreLine && normalizeDescriptor(doc.appearance.scoreLine ?? '') !== normalizeDescriptor(query.scoreLine)) continue;
    }
    candidates.push({ record, matchTier: 'MODELED_PREDICTED', regionScope,
      substances: doc.components.map(c => card(c.substance)),
      path: [doc.market?.label ?? doc.name, doc.citation.sourceRecordId,
        ...doc.components.map(c => c.substance.name), 'cited assertions'] });
  }
  candidates.sort((a, b) => Number(a.regionScope === 'broader_context') - Number(b.regionScope === 'broader_context') ||
    tierRank(a.record.document.evidenceTier) - tierRank(b.record.document.evidenceTier) ||
    cmp(b.record.document.observedOn ?? '', a.record.document.observedOn ?? '') || cmp(a.record.id, b.record.id));
  const logicalSampleId = (doc: SampleDocument) => `${doc.citation.publisher}\n${doc.citation.sourceRecordId}`;
  const lab = candidates.filter(c => c.record.document.origin === 'lab_sample' && c.regionScope === 'selected_region');
  const distribution = new Map<string, { substance: Entity; samples: Set<string> }>();
  for (const candidate of lab) for (const component of candidate.record.document.components) {
    const entry = distribution.get(component.substance.id) ?? { substance: component.substance, samples: new Set<string>() };
    entry.samples.add(logicalSampleId(candidate.record.document)); distribution.set(component.substance.id, entry);
  }
  const symptomMap = new Map<string, FieldResult['symptomCandidates'][number]>();
  if (query.mode === 'symptoms') for (const record of applicable) {
    const d = record.document;
    if (d.predicate !== 'ASSOCIATED_WITH_SYMPTOM' || !['PRIMARY_EMPIRICAL', 'CURATED_SECONDARY'].includes(d.evidenceTier) || !d.object || !(query.symptomIds.includes(d.object.id) || (query.term && normalizeDescriptor(d.object.name).includes(normalizeDescriptor(query.term))))) continue;
    const entry = symptomMap.get(d.subject.id) ?? { card: card(d.subject), supportingAssertions: [], matchedSymptomIds: [] };
    entry.supportingAssertions.push(fact(record));
    if (!entry.matchedSymptomIds.includes(d.object.id)) entry.matchedSymptomIds.push(d.object.id);
    symptomMap.set(d.subject.id, entry);
  }
  const symptomCandidates = [...symptomMap.values()].map(c => ({ ...c, matchedSymptomIds: c.matchedSymptomIds.sort() }))
    .sort((a, b) => b.matchedSymptomIds.length - a.matchedSymptomIds.length || cmp(a.card.substance.id, b.card.substance.id));
  return { query, candidates, symptomCandidates, excludedUndated,
    labSampleCount: new Set(lab.map(c => logicalSampleId(c.record.document))).size,
    publishedAlertCount: candidates.filter(c => c.record.document.origin === 'published_alert').length,
    visualReportCount: candidates.filter(c => c.record.document.origin === 'visual_report').length,
    distribution: [...distribution.values()].map(d => ({ substance: d.substance, labSampleCount: d.samples.size }))
      .sort((a, b) => b.labSampleCount - a.labSampleCount || cmp(a.substance.id, b.substance.id)),
    flags: [...new Set([
      'MATCH_DOES_NOT_IDENTIFY_PATIENT_SPECIMEN', 'REFERENCE_COVERAGE_IS_INCOMPLETE',
      ...(candidates.some(c => c.regionScope === 'broader_context') ? ['BROADER_REGIONAL_CONTEXT_INCLUDED'] : []),
      ...(candidates.some(c => c.record.document.unknownComponents.length) ? ['UNKNOWN_COMPONENTS_PRESENT'] : []),
      ...(query.mode === 'market' && marketGroups.size > 1 ? ['AMBIGUOUS_MARKET_LABEL'] : []),
      ...(query.mode === 'market' && query.expansionMode === 'EXPERIMENTAL_SLANG_EXPANSION' ? ['NO_UNREVIEWED_SLANG_EXPANSION'] : []),
      ...(new Set(candidates.map(c => logicalSampleId(c.record.document))).size < candidates.length ? ['MULTIPLE_SOURCE_VERSIONS'] : []),
      ...(excludedUndated ? ['UNDATED_RECORDS_EXCLUDED'] : []),
    ])].sort(),
  };
}
