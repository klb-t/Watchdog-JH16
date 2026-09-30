import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve('scripts/deploy_cloudrun.sh');

function harness() {
  const directory = mkdtempSync(path.join(tmpdir(), 'watchdog-cloudrun-guard-'));
  const bin = path.join(directory, 'bin'), log = path.join(directory, 'gcloud-calls');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'gcloud'), '#!/bin/sh\nprintf "gcloud was invoked\\n" >> "$CLI_LOG"\nexit 0\n', { mode: 0o755 });
  const run = (args: string[] = [], configured = true) => {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLI_LOG: log };
    if (configured) env.PROJECT_ID = 'fictional-watchdog-project';
    else delete env.PROJECT_ID;
    return spawnSync('bash', [script, ...args], { env, encoding: 'utf8', timeout: 5_000 });
  };
  return { run, calledCloud: () => existsSync(log), clean: () => rmSync(directory, { recursive: true, force: true }) };
}

test('Cloud Run legacy deployment fails before any cloud command, even with a configured project', () => {
  const h = harness();
  try {
    for (const configured of [false, true]) {
      const result = h.run([], configured);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /disabled.*SQLite.*Cloud Storage FUSE/);
      assert.match(result.stderr, /docs\/DEPLOY_GCP_VM\.md/);
      assert.equal(h.calledCloud(), false, 'unsupported deployment must not inspect or provision cloud resources');
    }
  } finally { h.clean(); }
});

test('Cloud Run help explains the blocker without cloud access; flags cannot bypass it', () => {
  const h = harness();
  try {
    for (const flag of ['--help', '-h']) {
      const result = h.run([flag], false);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /disabled.*SQLite.*Cloud Storage FUSE/);
    }
    const unsupported = h.run(['--force']);
    assert.equal(unsupported.status, 2, unsupported.stderr);
    assert.equal(h.calledCloud(), false);
  } finally { h.clean(); }
});
