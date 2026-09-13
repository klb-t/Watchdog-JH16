import type { DatasetDocument } from '../../shared/workbench';
/** Synthetic aggregate observations only. Never loaded into the application at startup. */
export function testDataset(): DatasetDocument {
  const column = (key: string, type: 'number' | 'text' | 'date', unit: string | null, semanticType: 'score' | 'count' | 'dimension') => ({ key, label: key, type, unit, semanticType, description: `Fictional ${key} test column` });
  return { version: 'workbench-dataset-1', key: 'fictional-region-table', name: 'Fictional regional test table', description: 'Synthetic software fixture; not surveillance or clinical evidence.',
    providerProfileId: 'manual-table', measure: 'Fictional measurement', normalization: 'none', comparisonScope: 'one fictional fixture', languageMeaning: 'query_term_language',
    source: { url: 'https://example.org/fictional-dataset', title: 'Software test fixture', publisher: 'Fictional test source', retrievedAt: '2026-09-09T00:00:00Z', sourceRecordId: 'fixture-1', license: 'Fictional software test data' },
    columns: [column('date', 'date', null, 'dimension'), column('region', 'text', null, 'dimension'), column('language', 'text', null, 'dimension'),
      column('longitude', 'number', 'degrees', 'dimension'), column('latitude', 'number', 'degrees', 'dimension'), column('interest', 'number', 'index', 'score'), column('mentions', 'number', 'count', 'count'), column('sentiment', 'number', 'score', 'score')],
    rows: [1, 2, 3, 4, 5].map((n, i) => ({ id: `row-${n}`, values: { date: `2026-09-0${n}`, region: i % 2 ? 'Region B' : 'Region A', language: i % 2 ? 'en' : 'nl',
      longitude: 4 + n, latitude: 50 + n, interest: n === 5 ? null : 10 * n, mentions: n * 2, sentiment: (n - 3) / 2 },
      evidenceTier: 'RAW_OBSERVATIONAL', qualityFlags: ['FICTIONAL_TEST_DATA', ...(n === 4 ? ['PROVIDER_DISCONTINUITY'] : [])], missingReasons: n === 5 ? { interest: 'Not reported by fictional source' } : {} })),
  };
}
