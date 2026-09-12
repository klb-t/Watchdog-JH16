import { createHash } from 'node:crypto';
import { createElement, createRef, version as reactVersion } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FigureCanvas } from '../../../shared/figure_renderer';
import { checkFigureBindings, checkFigureProfile, csvExport, filterRows, type DatasetRecord, type FigureSpec, type WorkbenchProfile } from '../../../shared/workbench';
import { checkGeographyBinding, regionJoinReport, type GeometryLayerRecord } from '../../../shared/geography';
import world from '../../../config/workbench/world.json';
import { canonicalHash, canonicalizeJson } from '../domain/canonical';
import { WorkbenchError } from '../db/repositories/workbench';
import { createZip, type ZipEntry } from '../utils/zip';
import { loadResearchVerifier,loadExtractionVerifier } from '../config/workbench';
import { verifyDatasetExtraction } from './extraction_data';

export function publicationSvg(record: DatasetRecord, figure: FigureSpec, profile: WorkbenchProfile, geometry?: GeometryLayerRecord | null): string {
  checkFigureProfile(figure, profile); checkFigureBindings(figure, record.document);
  if (figure.channels.facet && new Set(filterRows(record.document, figure).map(r => r.values[figure.channels.facet!])).size > 12)
    throw new WorkbenchError('SVG export supports up to 12 panels. Narrow the facet filter, or export the complete JSON/CSV.');
  if (figure.geography) { if (!geometry) throw new WorkbenchError('Geometry layer required.', 409); checkGeographyBinding(figure, geometry); }
  // A single implementation for interactive figures and publication output.
  // Server rendering never accepts arbitrary client SVG, HTML or scripts.
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + renderToStaticMarkup(createElement(FigureCanvas, {
    record, spec: figure, profile, geometry, standalone: true, svgRef: createRef<SVGSVGElement>(), onSelect() {}, onInspect() {}, onMenu() {},
  }));
}

export function researchPackage(record: DatasetRecord, figure: FigureSpec, profile: WorkbenchProfile, result: any | null, geometry?: GeometryLayerRecord | null) {
  const entries: ZipEntry[] = [];
  const add = (name: string, text: string) => entries.push({ name, content: Buffer.from(text) });
  const json = (name: string, value: unknown) => add(name, canonicalizeJson(value));
  const { document, ...receipt } = record;
  add('figure.svg', publicationSvg(record, figure, profile, geometry));
  json('workspace.json', { figure, profile });
  json('figure.json', figure); json('dataset.json', document); json('dataset-receipt.json', receipt); json('profile.json', profile);
  add('selected.csv', csvExport(record, figure));
  if (document.rawInput) add('source.csv', document.rawInput.text);
  if(document.sourceCopy){
    json('extraction/source-copy.json',document.sourceCopy);
    json('extraction/copied.json',verifyDatasetExtraction(document));
    add(`extraction/source.${document.sourceCopy.plan.format}`,document.sourceCopy.raw);
    add('extraction/replay.cjs',loadExtractionVerifier());
  }
  if (figure.renderer === 'map') json('rendering/basemap.json', world);
  if (geometry) {
    const { document: boundaryDocument, ...boundaryReceipt } = geometry;
    json('rendering/geometry.json', boundaryDocument); json('rendering/geometry-receipt.json', boundaryReceipt);
    json('rendering/region-join.json', regionJoinReport(document, figure, boundaryDocument));
    if (boundaryDocument.rawInput) add('rendering/source.geojson', boundaryDocument.rawInput.text);
  }
  if (result) {
    const { hash, manifest, ...payload } = result;
    if (!figure.analysis || canonicalHash(payload) !== figure.analysis.resultHash || hash !== figure.analysis.resultHash || canonicalHash(manifest.document) !== manifest.hash)
      throw new WorkbenchError('Research package result integrity mismatch.', 409);
    json('analysis/result.json', payload); json('analysis/manifest.json', manifest.document);
    json('analysis/method.json', result.methodSpec); json('analysis/inputs.json', result.inputs);
  } else if (figure.analysis) throw new WorkbenchError('The figure requires its verified analysis result.', 409);
  json('software.json', { rendererVersion: figure.rendererVersion, reactVersion, nodeVersion: process.version,
    executor: result ? { id: result.artifact.executorId, version: result.artifact.executorVersion } : null });
  add('verify.mjs', loadResearchVerifier());
  add('README.md', `# Watchdog research package\n\nOpen figure.svg in a browser or a vector editor. It contains the complete exported figure and its source metadata.\n\nExtract the ZIP, then run:\n\n    node verify.mjs . [independently-recorded-manifest-sha256]\n\nThe verifier needs only Node.js built-ins and makes no network requests. Keep the manifest hash shown by Watchdog separately when transferring this package. Internal hashes detect changed bytes; an independent hash is needed to detect replacement of the entire package.\n\nRestore workspace.json through the Watchdog figure import control to reopen these settings against the same accessible, currently approved dataset. An attached analysis must already belong to your account. Restoration does not import or approve source data.\n\nfigure.json pins the complete channels, filters, selected row IDs, camera, time frame and style. profile.json is the exact archived visualization profile, including palettes and evidence labels. dataset.json preserves all source values and missing-value reasons. dataset-receipt.json records approval and sharing at export; it does not assert current access or approval. selected.csv contains the statistical selection (or the whole filtered frame when nothing is selected), with spreadsheet-safe text. A selected mark does not hide other marks from figure.svg. source.csv, when present, preserves the original imported bytes as UTF-8 text, including untrusted spreadsheet formulas.\n\nWhen extraction/ is present, it retains the complete raw source, the tested copy plan, exact copied values and cell spans, the declared type/missingness mappings, and a bundled deterministic replay implementation. verify.mjs replays copying and numeric conversion locally and compares all mapped dataset rows. Numeric analysis uses binary64; decimals that would change their decimal value or exceed the safe integer range are rejected during import. Original numeric lexemes remain in the raw source. The original file includes unselected fields and must be reviewed before sharing.\n\nWhen an analysis is attached, analysis/ contains the exact method, typed inputs, result and immutable execution manifest. Undefined results remain null. Verification checks hashes and linked identities; it does not rerun statistics. Recalculation uses the recorded executor implementation/version and method from the Watchdog repository. The exported SVG remains directly usable without that software.\n\nSources, retrieval dates, licenses, comparison scope, normalization and language meaning are in dataset.json and the figure metadata. Geographic marker packages include the Natural Earth basemap. Region-color packages retain the exact reviewed boundary layer, its source text when imported and the per-panel join report. Duplicate source rows are marked ambiguous; missing values and unmatched identifiers remain explicit. No source value is aggregated during a region join. Evidence tiers, approval status, quality flags and visual color/alpha channels are independent. Correlation does not establish causation, prevalence or distribution routes. No live data, inferred sentiment or publication narrative is invented by this export.\n`);
  const manifest = { version: 'watchdog-research-package-1', identity: { figureHash: canonicalHash(figure), datasetHash: record.contentHash,
    profileHash: profile.contentHash, ...(geometry ? { geometryHash: geometry.contentHash } : {}), rendererVersion: figure.rendererVersion, resultHash: result?.hash ?? null, analysisManifestHash: result?.manifest.hash ?? null },
    files: entries.map(e => ({ path: e.name, bytes: e.content.length, sha256: createHash('sha256').update(e.content).digest('hex') })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
  const manifestHash = canonicalHash(manifest); json('package-manifest.json', manifest);
  const bytes = createZip(entries);
  return { bytes, manifestHash, sha256: createHash('sha256').update(bytes).digest('hex'), manifest };
}
