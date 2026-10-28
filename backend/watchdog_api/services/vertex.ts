import { registerSecretValue } from '../utils/redaction';

/**
 * One Vertex AI generateContent call with the VM's service account (metadata
 * token). Shared by optional language features (manuscript editing, request
 * reading); every caller verifies the reply itself and treats it as a proposal.
 */

export type Transport = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
export interface VertexProvider { kind: string; model: string; location: string; project: string; metadata_base: string; generation: Record<string, unknown>; timeout_ms: number }

async function metadata(base: string, p: string, transport: Transport) {
  const r = await transport(`${base}/${p}`, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`metadata ${p}: HTTP ${r.status}`);
  return r.text();
}

export async function vertexGenerate(p: VertexProvider, instruction: string, userText: string, transport: Transport) {
  if (p.kind !== 'vertex') throw new Error(`Unsupported provider '${p.kind}'`);
  const tokenBody = JSON.parse(await metadata(p.metadata_base, 'instance/service-accounts/default/token', transport));
  const token = tokenBody.access_token as string; registerSecretValue(token);
  const project = p.project === 'from_metadata' ? (await metadata(p.metadata_base, 'project/project-id', transport)).trim() : p.project;
  const host = p.location === 'global' ? 'aiplatform.googleapis.com' : `${p.location}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${project}/locations/${p.location}/publishers/google/models/${p.model}:generateContent`;
  const body = { systemInstruction: { parts: [{ text: instruction }] }, contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { ...p.generation, responseMimeType: 'application/json' } };
  const res = await transport(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(p.timeout_ms) });
  const raw = await res.text();
  if (!res.ok) throw Object.assign(new Error(`Vertex returned HTTP ${res.status}: ${raw.slice(0, 300)}`), { status: 502 });
  const d = JSON.parse(raw);
  return { text: d.candidates?.[0]?.content?.parts?.map((x: any) => x.text ?? '').join('') ?? '',
    usage: { input_tokens: d.usageMetadata?.promptTokenCount ?? 0, output_tokens: (d.usageMetadata?.candidatesTokenCount ?? 0) + (d.usageMetadata?.thoughtsTokenCount ?? 0) } };
}
