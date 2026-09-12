import { mapGeoJson, type GeometryLayerDocument } from '../../shared/geography';
import { defaultFigure, type DatasetRecord, type WorkbenchProfile } from '../../shared/workbench';
import type { GeometryLayerRecord } from '../../shared/geography';
import { testDataset } from './workbench';

/** Invented rectangles for software testing only; not a geographic or medical dataset. */
export function testGeometry(): GeometryLayerDocument {
  const square = (x: number, y: number) => [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]];
  const source = { type: 'FeatureCollection', features: ['A', 'B', 'C', 'D', 'E'].map((code, i) => ({ type: 'Feature', properties: { code, name: `Fictional region ${code}` }, geometry: {
    type: i === 4 ? 'MultiPolygon' : 'Polygon', coordinates: i === 4 ? [[square(4, 2)], [square(5.5, 2)]] : i === 0 ? [square(1, 2), [[1.2, 2.2], [1.2, 2.8], [1.8, 2.8], [1.8, 2.2], [1.2, 2.2]]] : [square(i + 1, 4)],
  } })) };
  return { version: 'workbench-geometry-1', key: 'fictional-boundaries', name: 'Fictional test boundaries', description: 'Synthetic shapes with a hole and multiple islands; test fixture only.',
    coordinateReferenceSystem: 'OGC:CRS84', coordinatePrecisionDegrees: null,
    source: { url: 'https://example.org/fictional-boundaries', title: 'Software geometry fixture', publisher: 'Fictional test source', license: 'Fictional test data', retrievedAt: '2026-09-09', sourceRecordId: 'geometry-1', upstreamSha256: null },
    ...mapGeoJson(JSON.stringify(source), 'code', 'name') };
}
export function regionDataset() {
  const document = testDataset(); document.key = 'fictional-choropleth'; document.name = 'Fictional choropleth test table';
  document.rows = ['A', 'B', 'C', 'C', 'source-E', 'unmatched'].map((region, i) => ({
    ...structuredClone(document.rows[0]), id: `region-row-${i}`, values: { ...document.rows[0].values, region, interest: i === 1 ? null : i * 10, sentiment: i, date: i === 3 ? '2026-09-02' : '2026-09-01' }, missingReasons: i === 1 ? { interest: 'Not reported by fictional source' } : {},
  }));
  return document;
}
export function regionFigure(record: DatasetRecord, layer: GeometryLayerRecord, profile: WorkbenchProfile) {
  const spec = defaultFigure(record, profile); spec.renderer = 'choropleth'; spec.style.palette = 'sequential';
  spec.channels = { ...spec.channels, x: 'interest', y: 'mentions', z: null, region: 'region', color: 'interest', alpha: 'sentiment' };
  spec.geography = { version: 'region-map-1', layerId: layer.id, layerHash: layer.contentHash, mappings: { 'source-E': 'E' }, classification: { mode: 'equal_interval', breaks: [] } };
  return spec;
}
