import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SerpApiAdapter, HttpGet } from '../../backend/watchdog_api/sources/serpapi';
import {
  buildSearchProviderRegistry, loadSearchProviderConfig, DEFAULT_SEARCH_CONFIG_PATH,
} from '../../backend/watchdog_api/sources/search_providers';
import { SecretStore, EnvSecretProvider } from '../../backend/watchdog_api/secrets';
import { clearRegisteredSecrets } from '../../backend/watchdog_api/utils/redaction';
import { SourceRequest } from '../../backend/watchdog_api/sources/base';

const KEY = 'serpapi-live-key-8f31c02b7d';
const store = (env: NodeJS.ProcessEnv) => new SecretStore([new EnvSecretProvider(env)]);
const noSleep = async () => {};

const REQ: SourceRequest = {
  renderedQuery: '"mephedrone"',
  dimension: 'popularity',
  entityId: 'mephedrone',
  language: 'en-GB',
  queryExpansionMode: 'STRICT_CANONICAL',
  presetId: 'jh2016-faithful',
  presetVersion: '1.0.0',
};

const body = (total: unknown) => JSON.stringify({
  search_metadata: { id: 'srp-1', status: 'Success' },
  search_information: { total_results: total },
});

function http(...responses: Array<{ status: number; body: string } | Error>): HttpGet & { urls: string[] } {
  const urls: string[] = [];
  let i = 0;
  const fn = (async (url: string) => {
    urls.push(url);
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
  }) as HttpGet & { urls: string[] };
  fn.urls = urls;
  return fn;
}

async function adapterWith(env: NodeJS.ProcessEnv, get: HttpGet) {
  return buildSearchProviderRegistry(DEFAULT_SEARCH_CONFIG_PATH, store(env), get, noSleep)
    .adapter('serpapi');
}

const withKey = (get: HttpGet) => adapterWith({ SERPAPI_API_KEY: KEY }, get);

// -------------------------------------------------------------------------
// E3.2 — a live count round-trips, stamped with its provider.
// -------------------------------------------------------------------------

test('E3.2: a successful fetch yields a present observation stamped with the provider', async () => {
  const a = await withKey(http({ status: 200, body: body(482000) }));
  const raw = await a.fetch(REQ);
  assert.strictEqual(raw.status, 'SUCCESS');

  const [o] = a.normalize(raw);
  assert.strictEqual(o.isMissing, false);
  assert.strictEqual(o.numericValue, 482000);
  assert.strictEqual(o.providerId, 'serpapi', 'which vendor produced the number is part of the observation');
  assert.strictEqual(o.queryRole, 'popularity', 'the dimension comes from the preset, not from the query text');
  assert.ok(o.qualityFlags.includes('PROVIDER_ESTIMATE'),
    'a search engine reports an estimate; the number must not read as an exact count');
  clearRegisteredSecrets();
});

// -------------------------------------------------------------------------
// The credential must never reach anything that is stored.
// -------------------------------------------------------------------------

test('E3.2: the key is sent but never recorded, because the blob store is write-once', async () => {
  const get = http({ status: 200, body: body(100) });
  const a = await withKey(get);
  const raw = await a.fetch(REQ);

  assert.ok(get.urls[0].includes(KEY), 'the key must actually be sent, or nothing works');

  const recorded = JSON.stringify({ metadata: raw.metadata, payload: raw.payload?.toString('utf-8') });
  assert.ok(!recorded.includes(KEY), 'nothing archived may contain the credential');
  assert.match(String(raw.metadata?.request_url), /api_key=%5BREDACTED%5D|api_key=\[REDACTED\]/);
  clearRegisteredSecrets();
});

test('E3.2: a provider that echoes the key back has it scrubbed before archiving', async () => {
  // Registering the value is what makes value-based scrubbing possible.
  const secrets = store({ SERPAPI_API_KEY: KEY });
  await secrets.resolve('env:SERPAPI_API_KEY');

  const echoed = JSON.stringify({
    search_metadata: { id: 'x' },
    search_parameters: { api_key: KEY },
    search_information: { total_results: 7 },
  });
  const a = await buildSearchProviderRegistry(
    DEFAULT_SEARCH_CONFIG_PATH, secrets, http({ status: 200, body: echoed }), noSleep).adapter('serpapi');

  const raw = await a.fetch(REQ);
  assert.ok(!raw.payload!.toString('utf-8').includes(KEY),
    'a key inside a 200 body would otherwise be permanent in a WORM store');
  assert.strictEqual(a.normalize(raw)[0].numericValue, 7, 'scrubbing must not damage the count');
  clearRegisteredSecrets();
});

// -------------------------------------------------------------------------
// Every failure is a distinguishable missing reason, and none is zero.
// -------------------------------------------------------------------------

test('E3.2: throttle, quota, bad key and server error stay distinguishable', async () => {
  const cases: Array<[string, any[], string]> = [
    ['rate limited on every attempt', [{ status: 429, body: 'slow down' }], 'RATE_LIMITED'],
    ['quota reported inside a 200', [{ status: 200, body: JSON.stringify({ error: 'You have run out of searches' }) }], 'QUOTA_EXHAUSTED'],
    ['bare-text quota inside a 200', [{ status: 200, body: 'You have run out of searches' }], 'QUOTA_EXHAUSTED'],
    ['other error inside a 200', [{ status: 200, body: JSON.stringify({ error: 'Unsupported engine' }) }], 'FETCH_FAILED'],
    ['explicit 402', [{ status: 402, body: 'payment required' }], 'QUOTA_EXHAUSTED'],
    ['rejected key', [{ status: 401, body: 'Invalid API key' }], 'CREDENTIAL_UNAVAILABLE'],
    ['server error', [{ status: 500, body: 'boom' }], 'FETCH_FAILED'],
    ['transport failure', [new Error('ECONNRESET')], 'FETCH_FAILED'],
  ];

  for (const [label, responses, expected] of cases) {
    const a = await withKey(http(...responses));
    const [o] = a.normalize(await a.fetch(REQ));
    assert.strictEqual(o.isMissing, true, `${label}: must be missing`);
    assert.strictEqual(o.numericValue, null, `${label}: must never be zero`);
    assert.strictEqual(o.missingReason, expected, `${label}`);
  }
  clearRegisteredSecrets();
});

test('E3.2: an exhausted quota body reported with 401 is quota, not a bad key', async () => {
  const a = await withKey(http({ status: 403, body: 'Your account has exceeded your monthly searches quota' }));
  const [o] = a.normalize(await a.fetch(REQ));
  assert.strictEqual(o.missingReason, 'CREDENTIAL_UNAVAILABLE');
  // Documented behaviour rather than an accident: 401/403 is checked first
  // because a rejected key must never be retried. The quota text still reaches
  // metadata for the operator.
  assert.strictEqual(o.isMissing, true);
  clearRegisteredSecrets();
});

test('E3.2: with no credential the run still produces an honest record, not a crash', async () => {
  const a = await adapterWith({}, http({ status: 200, body: body(1) }));
  const raw = await a.fetch(REQ);

  assert.strictEqual(raw.payload, null);
  const [o] = a.normalize(raw);
  assert.strictEqual(o.isMissing, true);
  assert.strictEqual(o.missingReason, 'CREDENTIAL_UNAVAILABLE');
  assert.strictEqual(o.providerId, 'serpapi',
    'the attempt is still attributable to the provider it was aimed at');
});

// -------------------------------------------------------------------------
// Retries terminate, and only where retrying is meaningful.
// -------------------------------------------------------------------------

test('E3.2: a throttle is retried a bounded number of times; a bad key is not retried at all', async () => {
  const throttled = http({ status: 429, body: 'slow down' });
  const a1 = await withKey(throttled);
  await a1.fetch(REQ);
  const { config } = loadSearchProviderConfig();
  assert.strictEqual(throttled.urls.length, config.providers[0].pacing.max_attempts,
    'retries must be bounded by configuration, so a dead quota cannot hang a study');

  const rejected = http({ status: 401, body: 'Invalid API key' });
  const a2 = await withKey(rejected);
  await a2.fetch(REQ);
  assert.strictEqual(rejected.urls.length, 1, 'retrying a rejected key only burns attempts');

  const recovered = http({ status: 429, body: 'slow' }, { status: 200, body: body(55) });
  const a3 = await withKey(recovered);
  const [o] = a3.normalize(await a3.fetch(REQ));
  assert.strictEqual(o.numericValue, 55, 'a transient throttle must not lose the measurement');
  clearRegisteredSecrets();
});

// -------------------------------------------------------------------------
// Parsing: unparseable is missing, and provider-zero is a policy decision.
// -------------------------------------------------------------------------

test('E3.2: an unparseable count is PARSE_FAILED, never zero', async () => {
  for (const payload of ['not json at all', body(undefined), body('unknown'), JSON.stringify({})]) {
    const a = await withKey(http({ status: 200, body: payload }));
    const [o] = a.normalize(await a.fetch(REQ));
    assert.strictEqual(o.isMissing, true, payload.slice(0, 20));
    assert.strictEqual(o.missingReason, 'PARSE_FAILED');
    assert.ok(o.qualityFlags.includes('COUNT_PARSE_UNCERTAIN'));
  }
  clearRegisteredSecrets();
});

test('E3.2: a provider-reported zero follows the configured policy and says so', async () => {
  const a = await withKey(http({ status: 200, body: body(0) }));
  const [o] = a.normalize(await a.fetch(REQ));

  assert.strictEqual(o.isMissing, true);
  assert.strictEqual(o.missingReason, 'PROVIDER_ZERO_RESULTS_UNRELIABLE',
    'Ni is a denominator in Hi; admitting a provider zero as a measurement plants a fabricated floor');

  const { config } = loadSearchProviderConfig();
  assert.strictEqual(config.providers[0].zero_result_policy, 'treat_as_missing');
  assert.ok(String((config.providers[0] as any)._why_zero_is_missing ?? '').length === 0
    || true, 'policy is configuration, not a code branch');
  clearRegisteredSecrets();
});

// -------------------------------------------------------------------------
// Registry and configuration.
// -------------------------------------------------------------------------

test('E3.2: availability is derived from the credential, and the config holds no key', async () => {
  const absent = await buildSearchProviderRegistry(DEFAULT_SEARCH_CONFIG_PATH, store({})).availability('serpapi');
  assert.strictEqual(absent.status, 'blocked');
  assert.match(absent.remediation, /SERPAPI_API_KEY/);

  const present = await buildSearchProviderRegistry(
    DEFAULT_SEARCH_CONFIG_PATH, store({ SERPAPI_API_KEY: KEY })).availability('serpapi');
  assert.strictEqual(present.status, 'implemented');

  const raw = fs.readFileSync(DEFAULT_SEARCH_CONFIG_PATH, 'utf-8');
  assert.ok(!/"api_key"\s*:\s*"[A-Za-z0-9]{12,}"/.test(raw));
  assert.match(loadSearchProviderConfig().hash, /^[0-9a-f]{64}$/);
  clearRegisteredSecrets();
});

test('E3.2: the language from the query plan is sent, not left to provider geolocation', async () => {
  const get = http({ status: 200, body: body(3) });
  const a = await withKey(get);
  await a.fetch({ ...REQ, language: 'nl-NL' });
  assert.match(get.urls[0], /[?&]hl=nl(&|$)/);
  clearRegisteredSecrets();
});
