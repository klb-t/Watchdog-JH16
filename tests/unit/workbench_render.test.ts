import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCsv } from '../../shared/csv_import';
import { project3d, wrapFigureText } from '../../shared/figure_geometry';
import { checkFigureBindings, checkFigureProfile, defaultFigure, validateDataset, type DatasetRecord, type FigureSpec } from '../../shared/workbench';
import { FigureCanvas } from '../../src/components/FigureCanvas';
import { testDataset } from '../helpers/workbench';
import { loadWorkbenchProfile } from '../../backend/watchdog_api/config/workbench';
const record: DatasetRecord = { id: 'test', document: testDataset(), contentHash: 'a'.repeat(64), approvalState: 'APPROVED', approvedHash: 'a'.repeat(64), approvedBy: 'test', approvedAt: '2026-09-09T00:00:00Z', ownerId: 'test', visibility: 'private' };
const render = (spec: FigureSpec, r = record) => renderToStaticMarkup(createElement(FigureCanvas, { record: r, spec, profile: loadWorkbenchProfile(), onSelect() {}, onInspect() {}, onMenu() {}, svgRef: createRef<SVGSVGElement>() }));

test('E5 CSV: quoted delimiters, escaped quotes, multiline cells, BOM and syntax errors', () => {
  assert.deepEqual(parseCsv('\uFEFFname,value\r\n"A,B","line 1\nline 2"\r\n"quote ""x""",-1'), [['name', 'value'], ['A,B', 'line 1\nline 2'], ['quote "x"', '-1']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2', '\t'), [['a', 'b'], ['1', '2']]);
  assert.throws(() => parseCsv('a,"unclosed'), /unclosed/);
  assert.throws(() => parseCsv('a,"x"oops'), /closing quote/);
  const d = testDataset(); d.rows[0].values.mentions = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => validateDataset(d), /Unsafe integer/);
});

test('E5 figures: physical map units and numeric channels prevent silent reinterpretation', () => {
  const spec = defaultFigure(record, loadWorkbenchProfile()); spec.renderer = 'map'; checkFigureBindings(spec, record.document);
  spec.channels.x = 'interest'; assert.throws(() => checkFigureBindings(spec, record.document), /longitude/);
  assert.match(render(spec), /Map X must be longitude/);
  spec.renderer = 'scatter3d'; spec.channels.z = 'region'; assert.throws(() => checkFigureBindings(spec, record.document), /numeric/);
  spec.renderer = 'bar'; spec.style.yScale = 'log'; assert.throws(() => checkFigureProfile(spec, loadWorkbenchProfile()), /zero baseline/);
});

test('E5 SVG: source tiers, approval, missingness, labels and camera survive vector rendering', () => {
  const spec = defaultFigure(record, loadWorkbenchProfile()); spec.channels.x = 'interest'; spec.channels.y = 'mentions'; spec.channels.z = 'sentiment'; spec.renderer = 'scatter3d';
  spec.style.opacity = 0.15; spec.style.labels = true; spec.channels.color = 'language';
  const svg = render(spec); assert.match(svg, /aria-label="3D axes"/); assert.match(svg, /4 shown · 1 missing/);
  assert.match(svg, /Evidence tier: Raw observation/); assert.match(svg, /Source mapping: APPROVED/);
  assert.ok(svg.includes(record.contentHash)); assert.ok(svg.includes(record.document.source.url));
  spec.camera.yaw = 100; assert.notEqual(render(spec), svg);
  const r = structuredClone(record); r.document.rows[0].values.longitude = 181;
  spec.renderer = 'map'; spec.channels.x = 'longitude'; spec.channels.y = 'latitude';
  assert.match(render(spec, r), /4 shown · 1 missing/);
});

test('E5 SVG: missing log values and provider discontinuities break lines without zero substitution', () => {
  const spec = defaultFigure(record, loadWorkbenchProfile()); spec.renderer = 'line'; spec.channels.x = 'mentions'; spec.channels.y = 'interest'; spec.style.yScale = 'log';
  const r = structuredClone(record); r.document.rows[1].values.interest = 0;
  const svg = render(spec, r); assert.match(svg, /3 shown · 2 missing/); assert.match(svg, /Provider discontinuity/);
  assert.ok(!svg.includes('NaN')); assert.ok(!svg.includes('Infinity'));
  assert.match(svg, /d="M[^"L]+M[^"L]+M[^"L]+" fill="none"/);
});

test('E5 projection: rotations preserve depth identity and deterministic wrapping preserves all words', () => {
  assert.deepEqual(project3d(1, 2, 3, { yaw: 0, pitch: 0, zoom: 1 }), [1, 2, 3]);
  const turned = project3d(1, 2, 3, { yaw: 90, pitch: 0, zoom: 2 });
  assert.ok(Math.abs(turned[0] + 6) < 1e-12); assert.equal(turned[1], 4); assert.ok(Math.abs(turned[2] - 1) < 1e-12);
  const title = 'Long publication title with several words'; const lines = wrapFigureText(title, 15);
  assert.equal(lines.join(' '), title); assert.ok(lines.every(l => l.length <= 15));
});

test('E5 animation: a record keeps its color, size and alpha when the time frame narrows', () => {
  const spec = defaultFigure(record, loadWorkbenchProfile()); spec.channels.color = 'language'; spec.channels.size = 'mentions'; spec.channels.alpha = 'sentiment';
  const mark = (svg: string) => svg.split('data-row-id="row-1"')[1].match(/<circle[^>]+/g)![0];
  const before = mark(render(spec)); spec.channels.time = 'date'; spec.timeValue = '2026-09-01';
  assert.equal(mark(render(spec)), before, 'stable domains prevent frame-by-frame rescaling from hiding or inventing visual change');
  spec.style.domainScope = 'filtered'; assert.notEqual(mark(render(spec)), before, 'explicit rescaling remains available as a separate setting');
});
