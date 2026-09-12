/** Versioned region geometry and exact joins. No geocoder or statistical aggregation. */
import { z } from 'zod';
import { filterRows, WorkbenchInputError, type DatasetDocument, type FigureSpec } from './workbench';
const text = z.string().min(1).max(1000), id = z.string().min(1).max(200);
const position = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]);
const ring = z.array(position).min(4), polygon = z.array(ring).min(1);
export const PolygonGeometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: polygon }).strict(),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(polygon).min(1) }).strict(),
]);
export const GeometryLayerSchema = z.object({
  version: z.literal('workbench-geometry-1'), key: id, name: text, description: text,
  coordinateReferenceSystem: z.literal('OGC:CRS84'), coordinatePrecisionDegrees: z.number().positive().nullable(),
  collapsedPartPolicy: z.literal('retain_and_flag').optional(),
  source: z.object({ url: z.url().refine(s => new URL(s).protocol === 'https:' && !new URL(s).username && !new URL(s).password),
    title: text, publisher: text, license: text, retrievedAt: z.union([z.iso.date(), z.iso.datetime({ offset: true })]),
    sourceRecordId: text, upstreamSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict(),
  features: z.array(z.object({ id, name: text, geometry: PolygonGeometrySchema }).strict()).min(1).max(2000),
  rawInput: z.object({ mediaType: z.literal('application/geo+json'), text: z.string().max(1_000_000), idProperty: z.string().max(200).nullable(), nameProperty: z.string().max(200).nullable() }).strict().optional(),
}).strict();
export type GeometryLayerDocument = z.infer<typeof GeometryLayerSchema>;
export type RegionGeometry = z.infer<typeof PolygonGeometrySchema>;
export type RegionFeature = GeometryLayerDocument['features'][number];
export interface GeometryLayerRecord {
  id: string; document: GeometryLayerDocument; contentHash: string; ownerId: string; visibility: 'private' | 'shared_aggregate';
  approvalState: 'PROPOSED' | 'APPROVED'; approvedHash: string | null; approvedBy: string | null; approvedAt: string | null;
}
export const regionPolygons = (geometry: RegionGeometry) => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
function collapsedRing(points: z.infer<typeof ring>): boolean {
  const a = points[0], b = points.find(p => p[0] !== a[0] || p[1] !== a[1]);
  return !b || points.every(c => (b[0] - a[0]) * (c[1] - a[1]) === (c[0] - a[0]) * (b[1] - a[1]));
}
export function validateGeometryLayer(input: unknown): GeometryLayerDocument {
  const layer = GeometryLayerSchema.parse(input);
  if (new Set(layer.features.map(f => f.id)).size !== layer.features.length) throw new WorkbenchInputError('Geometry feature IDs must be distinct.');
  for (const feature of layer.features) if (!regionPolygons(feature.geometry).some(p => !collapsedRing(p[0])))
    throw new WorkbenchInputError(`No drawable outer polygon in ${feature.id}.`);
  let positions = 0;
  for (const feature of layer.features) for (const polygon of regionPolygons(feature.geometry)) for (const ring of polygon) {
    positions += ring.length;
    if (positions > 100_000) throw new WorkbenchInputError('Geometry exceeds the 100,000-position limit. Prepare a documented lower-resolution layer.');
    if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) throw new WorkbenchInputError(`Unclosed polygon ring in ${feature.id}. Source coordinates are never repaired silently.`);
    if (collapsedRing(ring) && layer.collapsedPartPolicy !== 'retain_and_flag') throw new WorkbenchInputError(`Collapsed polygon ring in ${feature.id}. Declare retain_and_flag explicitly to preserve collapsed parts of otherwise drawable features.`);
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i];
      // A full-width edge at a pole closes a polar cap; other dateline crossings
      // must be explicitly split in the source, per RFC 7946 §3.1.9.
      if (Math.abs(a[0] - b[0]) > 180 && !(a[1] === b[1] && Math.abs(a[1]) === 90))
        throw new WorkbenchInputError(`Cut the antimeridian-crossing polygon in ${feature.id} before import.`);
    }
  }
  if (layer.rawInput) {
    const mapped = mapGeoJson(layer.rawInput.text, layer.rawInput.idProperty, layer.rawInput.nameProperty);
    if (JSON.stringify(GeometryLayerSchema.shape.features.parse(mapped.features)) !== JSON.stringify(layer.features)) throw new WorkbenchInputError('Normalized boundaries do not match the retained GeoJSON and field mapping.');
  }
  return layer;
}
export function geometryWarnings(layer: GeometryLayerDocument) {
  return layer.features.flatMap(feature => regionPolygons(feature.geometry).flatMap((polygon, polygonIndex) => polygon.flatMap((ring, ringIndex) =>
    collapsedRing(ring) ? [`${feature.id}: polygon ${polygonIndex}, ring ${ringIndex} collapsed; original coordinates retained, no drawable area.`] : [])));
}
/** Maps only explicitly selected GeoJSON identifier/name fields; retains the source text. */
export function mapGeoJson(sourceText: string, idProperty: string | null, nameProperty: string | null): Pick<GeometryLayerDocument, 'features' | 'rawInput'> {
  if (sourceText.length > 1_000_000) throw new WorkbenchInputError('GeoJSON exceeds the 1 MB source limit.');
  let collection: any;
  try { collection = JSON.parse(sourceText); } catch { throw new WorkbenchInputError('GeoJSON must contain valid JSON.'); }
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features) || 'crs' in collection) throw new WorkbenchInputError('Use an RFC 7946 FeatureCollection in WGS84 longitude/latitude without a legacy CRS override.');
  const features = collection.features.map((f: any) => {
    if (f?.type !== 'Feature' || !f.geometry || typeof f.geometry !== 'object' || Array.isArray(f.geometry) || 'crs' in f || 'crs' in f.geometry) throw new WorkbenchInputError('Every source feature needs Polygon/MultiPolygon geometry without a CRS override.');
    const identifier = idProperty ? f.properties?.[idProperty] : f.id;
    if (!(typeof identifier === 'string' && identifier.length || typeof identifier === 'number' && Number.isSafeInteger(identifier))) throw new WorkbenchInputError('Every feature needs an explicit string or safe-integer identifier from the selected field.');
    const name = nameProperty ? f.properties?.[nameProperty] : String(identifier);
    if (typeof name !== 'string' || !name.length) throw new WorkbenchInputError('The selected feature-label property must contain text on every feature.');
    return { id: String(identifier), name, geometry: { type: f.geometry.type, coordinates: f.geometry.coordinates } };
  });
  return { features, rawInput: { mediaType: 'application/geo+json', text: sourceText, idProperty, nameProperty } };
}

export function checkGeographyBinding(spec: FigureSpec, layer: GeometryLayerRecord) {
  if (!spec.geography || layer.id !== spec.geography.layerId || layer.contentHash !== spec.geography.layerHash || layer.approvedHash !== layer.contentHash || layer.approvalState !== 'APPROVED')
    throw new WorkbenchInputError('The map requires the exact, currently approved geometry layer.');
  const ids = new Set(layer.document.features.map(f => f.id));
  for (const target of Object.values(spec.geography.mappings)) if (!ids.has(target)) throw new WorkbenchInputError(`Unknown mapped geometry feature '${target}'.`);
}
export interface RegionJoin {
  featureId: string; rowIds: string[]; state: 'value' | 'missing' | 'no_observation' | 'ambiguous'; value: number | null;
}
export function joinRegions(document: DatasetDocument, spec: FigureSpec, layer: GeometryLayerDocument) {
  const features = new Map(layer.features.map(f => [f.id, [] as DatasetDocument['rows']]));
  const mappings = new Map(Object.entries(spec.geography?.mappings ?? {}));
  const unmatched: { rowId: string; region: string | number | null; reason: string }[] = [];
  for (const row of filterRows(document, spec)) {
    const region = row.values[spec.channels.region!];
    const featureId = region === null || region === undefined ? null : mappings.get(String(region)) ?? String(region);
    const bucket = featureId === null ? undefined : features.get(featureId);
    if (!bucket) unmatched.push({ rowId: row.id, region: region ?? null, reason: featureId === null ? 'Missing region identifier' : `No exact geometry match for ${JSON.stringify(region)}` });
    else bucket.push(row);
  }
  const regions: RegionJoin[] = [...features.entries()].map(([featureId, rows]): RegionJoin => {
    const value = rows.length === 1 ? rows[0].values[spec.channels.color!] : null;
    return { featureId, rowIds: rows.map(r => r.id).sort(), state: rows.length === 0 ? 'no_observation' : rows.length > 1 ? 'ambiguous' : typeof value === 'number' ? 'value' : 'missing', value: typeof value === 'number' ? value : null };
  }).sort((a, b) => a.featureId < b.featureId ? -1 : a.featureId > b.featureId ? 1 : 0);
  return { version: 'region-join-1', regions, unmatched: unmatched.sort((a, b) => a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0) };
}
/** Color classification changes presentation only; it never averages source rows. */
export function regionColorScale(document: DatasetDocument, spec: FigureSpec, colors: string[]) {
  const rows = spec.style.domainScope === 'dataset' ? document.rows : filterRows(document, spec);
  const values = rows.map(r => r.values[spec.channels.color!]).filter((v): v is number => typeof v === 'number');
  const min = values.length ? Math.min(...values) : null, max = values.length ? Math.max(...values) : null;
  const manual = spec.geography!.classification.mode === 'manual';
  const breaks = manual ? spec.geography!.classification.breaks : min === null || min === max ? [] : colors.slice(1).map((_, i) => {
    const t = (i + 1) / colors.length;
    return min * (1 - t) + max! * t;
  });
  if (breaks.some((v, i) => !Number.isFinite(v) || i > 0 && v <= breaks[i - 1])) throw new WorkbenchInputError('Color classes cannot be distinguished at this numeric precision. Choose explicit class boundaries or a palette with fewer classes.');
  const index = (value: number) => breaks.filter(boundary => value >= boundary).length;
  const color = (value: number) => colors[!manual && min === max ? Math.floor(colors.length / 2) : index(value)];
  const fmt = (v: number) => String(Number(v.toPrecision(6)));
  const legend = !manual && !values.length ? [] : !manual && min === max ? [{ color: colors[Math.floor(colors.length / 2)], label: `All numeric source values = ${fmt(min!)}` }]
    : colors.map((c, i) => ({ color: c, label: manual ? i === 0 ? `< ${fmt(breaks[0])}` : i === colors.length - 1 ? `≥ ${fmt(breaks[i - 1])}` : `${fmt(breaks[i - 1])} ≤ value < ${fmt(breaks[i])}`
      : `${fmt(i === 0 ? min! : breaks[i - 1])} ≤ value ${i === colors.length - 1 ? '≤' : '<'} ${fmt(i === colors.length - 1 ? max! : breaks[i])}` }));
  return { min, max, breaks, color, legend };
}
export function geometryBounds(features: RegionFeature[]): [number, number, number, number] {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const feature of features) for (const polygon of regionPolygons(feature.geometry)) for (const ring of polygon) for (const [lon, lat] of ring) {
    west = Math.min(west, lon); east = Math.max(east, lon); south = Math.min(south, lat); north = Math.max(north, lat);
  }
  return [west, south, east, north];
}
export function fitGeometry(features: RegionFeature[]) {
  if (!features.length) throw new WorkbenchInputError('No boundary features to fit.');
  const [west, south, east, north] = geometryBounds(features);
  return { centerLongitude: (west + east) / 2, centerLatitude: (south + north) / 2, zoom: Math.max(0.5, Math.min(4096, 330 / Math.max(east - west, 0.001), 165 / Math.max(north - south, 0.001))) };
}
/** Display interpolation remains finite even when the numeric range exceeds MAX_VALUE. */
export function regionAlphaFraction(value: number, min: number, max: number) {
  return min === max ? 0.5 : Number.isFinite(max - min) ? (value - min) / (max - min) : (value / 2 - min / 2) / (max / 2 - min / 2);
}
/** Label anchor inside a polygon, excluding holes. Not a geocode or an area measurement. */
export function regionLabelPoint(geometry: RegionGeometry): [number, number] {
  let bestWidth = -1, point: [number, number] | null = null;
  for (const rings of regionPolygons(geometry)) {
    const [, south, , north] = geometryBounds([{ id: 'label', name: 'label', geometry: { type: 'Polygon', coordinates: rings } }]);
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9]) {
      const y = south + (north - south) * t, xs: number[] = [];
      for (const ring of rings) for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1], b = ring[i];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i += 2) if (xs[i] - xs[i - 1] > bestWidth) { bestWidth = xs[i] - xs[i - 1]; point = [(xs[i] + xs[i - 1]) / 2, y]; }
    }
  }
  const fallback = regionPolygons(geometry)[0][0][0];
  return point ?? [fallback[0], fallback[1]];
}
export function polygonPath(geometry: RegionGeometry, project: (lon: number, lat: number) => [number, number]) {
  return regionPolygons(geometry).map(polygon => polygon.map(ring => ring.map(([lon, lat], i) => {
    const p = project(lon, lat); return `${i ? 'L' : 'M'}${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  }).join(' ') + 'Z').join(' '));
}

/** Per-panel join provenance; visual selection never changes regional source membership. */
export function regionJoinReport(document: DatasetDocument, spec: FigureSpec, layer: GeometryLayerDocument) {
  const groups = new Map<string, { facet: string | number | null; rows: DatasetDocument['rows'] }>();
  for (const row of filterRows(document, spec)) {
    const facet = spec.channels.facet ? row.values[spec.channels.facet] : null, key = JSON.stringify(facet);
    if (!groups.has(key)) groups.set(key, { facet, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  if (!groups.size) groups.set('empty', { facet: null, rows: [] });
  return { version: 'region-join-report-1', regionColumn: spec.channels.region, valueColumn: spec.channels.color,
    panels: [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, group]) => ({ facet: group.facet, ...joinRegions({ ...document, rows: group.rows }, spec, layer) })) };
}
