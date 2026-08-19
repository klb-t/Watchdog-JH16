import { test } from 'node:test';
import * as assert from 'node:assert';
import { inspect } from 'node:util';
import {
  SecretStore, EnvSecretProvider, GcpSecretManagerProvider, SecretHandle,
  CredentialUnavailableError, MalformedSecretRefError, HttpTransport,
} from '../../backend/watchdog_api/secrets';
import {
  redact, clearRegisteredSecrets, registeredSecretCount, REDACTED,
} from '../../backend/watchdog_api/utils/redaction';

const CANARY = 'sk-or-v1-CANARY-9f2b7c14d0e3';

const envStore = (env: NodeJS.ProcessEnv) => new SecretStore([new EnvSecretProvider(env)]);

// -------------------------------------------------------------------------
// E3.1 — absent, invalid and present are three different states.
// -------------------------------------------------------------------------

test('E3.1: an unset variable is absent, and absent never yields a usable value', async () => {
  const h = await envStore({}).resolve('env:OPENROUTER_API_KEY');
  assert.strictEqual(h.status, 'absent');
  assert.strictEqual(h.isPresent, false);
  assert.throws(() => h.use(v => v), CredentialUnavailableError,
    'an absent credential must throw, not hand back an empty string that reads as configured');
});

test('E3.1: a set-but-empty variable is invalid, not absent', async () => {
  const h = await envStore({ OPENROUTER_API_KEY: '   ' }).resolve('env:OPENROUTER_API_KEY');
  assert.strictEqual(h.status, 'invalid');
  assert.match(h.detail, /set but empty/);
  assert.notStrictEqual(h.status, 'absent',
    'collapsing these two sends the operator looking in the wrong place');
});

test('E3.1: a present credential is reachable only inside use()', async () => {
  const h = await envStore({ OPENROUTER_API_KEY: CANARY }).resolve('env:OPENROUTER_API_KEY');
  assert.strictEqual(h.status, 'present');
  assert.strictEqual(h.use(v => v), CANARY);
});

// -------------------------------------------------------------------------
// The value must be structurally unreachable, not merely undocumented.
// -------------------------------------------------------------------------

test('E3.1: a handle cannot leak its value through serialisation or enumeration', async () => {
  const h = await envStore({ OPENROUTER_API_KEY: CANARY }).resolve('env:OPENROUTER_API_KEY');

  // The realistic accident: a handle ends up on an API response or in a log line.
  assert.ok(!JSON.stringify(h).includes(CANARY), 'JSON.stringify must not reach the value');
  assert.ok(!JSON.stringify({ credential: h }).includes(CANARY));
  assert.ok(!Object.values(h).some(v => v === CANARY));
  assert.ok(!Object.keys(h).includes('value'));
  assert.ok(!JSON.stringify({ ...h }).includes(CANARY), 'spread must not carry the value');
  assert.ok(!inspect(h).includes(CANARY), 'console.log must not print it');

  assert.deepStrictEqual(Object.keys(h.describe()).sort(), ['detail', 'ref', 'status']);
});

test('E3.1: resolving registers the value with the redactor, so it is scrubbed by value', async () => {
  clearRegisteredSecrets();
  const before = registeredSecretCount();

  await envStore({ OPENROUTER_API_KEY: CANARY }).resolve('env:OPENROUTER_API_KEY');
  assert.strictEqual(registeredSecretCount(), before + 1);

  // The case key-based redaction misses entirely: no credential-shaped key,
  // just an upstream error that interpolated the key into free text.
  const upstream = { message: `401 Unauthorized for key ${CANARY}`, path: '/api/v1/chat' };
  const scrubbed = redact(upstream);
  assert.ok(!JSON.stringify(scrubbed).includes(CANARY));
  assert.ok(scrubbed.message.includes(REDACTED));

  clearRegisteredSecrets();
});

test('E3.1: an absent credential registers nothing', async () => {
  clearRegisteredSecrets();
  await envStore({}).resolve('env:NOPE');
  assert.strictEqual(registeredSecretCount(), 0);
});

// -------------------------------------------------------------------------
// Malformed refs fail loudly.
// -------------------------------------------------------------------------

test('E3.1: a malformed or unknown secret_ref throws rather than resolving to absent', async () => {
  const s = envStore({});
  await assert.rejects(() => s.resolve('OPENROUTER_API_KEY'), MalformedSecretRefError,
    'a ref with no scheme is a bug in configuration, not a missing credential');
  await assert.rejects(() => s.resolve('vault:secret/x'), MalformedSecretRefError);
  await assert.rejects(() => s.resolve('env:not-an-env-name'), MalformedSecretRefError);
});

test('E3.1: the handle constructor refuses an inconsistent state', () => {
  assert.throws(() => new SecretHandle('env:X', 'present', '', null));
  assert.throws(() => new SecretHandle('env:X', 'absent', '', 'a-value'));
});

// -------------------------------------------------------------------------
// GCP Secret Manager, over a stubbed transport — no network in tests.
// -------------------------------------------------------------------------

function gcpTransport(routes: Record<string, { status: number; body: string }>): HttpTransport {
  return async (url) => {
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    const r = hit ? hit[1] : { status: 404, body: '{}' };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
  };
}

const gcpStore = (t: HttpTransport) => new SecretStore([
  new GcpSecretManagerProvider(t, 'http://metadata.test/token', 'https://sm.test/v1'),
]);
const REF = 'gcp-sm:projects/p/secrets/openrouter/versions/latest';

test('E3.1: a Secret Manager version resolves and its value is registered, not exposed', async () => {
  clearRegisteredSecrets();
  const t = gcpTransport({
    'metadata.test': { status: 200, body: JSON.stringify({ access_token: 'ya29.test-token-value' }) },
    ':access': { status: 200, body: JSON.stringify({ payload: { data: Buffer.from(CANARY).toString('base64') } }) },
  });

  const h = await gcpStore(t).resolve(REF);
  assert.strictEqual(h.status, 'present');
  assert.strictEqual(h.use(v => v), CANARY);
  assert.ok(!JSON.stringify(h).includes(CANARY));

  // The access token is a credential too, and is scrubbed on the same terms.
  assert.ok(!JSON.stringify(redact({ msg: 'token ya29.test-token-value used' })).includes('ya29.test-token-value'));
  clearRegisteredSecrets();
});

test('E3.1: Secret Manager failures map to distinguishable states, never to a value', async () => {
  const token = { status: 200, body: JSON.stringify({ access_token: 'ya29.t-value-here' }) };

  const missing = await gcpStore(gcpTransport({ 'metadata.test': token, ':access': { status: 404, body: '{}' } })).resolve(REF);
  assert.strictEqual(missing.status, 'absent');

  const denied = await gcpStore(gcpTransport({ 'metadata.test': token, ':access': { status: 403, body: '{}' } })).resolve(REF);
  assert.strictEqual(denied.status, 'invalid', 'permission denied is not the same as no secret');

  const empty = await gcpStore(gcpTransport({
    'metadata.test': token,
    ':access': { status: 200, body: JSON.stringify({ payload: { data: Buffer.from('  ').toString('base64') } }) },
  })).resolve(REF);
  assert.strictEqual(empty.status, 'invalid');

  // Off GCP there is no metadata server; the message must say what to do.
  await assert.rejects(
    () => gcpStore(gcpTransport({ ':access': token })).resolve(REF),
    (e: any) => /metadata server returned/.test(e.message) && /env:/.test(e.message),
  );
});

test('E3.1: resolution is cached, so one run does not re-read a secret per query', async () => {
  let reads = 0;
  const t: HttpTransport = async (url) => {
    if (url.includes(':access')) reads++;
    return {
      ok: true, status: 200,
      text: async () => url.includes('metadata')
        ? JSON.stringify({ access_token: 'ya29.t-value-here' })
        : JSON.stringify({ payload: { data: Buffer.from(CANARY).toString('base64') } }),
    };
  };
  const s = gcpStore(t);
  await s.resolve(REF); await s.resolve(REF); await s.resolve(REF);
  assert.strictEqual(reads, 1, '32 queries must not mean 32 Secret Manager reads');

  s.clearCache();
  await s.resolve(REF);
  assert.strictEqual(reads, 2);
  clearRegisteredSecrets();
});
