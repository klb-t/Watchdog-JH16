import { test, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { buildSearchProviderRegistry } from '../../backend/watchdog_api/sources/search_providers';
import { buildTextGenerationRegistry } from '../../backend/watchdog_api/llm';
import { SecretStore, EnvSecretProvider } from '../../backend/watchdog_api/secrets';
import { clearRegisteredSecrets } from '../../backend/watchdog_api/utils/redaction';
import { detectDiscontinuities } from '../../backend/watchdog_api/services/discontinuity';
import {
  generateNarrativeWithProvider, hashNarrativePayload, NarrativePayload,
} from '../../backend/watchdog_api/services/narrative';
import { SourceRequest, Observation } from '../../backend/watchdog_api/sources/base';

/**
 * The credentialled path, end to end, against stub providers on localhost.
 *
 * Every other test for E2.1 and E3.2 stubs the transport function. This one
 * stubs the *server*: real sockets, real HTTP, the adapters' own `fetch`, the
 * real configuration loader reading a real file. What separates this from a
 * live run is the value of two environment variables and the hostname they
 * point at — which is the claim the maintainer needs to be able to trust
 * before spending money on keys.
 */

const KEY_SERP = 'serpapi-test-key-4c1f9a';
const KEY_LLM = 'sk-or-v1-test-2b7e40';

let server: http.Server;
let baseUrl: string;
let configDir: string;
let seenAuthHeaders: string[] = [];
let seenUrls: string[] = [];

const COUNTS: Record<string, number> = {
  '"alcohol"': 1_240_000,
  '"alcohol" "harm" OR "harmful"': 62_000,
  '"cannabis"': 880_000,
  '"cannabis" "harm" OR "harmful"': 31_500,
};

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    seenUrls.push(req.url!);
    if (req.headers.authorization) seenAuthHeaders.push(String(req.headers.authorization));

    if (url.pathname === '/serpapi/search.json') {
      if (url.searchParams.get('api_key') !== KEY_SERP) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid API key' }));
      }
      const q = url.searchParams.get('q') ?? '';
      const total = COUNTS[q];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        search_metadata: { id: `srp-${Buffer.from(q).toString('hex').slice(0, 8)}`, status: 'Success' },
        search_parameters: { q, engine: 'google' },
        search_information: total === undefined ? {} : { total_results: total },
      }));
    }

    if (url.pathname === '/llm/chat/completions') {
      if (req.headers.authorization !== `Bearer ${KEY_LLM}`) {
        res.writeHead(401); return res.end('{"error":"bad key"}');
      }
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        const prompt: string = parsed.messages.at(-1).content;
        const source = prompt.split('\n\n').slice(1).join('\n\n');
        // A faithful rewrite: reorders words, invents no figure.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'gen-live-1', model: parsed.model,
          choices: [{ message: { role: 'assistant', content: `In summary: ${source}` } }],
          usage: { prompt_tokens: 210, completion_tokens: 88 },
        }));
      });
      return;
    }

    res.writeHead(404); res.end('{}');
  });

  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;

  // A real configuration file, loaded by the real loader, pointing at the stub.
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-live-'));
  fs.writeFileSync(path.join(configDir, 'search.json'), JSON.stringify({
    schema_version: '1.0.0', capability: 'search.result_count',
    providers: [{
      provider_key: 'serpapi', display_name: 'SerpApi (stub)',
      endpoint: `${baseUrl}/serpapi/search.json`, secret_ref: 'env:SERPAPI_API_KEY',
      engine: 'google', api_key_param: 'api_key',
      count_path: 'search_information.total_results',
      zero_result_policy: 'treat_as_missing',
      request_params: { num: 10, safe: 'off' },
      pacing: { min_interval_ms: 0, max_attempts: 3, backoff_ms: [1, 1] },
    }],
  }));
  fs.writeFileSync(path.join(configDir, 'text.json'), JSON.stringify({
    schema_version: '1.0.0', capability: 'text.generate',
    providers: [{
      provider_key: 'openrouter', display_name: 'OpenRouter (stub)',
      endpoint: `${baseUrl}/llm/chat/completions`, secret_ref: 'env:OPENROUTER_API_KEY',
      default_model: 'anthropic/claude-sonnet-4.5',
      allowed_models: ['anthropic/claude-sonnet-4.5'],
      generation_params: { temperature: 0, max_tokens: 800 },
    }],
  }));
});

after(async () => {
  await new Promise<void>(r => server.close(() => r()));
  fs.rmSync(configDir, { recursive: true, force: true });
  clearRegisteredSecrets();
});

const secrets = () => new SecretStore([new EnvSecretProvider({
  SERPAPI_API_KEY: KEY_SERP, OPENROUTER_API_KEY: KEY_LLM,
})]);

const request = (entityId: string, dimension: string, q: string): SourceRequest => ({
  renderedQuery: q, dimension, entityId, language: 'en-GB',
  queryExpansionMode: 'STRICT_CANONICAL', presetId: 'jh2016-faithful', presetVersion: '1.0.0',
});

// -------------------------------------------------------------------------

test('Live path: with a key present, acquisition flips to ready and collects real counts', async () => {
  const registry = buildSearchProviderRegistry(path.join(configDir, 'search.json'), secrets());

  const availability = await registry.availability('serpapi');
  assert.strictEqual(availability.status, 'implemented');
  assert.strictEqual(availability.remediation, '', 'nothing left to fix');

  const adapter = await registry.adapter('serpapi');
  const observations: Observation[] = [];

  for (const [entity, [pop, harm]] of Object.entries({
    alcohol: ['"alcohol"', '"alcohol" "harm" OR "harmful"'],
    cannabis: ['"cannabis"', '"cannabis" "harm" OR "harmful"'],
  })) {
    observations.push(...adapter.normalize(await adapter.fetch(request(entity, 'popularity', pop))));
    observations.push(...adapter.normalize(await adapter.fetch(request(entity, 'harm', harm))));
  }

  assert.strictEqual(observations.length, 4);
  assert.ok(observations.every(o => !o.isMissing), 'every query resolved over real HTTP');

  const byQuery = Object.fromEntries(observations.map(o => [o.queryText, o]));
  assert.strictEqual(byQuery['"alcohol"'].numericValue, 1_240_000);
  assert.strictEqual(byQuery['"cannabis"'].numericValue, 880_000);

  // Provenance survives the round trip.
  for (const o of observations) {
    assert.strictEqual(o.providerId, 'serpapi');
    assert.strictEqual(o.language, 'en-GB');
    assert.ok(o.qualityFlags.includes('PROVIDER_ESTIMATE'));
  }

  // And the JH2016 arithmetic works on live-shaped input: Pi = Ni/max(Ni)×100.
  const pop = observations.filter(o => o.queryRole === 'popularity' && !o.isMissing);
  const max = Math.max(...pop.map(o => o.numericValue as number));
  const pi = Object.fromEntries(pop.map(o => [o.entityId, ((o.numericValue as number) / max) * 100]));
  assert.strictEqual(pi.alcohol, 100);
  assert.ok(Math.abs(pi.cannabis - 70.967) < 0.01);
});

test('Live path: the key reaches the provider and nothing else', async () => {
  seenUrls = [];
  const adapter = await buildSearchProviderRegistry(path.join(configDir, 'search.json'), secrets())
    .adapter('serpapi');

  const raw = await adapter.fetch(request('alcohol', 'popularity', '"alcohol"'));

  // It was genuinely sent — otherwise the stub would have answered 401.
  assert.ok(seenUrls.some(u => u.includes(KEY_SERP)));
  assert.strictEqual(raw.status, 'SUCCESS');

  // And it is absent from everything that gets archived or logged.
  const archived = JSON.stringify({ metadata: raw.metadata, payload: raw.payload?.toString('utf-8') });
  assert.ok(!archived.includes(KEY_SERP), 'the WORM store would make a leaked key permanent');
});

test('Live path: a wrong key is reported as a credential problem, not as data', async () => {
  const wrong = new SecretStore([new EnvSecretProvider({ SERPAPI_API_KEY: 'not-the-key' })]);
  const adapter = await buildSearchProviderRegistry(path.join(configDir, 'search.json'), wrong)
    .adapter('serpapi');

  const [o] = adapter.normalize(await adapter.fetch(request('alcohol', 'popularity', '"alcohol"')));
  assert.strictEqual(o.isMissing, true);
  assert.strictEqual(o.missingReason, 'CREDENTIAL_UNAVAILABLE');
  assert.strictEqual(o.numericValue, null, 'a rejected key must never become a zero');
  clearRegisteredSecrets();
});

test('Live path: an unanswerable query is missing, and the rest of the run survives it', async () => {
  const adapter = await buildSearchProviderRegistry(path.join(configDir, 'search.json'), secrets())
    .adapter('serpapi');

  const unknown = adapter.normalize(await adapter.fetch(request('mephedrone', 'popularity', '"mephedrone"')));
  assert.strictEqual(unknown[0].isMissing, true);
  assert.strictEqual(unknown[0].missingReason, 'PARSE_FAILED');

  const known = adapter.normalize(await adapter.fetch(request('alcohol', 'popularity', '"alcohol"')));
  assert.strictEqual(known[0].numericValue, 1_240_000, 'one missing query must not poison the run');
});

test('Live path: two providers in one series raise a discontinuity on live data', async () => {
  const adapter = await buildSearchProviderRegistry(path.join(configDir, 'search.json'), secrets())
    .adapter('serpapi');

  const first = adapter.normalize(await adapter.fetch(request('alcohol', 'popularity', '"alcohol"')));
  const second = adapter.normalize(await adapter.fetch(request('alcohol', 'popularity', '"alcohol"')));

  // The second point served by a different vendor — the mid-study swap.
  const swapped = { ...second[0], providerId: 'serper', retrievedAt: '2099-01-01T00:00:00.000Z' } as Observation;
  const report = detectDiscontinuities([
    { ...first[0], seriesId: 'ni-alcohol' } as Observation,
    { ...swapped, seriesId: 'ni-alcohol' } as Observation,
  ]);

  assert.deepStrictEqual(report.flags, ['PROVIDER_DISCONTINUITY']);
  assert.strictEqual(report.records[0].from, 'serpapi');
  assert.strictEqual(report.records[0].to, 'serper');
});

test('Live path: a real HTTP language model produces a PROPOSED narrative and invents no number', async () => {
  seenAuthHeaders = [];
  const registry = buildTextGenerationRegistry(path.join(configDir, 'text.json'), secrets());
  assert.strictEqual((await registry.availability('openrouter')).status, 'implemented');

  const payload: NarrativePayload = {
    presetId: 'jh2016-faithful',
    results: [
      { metricKey: 'Pi', entityId: 'alcohol', valueNumeric: 100, unit: '%' },
      { metricKey: 'Pi', entityId: 'cannabis', valueNumeric: 70.97, unit: '%' },
      { metricKey: 'Hi', entityId: 'alcohol', valueNumeric: 5, unit: '%' },
    ],
    missingCount: 1,
    qualityFlags: ['PROVIDER_ESTIMATE'],
  };

  const narrative = await generateNarrativeWithProvider({
    runId: 'live-run-1', payload, payloadHash: hashNarrativePayload(payload),
    templateId: 'jh2016-summary', templateVersion: '1.0',
    providerId: 'openrouter', model: 'anthropic/claude-sonnet-4.5',
    generationParams: await registry.defaultParams('openrouter'),
    generator: await registry.get('openrouter'),
  });

  assert.strictEqual(narrative.approvalState, 'PROPOSED', 'a model can never approve its own output');
  assert.strictEqual(narrative.nondeterministicContent, true);
  assert.strictEqual(narrative.upstreamId, 'gen-live-1');
  assert.strictEqual(narrative.usage!.promptTokens, 210);
  assert.match(narrative.content, /^In summary:/);

  // Sent as a header over the wire, never in the body.
  assert.deepStrictEqual([...new Set(seenAuthHeaders)], [`Bearer ${KEY_LLM}`]);
  clearRegisteredSecrets();
});

test('Live path: a model that invents a figure is rejected over real HTTP too', async () => {
  // The stub echoes the prompt back with a prefix; give it a payload whose
  // deterministic summary the prefix will not match, by asking for a model
  // response that adds a number. Simulated by a payload the stub mangles.
  const registry = buildTextGenerationRegistry(path.join(configDir, 'text.json'), secrets());
  const generator = await registry.get('openrouter');

  const fabricating = {
    ...generator,
    generate: async (r: any) => ({
      ...(await generator.generate(r)),
      text: 'Alcohol reached 99.4% and one observation was missing.',
    }),
  };

  const payload: NarrativePayload = {
    presetId: 'p', results: [{ metricKey: 'Pi', entityId: 'alcohol', valueNumeric: 100, unit: '%' }],
    missingCount: 1, qualityFlags: [],
  };

  await assert.rejects(() => generateNarrativeWithProvider({
    runId: 'r', payload, payloadHash: hashNarrativePayload(payload),
    templateId: 't', templateVersion: '1', providerId: 'openrouter',
    model: 'anthropic/claude-sonnet-4.5', generator: fabricating as any,
  }), /do not appear in the frozen payload/);
  clearRegisteredSecrets();
});
