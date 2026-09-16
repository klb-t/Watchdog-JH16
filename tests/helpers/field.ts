import type { SampleDocument, AssertionDocument, FieldQuery } from '../../shared/field';
export const testSample = (changes: Partial<SampleDocument> = {}): SampleDocument => ({
  key: 'fictional-sample-a', kind: 'sample', name: 'Fictional Green X', origin: 'lab_sample',
  region: { id: 'NL-NB', name: 'Noord-Brabant', parentId: 'NL' }, observedOn: '2026-09-01', timeBasis: 'tested', testMethod: 'Fictional assay for software tests',
  appearance: { colors: ['green'], shape: 'round', logo: 'X', scoreLine: 'line' }, market: { label: 'test label', group: 'test-market', language: 'nl' },
  components: [{ substance: { id: 'test-a', name: 'Fictional A', type: 'substance' }, amount: null, unit: null, note: null }], unknownComponents: [],
  citation: { url: 'https://example.org/fictional', title: 'Fictional software fixture', publisher: 'Software test source', retrievedAt: '2026-09-08T00:00:00Z', locator: 'A', sourceRecordId: 'sample-a' },
  evidenceTier: 'PRIMARY_EMPIRICAL', qualityFlags: ['FICTIONAL_TEST_DATA'], ...changes,
});
export const testAssertion = (changes: Partial<AssertionDocument> = {}): AssertionDocument => ({
  key: 'fictional-interaction', kind: 'assertion', subject: { id: 'test-a', name: 'Fictional A', type: 'substance' }, predicate: 'INTERACTS_WITH',
  object: { id: 'test-b', name: 'Fictional B', type: 'substance' }, category: 'interactions',
  statement: { text: 'Fictional interaction used only to verify software behavior.', language: 'en', kind: 'curator_summary', mechanism: null, severity: null, population: null },
  region: null, validFrom: null, validTo: null, contradicts: [], supersedes: null,
  citation: testSample().citation, evidenceTier: 'CURATED_SECONDARY', qualityFlags: ['FICTIONAL_TEST_DATA'], ...changes,
});
export const testQuery = (changes: Partial<FieldQuery> = {}): FieldQuery => ({ mode: 'pill', term: 'X', color: 'green', shape: '', scoreLine: '',
  symptomIds: [], regionId: 'NL-NB', from: null, to: null, includeBroaderContext: false, language: 'nl', expansionMode: 'STRICT_CANONICAL', ...changes });
