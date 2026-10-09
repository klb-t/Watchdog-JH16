import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPersonalProviders } from '../../backend/watchdog_api/config/personal_providers';
import { loadAssistantProfile } from '../../backend/watchdog_api/config/assistant';
import { ProfileGenerator } from '../../backend/watchdog_api/llm/profile_generator';
import { OpenAiCompatibleGenerator } from '../../backend/watchdog_api/llm/openai_compatible';
import { SecretHandle } from '../../backend/watchdog_api/secrets';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';

const credential = new SecretHandle('fixture:publishable', 'present', 'Synthetic fixture', 'synthetic-test-credential');
const providers = loadPersonalProviders();

test('WD-003: an empty request preserves the previously valid OpenRouter default body', async () => {
  const profile = providers.providers.find(p => p.id === 'openrouter')!;
  let body: unknown;
  const generator = new ProfileGenerator(profile, credential, async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'Synthetic result' } }] }) };
  }, 'synthetic/model', 1200);
  await generator.generate({ model: 'synthetic/model', prompt: 'Synthetic prompt', params: {} });
  assert.deepEqual(body, { model: 'synthetic/model', messages: [{ role: 'user', content: 'Synthetic prompt' }],
    provider: { allow_fallbacks: false }, plugins: [], max_tokens: 1200, stream: false });
});

test('WD-003: configuration cannot grant envelope overrides and old task packs require explicit migration', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'watchdog-parameter-profile-'));
  try {
    const filename = path.join(dir, 'profile.json');
    const personal = JSON.parse(readFileSync('config/providers/personal.json', 'utf8'));
    const provider = personal.providers.find((p: any) => p.id === 'openrouter');
    provider.requestParameters = { max_tokens: { type: 'integer', minimum: 1 } };
    writeFileSync(filename, JSON.stringify(personal));
    assert.throws(() => loadPersonalProviders(filename), /reserved request envelope/);
    provider.requestParameters = { enabled: { type: 'boolean', minimum: 1 } };
    writeFileSync(filename, JSON.stringify(personal));
    assert.throws(() => loadPersonalProviders(filename), /Boolean parameters/);
    delete provider.requestParameters;
    writeFileSync(filename, JSON.stringify(personal));
    assert.equal(loadPersonalProviders(filename).providers.find(p => p.id === 'openrouter')!.requestParameters, undefined);

    const assistant = JSON.parse(readFileSync('config/assistant.json', 'utf8'));
    assistant.tasks[0].generationParameters = { max_tokens: 1 };
    writeFileSync(filename, JSON.stringify(assistant));
    assert.throws(() => loadAssistantProfile(filename), /reserved request envelope/);
    assistant.schemaVersion = 'assistant-routing-1';
    for (const task of assistant.tasks) delete task.generationParameters;
    writeFileSync(filename, JSON.stringify(assistant));
    assert.throws(() => loadAssistantProfile(filename), /assistant-routing-2/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('WD-003: profile protocols preserve permitted overrides and exact submitted-body evidence', async () => {
  for (const id of ['openrouter', 'openai', 'anthropic']) {
    const profile = providers.providers.find(p => p.id === id)!;
    const params = id === 'anthropic' ? { temperature: 0.25 } : { temperature: 0.25, seed: 42 };
    let body: any;
    const generator = new ProfileGenerator(profile, credential, async (_url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => JSON.stringify(profile.protocol === 'anthropic'
        ? { content: [{ type: 'text', text: 'Synthetic result' }] } : { choices: [{ message: { content: 'Synthetic result' } }] }) };
    }, 'synthetic/model', 123);
    const result = await generator.generate({ model: 'synthetic/model', prompt: 'Synthetic input', system: 'Synthetic system', params });
    assert.equal(body.temperature, 0.25); assert.equal(body.seed, params.seed);
    assert.equal(body[profile.outputParameter], 123); assert.equal(body.stream, false);
    assert.equal(result.generation.requestBodyHash, canonicalHash(body));
    assert.equal(result.generation.parameters.temperature, body.temperature);
    assert.equal(result.generation.credentialRef, credential.ref);
    assert.ok(!JSON.stringify(result.generation).includes('synthetic-test-credential'));
  }
});

test('WD-003: changed capability data permits a typed parameter without changing the adapter', async () => {
  const original = providers.providers.find(p => p.id === 'openrouter')!;
  const profile = { ...original, parameters: { ...original.parameters, temperature: 0.1 },
    requestParameters: { ...original.requestParameters, sample_strength: { type: 'number' as const, minimum: 0, maximum: 1 } } };
  let body: any;
  const generator = new ProfileGenerator(profile, credential, async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'Synthetic result' } }] }) };
  }, 'synthetic/model', 123);
  const request = { model: 'synthetic/model', prompt: 'Synthetic input', params: { sample_strength: 0.5 } };
  const result = await generator.generate(request);
  assert.equal(body.sample_strength, 0.5); assert.equal(body.temperature, 0.1);
  assert.equal(result.generation.sources.temperature, 'provider_profile');
  assert.equal(result.generation.sources.sample_strength, 'request');
  assert.equal(result.generation.providerProfileHash, canonicalHash(profile));
  assert.notEqual(result.generation.providerProfileHash, canonicalHash(original));
  await assert.rejects(() => new ProfileGenerator(original, credential, async () => { throw new Error('unexpected dispatch'); },
    'synthetic/model', 123).generate(request), (error: any) => error.kind === 'invalid_parameters');
});

test('WD-003: invalid, undeclared and route-sensitive fields fail before dispatch', async () => {
  const profile = providers.providers.find(p => p.id === 'openrouter')!;
  let calls = 0;
  const generator = new ProfileGenerator(profile, credential, async () => { calls++; throw new Error('unexpected dispatch'); }, 'synthetic/model', 123);
  const bad: Record<string, unknown>[] = [{ model: 'foreign/model' }, { messages: [] }, { system: 'replacement' }, { prompt: 'replacement' },
    { max_tokens: 999 }, { max_completion_tokens: 999 }, { stream: true }, { tools: [] }, { n: 2 },
    { provider: { allow_fallbacks: true } }, { plugins: [] }, { api_key: 'synthetic-test-credential' },
    { temperature: '0.5' }, { temperature: NaN }, { temperature: Infinity }, { temperature: -0.1 }, { seed: 0.2 },
    { toString: 1 }, { absent_capability: 1 }];
  for (const params of bad) await assert.rejects(() => generator.generate({ model: 'synthetic/model', prompt: 'Synthetic input', params }),
    (error: any) => error.kind === 'invalid_parameters');
  for (const params of [undefined, null, [], ['temperature'], 'temperature', 0, new Date()])
    await assert.rejects(() => generator.generate({ model: 'synthetic/model', prompt: 'Synthetic input', params: params as any }),
      (error: any) => error.kind === 'invalid_parameters');
  const constrained = new ProfileGenerator(profile, credential, async () => { calls++; throw new Error('unexpected dispatch'); },
    'synthetic/model', 123, ['temperature']);
  await assert.rejects(() => constrained.generate({ model: 'synthetic/model', prompt: 'Synthetic input', params: { seed: 1 } }),
    (error: any) => error.kind === 'invalid_parameters');
  const anthropic = providers.providers.find(p => p.id === 'anthropic')!;
  await assert.rejects(() => new ProfileGenerator(anthropic, credential, async () => { calls++; throw new Error('unexpected dispatch'); },
    'synthetic/model', 123).generate({ model: 'synthetic/model', prompt: 'Synthetic input', params: { seed: 1 } }),
    (error: any) => error.kind === 'invalid_parameters');
  assert.equal(calls, 0);
});

test('WD-003: shared OpenAI transport cannot bypass model or input bindings through params', async () => {
  let calls = 0;
  const generator = new OpenAiCompatibleGenerator('fixture', 'https://example.test', credential,
    async () => { calls++; throw new Error('unexpected dispatch'); }, {}, ['synthetic/model']);
  for (const params of [{ model: 'foreign/model' }, { messages: [] }, { system: 'replacement' }, { prompt: 'replacement' }])
    await assert.rejects(() => generator.generate({ model: 'synthetic/model', prompt: 'Original input', params }),
      (error: any) => error.kind === 'invalid_parameters');
  for (const params of [undefined, null, [], 'temperature'])
    await assert.rejects(() => generator.generate({ model: 'synthetic/model', prompt: 'Original input', params: params as any }),
      (error: any) => error.kind === 'invalid_parameters');
  assert.equal(calls, 0);
});
