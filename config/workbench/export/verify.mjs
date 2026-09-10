#!/usr/bin/env node
// Standalone verifier: Node.js built-ins only; no network, packages or database.
import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => value === null || value === undefined ? 'null' : typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const hash = value => sha(canonical(value));
const check = (condition, message) => { if (!condition) throw new Error(message); };
try {
  const root = realpathSync(process.argv[2] ?? path.dirname(fileURLToPath(import.meta.url)));
  const read = name => {
    check(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.[a-z0-9]+$/.test(name), `Unsafe package path: ${name}`);
    const filename = path.join(root, name), actual = realpathSync(filename);
    check(actual === filename && actual.startsWith(root + path.sep) && lstatSync(filename).isFile(), `Non-regular package file: ${name}`);
    return readFileSync(filename);
  };
  const manifestBytes = read('package-manifest.json'), manifest = JSON.parse(manifestBytes);
  const packageHash = sha(manifestBytes);
  check(manifest.version === 'watchdog-research-package-1', 'Unsupported research package version.');
  if (process.argv[3]) check(packageHash === process.argv[3], 'Trusted package manifest hash does not match.');
  check(Array.isArray(manifest.files) && manifest.files.length > 0, 'Missing file inventory.');
  const names = new Set();
  for (const file of manifest.files) {
    check(!names.has(file.path), `Duplicate package file: ${file.path}`); names.add(file.path);
    const bytes = read(file.path);
    check(bytes.length === file.bytes && sha(bytes) === file.sha256, `File integrity mismatch: ${file.path}`);
  }
  const json = name => { check(names.has(name), `Required file is not inventoried: ${name}`); return JSON.parse(read(name)); };
  for (const name of ['figure.svg', 'selected.csv', 'README.md', 'verify.mjs']) check(names.has(name), `Missing ${name}`);
  const figure = json('figure.json'), dataset = json('dataset.json'), receipt = json('dataset-receipt.json'), profile = json('profile.json');
  const workspace = json('workspace.json');
  check(hash(workspace.figure) === hash(figure) && hash(workspace.profile) === hash(profile), 'Workspace restoration snapshot mismatch.');
  check(hash(figure) === manifest.identity.figureHash, 'Figure identity mismatch.');
  check(hash(dataset) === manifest.identity.datasetHash && figure.datasetHash === manifest.identity.datasetHash, 'Dataset identity mismatch.');
  check(receipt.id === figure.datasetId && receipt.contentHash === figure.datasetHash && receipt.approvedHash === figure.datasetHash && receipt.approvalState === 'APPROVED', 'Dataset approval receipt mismatch.');
  const { contentHash, ...profileDocument } = profile;
  check(hash(profileDocument) === contentHash && contentHash === figure.profileHash && contentHash === manifest.identity.profileHash, 'Profile identity mismatch.');
  check(figure.rendererVersion === manifest.identity.rendererVersion, 'Renderer identity mismatch.');
  if (dataset.rawInput) check(names.has('source.csv') && read('source.csv').equals(Buffer.from(dataset.rawInput.text)), 'Raw CSV source mismatch.');
  if (figure.renderer === 'map') json('rendering/basemap.json');
  if (figure.geography) {
    const geometry = json('rendering/geometry.json'), geometryReceipt = json('rendering/geometry-receipt.json');
    check(hash(geometry) === figure.geography.layerHash && figure.geography.layerHash === manifest.identity.geometryHash, 'Geometry identity mismatch.');
    check(geometryReceipt.id === figure.geography.layerId && geometryReceipt.contentHash === figure.geography.layerHash && geometryReceipt.approvedHash === figure.geography.layerHash && geometryReceipt.approvalState === 'APPROVED', 'Geometry approval receipt mismatch.');
    // Independent join verification: selection is statistical, never regional aggregation.
    const rows = dataset.rows.filter(row => figure.filters.every(filter => {
      const value = row.values[filter.column];
      if (value === null || value === undefined) return false;
      if (filter.operator === 'equals') return value === filter.values[0];
      if (filter.operator === 'contains') return String(value).normalize('NFKC').toLowerCase().includes(String(filter.values[0]).normalize('NFKC').toLowerCase());
      return value >= filter.values[0] && value <= filter.values[1];
    }) && (!figure.channels.time || figure.timeValue === null || row.values[figure.channels.time] === figure.timeValue));
    const groups = new Map(), compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    for (const row of rows) {
      const facet = figure.channels.facet ? row.values[figure.channels.facet] : null, key = JSON.stringify(facet);
      if (!groups.has(key)) groups.set(key, { facet, rows: [] }); groups.get(key).rows.push(row);
    }
    if (!groups.size) groups.set('empty', { facet: null, rows: [] });
    const mappings = new Map(Object.entries(figure.geography.mappings));
    const panels = [...groups.entries()].sort(([a], [b]) => compare(a, b)).map(([, group]) => {
      const buckets = new Map(geometry.features.map(f => [f.id, []])), unmatched = [];
      for (const target of mappings.values()) check(buckets.has(target), 'Unknown mapped geometry feature.');
      for (const row of group.rows) {
        const region = row.values[figure.channels.region], featureId = region === null || region === undefined ? null : mappings.get(String(region)) ?? String(region);
        if (featureId !== null && buckets.has(featureId)) buckets.get(featureId).push(row);
        else unmatched.push({ rowId: row.id, region: region ?? null, reason: featureId === null ? 'Missing region identifier' : `No exact geometry match for ${JSON.stringify(region)}` });
      }
      const regions = [...buckets.entries()].map(([featureId, source]) => {
        const value = source.length === 1 ? source[0].values[figure.channels.color] : null;
        return { featureId, rowIds: source.map(r => r.id).sort(), state: source.length === 0 ? 'no_observation' : source.length > 1 ? 'ambiguous' : typeof value === 'number' ? 'value' : 'missing', value: typeof value === 'number' ? value : null };
      }).sort((a, b) => compare(a.featureId, b.featureId));
      return { facet: group.facet, version: 'region-join-1', regions, unmatched: unmatched.sort((a, b) => compare(a.rowId, b.rowId)) };
    });
    check(hash(json('rendering/region-join.json')) === hash({ version: 'region-join-report-1', regionColumn: figure.channels.region, valueColumn: figure.channels.color, panels }), 'Region join report does not match source observations.');
    if (geometry.rawInput) check(names.has('rendering/source.geojson') && read('rendering/source.geojson').equals(Buffer.from(geometry.rawInput.text)), 'Original GeoJSON mismatch.');
  }
  if (figure.analysis) {
    const result = json('analysis/result.json'), provenance = json('analysis/manifest.json');
    const method = json('analysis/method.json'), inputs = json('analysis/inputs.json');
    check(hash(result) === figure.analysis.resultHash && figure.analysis.resultHash === manifest.identity.resultHash, 'Analysis result identity mismatch.');
    check(hash(provenance) === manifest.identity.analysisManifestHash && provenance.runId === result.runId, 'Analysis manifest mismatch.');
    check(provenance.outputs.some(output => output.sha256 === figure.analysis.resultHash), 'Result is absent from the analysis manifest.');
    check(hash(method) === figure.analysis.methodHash && hash(result.methodSpec) === figure.analysis.methodHash && result.methodId === figure.analysis.methodId, 'Method identity mismatch.');
    check(provenance.method.approvedHash === figure.analysis.methodHash && provenance.method.id === figure.analysis.methodId, 'Method approval receipt mismatch.');
    check(hash(inputs) === result.inputHash && hash(result.inputs) === result.inputHash && provenance.inputs.combinedHash === result.inputHash, 'Analysis inputs mismatch.');
    check(result.datasetHash === figure.datasetHash, 'Analysis dataset mismatch.');
    const columnNames = method.steps[0].primitive === 'describe' ? [figure.channels.y] : [figure.channels.x, figure.channels.y];
    const selection = { datasetHash: figure.datasetHash, columns: columnNames, filters: figure.filters, selectedIds: [...new Set(figure.selectedIds)].sort(), time: figure.channels.time, timeValue: figure.timeValue };
    check(method.assumptions.includes(`selection_sha256=${hash(selection)}`), 'Figure and method selections disagree.');
  } else check(manifest.identity.resultHash === null && manifest.identity.analysisManifestHash === null, 'Unexpected analysis reference.');
  console.log(`Verified ${names.size} files and linked figure/data/profile/geometry/analysis identities.\nPackage manifest SHA-256: ${packageHash}`);
  console.log(process.argv[3] ? 'Matches the independently supplied manifest hash.' : 'No independent hash supplied: internal consistency checked, not authorship.');
  console.log('Approval receipts describe the export snapshot; they do not grant access or establish current approval. Statistics were not rerun.');
} catch (error) { console.error(`Verification failed: ${error.message}`); process.exitCode = 1; }
