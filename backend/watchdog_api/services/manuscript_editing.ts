import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalHash } from '../domain/canonical';
import type { Manuscript } from './replication_dossier';
import { registerSecretValue } from '../utils/redaction';

/**
 * Optional language editing of a manuscript by a model (Vertex AI by default).
 *
 * Only sentences and list items are sent; tables are never sent and never
 * change. Each edited unit must keep exactly the same protected tokens —
 * numbers, percentages, run identifiers, hashes, DOIs, dates, quoted strings —
 * as its original, or the original is kept and the rejection is recorded.
 * The block's sources are copied from the original, so every sentence keeps
 * its link to the data. The result is a separate, write-once edition.
 */

export function readEditingSettings(root = process.cwd()) {
  const settings = JSON.parse(fs.readFileSync(path.join(root, 'config/manuscript/editing.json'), 'utf8'));
  return { settings, hash: canonicalHash(settings) };
}

export type Transport = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Tokens that carry facts. Order-insensitive multiset; whitespace and punctuation around them may change. */
export function protectedTokens(text: string): string[] {
  const t = text.normalize('NFC');
  const patterns = [
    /10\.\d{4,9}\/[^\s,;)]+/g,                      // DOI
    /\b[0-9a-f]{7,64}\b/gi,                         // run ids, commits, hashes
    /\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/g,            // dates and timestamps
    /[-−]?\d+(?:[.,]\d+)*(?:e[-+]?\d+)?\s?%?/gi,   // numbers, decimals, exponents, percentages
    /[„"“][^„"”“]{1,80}[”"]/g,                      // quoted strings (queries)
  ];
  const found: string[] = []; let rest = t;
  for (const re of patterns) rest = rest.replace(re, m => { found.push(m.replace(/\s/g, '').replace('−', '-').replace(/[„“”]/g, '"').toLowerCase()); return ' '; });
  return found.sort();
}

export interface EditUnit { id: string; section: string; original: string; edited: string; status: 'edited' | 'unchanged' | 'rejected'; reason?: string }
export interface Edition { id: string; target_id: string; manuscript_input_hash: string; provider: string; model: string; settings_hash: string; created_at: string;
  usage: { input_tokens: number; output_tokens: number }; estimated_cost_usd: number; units: EditUnit[] }

function units(m: Manuscript): { id: string; section: string; text: string }[] {
  const out: { id: string; section: string; text: string }[] = [];
  for (const s of m.sections) s.blocks.forEach((b, i) => {
    if (b.type === 'p') out.push({ id: `${s.id}.${i}`, section: s.id, text: b.text });
    if (b.type === 'list') b.items.forEach((item, j) => out.push({ id: `${s.id}.${i}.${j}`, section: s.id, text: item }));
  });
  return out;
}

export function verifyUnit(original: string, edited: unknown): { ok: boolean; reason?: string } {
  if (typeof edited !== 'string' || !edited.trim()) return { ok: false, reason: 'no text returned' };
  if (edited.length > original.length * 2 + 200) return { ok: false, reason: 'edited text is far longer than the original' };
  const a = protectedTokens(original), b = protectedTokens(edited);
  if (a.join('\u0000') !== b.join('\u0000')) {
    const missing = a.filter(x => !b.includes(x)), added = b.filter(x => !a.includes(x));
    return { ok: false, reason: `protected tokens changed${missing.length ? `; missing: ${missing.join(' ')}` : ''}${added.length ? `; added: ${added.join(' ')}` : ''}` };
  }
  return { ok: true };
}

/** Applies an edition to a manuscript: only accepted units change; tables and sources stay as they are. */
export function applyEdition(m: Manuscript, e: Edition): Manuscript & { edition: { id: string; model: string; edited: number; rejected: number } } {
  const byId = new Map(e.units.filter(u => u.status === 'edited').map(u => [u.id, u.edited]));
  return { ...m, sections: m.sections.map(s => ({ ...s, blocks: s.blocks.map((b, i) => b.type === 'p' ? { ...b, text: byId.get(`${s.id}.${i}`) ?? b.text }
      : b.type === 'list' ? { ...b, items: b.items.map((x, j) => byId.get(`${s.id}.${i}.${j}`) ?? x) } : b) })),
    edition: { id: e.id, model: `${e.provider}:${e.model}`, edited: e.units.filter(u => u.status === 'edited').length, rejected: e.units.filter(u => u.status === 'rejected').length } };
}

async function metadata(base: string, p: string, transport: Transport) {
  const r = await transport(`${base}/${p}`, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`metadata ${p}: HTTP ${r.status}`);
  return r.text();
}

export async function editManuscript(m: Manuscript, opts: { transport?: Transport; spentTodayUsd: number; root?: string }): Promise<Edition> {
  const { settings, hash } = readEditingSettings(opts.root), transport = opts.transport ?? (fetch as unknown as Transport), p = settings.provider;
  if (p.kind !== 'vertex') throw new Error(`Unsupported editing provider '${p.kind}'`);
  const list = units(m);
  // Budget is checked before sending, on a generous estimate (4 characters per token, output as long as input).
  const estTokens = Math.ceil((settings.instruction.length + JSON.stringify(list).length) / 4);
  const estimate = (estTokens * settings.pricing_usd_per_million_tokens.input + estTokens * 1.5 * settings.pricing_usd_per_million_tokens.output) / 1e6;
  if (opts.spentTodayUsd + estimate > settings.daily_budget_usd)
    throw Object.assign(new Error(`Editing would exceed the daily budget (${settings.daily_budget_usd} USD; spent ${opts.spentTodayUsd.toFixed(4)}, this edit up to ${estimate.toFixed(4)})`), { status: 409 });
  const tokenBody = JSON.parse(await metadata(p.metadata_base, 'instance/service-accounts/default/token', transport));
  const token = tokenBody.access_token as string; registerSecretValue(token);
  const project = p.project === 'from_metadata' ? (await metadata(p.metadata_base, 'project/project-id', transport)).trim() : p.project;
  const host = p.location === 'global' ? 'aiplatform.googleapis.com' : `${p.location}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${project}/locations/${p.location}/publishers/google/models/${p.model}:generateContent`;
  const body = { systemInstruction: { parts: [{ text: settings.instruction }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(list.map(u => ({ id: u.id, text: u.text }))) }] }],
    generationConfig: { ...p.generation, responseMimeType: 'application/json' } };
  const res = await transport(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(p.timeout_ms) });
  const raw = await res.text();
  if (!res.ok) throw Object.assign(new Error(`Vertex returned HTTP ${res.status}: ${raw.slice(0, 300)}`), { status: 502 });
  const d = JSON.parse(raw), usage = { input_tokens: d.usageMetadata?.promptTokenCount ?? 0, output_tokens: (d.usageMetadata?.candidatesTokenCount ?? 0) + (d.usageMetadata?.thoughtsTokenCount ?? 0) };
  let returned: any[] = [];
  try { returned = JSON.parse(d.candidates?.[0]?.content?.parts?.map((x: any) => x.text ?? '').join('') ?? '[]'); } catch { returned = []; }
  const byId = new Map((Array.isArray(returned) ? returned : []).map((x: any) => [String(x?.id), x?.text]));
  const edited: EditUnit[] = list.map(u => {
    const text = byId.get(u.id);
    if (text === undefined) return { id: u.id, section: u.section, original: u.text, edited: u.text, status: 'rejected', reason: 'unit missing from the model response' };
    const v = verifyUnit(u.text, text);
    if (!v.ok) return { id: u.id, section: u.section, original: u.text, edited: u.text, status: 'rejected', reason: v.reason };
    return { id: u.id, section: u.section, original: u.text, edited: text, status: text === u.text ? 'unchanged' : 'edited' };
  });
  const cost = (usage.input_tokens * settings.pricing_usd_per_million_tokens.input + usage.output_tokens * settings.pricing_usd_per_million_tokens.output) / 1e6;
  return { id: randomUUID(), target_id: m.target_id, manuscript_input_hash: m.input_hash, provider: p.kind, model: p.model, settings_hash: hash,
    created_at: new Date().toISOString(), usage, estimated_cost_usd: cost, units: edited };
}
