import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  OpenAiCompatibleGenerator, TextGenerationError, HttpPost,
  buildTextGenerationRegistry, loadTextGenerationConfig,
} from '../../backend/watchdog_api/llm';
import { SecretStore, EnvSecretProvider } from '../../backend/watchdog_api/secrets';
import { clearRegisteredSecrets } from '../../backend/watchdog_api/utils/redaction';
import {
  generateNarrative, generateNarrativeWithProvider, assertNoNovelNumbers,
  NarrativeFabricationError, hashNarrativePayload, NarrativePayload,
} from '../../backend/watchdog_api/services/narrative';

const KEY = 'sk-or-v1-test-key-value-0011';
const CFG = path.join(process.cwd(), 'config', 'providers', 'text_generation.json');

const store = (env: NodeJS.ProcessEnv) => new SecretStore([new EnvSecretProvider(env)]);

function respond(status: number, body: unknown): HttpPost {
  return async () => ({
    ok: status >= 200 && status < 300, status,
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const completion = (text: string, extra: Record<string, unknown> = {}) => ({
  id: 'gen-abc123', model: 'anthropic/claude-sonnet-4.5',
  choices: [{ message: { role: 'assistant', content: text } }],
  usage: { prompt_tokens: 120, completion_tokens: 45 },
  ...extra,
});

// -------------------------------------------------------------------------
// E2.1 — availability is derived from credential state, never stored.
// -------------------------------------------------------------------------

test('E2.1: with no key OpenRouter is blocked, and the reason names the fix', async () => {
  const reg = buildTextGenerationRegistry(CFG, store({}), respond(200, completion('x')));
  const a = await reg.availability('openrouter');

  assert.strictEqual(a.status, 'blocked');
  assert.strictEqual(a.credentialStatus, 'absent');
  assert.match(a.remediation, /OPENROUTER_API_KEY/);
  assert.notStrictEqual(a.status, 'implemented');

  await assert.rejects(() => reg.get('openrouter'), (e: any) =>
    e instanceof TextGenerationError && e.kind === 'credential_absent');
});

test('E2.1: adding the key flips it to implemented with no invalidation step', async () => {
  const reg = buildTextGenerationRegistry(CFG, store({ OPENROUTER_API_KEY: KEY }), respond(200, completion('x')));
  const a = await reg.availability('openrouter');

  assert.strictEqual(a.status, 'implemented');
  assert.strictEqual(a.credentialStatus, 'present');
  assert.strictEqual(a.remediation, '');
  assert.strictEqual(a.defaultModel, 'anthropic/claude-sonnet-4.5');
  clearRegisteredSecrets();
});

test('E2.1: derived status publishes into the one gate every run passes through', async () => {
  const { CapabilityRegistry } = await import('../../backend/watchdog_api/sources/provider_registry');
  const capreg = new CapabilityRegistry();
  assert.strictEqual(capreg.isSelectable('openrouter'), false, 'planned by default');

  await buildTextGenerationRegistry(CFG, store({ OPENROUTER_API_KEY: KEY }), respond(200, completion('x')))
    .syncTo(capreg);
  assert.strictEqual(capreg.isSelectable('openrouter'), true);

  await buildTextGenerationRegistry(CFG, store({}), respond(200, completion('x'))).syncTo(capreg);
  assert.strictEqual(capreg.isSelectable('openrouter'), false,
    'removing the key must take the provider back out of service on the next read');
  clearRegisteredSecrets();
});

test('E2.1: the manual OpenAI-compatible provider needs endpoint and model too', async () => {
  const reg = buildTextGenerationRegistry(CFG, store({ LLM_API_KEY: KEY }), respond(200, completion('x')));
  const a = await reg.availability('openai_compatible_manual');
  assert.strictEqual(a.status, 'blocked');
  assert.match(a.remediation, /LLM_ENDPOINT_URL/);

  const ok = await buildTextGenerationRegistry(CFG, store({
    LLM_API_KEY: KEY, LLM_ENDPOINT_URL: 'https://llm.internal/v1/chat/completions', LLM_MODEL: 'local/mixtral',
  }), respond(200, completion('x'))).availability('openai_compatible_manual');
  assert.strictEqual(ok.status, 'implemented');
  clearRegisteredSecrets();
});

// -------------------------------------------------------------------------
// Configuration is configuration (rule 3), and carries no keys.
// -------------------------------------------------------------------------

test('E2.1: the provider config holds pointers, never credentials', () => {
  const { config, hash } = loadTextGenerationConfig(CFG);
  assert.match(hash, /^[0-9a-f]{64}$/);

  const raw = fs.readFileSync(CFG, 'utf-8');
  assert.ok(!/sk-[a-zA-Z0-9]{16,}/.test(raw), 'no literal key may appear in configuration');
  for (const p of config.providers) {
    assert.match(p.secret_ref, /^[a-z][a-z0-9-]*:/);
  }
  // Endpoints and models are data, so changing a model is not a code change.
  assert.ok(config.providers.some(p => (p.allowed_models?.length ?? 0) > 0));
});

// -------------------------------------------------------------------------
// Failure kinds stay distinguishable, and no failure yields prose.
// -------------------------------------------------------------------------

test('E2.1: each upstream failure maps to its own actionable kind', async () => {
  const cred = await store({ OPENROUTER_API_KEY: KEY }).resolve('env:OPENROUTER_API_KEY');
  const gen = (status: number, body: unknown = {}) =>
    new OpenAiCompatibleGenerator('openrouter', 'https://x/y', cred, respond(status, body), {}, []);
  const req = { prompt: 'p', model: 'm', params: {} };

  const kinds: Record<number, string> = {
    401: 'credential_invalid', 403: 'credential_invalid',
    402: 'quota_exhausted', 429: 'rate_limited', 500: 'upstream_error',
  };
  for (const [status, kind] of Object.entries(kinds)) {
    await assert.rejects(() => gen(Number(status)).generate(req),
      (e: any) => e.kind === kind, `HTTP ${status} must map to ${kind}`);
  }

  // 429 and 5xx are retryable operating conditions; 402 is a billing state.
  await assert.rejects(() => gen(429).generate(req), (e: any) => e.retryable === true);
  await assert.rejects(() => gen(402).generate(req), (e: any) => e.retryable === false);

  // A gateway that reports an error inside a 200 must not be read as success.
  await assert.rejects(() => gen(200, { error: { message: 'no such model' } }).generate(req),
    (e: any) => e.kind === 'upstream_error');
  await assert.rejects(() => gen(200, completion('   ')).generate(req),
    (e: any) => e.kind === 'malformed_response');
  clearRegisteredSecrets();
});

test('E2.1: a model outside allowed_models is refused rather than substituted', async () => {
  const cred = await store({ OPENROUTER_API_KEY: KEY }).resolve('env:OPENROUTER_API_KEY');
  const g = new OpenAiCompatibleGenerator('openrouter', 'https://x/y', cred,
    respond(200, completion('x')), {}, ['anthropic/claude-sonnet-4.5']);
  await assert.rejects(() => g.generate({ prompt: 'p', model: 'evil/model', params: {} }),
    (e: any) => e.kind === 'model_not_permitted');
  clearRegisteredSecrets();
});

test('E2.1: the served model is recorded, not the requested one', async () => {
  const cred = await store({ OPENROUTER_API_KEY: KEY }).resolve('env:OPENROUTER_API_KEY');
  const g = new OpenAiCompatibleGenerator('openrouter', 'https://x/y', cred,
    respond(200, completion('hello', { model: 'anthropic/claude-sonnet-4.5-fallback' })), {}, []);
  const r = await g.generate({ prompt: 'p', model: 'anthropic/claude-sonnet-4.5', params: {} });

  assert.strictEqual(r.model, 'anthropic/claude-sonnet-4.5-fallback',
    'OpenRouter reroutes; recording what was asked for would hide the substitution');
  assert.strictEqual(r.upstreamId, 'gen-abc123');
  assert.strictEqual(r.usage.promptTokens, 120);
  assert.strictEqual(r.nondeterministic, true);
  clearRegisteredSecrets();
});

test('E2.1: the API key never appears in the request body or an error', async () => {
  const cred = await store({ OPENROUTER_API_KEY: KEY }).resolve('env:OPENROUTER_API_KEY');
  let seenBody = '', seenAuth = '';
  const post: HttpPost = async (_u, init) => {
    seenBody = init.body; seenAuth = init.headers.Authorization;
    return { ok: false, status: 401, text: async () => `bad key ${KEY}` };
  };
  const g = new OpenAiCompatibleGenerator('openrouter', 'https://x/y', cred, post, {}, []);

  await assert.rejects(() => g.generate({ prompt: 'p', model: 'm', params: {} }), (e: any) => {
    assert.ok(!e.message.includes(KEY), 'the mapped error must not echo the upstream body verbatim');
    return true;
  });
  assert.ok(!seenBody.includes(KEY), 'the key belongs in the header, not the payload');
  assert.strictEqual(seenAuth, `Bearer ${KEY}`);
  clearRegisteredSecrets();
});

// -------------------------------------------------------------------------
// Rule 2 — the numeric guard.
// -------------------------------------------------------------------------

test('E2.1: a number absent from the source is rejected, including a rounded one', () => {
  const src = 'Alcohol scored 15.17 and 3 observations were missing.';

  assert.doesNotThrow(() => assertNoNovelNumbers('Alcohol reached 15.17; 3 were missing.', src, 'p'));
  assert.doesNotThrow(() => assertNoNovelNumbers('No figures here at all.', src, 'p'));
  // Formatting differences are not fabrication.
  assert.doesNotThrow(() => assertNoNovelNumbers('The value 15.170 was recorded.',
    'The value 15.17 was recorded.', 'p'));

  assert.throws(() => assertNoNovelNumbers('Alcohol scored 15.2.', src, 'p'), NarrativeFabricationError,
    'rounding is a silent precision change, not a paraphrase');
  assert.throws(() => assertNoNovelNumbers('Cannabis scored 42.', src, 'p'), NarrativeFabricationError);
  assert.throws(() => assertNoNovelNumbers('A total of 18.17 across both.', src, 'p'), NarrativeFabricationError,
    'a computed total is a number the model produced');
});

const payload: NarrativePayload = {
  presetId: 'jh2016-faithful',
  results: [
    { metricKey: 'Pi', entityId: 'alcohol', valueNumeric: 100, unit: '%' },
    { metricKey: 'Pi', entityId: 'cannabis', valueNumeric: 15.17, unit: '%' },
    { metricKey: 'Hi', entityId: 'alcohol', valueNumeric: 2.5, unit: '%' },
  ],
  missingCount: 1,
  qualityFlags: ['PROVIDER_ESTIMATE'],
};

test('E2.1: a provider narrative is PROPOSED, marked generated and marked nondeterministic', async () => {
  const cred = await store({ OPENROUTER_API_KEY: KEY }).resolve('env:OPENROUTER_API_KEY');
  const deterministic = generateNarrative({
    runId: 'r1', payload, payloadHash: hashNarrativePayload(payload),
    templateId: 't', templateVersion: '1', providerId: null, model: null,
  });

  const g = new OpenAiCompatibleGenerator('openrouter', 'https://x/y', cred,
    respond(200, completion(deterministic.content.replace('Methodological', 'The methodological'))), {}, []);

  const n = await generateNarrativeWithProvider({
    runId: 'r1', payload, payloadHash: hashNarrativePayload(payload),
    templateId: 't', templateVersion: '1', providerId: 'openrouter',
    model: 'anthropic/claude-sonnet-4.5', generator: g, generationParams: { temperature: 0 },
  });

  assert.strictEqual(n.approvalState, 'PROPOSED', 'nothing in the generation path may approve');
  assert.strictEqual(n.generated, true);
  assert.strictEqual(n.nondeterministicContent, true,
    "rule 7's byte-identical guarantee must never be claimed for sampled prose");
  assert.strictEqual(n.providerId, 'openrouter');
  assert.strictEqual(n.upstreamId, 'gen-abc123');
  assert.notStrictEqual(n.contentHash, deterministic.contentHash);
  clearRegisteredSecrets();
});

test('E2.1: a fabricating provider is rejected outright, not footnoted', async () => {
  const cred = await store({ OPENROUTER_API_KEY: KEY }).resolve('env:OPENROUTER_API_KEY');
  const g = new OpenAiCompatibleGenerator('openrouter', 'https://x/y', cred,
    respond(200, completion('Alcohol led with 99.4% and cannabis followed at 15.17%.')), {}, []);

  await assert.rejects(() => generateNarrativeWithProvider({
    runId: 'r1', payload, payloadHash: hashNarrativePayload(payload),
    templateId: 't', templateVersion: '1', providerId: 'openrouter',
    model: 'anthropic/claude-sonnet-4.5', generator: g,
  }), NarrativeFabricationError);
  clearRegisteredSecrets();
});

test('E2.1: a provider failure throws rather than silently serving template prose', async () => {
  const cred = await store({ OPENROUTER_API_KEY: KEY }).resolve('env:OPENROUTER_API_KEY');
  const g = new OpenAiCompatibleGenerator('openrouter', 'https://x/y', cred, respond(429, {}), {}, []);

  await assert.rejects(() => generateNarrativeWithProvider({
    runId: 'r1', payload, payloadHash: hashNarrativePayload(payload),
    templateId: 't', templateVersion: '1', providerId: 'openrouter',
    model: 'anthropic/claude-sonnet-4.5', generator: g,
  }), (e: any) => e.kind === 'rate_limited',
    'falling back to the template would be a silent provider substitution under rule 4');
  clearRegisteredSecrets();
});
