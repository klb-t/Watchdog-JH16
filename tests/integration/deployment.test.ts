import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf-8');

// ---------------------------------------------------------------------------
// E3.5 — the container and the deployment configuration.
//
// These check the properties that make a deployment honest rather than merely
// working, because a deployment that works while quietly losing provenance is
// the failure D17 is built around.
// ---------------------------------------------------------------------------

test('E3.5: the image carries the data the running system reads', () => {
  const df = read('Dockerfile');
  // Without config/ every run fails at config load; without fixtures/ the
  // offline slice — the only thing that works with no credentials — is gone.
  assert.match(df, /COPY .*\/app\/config \.\/config/);
  assert.match(df, /COPY .*\/app\/fixtures \.\/fixtures/);
  assert.match(df, /COPY .*\/app\/dist \.\/dist/);
});

test('E3.5: the build fails before an image exists if the checks fail', () => {
  const df = read('Dockerfile');
  assert.match(df, /RUN npm run lint && npm run test && npm run build/,
    'a deployable artifact must not be producible from a red tree');
  assert.match(df, /npm prune --omit=dev/);
  assert.match(df, /^USER node$/m, 'the runtime must not be root');
});

test('E3.5: the container never bakes in a credential', () => {
  const df = read('Dockerfile');
  for (const name of ['OPENROUTER_API_KEY', 'SERPAPI_API_KEY', 'SESSION_SIGNING_KEY', 'WATCHDOG_GRANTS']) {
    assert.ok(!df.includes(name), `${name} must arrive at runtime, never in an image layer`);
  }
  // .dockerignore keeps local state and git history out of the build context.
  const di = read('.dockerignore');
  for (const entry of ['data', 'runs', '.git', 'node_modules']) {
    assert.match(di, new RegExp(`^${entry.replace('.', '\\.')}$`, 'm'));
  }
});

test('E3.5: the deploy pins a single instance, because SQLite has one writer', () => {
  const sh = read('scripts', 'deploy_cloudrun.sh');
  assert.match(sh, /--max-instances 1/,
    'a second instance would be a second writer against one SQLite file');
  assert.match(sh, /Postgres backend exists/, 'and the reason must be recorded where it is set');

  // Durable storage is configured by the same command that deploys, so the
  // two cannot drift apart.
  assert.match(sh, /STORE_BACKEND=gcs/);
  assert.match(sh, /DB_PATH=\/mnt\/watchdog\/watchdog\.sqlite/);
  assert.match(sh, /--add-volume-mount/);

  // Not public until sign-in is configured.
  assert.match(sh, /--no-allow-unauthenticated/);
});

test('E3.5: no secret value is ever an argument to the deploy script', () => {
  const sh = read('scripts', 'deploy_cloudrun.sh');
  assert.match(sh, /--set-secrets/, 'secrets are referenced from Secret Manager, not passed as env values');
  assert.ok(!/--set-env-vars[^\n]*(API_KEY|SIGNING_KEY)=/.test(sh),
    'a key passed as an env var on the command line lands in shell history');
  assert.match(sh, /--data-file=-/, 'secret values are piped, never given as arguments');
});

test('E3.5: .env.example lists names only, and matches what the code reads', () => {
  const env = read('.env.example');

  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) assert.strictEqual(m[2].trim(), '', `${m[1]} must have no value in .env.example`);
  }

  // The stale AI Studio leftovers this replaced.
  assert.ok(!env.includes('GEMINI_API_KEY'));
  assert.ok(!env.includes('AI Studio'));

  for (const name of [
    'GOOGLE_OAUTH_CLIENT_ID', 'WATCHDOG_GRANTS', 'SESSION_SIGNING_KEY',
    'OPENROUTER_API_KEY', 'SERPAPI_API_KEY', 'STORE_BACKEND', 'GCS_BUCKET', 'DB_PATH',
  ]) {
    assert.ok(env.includes(name), `${name} is read by the code and must be documented`);
  }
});

test('E3.5: every environment variable the code reads is documented', () => {
  const documented = new Set(
    [...read('.env.example').matchAll(/^#?\s*([A-Z][A-Z0-9_]{3,})=/gm)].map(m => m[1]));

  // Set by the platform or by the test harness rather than by an operator.
  const exempt = new Set(['NODE_ENV', 'PORT', 'PLAYWRIGHT_BROWSERS_PATH', 'HTTPS_PROXY']);

  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : (e.name.endsWith('.ts') ? [p] : []);
    });

  const undocumented = new Set<string>();
  for (const file of [...walk(path.join(process.cwd(), 'backend')), path.join(process.cwd(), 'server.ts')]) {
    for (const m of fs.readFileSync(file, 'utf-8').matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      if (!documented.has(m[1]) && !exempt.has(m[1])) undocumented.add(m[1]);
    }
  }

  assert.deepStrictEqual([...undocumented].sort(), [],
    'an undocumented variable is a setting nobody can find when the instance misbehaves');
});

test('E3.5: the production build actually produces the entrypoint the image runs', () => {
  // The Dockerfile's CMD and the build script must not drift apart.
  assert.match(read('Dockerfile'), /CMD \["node", "dist\/server\.cjs"\]/);
  assert.match(read('package.json'), /outfile=dist\/server\.cjs/);
  assert.match(read('package.json'), /"start": "node dist\/server\.cjs"/);
});

test('E3.5: the runbook documents both refuse-to-start checks and their waivers', () => {
  const doc = read('docs', 'DEPLOY_GCP.md');
  assert.match(doc, /WATCHDOG_ALLOW_OPEN_INSTANCE/);
  assert.match(doc, /WATCHDOG_ALLOW_EPHEMERAL_STORAGE/);
  assert.match(doc, /max-instances=1/);
  assert.match(doc, /migrate-local-user/, 'claiming pre-authentication rows must be documented');
});

test('E3.5: a production start with ephemeral storage exits non-zero', () => {
  // The real check, in a real process. A unit test on the predicate would not
  // catch the wiring being absent from server.ts, which is the mistake that
  // actually publishes an unsafe instance.
  let failed = false;
  let output = '';
  try {
    output = execFileSync(process.execPath, ['--import', 'tsx', 'server.ts'], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        WATCHDOG_ALLOW_OPEN_INSTANCE: 'true',   // isolate the storage check
        DB_PATH: '/tmp/watchdog-e35.sqlite',
        STORE_PATH: '/tmp/watchdog-e35-store',
        PORT: '0',
      },
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
    });
  } catch (e: any) {
    failed = true;
    output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }

  assert.ok(failed, 'the server must refuse to start, not warn and continue');
  assert.match(output, /would not survive a restart/);
  assert.match(output, /STORE_BACKEND=gcs/, 'and must name the fix');
});
