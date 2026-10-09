import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { canonicalHash } from '../domain/canonical';
const Endpoint = z.string().url().refine(s => { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; }, 'A credential-free HTTPS endpoint is required');
const ParameterRule = z.object({ type: z.enum(['number', 'integer', 'boolean']),
  minimum: z.number().finite().optional(), maximum: z.number().finite().optional() }).strict()
  .refine(v => v.minimum === undefined || v.maximum === undefined || v.minimum <= v.maximum, 'Invalid parameter bounds')
  .refine(v => v.type !== 'boolean' || (v.minimum === undefined && v.maximum === undefined), 'Boolean parameters cannot have numeric bounds');
// Transport envelope and admission fields are controlled by the caller's
// route/reservation, never by an arbitrary generation-parameter override.
export const reservedGenerationParameters = new Set(['model', 'messages', 'system', 'prompt', 'stream',
  'max_tokens', 'max_completion_tokens', 'n', 'tools', 'tool_choice', 'parallel_tool_calls', 'functions',
  'function_call', 'provider', 'plugins', 'api_key', 'authorization', 'headers', 'endpoint', '__proto__', 'constructor', 'prototype']);
const Provider = z.object({ id: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/), label: z.string().min(1),
  endpoint: Endpoint, protocol: z.enum(['openai', 'openrouter', 'anthropic']), catalogUrl: Endpoint.nullable(), catalogAuth: z.boolean(),
  headers: z.record(z.string(), z.string()), outputParameter: z.enum(['max_tokens', 'max_completion_tokens']),
  parameters: z.record(z.string(), z.unknown()), requestParameters: z.record(z.string(), ParameterRule).optional(),
  documentation: Endpoint, support: z.literal('text_nonstreaming'), verification: z.string() }).strict();
export function loadPersonalProviders(filename = path.join(process.cwd(), 'config/providers/personal.json')) {
  const value = z.object({ version: z.literal('personal-providers-1'), providers: z.array(Provider).min(1).max(100) }).strict().parse(JSON.parse(readFileSync(filename, 'utf8')));
  if (new Set(value.providers.map(p => p.id)).size !== value.providers.length) throw new Error('Duplicate personal provider profile');
  for (const p of value.providers) {
    if (Object.keys(p.headers).some(k => /authorization|api.?key|cookie|host/i.test(k)) || Object.keys(p.parameters).some(k =>
      reservedGenerationParameters.has(k) && k !== 'provider' && k !== 'plugins')) throw new Error('Profile cannot override credentials or bounded request fields');
    if (Object.keys(p.requestParameters ?? {}).some(k => reservedGenerationParameters.has(k))) throw new Error('Parameter capability cannot override the reserved request envelope');
    if (p.catalogAuth && p.catalogUrl && new URL(p.catalogUrl).origin !== new URL(p.endpoint).origin) throw new Error('Model discovery cannot send a credential to a different origin');
  }
  return { ...value, contentHash: canonicalHash(value) };
}
export type PersonalProvider = ReturnType<typeof loadPersonalProviders>['providers'][number];
