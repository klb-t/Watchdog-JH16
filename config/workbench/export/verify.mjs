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
  console.log(`Verified ${names.size} files and linked figure/data/profile/analysis identities.\nPackage manifest SHA-256: ${packageHash}`);
  console.log(process.argv[3] ? 'Matches the independently supplied manifest hash.' : 'No independent hash supplied: internal consistency checked, not authorship.');
  console.log('Approval receipts describe the export snapshot; they do not grant access or establish current approval. Statistics were not rerun.');
} catch (error) { console.error(`Verification failed: ${error.message}`); process.exitCode = 1; }
