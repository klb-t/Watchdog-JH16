/** Bundled independent verifier. It requires only Node, not WatchDog or its database. */
export const PROJECT_ARCHIVE_VERIFIER = `import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
const canonical = value => value === null ? 'null' : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const root = resolve(process.argv[2] || '.'), supplied = process.argv[3];
  const manifest = JSON.parse(readFileSync(resolve(root, 'project-manifest.json'), 'utf8'));
  const manifestHash = hash(canonical(manifest));
  if (manifest.schemaVersion !== 'research-project-archive-1' || manifest.purpose !== 'PRIVATE_WORKSPACE_ARCHIVE') throw Error('Unexpected archive contract');
  if (supplied && manifestHash !== supplied) throw Error('Does not match the independently supplied manifest hash');
  const seen = new Set();
  for (const file of manifest.files) {
    const full = resolve(root, file.path);
    if (!full.startsWith(root + sep) || seen.has(file.path)) throw Error('Invalid or repeated file path');
    seen.add(file.path);
    const bytes = readFileSync(full);
    if (bytes.length !== file.byteSize || hash(bytes) !== file.sha256) throw Error('Integrity failure: ' + file.path);
  }
  const revision = JSON.parse(readFileSync(resolve(root, 'revision.json'), 'utf8'));
  if (hash(canonical(revision)) !== manifest.revisionHash || revision.projectId !== manifest.projectId || revision.revision !== manifest.revision) throw Error('Revision lineage failure');
  for (const link of revision.links) {
    if (hash(canonical(link.snapshot)) !== link.snapshotHash) throw Error('Link metadata integrity failure');
    if ((link.kind === 'schedule') !== (link.binding === 'live_schedule_pointer')) throw Error('Schedule binding semantics changed');
    for (const file of link.files) {
      const pinned = manifest.files.find(f => f.path === file.path);
      if (!pinned || pinned.sha256 !== file.sha256 || pinned.byteSize !== file.byteSize) throw Error('Linked source is missing from manifest');
    }
  }
  console.log(supplied ? 'Matches the independently supplied manifest hash; all files and revision links verify.' : 'Internally consistent archive; no external identity anchor supplied. Manifest SHA-256: ' + manifestHash);
  console.log('Workspace archive verification grants no scientific approval or replication verdict.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
`;
