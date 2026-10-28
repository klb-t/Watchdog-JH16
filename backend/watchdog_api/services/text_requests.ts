import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalHash } from '../domain/canonical';
import type { ObjectStore } from '../storage/object_store';
import { listReplicationTargets, type ReplicationTarget } from './replication_dossier';
import { measurementPlan } from './replication_measurements';
import { readTrendsCalibration, trendsRequestsPerRegion } from './jh16_trends';
import { htmlToText } from '../sources/document_conversion';
import { vertexGenerate, type Transport, type VertexProvider } from './vertex';
import { AutomationError } from '../db/repositories/automation';
import type { TextRequestRepository } from '../db/repositories/text_requests';

/**
 * A request from a pasted text (config/requests/text-requests.json).
 *
 * The text names a work (URL, DOI) and says what to do with it. WatchDog
 * resolves the work through open metadata, matches it to a registered
 * replication target, recognises the intents the configured rules cover (each
 * with the fragment that triggered it) and builds a plan from the target's
 * dossier: the literal part starts when the request is sent, within a daily
 * spending cap; proposals wait for acceptance; questions are asked without
 * blocking. A work outside the register is taken into paper intake instead,
 * with what could be fetched. No model output reaches a number: the optional
 * model reading only proposes intents and method notes, each kept only if it
 * quotes the text it rests on.
 */

const read = (root: string, p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf-8'));
export function readRequestConfig(root = process.cwd()) { const c = read(root, 'config/requests/text-requests.json'); return { config: c, hash: canonicalHash(c) }; }

export type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; url: string; contentType: string; body: Buffer }>;
export const httpFetcher = (maxBytes: number): Fetcher => async (url, init) => {
  const r = await fetch(url, { headers: init.headers, signal: init.signal, redirect: 'follow' });
  const reader = r.body?.getReader(), chunks: Uint8Array[] = []; let n = 0;
  if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > maxBytes) { await reader.cancel(); throw new Error(`response exceeds ${maxBytes} bytes`); } chunks.push(value); }
  return { status: r.status, url: r.url, contentType: r.headers.get('content-type') ?? '', body: Buffer.concat(chunks) };
};

export interface Retrieval { purpose: string; url: string; status: number | null; bytes: number; sha256: string | null; object_uri: string | null; error: string | null; note?: string }
export interface Action { id: string; label: string; intents: string[]; launch: any | null; unavailable?: string; requests: number | null; matched_intents: string[] }
export interface Analysis {
  config_version: string; config_hash: string; text_sha256: string;
  identifiers: { kind: 'doi' | 'url'; value: string }[];
  retrievals: Retrieval[];
  works: { doi: string; title: string | null; via: string }[];
  target: { target_id: string; title: string; matched_doi: string } | null;
  intents: { id: string; label: string; fragment: string; rule: string; source: 'rule' | 'model' }[];
  model: { status: 'disabled' | 'used' | 'failed'; reason: string | null; notes: { statement: string; quote: string }[] };
  literal: Action[]; proposals: Action[]; questions: { id: string; to: string; text: string; matched_intents: string[] }[];
  intake: { title: string; source: string; coverage: 'full_text' | 'abstract' | 'identifier_only'; retrieval: string | null } | null;
  cost: { eur_per_request: number; literal_requests: number; literal_eur: number; daily_auto_spend_eur: number };
  plan_hash: string;
}

const normUrl = (u: string) => u.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
// The sentence around a match: bounded by sentence punctuation or a blank line. A single
// line break is wrapping, not a boundary. The fragment stays a verbatim substring of the text.
const sentenceAt = (text: string, index: number) => {
  const para = text.lastIndexOf('\n\n', index), start = Math.max(para < 0 ? -1 : para + 1, ...['.', '!', '?'].map(c => text.lastIndexOf(c, index - 1))) + 1;
  const ends = ['.', '!', '?'].map(c => text.indexOf(c, index)).filter(i => i >= 0), paraEnd = text.indexOf('\n\n', index);
  const end = Math.min(ends.length ? Math.min(...ends) + 1 : text.length, paraEnd < 0 ? text.length : paraEnd);
  return text.slice(start, end).trim().slice(0, 300);
};

export interface AnalyzeDeps { fetcher: Fetcher; store: ObjectStore; root?: string; modelTransport?: Transport }

async function retrieve(deps: AnalyzeDeps, cfg: any, purpose: string, url: string): Promise<{ r: Retrieval; body: Buffer | null; contentType: string }> {
  try {
    const res = await deps.fetcher(url, { headers: { 'User-Agent': cfg.fetch.user_agent, Accept: purpose === 'page' ? 'text/html,application/pdf' : 'application/json' }, signal: AbortSignal.timeout(cfg.fetch.timeout_ms) });
    const sha = res.body.length ? createHash('sha256').update(res.body).digest('hex') : null;
    const uri = sha ? await deps.store.put(`raw/${sha}`, res.body) : null;
    // Only a 200 is the document itself; a 202 or similar is typically a bot-protection page and is kept as evidence, not as text.
    const note = res.status !== 200 && res.status < 400 ? `HTTP ${res.status} (${res.body.length} B) is not the document (e.g. bot protection); recorded, not worked around` : undefined;
    return { r: { purpose, url, status: res.status, bytes: res.body.length, sha256: sha, object_uri: uri, error: null, ...(note ? { note } : {}) }, body: res.status === 200 && res.body.length ? res.body : null, contentType: res.contentType };
  } catch (e) { return { r: { purpose, url, status: null, bytes: 0, sha256: null, object_uri: null, error: (e as Error).message.slice(0, 200) }, body: null, contentType: '' }; }
}

function estimateRequests(t: ReplicationTarget, launch: any, root: string): number | null {
  if (!launch) return null;
  if (launch.kind === 'measurement') return measurementPlan(t, root)?.requests ?? null;
  if (launch.kind !== 'jh16_plan') return null;
  const preset = read(root, 'config/presets/jh2016-faithful.json'), perRun = preset.substances.length * 2;
  const baseline = launch.baseline === 'fixture' || launch.baseline === 'none' ? 0
    : launch.baseline === 'live_serp' ? perRun : perRun * (1 + read(root, 'config/presets/jh2016-serp-extension.json').variants.length);
  return baseline + trendsRequestsPerRegion(readTrendsCalibration(root).calibration) * (launch.trendsRegions?.length ?? 0);
}

export async function analyzeText(text: string, deps: AnalyzeDeps): Promise<Analysis> {
  const root = deps.root ?? process.cwd(), { config: cfg, hash } = readRequestConfig(root);
  const textSha = createHash('sha256').update(text).digest('hex');
  const ids: Analysis['identifiers'] = [];
  for (const m of text.matchAll(new RegExp(cfg.identifier_patterns.url, 'gi'))) ids.push({ kind: 'url', value: m[0] });
  for (const m of text.matchAll(new RegExp(cfg.identifier_patterns.doi, 'gi'))) if (!ids.some(i => i.kind === 'url' && i.value.includes(m[0]))) ids.push({ kind: 'doi', value: m[0].toLowerCase() });
  const retrievals: Retrieval[] = [], works: Analysis['works'] = [];
  let pageText: { title: string | null; text: string; retrieval: string } | null = null;
  for (const id of ids.filter(i => i.kind === 'url')) {
    const page = await retrieve(deps, cfg, 'page', id.value); retrievals.push(page.r);
    if (page.body && /html/i.test(page.contentType)) {
      const html = page.body.toString('utf-8');
      const meta = (name: string) => html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1] ?? null;
      const doi = meta('citation_doi') ?? meta('dc.identifier');
      if (doi && /^10\./.test(doi)) works.push({ doi: doi.toLowerCase(), title: meta('citation_title'), via: `page meta (${id.value})` });
      const converted = htmlToText(html); pageText = { title: converted.title ?? meta('citation_title'), text: converted.text, retrieval: page.r.sha256! };
    }
    if (works.some(w => w.via.includes(id.value))) continue;
    const u = new URL(id.value);
    for (const res of cfg.url_resolvers) {
      const m = u.host.endsWith(res.host_suffix) ? u.pathname.match(new RegExp(res.path_pattern)) : null;
      if (!m) continue;
      const year = m[res.year_group];
      const q = `${cfg.crossref_endpoint}?filter=issn:${res.issn},from-pub-date:${year}-01-01,until-pub-date:${year}-12-31&rows=1000&select=DOI,title,resource`;
      const cr = await retrieve(deps, cfg, `crossref (${res.id})`, q); retrievals.push(cr.r);
      if (!cr.body) continue;
      const hit = (JSON.parse(cr.body.toString('utf-8')).message?.items ?? []).find((it: any) => normUrl(it.resource?.primary?.URL ?? '') === normUrl(id.value));
      if (hit) works.push({ doi: String(hit.DOI).toLowerCase(), title: hit.title?.[0] ?? null, via: `Crossref ${res.issn}/${year}: registered landing page equals ${id.value}` });
    }
  }
  for (const id of ids.filter(i => i.kind === 'doi')) {
    const cr = await retrieve(deps, cfg, 'crossref (doi)', `${cfg.crossref_endpoint}/${encodeURIComponent(id.value)}`); retrievals.push(cr.r);
    if (cr.body) { const it = JSON.parse(cr.body.toString('utf-8')).message; works.push({ doi: id.value, title: it?.title?.[0] ?? null, via: 'Crossref DOI record' }); }
  }
  const dedupWorks = [...new Map(works.map(w => [w.doi, w])).values()];
  const targets = listReplicationTargets(root), match = targets.find(t => dedupWorks.some(w => w.doi === String(t.target.identifier).toLowerCase()));
  const target = match ? { target_id: match.target.target_id, title: match.target.title, matched_doi: String(match.target.identifier).toLowerCase() } : null;

  const intents: Analysis['intents'] = [];
  for (const rule of cfg.intents) for (const p of rule.patterns) {
    const m = new RegExp(p, 'i').exec(text);
    if (m) { intents.push({ id: rule.id, label: rule.label, fragment: sentenceAt(text, m.index), rule: p, source: 'rule' }); break; }
  }
  const model = await modelReading(text, pageText?.text ?? null, cfg, intents, deps.modelTransport);
  for (const x of model.intents) if (!intents.some(i => i.id === x.id)) intents.push(x);

  const recognised = intents.map(i => i.id), acts = match?.dossier?.request_actions ?? { literal: [], proposals: [], questions: [] };
  const pick = (list: any[]): Action[] => list.map(a => ({ id: a.id, label: a.label, intents: a.intents, launch: a.launch ?? null, ...(a.unavailable ? { unavailable: a.unavailable } : {}),
    requests: match ? estimateRequests(match, a.launch, root) : null, matched_intents: a.intents.filter((i: string) => recognised.includes(i)) })).filter(a => a.matched_intents.length);
  const literal = pick(acts.literal), proposals = pick(acts.proposals);
  const questions = (acts.questions ?? []).map((q: any) => ({ id: q.id, to: q.to, text: q.text, matched_intents: q.intents.filter((i: string) => recognised.includes(i)) })).filter((q: any) => q.matched_intents.length);
  const doi = dedupWorks[0]?.doi, firstUrl = ids.find(i => i.kind === 'url')?.value;
  const intake = match || (!doi && !firstUrl) ? null : { title: pageText?.title ?? dedupWorks[0]?.title ?? (doi ? `doi:${doi}` : firstUrl!), source: doi ? `doi:${doi}` : firstUrl!,
    coverage: pageText?.text.trim() ? 'full_text' as const : 'identifier_only' as const, retrieval: pageText?.retrieval ?? null };
  const eur = cfg.cost.serpapi_eur_per_request, literalRequests = literal.reduce((k, a) => k + (a.requests ?? 0), 0);
  const plan = { identifiers: ids, works: dedupWorks.map(w => w.doi), target: target?.target_id ?? null, intents: recognised,
    literal: literal.map(a => [a.id, a.requests]), proposals: proposals.map(a => [a.id, a.requests]), questions: questions.map((q: any) => q.id), intake: intake ? [intake.source, intake.coverage] : null, config: hash };
  return { config_version: cfg.version, config_hash: hash, text_sha256: textSha, identifiers: ids, retrievals, works: dedupWorks, target, intents,
    model: { status: model.status, reason: model.reason, notes: model.notes }, literal, proposals, questions, intake,
    cost: { eur_per_request: eur, literal_requests: literalRequests, literal_eur: Number((literalRequests * eur).toFixed(4)), daily_auto_spend_eur: cfg.cost.daily_auto_spend_eur },
    plan_hash: canonicalHash(plan) };
}

/** Optional model reading: proposals only, each kept only if its quote occurs verbatim in the text it cites. */
async function modelReading(text: string, paper: string | null, cfg: any, ruleIntents: { id: string }[], transport?: Transport) {
  const s = cfg.model_supplement;
  const none = { intents: [] as Analysis['intents'], notes: [] as { statement: string; quote: string }[] };
  if (s.enabled !== true) return { ...none, status: 'disabled' as const, reason: s._why_disabled ?? 'disabled in config' };
  try {
    const provider: VertexProvider = { kind: s.provider, model: s.model, location: s.location, project: s.project ?? 'from_metadata', metadata_base: s.metadata_base ?? 'http://metadata.google.internal/computeMetadata/v1',
      generation: s.generation ?? { temperature: 0.1 }, timeout_ms: s.timeout_ms ?? 60000 };
    const known = cfg.intents.map((i: any) => i.id);
    const reply = await vertexGenerate(provider, s.instruction, JSON.stringify({ text, paper: paper?.slice(0, 20000) ?? null, intent_ids: known, already: ruleIntents.map(i => i.id) }), transport ?? (fetch as unknown as Transport));
    const d = JSON.parse(reply.text || '{}');
    const intents = (Array.isArray(d.intents) ? d.intents : []).filter((x: any) => known.includes(x?.id) && typeof x.quote === 'string' && x.quote.length >= 8 && text.includes(x.quote))
      .map((x: any) => ({ id: x.id, label: cfg.intents.find((i: any) => i.id === x.id).label, fragment: x.quote, rule: `model ${s.model}`, source: 'model' as const }));
    const notes = (Array.isArray(d.method_notes) ? d.method_notes : []).filter((x: any) => typeof x?.statement === 'string' && typeof x.quote === 'string' && x.quote.length >= 8 && (paper ?? text).includes(x.quote))
      .map((x: any) => ({ statement: String(x.statement).slice(0, 500), quote: String(x.quote).slice(0, 500) }));
    return { intents, notes, status: 'used' as const, reason: null };
  } catch (e) { return { ...none, status: 'failed' as const, reason: (e as Error).message.slice(0, 200) }; }
}

export interface Launchers {
  jh16Plan: (owner: string, launch: any, name: string) => { runIds: string[] };
  measurement: (owner: string, t: ReplicationTarget) => { runIds: string[] };
  intake: (owner: string, doc: { title: string; source: string; text: string; coverage: string }) => { documentId: string };
  searchesToday: (owner: string) => number;
}

export class TextRequests {
  constructor(private readonly repo: TextRequestRepository, private readonly deps: AnalyzeDeps, private readonly launch: Launchers) {}
  preview(text: string) { return analyzeText(text, this.deps); }

  async submit(owner: string, text: string, expectedPlanHash: string) {
    if (!text.trim()) throw new AutomationError('Paste a text first');
    const analysis = await analyzeText(text, this.deps);
    if (analysis.plan_hash !== expectedPlanHash) throw new AutomationError('The plan changed since the preview (e.g. the work could not be resolved again); review it again');
    const stored = this.repo.create(owner, analysis.text_sha256, { text, analysis });
    const t = analysis.target ? listReplicationTargets(this.deps.root).find(x => x.target.target_id === analysis.target!.target_id)! : null;
    let spent = this.launch.searchesToday(owner) * analysis.cost.eur_per_request;
    for (const a of analysis.literal) {
      const eur = (a.requests ?? 0) * analysis.cost.eur_per_request;
      if (spent + eur > analysis.cost.daily_auto_spend_eur) {
        this.repo.event(owner, stored.id, 'deferred', { action: a.id, reason: `would exceed the daily cap for automatic spending (${analysis.cost.daily_auto_spend_eur} EUR; spent ~${spent.toFixed(2)}, this ~${eur.toFixed(2)}); start it below when you choose` });
        continue;
      }
      this.run(owner, stored.id, a, t, text);
      spent += eur;
    }
    if (analysis.intake) {
      const uri = analysis.retrievals.find(x => x.sha256 === analysis.intake!.retrieval)?.object_uri ?? null;
      const page = uri ? await this.deps.store.get(uri).catch(() => null) : null;
      try {
        const body = page ? htmlToText(page.toString('utf-8')).text : '';
        const r = this.launch.intake(owner, { title: analysis.intake.title, source: analysis.intake.source, text: body, coverage: body.trim() ? 'full_text' : 'identifier_only' });
        this.repo.event(owner, stored.id, 'launched', { action: 'intake', documentId: r.documentId });
      } catch (e) { this.repo.event(owner, stored.id, 'failed', { action: 'intake', message: (e as Error).message.slice(0, 300) }); }
    }
    return this.repo.get(owner, stored.id)!;
  }

  private run(owner: string, requestId: string, a: Action, t: ReplicationTarget | null, text: string) {
    try {
      if (!a.launch || !t) throw new AutomationError(a.unavailable ?? 'not executable');
      const name = `Zlecenie z tekstu: ${a.label}`.slice(0, 160);
      const r = a.launch.kind === 'measurement' ? this.launch.measurement(owner, t) : this.launch.jh16Plan(owner, a.launch, name);
      this.repo.event(owner, requestId, 'launched', { action: a.id, runIds: r.runIds, requests: a.requests, text_sha256: createHash('sha256').update(text).digest('hex') });
    } catch (e) { this.repo.event(owner, requestId, 'failed', { action: a.id, message: (e as Error).message.slice(0, 300) }); }
  }

  /** A deferred literal action or a proposal, started on the user's explicit acceptance. */
  accept(owner: string, requestId: string, actionId: string) {
    const r = this.repo.get(owner, requestId); if (!r) throw new AutomationError('Request not found', 404);
    const a = [...r.body.analysis.literal, ...r.body.analysis.proposals].find((x: Action) => x.id === actionId);
    if (!a) throw new AutomationError('No such action in this request');
    if (!a.launch) throw new AutomationError(a.unavailable ?? 'This proposal cannot be started yet');
    if (r.events.some(e => e.kind === 'launched' && e.body.action === actionId)) throw new AutomationError('Already started');
    this.repo.event(owner, requestId, 'accepted', { action: actionId });
    const t = listReplicationTargets(this.deps.root).find(x => x.target.target_id === r.body.analysis.target?.target_id) ?? null;
    this.run(owner, requestId, a, t, r.body.text);
    return this.repo.get(owner, requestId)!;
  }

  answer(owner: string, requestId: string, questionId: string, answer: string) {
    const r = this.repo.get(owner, requestId); if (!r) throw new AutomationError('Request not found', 404);
    if (!r.body.analysis.questions.some((q: any) => q.id === questionId)) throw new AutomationError('No such question in this request');
    this.repo.event(owner, requestId, 'answered', { question: questionId, answer: answer.trim().slice(0, 4000) });
    return this.repo.get(owner, requestId)!;
  }
}
