import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// E3.22: deterministic offline host/cloud contracts; no real apt, IAM, SSH or VM mutations.
test('E3.22 devbox recovery and desktop operational contracts (Python standard library)', () => {
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests/ops', '-p', 'test_devbox.py', '-v'], {
    encoding: 'utf8', timeout: 60_000,
  });
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
});
