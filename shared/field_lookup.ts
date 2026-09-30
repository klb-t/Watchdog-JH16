/** Deterministic projection over a frozen, approved reference snapshot. No I/O,
 * learned scores, prevalence estimates or clinical generation. Shared offline. */
import type { AssertionDocument, FieldQuery, FieldResult, FieldSnapshot, FieldSampleSummary, FactView, ReferenceRecord,
  SampleCandidate, SampleDocument, SubstanceCard, Entity } from './field';

export const normalizeDescriptor = (s: string) => s.normalize('NFKC').toLocaleLowerCase('en-US').trim().replace(/\s+/g, ' ');
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const clinical = new Set(['pharmacokinetics', 'pharmacodynamics', 'acute_toxicity', 'chronic_effects', 'interactions']);
const logicalSampleId = (doc: SampleDocument) => `${doc.citation.publisher}\n${doc.citation.sourceRecordId}`;

/** Denominators count distinct source specimen IDs, not document versions.
 * Mixed specimens can contribute to several component counts. No prevalence is inferred. */
function summarize(candidates: SampleCandidate[]): FieldSampleSummary {
  const lab = candidates.filter(c => c.record.document.origin === 'lab_sample');
  const distribution = new Map<string, { substance: Entity; samples: Set<string> }>();
  for (const candidate of lab) for (const component of candidate.record.document.components) {
    const entry = distribution.get(component.substance.id) ?? { substance: component.substance, samples: new Set<string>() };
    entry.samples.add(logicalSampleId(candidate.record.document)); distribution.set(component.substance.id, entry);
  }
  return {
    recordCount: candidates.length,
    distinctSourceRecordCount: new Set(candidates.map(c => logicalSampleId(c.record.document))).size,
    labSampleCount: new Set(lab.map(c => logicalSampleId(c.record.document))).size,
    publishedAlertCount: candidates.filter(c => c.record.document.origin === 'published_alert').length,
    visualReportCount: candidates.filter(c => c.record.document.origin === 'visual_report').length,
    distribution: [...distribution.values()].map(d => ({ substance: d.substance, labSampleCount: d.samples.size }))
      .sort((a, b) => b.labSampleCount - a.labSampleCount || cmp(a.substance.id, b.substance.id)),
  };
}

export function lookupField(snapshot: FieldSnapshot, query: FieldQuery): FieldResult {
  const regions = new Map(snapshot.profile.regions.map(r => [r.id, r]));
  if (!regions.has(query.regionId)) throw new Error('Select a registered region.');
  const ancestors = (id: string): string[] => {
    const out: string[] = [], seen = new Set<string>();
    let current: string | null = id;
    while (current) {
      if (seen.has(current)) throw new Error('Region hierarchy contains a cycle.');
      if (!regions.has(current)) throw new Error('Reference region is not registered.');
      seen.add(current); out.push(current); current = regions.get(current)!.parentId;
    }
    return out;
  };
  const selectedAncestors = ancestors(query.regionId);
  const scope = (id: string): SampleCandidate['regionScope'] => ancestors(id).includes(query.regionId) ? 'selected_region'
    : selectedAncestors.includes(id) ? 'broader_context' : 'global_context';
  const inRegionalResult = (id: string) => scope(id) === 'selected_region' || query.includeBroaderContext && scope(id) === 'broader_context';
  const approved = snapshot.records.filter(r => r.approvalState === 'APPROVED' && r.approvedHash === r.contentHash);
  const assertions = approved.filter(r => r.document.kind === 'assertion') as ReferenceRecord<AssertionDocument>[];
  const asOf = query.to ?? snapshot.generatedAt.slice(0, 10);
  const applicableFor = (regionId: string) => {
    const contextAncestors = ancestors(regionId);
    return assertions.filter(r => {
      const d = r.document;
      if ((d.validFrom && d.validFrom > asOf) || (d.validTo && d.validTo < asOf)) return false;
      if (d.region && !contextAncestors.includes(d.region.id)) return false;
      return !clinical.has(d.category) || ['PRIMARY_EMPIRICAL', 'CURATED_SECONDARY'].includes(d.evidenceTier);
    });
  };
  const fact = (record: ReferenceRecord<AssertionDocument>, applicable: ReferenceRecord<AssertionDocument>[]): FactView => ({ record,
    contradicted: record.document.contradicts.length > 0 || applicable.some(other => other.document.contradicts.includes(record.id)) });
  const card = (substance: Entity, regionId = query.regionId): SubstanceCard => {
    const applicable = applicableFor(regionId);
    const facts = applicable.filter(r => r.document.subject.id === substance.id ||
      r.document.predicate === 'INTERACTS_WITH' && r.document.object?.id === substance.id)
      .sort((a, b) => cmp(a.id, b.id)).map(record => fact(record, applicable));
    return { substance, referenceRegion: regions.get(regionId)!, sections: snapshot.profile.categories.map(category => ({ ...category,
      facts: facts.filter(f => f.record.document.category === category.id) })),
      missingInteractions: !facts.some(f => f.record.document.predicate === 'INTERACTS_WITH') };
  };
  const term = normalizeDescriptor(query.term);
  const colorProfile = snapshot.profile.colors.find(c => [c.id, c.label, ...c.aliases]
    .some(alias => normalizeDescriptor(alias) === normalizeDescriptor(query.color)));
  const desiredColor = colorProfile?.id ?? normalizeDescriptor(query.color);
  const samples = approved.filter(r => r.document.kind === 'sample') as ReferenceRecord<SampleDocument>[];
  // Regional and archive-wide label resolution are kept separate. A label reviewed
  // elsewhere can discover alternatives without becoming a local chemical synonym.
  const resolveMarketGroups = (records: ReferenceRecord<SampleDocument>[]) => new Set(records.flatMap(r => {
    const m = r.document.market;
    if (!m) return [];
    const direct = normalizeDescriptor(m.group) === term;
    const localized = ['LOCALIZED_SYNONYMS', 'EXPERIMENTAL_SLANG_EXPANSION'].includes(query.expansionMode)
      && m.language === query.language && normalizeDescriptor(m.label) === term;
    return direct || localized ? [m.group] : [];
  }));
  const marketGroups = resolveMarketGroups(samples.filter(r => inRegionalResult(r.document.region.id)));
  const globalMarketGroups = resolveMarketGroups(samples);
  const matchesDescriptor = (doc: SampleDocument, groups: Set<string>) => {
    if (query.mode === 'market') return Boolean(doc.market && (!term || groups.has(doc.market.group)));
    const name = normalizeDescriptor([doc.name, doc.appearance.logo ?? ''].join(' '));
    if (term && !term.split(' ').every(token => name.includes(token))) return false;
    if (desiredColor && !doc.appearance.colors.some(c => normalizeDescriptor(c) === desiredColor)) return false;
    if (query.shape && normalizeDescriptor(doc.appearance.shape ?? '') !== normalizeDescriptor(query.shape)) return false;
    return !query.scoreLine || normalizeDescriptor(doc.appearance.scoreLine ?? '') === normalizeDescriptor(query.scoreLine);
  };
  let excludedUndated = 0, globalExcludedUndated = 0;
  const candidates: SampleCandidate[] = [], allCandidates: SampleCandidate[] = [];
  if (query.mode !== 'symptoms') for (const record of samples) {
    const doc = record.document;
    const regionalMatch = inRegionalResult(doc.region.id) && matchesDescriptor(doc, marketGroups);
    const globalMatch = matchesDescriptor(doc, globalMarketGroups);
    if (!regionalMatch && !globalMatch) continue;
    if ((query.from || query.to) && !doc.observedOn) {
      if (regionalMatch) excludedUndated++;
      if (globalMatch) globalExcludedUndated++;
      continue;
    }
    if (doc.observedOn && (query.from && doc.observedOn < query.from || query.to && doc.observedOn > query.to)) continue;
    const candidate: SampleCandidate = { record, matchTier: 'MODELED_PREDICTED', regionScope: scope(doc.region.id),
      substances: doc.components.map(c => card(c.substance, doc.region.id)),
      path: [doc.market?.label ?? doc.name, doc.citation.sourceRecordId,
        ...doc.components.map(c => c.substance.name), 'cited assertions'] };
    if (regionalMatch) candidates.push(candidate);
    if (globalMatch) allCandidates.push(candidate);
  }
  // Region, date and stable ID order the display. Color is not a confidence score.
  const scopeOrder = { selected_region: 0, broader_context: 1, global_context: 2 };
  const order = (a: SampleCandidate, b: SampleCandidate) => scopeOrder[a.regionScope] - scopeOrder[b.regionScope] ||
    cmp(b.record.document.observedOn ?? '', a.record.document.observedOn ?? '') || cmp(a.record.id, b.record.id);
  candidates.sort(order); allCandidates.sort(order);
  const regionalIds = new Set(candidates.map(c => c.record.id));
  const globalCandidates = allCandidates.filter(c => !regionalIds.has(c.record.id));
  const localSummary = summarize(candidates.filter(c => c.regionScope === 'selected_region'));
  const globalSummary = summarize(allCandidates);
  const applicable = applicableFor(query.regionId);
  const symptomMap = new Map<string, FieldResult['symptomCandidates'][number]>();
  if (query.mode === 'symptoms') for (const record of applicable) {
    const d = record.document;
    if (d.predicate !== 'ASSOCIATED_WITH_SYMPTOM' || !['PRIMARY_EMPIRICAL', 'CURATED_SECONDARY'].includes(d.evidenceTier) || !d.object || !(query.symptomIds.includes(d.object.id) || (query.term && normalizeDescriptor(d.object.name).includes(normalizeDescriptor(query.term))))) continue;
    const entry = symptomMap.get(d.subject.id) ?? { card: card(d.subject), supportingAssertions: [], matchedSymptomIds: [] };
    entry.supportingAssertions.push(fact(record, applicable));
    if (!entry.matchedSymptomIds.includes(d.object.id)) entry.matchedSymptomIds.push(d.object.id);
    symptomMap.set(d.subject.id, entry);
  }
  const symptomCandidates = [...symptomMap.values()].map(c => ({ ...c,
    supportingAssertions: c.supportingAssertions.sort((a, b) => cmp(a.record.id, b.record.id)), matchedSymptomIds: c.matchedSymptomIds.sort() }))
    .sort((a, b) => b.matchedSymptomIds.length - a.matchedSymptomIds.length || cmp(a.card.substance.id, b.card.substance.id));
  return { query, candidates, globalCandidates, globalSummary, globalExcludedUndated, symptomCandidates, excludedUndated,
    labSampleCount: localSummary.labSampleCount,
    publishedAlertCount: candidates.filter(c => c.record.document.origin === 'published_alert').length,
    visualReportCount: candidates.filter(c => c.record.document.origin === 'visual_report').length,
    distribution: localSummary.distribution,
    flags: [...new Set([
      'MATCH_DOES_NOT_IDENTIFY_PATIENT_SPECIMEN', 'REFERENCE_COVERAGE_IS_INCOMPLETE',
      ...(candidates.some(c => c.regionScope === 'broader_context') ? ['BROADER_REGIONAL_CONTEXT_INCLUDED'] : []),
      ...(globalCandidates.length ? ['GLOBAL_ARCHIVE_ALTERNATIVES_AVAILABLE'] : []),
      ...(allCandidates.some(c => c.record.document.unknownComponents.length) ? ['UNKNOWN_COMPONENTS_PRESENT'] : []),
      ...(query.mode === 'market' && marketGroups.size > 1 ? ['AMBIGUOUS_MARKET_LABEL'] : []),
      ...(query.mode === 'market' && globalMarketGroups.size > 1 ? ['AMBIGUOUS_GLOBAL_MARKET_LABEL'] : []),
      ...(query.mode === 'market' && query.expansionMode === 'EXPERIMENTAL_SLANG_EXPANSION' ? ['NO_UNREVIEWED_SLANG_EXPANSION'] : []),
      ...(globalSummary.distinctSourceRecordCount < allCandidates.length ? ['MULTIPLE_SOURCE_VERSIONS'] : []),
      ...(excludedUndated ? ['UNDATED_RECORDS_EXCLUDED'] : []),
      ...(globalExcludedUndated ? ['GLOBAL_UNDATED_RECORDS_EXCLUDED'] : []),
    ])].sort(),
  };
}
