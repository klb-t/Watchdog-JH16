import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildFieldShell, verifyFieldShell } from '../../scripts/field_shell.mjs';

// Executed after the canonical client build: generated output must describe the
// same index and current hashed assets that the production app actually serves.
test('E6 offline build: current production shell caches its index assets and matches the index version', async () => {
  const verified = await verifyFieldShell();
  assert.ok(verified.required.some(asset => asset.endsWith('.js')));
  assert.ok(verified.required.some(asset => asset.endsWith('.css')));
});

test('E6 offline build: changed HTML or an omitted current module is refused instead of producing a blank offline app', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'watchdog-shell-test-'));
  try {
    await mkdir(path.join(root, 'assets'));
    await writeFile(path.join(root, 'assets/app.js'), 'console.log("fictional shell fixture");');
    await writeFile(path.join(root, 'assets/app.css'), 'body { color: black; }');
    const html = '<script type="module" src="/assets/app.js"></script><link href="/assets/app.css" rel="stylesheet">';
    await writeFile(path.join(root, 'index.html'), html);
    const initial = await buildFieldShell(root);
    assert.deepEqual(initial.required, ['/index.html', '/assets/app.css', '/assets/app.js']);
    const workerPath = path.join(root, 'field-sw.js'), worker = await readFile(workerPath, 'utf8');
    await writeFile(workerPath, worker.replace(',"/assets/app.js"', ''));
    await assert.rejects(verifyFieldShell(root), /does not cache the current client asset/);
    await writeFile(workerPath, worker);
    await writeFile(path.join(root, 'index.html'), html + '<title>Changed shell</title>');
    await assert.rejects(verifyFieldShell(root), /version does not match/);
    const regenerated = await buildFieldShell(root);
    assert.notEqual(regenerated.version, initial.version);
    await writeFile(path.join(root, 'index.html'), '<script src="/assets/missing.js"></script>');
    await assert.rejects(buildFieldShell(root), /does not cache the current client asset/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
