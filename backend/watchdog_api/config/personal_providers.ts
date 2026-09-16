import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { canonicalHash } from '../domain/canonical';
const Endpoint = z.string().url().refine(s => { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; }, 'A credential-free HTTPS endpoint is required');
const Provider = z.object({ id: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/), label: z.string().min(1),
  endpoint: Endpoint, protocol: z.enum(['openai', 'openrouter', 'anthropic']), catalogUrl: Endpoint.nullable(), catalogAuth: z.boolean(),
  headers: z.record(z.string(), z.string()), outputParameter: z.enum(['max_tokens', 'max_completion_tokens']),
  parameters: z.record(z.string(), z.unknown()), documentation: Endpoint, support: z.literal('text_nonstreaming'), verification: z.string() }).strict();
export function loadPersonalProviders(filename = path.join(process.cwd(), 'config/providers/personal.json')) {
  const value = z.object({ version: z.literal('personal-providers-1'), providers: z.array(Provider).min(1).max(100) }).strict().parse(JSON.parse(readFileSync(filename, 'utf8')));
  if (new Set(value.providers.map(p => p.id)).size !== value.providers.length) throw new Error('Duplicate personal provider profile');
  for (const p of value.providers) {
    if (Object.keys(p.headers).some(k => /authorization|api.?key|cookie|host/i.test(k)) || Object.keys(p.parameters).some(k => ['model','messages','stream','max_tokens','max_completion_tokens','tools'].includes(k))) throw new Error('Profile cannot override credentials or bounded request fields');
    if (p.catalogAuth && p.catalogUrl && new URL(p.catalogUrl).origin !== new URL(p.endpoint).origin) throw new Error('Model discovery cannot send a credential to a different origin');
  }
  return { ...value, contentHash: canonicalHash(value) };
}
export type PersonalProvider = ReturnType<typeof loadPersonalProviders>['providers'][number];
