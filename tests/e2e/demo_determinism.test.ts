import { test } from 'node:test';
import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * E1.24 — the E1 exit test.
 *
 * Runs `demo:jh16` twice and compares the two run directories byte for byte,
 * ignoring only the run id and the timestamps that legitimately differ.
 */

const ROOT = process.cwd();
const RUNS = path.join(ROOT, 'runs');

function runDemo(): string {
  const before = new Set(fs.existsSync(RUNS) ? fs.readdirSync(RUNS) : []);
  execFileSync('npx', ['tsx', 'scripts/demo_jh16.ts'], { cwd: ROOT, stdio: 'pipe' });
  const after = fs.readdirSync(RUNS).filter(d => !before.has(d));
  assert.strictEqual(after.length, 1, 'the demo should produce exactly one run directory');
  return path.join(RUNS, after[0]);
}

function walk(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full, base) : [path.relative(base, full)];
  }).sort();
}

/**
 * Blanks the values that are allowed to differ between two runs: the run id
 * itself, timestamps, and the sqlite binary (which embeds both). Everything
 * else must match exactly.
 */
function normalise(content: Buffer, runId: string): string {
  return content.toString('utf-8')
    .split(runId).join('<RUN_ID>')
    .replace(/"(created_at|started_at|completed_at|finalized_at|retrieved_at|observed_at|requested_at|timestamp)":\s*"[^"]*"/g, '"$1":"<TS>"')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<TS>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g, '<TS>')
    // Span and error ids are freshly generated per run by design; the trace's
    // *shape* is what must be identical, not its correlation identifiers.
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<UUID>')
    // Hashes taken OVER run-scoped content are run-dependent by construction:
    // an export that names its run, and the manifest that hashes that export,
    // cannot have a stable digest. Only these two are relaxed. The hashes that
    // carry scientific weight — raw blob digests and the effective-config hash
    // — are asserted strictly below and are NOT normalised here.
    .replace(/"sha256":\s*"[0-9a-f]{64}"/g, '"sha256":"<ARTIFACT_SHA>"')
    .replace(/"manifest_sha256":\s*"[0-9a-f]{64}"/g, '"manifest_sha256":"<MANIFEST_SHA>"');
}

test('E1.24: two demo runs produce byte-identical directories apart from run id and timestamps', () => {
  const dirA = runDemo();
  const dirB = runDemo();
  const idA = path.basename(dirA);
  const idB = path.basename(dirB);

  const filesA = walk(dirA).filter(f => !f.endsWith('.sqlite'));
  const filesB = walk(dirB).filter(f => !f.endsWith('.sqlite'));

  // "Apart from run id" applies to file NAMES as well as contents: the stored
  // manifest is named for its run.
  const namesA = filesA.map(f => f.split(idA).join('<RUN_ID>'));
  const namesB = filesB.map(f => f.split(idB).join('<RUN_ID>'));
  assert.deepStrictEqual(namesA, namesB, 'both runs produce the same set of files');

  // The run directory must actually be complete, not merely consistent.
  for (const required of [
    'manifest.json', 'observations.json', 'analysis.json', 'narrative.json',
    'replication.json', 'exports/results.csv', 'exports/results.json',
    'charts/pi-bar.json', 'charts/hi-bar.json', 'charts/hi-vs-reference-scatter.json',
  ]) {
    assert.ok(filesA.includes(required), `run directory is missing ${required}`);
  }
  assert.ok(filesA.some(f => f.startsWith('raw/')), 'raw fixture copies must be retained');
  assert.ok(filesA.some(f => f.startsWith('trace/')), 'the trace must be in the run directory');

  const byNameB = new Map(filesB.map(f => [f.split(idB).join('<RUN_ID>'), f]));
  const differing: string[] = [];
  for (const f of filesA) {
    const key = f.split(idA).join('<RUN_ID>');
    const a = normalise(fs.readFileSync(path.join(dirA, f)), idA);
    const b = normalise(fs.readFileSync(path.join(dirB, byNameB.get(key)!)), idB);
    if (a !== b) differing.push(key);
  }
  assert.deepStrictEqual(differing, [], `these files differed between runs: ${differing.join(', ')}`);

  // The hashes that matter must match EXACTLY, un-normalised: identical
  // fixtures and an identical configuration must produce identical digests,
  // and relaxing those would make the determinism claim hollow.
  const mA = JSON.parse(fs.readFileSync(path.join(dirA, 'manifest.json'), 'utf-8'));
  const mB = JSON.parse(fs.readFileSync(path.join(dirB, 'manifest.json'), 'utf-8'));
  assert.strictEqual(mA.effective_config_hash, mB.effective_config_hash,
    'the same configuration must hash identically across runs');
  assert.deepStrictEqual(
    mA.fetches.map((f: any) => f.raw_blob_sha256).sort(),
    mB.fetches.map((f: any) => f.raw_blob_sha256).sort(),
    'identical fixture bytes must yield identical content addresses');
  assert.deepStrictEqual(mA.analyses[0].method_spec_hash, mB.analyses[0].method_spec_hash,
    'the same method spec must hash identically');

  // Raw evidence is content-addressed, so identical fixtures hash identically
  // across runs — a stronger check than "the files look the same".
  const rawA = filesA.filter(f => f.startsWith('raw/')).map(f =>
    createHash('sha256').update(fs.readFileSync(path.join(dirA, f))).digest('hex')).sort();
  const rawB = filesB.filter(f => f.startsWith('raw/')).map(f =>
    createHash('sha256').update(fs.readFileSync(path.join(dirB, f))).digest('hex')).sort();
  assert.deepStrictEqual(rawA, rawB);

  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });
});

test('E1.24: the demo produces the published JH2016 values, offline', () => {
  const dir = runDemo();
  const analysis = JSON.parse(fs.readFileSync(path.join(dir, 'analysis.json'), 'utf-8'));
  const paper = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'jh2016', 'paper_reported.json'), 'utf-8'));

  for (const s of paper.substances) {
    const pi = analysis.results.find((r: any) => r.metricKey === 'Pi' && r.entityId === s.canonical);
    const hi = analysis.results.find((r: any) => r.metricKey === 'Hi' && r.entityId === s.canonical);
    assert.ok(Math.abs(pi.valueNumeric - s.Pi_percent) < 0.06, `${s.canonical} Pi`);
    assert.ok(Math.abs(hi.valueNumeric - s.Hi_percent) < 0.06, `${s.canonical} Hi`);
  }

  // The manifest is the scientific claim; it must be there and complete.
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));
  assert.strictEqual(manifest.fetches.length, 32);
  assert.strictEqual(manifest.preset_locked, true);
  assert.ok(manifest.effective_config_hash);
  assert.ok(manifest.quality_flags.includes('PROVIDER_ESTIMATE'));

  // And no replication verdict is invented against an unapproved tolerance.
  const replication = JSON.parse(fs.readFileSync(path.join(dir, 'replication.json'), 'utf-8'));
  assert.strictEqual(replication.status, 'no_claims_registered');
  assert.deepStrictEqual(replication.verdicts, []);

  fs.rmSync(dir, { recursive: true, force: true });
});
