import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { freePort, waitForServer } from '../helpers/server';

// The browser suites' startup wait (tests/helpers/server.ts) must explain a failed start and must not let output block the server.

test('a server that dies at startup fails the wait with its exit code and its own words', async () => {
  const child = spawn(process.execPath, ['-e', "console.error('cannot open database'); process.exit(3)"], { stdio: 'pipe' });
  await assert.rejects(waitForServer(child, `http://127.0.0.1:${await freePort()}`, '/', 10_000), (e: Error) => /exited with code 3/.test(e.message) && /cannot open database/.test(e.message));
});

test('a server that writes more than a pipe holds before listening still starts', async () => {
  const port = await freePort();
  // 1 MB of output before listen: with an unread pipe the write blocks and the server never answers.
  const child = spawn(process.execPath, ['-e', `process.stdout.write('x'.repeat(1 << 20), () => require('node:http').createServer((q, s) => s.end('ok')).listen(${port}, '127.0.0.1'))`], { stdio: 'pipe' });
  try { await waitForServer(child, `http://127.0.0.1:${port}`, '/', 15_000); } finally { child.kill('SIGKILL'); }
});
