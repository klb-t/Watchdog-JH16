import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { validateGeometryLayer, mapGeoJson, geometryWarnings, joinRegions, regionJoinReport, regionColorScale, polygonPath, regionLabelPoint, regionAlphaFraction, fitGeometry, type GeometryLayerRecord } from '../../shared/geography';
import { FigureCanvas } from '../../shared/figure_renderer';
import { checkFigureProfile, checkFigureBindings, type DatasetRecord } from '../../shared/workbench';
import { bundledWorldLayer } from '../../backend/watchdog_api/config/geography';
import { loadWorkbenchProfile } from '../../backend/watchdog_api/config/workbench';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';
import { testGeometry, regionDataset, regionFigure } from '../helpers/geography';

const receipt = { ownerId: 'test', visibility: 'private' as const, approvalState: 'APPROVED' as const, approvedBy: 'test', approvedAt: '2026-09-09T00:00:00Z' };
const doc = testGeometry(), hash = canonicalHash(doc), geometry: GeometryLayerRecord = { id: 'geometry-test', document: doc, contentHash: hash, approvedHash: hash, ...receipt };
const dataset = regionDataset(), datasetHash = canonicalHash(dataset), record: DatasetRecord = { id: 'dataset-test', document: dataset, contentHash: datasetHash, approvedHash: datasetHash, ...receipt };
const profile = loadWorkbenchProfile();

test('E5 geography: explicit 2D GeoJSON mapping retains holes, islands and raw source; malformed or changed mappings fail', () => {
  assert.deepEqual(validateGeometryLayer(doc), doc);
  const invalid = (change: (d: any) => void, message?: RegExp) => { const copy = structuredClone(doc); delete copy.rawInput; change(copy); assert.throws(() => validateGeometryLayer(copy), message); };
  invalid(d => d.features[1].geometry.coordinates[0] = [[1, 2], [2, 2], [3, 2], [1, 2]], /No drawable/);
  invalid(d => d.features[1].id = d.features[0].id, /distinct/);
  invalid(d => d.features[0].geometry.coordinates[0].pop(), /Unclosed/);
  invalid(d => d.features[0].geometry.coordinates[0][0][0] = 181);
  invalid(d => d.features[0].geometry.coordinates[0][0].push(12));
  invalid(d => d.features[0].geometry.coordinates[0] = [[170, 2], [-170, 2], [-170, 3], [170, 3], [170, 2]], /antimeridian/);
  const forged = structuredClone(doc); forged.features[0].name = 'Changed label'; assert.throws(() => validateGeometryLayer(forged), /retained GeoJSON/);
  assert.throws(() => mapGeoJson(JSON.stringify({ type: 'FeatureCollection', crs: {}, features: [] }), null, null), /CRS/);
  assert.throws(() => mapGeoJson('{broken', null, null), /valid JSON/);
  assert.throws(() => mapGeoJson(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: 7 }] }), null, null), /geometry/);
  assert.throws(() => mapGeoJson(doc.rawInput!.text, null, 'name'), /explicit/);
  const world = bundledWorldLayer(); assert.equal(world.features.length, 177); assert.equal(new Set(world.features.map(f => f.id)).size, 177);
  assert.equal(world.features.find(f => f.name === 'France')?.id, 'NE:France');
  assert.equal(geometryWarnings(world).length, 1); assert.match(geometryWarnings(world)[0], /PRK.*collapsed/);
  const strictWorld = structuredClone(world); delete strictWorld.collapsedPartPolicy; assert.throws(() => validateGeometryLayer(strictWorld), /Collapsed/);
  assert.ok(world.features.some(f => f.name === 'Antarctica'), 'a pole-closing edge remains valid');
});

test('E5 geography: exact joins distinguish zero, missing, absent, duplicate and unmatched rows; selections never aggregate', () => {
  const spec = regionFigure(record, geometry, profile), result = joinRegions(dataset, spec, doc);
  assert.deepEqual(result.regions.map(r => [r.featureId, r.state, r.value]), [['A', 'value', 0], ['B', 'missing', null], ['C', 'ambiguous', null], ['D', 'no_observation', null], ['E', 'value', 40]]);
  assert.deepEqual(result.regions[2].rowIds, ['region-row-2', 'region-row-3']); assert.equal(result.unmatched[0].rowId, 'region-row-5');
  spec.selectedIds = ['region-row-2']; assert.deepEqual(joinRegions(dataset, spec, doc), result);
  spec.channels.time = 'date'; spec.timeValue = '2026-09-01'; assert.equal(joinRegions(dataset, spec, doc).regions[2].value, 20);
  spec.timeValue = null; spec.channels.facet = 'date'; const panels = regionJoinReport(dataset, spec, doc).panels;
  assert.deepEqual(panels.map(p => p.regions[2].value), [20, 30]);
  const reversed = { ...dataset, rows: [...dataset.rows].reverse() }; assert.deepEqual(regionJoinReport(reversed, spec, doc), regionJoinReport(dataset, spec, doc));
  const missing = structuredClone(dataset); missing.rows[0].values.region = null; assert.equal(joinRegions(missing, spec, doc).unmatched.find(r => r.rowId === 'region-row-0')?.reason, 'Missing region identifier');
});

test('E5 geography: color classes remain stable through time, manual thresholds use upper intervals, extreme values stay finite', () => {
  const spec = regionFigure(record, geometry, profile), colors = profile.palettes[1].colors;
  const whole = regionColorScale(dataset, spec, colors); spec.channels.time = 'date'; spec.timeValue = '2026-09-02';
  assert.deepEqual(regionColorScale(dataset, spec, colors).breaks, whole.breaks);
  spec.style.domainScope = 'filtered'; assert.equal(regionColorScale(dataset, spec, colors).color(30), colors[3]);
  spec.geography!.classification = { mode: 'manual', breaks: [0, 10, 20, 30, 40] }; checkFigureProfile(spec, profile);
  const manual = regionColorScale(dataset, spec, colors); assert.equal(manual.color(-1), colors[0]); assert.equal(manual.color(0), colors[1]); assert.equal(manual.color(40), colors[5]);
  spec.geography!.classification.breaks[1] = 0; assert.throws(() => checkFigureProfile(spec, profile), /strictly increasing/);
  spec.geography!.classification = { mode: 'equal_interval', breaks: [] }; spec.style.domainScope = 'dataset';
  const extreme = structuredClone(dataset); extreme.rows[0].values.interest = -Number.MAX_VALUE; extreme.rows[1].values.interest = Number.MAX_VALUE;
  assert.ok(regionColorScale(extreme, spec, colors).breaks.every(Number.isFinite)); assert.equal(regionAlphaFraction(0, -Number.MAX_VALUE, Number.MAX_VALUE), 0.5);
  spec.channels.color = 'region'; assert.throws(() => checkFigureBindings(spec, dataset), /numeric/);
  const incomplete = regionFigure(record, geometry, profile); delete incomplete.geography; assert.throws(() => checkFigureBindings(incomplete, dataset), /pinned/);
});

test('E5 geography: publication renderer preserves hole paths, pattern states, evidence and complete pinned provenance', () => {
  const spec = regionFigure(record, geometry, profile); spec.style.labels = true; spec.style.title = 'Fictional region figure'; spec.camera = { ...spec.camera, ...fitGeometry(doc.features) };
  const render = () => renderToStaticMarkup(createElement(FigureCanvas, { record, spec, profile, geometry, standalone: true, svgRef: createRef<SVGSVGElement>(), onSelect() {}, onInspect() {}, onMenu() {} }));
  const svg = render(); assert.match(svg, /data-region-id="A" data-join-state="value"/); assert.match(svg, /data-region-id="C" data-join-state="ambiguous"/);
  assert.match(svg, /fill-rule="evenodd"/); assert.match(svg, /fill="url\(#region-ambiguous\)"/); assert.match(svg, /fill="url\(#region-missing\)"/);
  assert.match(svg, /Evidence tier: Raw observation/); assert.ok(svg.includes(hash)); assert.ok(svg.includes(doc.source.url)); assert.ok(!/NaN|Infinity/.test(svg));
  assert.equal(polygonPath(doc.features[0].geometry, (x, y) => [x, y])[0].split('M').length, 3, 'outer and hole rings are separate subpaths');
  assert.equal(polygonPath(doc.features[4].geometry, (x, y) => [x, y]).length, 2, 'islands stay separate polygons');
  const anchor = regionLabelPoint(doc.features[0].geometry);
  assert.ok(anchor[0] > 1 && anchor[0] < 2 && anchor[1] > 2 && anchor[1] < 3);
  assert.ok(!(anchor[0] > 1.2 && anchor[0] < 1.8 && anchor[1] > 2.2 && anchor[1] < 2.8), 'label never lands in the hole');
  const smaller = structuredClone(doc.features); smaller[0].geometry = { type: 'Polygon', coordinates: [[[1, 1], [1.01, 1], [1.01, 1.01], [1, 1.01], [1, 1]]] };
  assert.equal(fitGeometry(smaller.slice(0, 1)).zoom, 4096); assert.throws(() => fitGeometry([]), /No boundary/);
});
