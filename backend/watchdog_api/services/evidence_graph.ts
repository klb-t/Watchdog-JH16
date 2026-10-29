import { canonicalHash } from '../domain/canonical';
import { completeRun, type ReplicationTarget, type RunSummary, type Manuscript } from './replication_dossier';
import { dataRole } from './study_protocols';

/**
 * The evidence graph of one replication target (E5.7b): which hypothesis is
 * tested by which pre-registered claim, which protocol fixes it, which runs
 * evaluate it, which files those runs and the diagnosis rest on, and which
 * manuscript sections cite them. Built only from stored configuration, runs
 * and the manuscript's own source lists; it computes no statistic.
 *
 * `gaps` names what the graph shows to be unsupported: a claim no complete run
 * evaluates, a hypothesis without a claim, a diagnosis marked shown, probable or
 * excluded without evidence, a manuscript table without a source. Ordering is explicit so the graph and its
 * hash are identical for identical inputs.
 */

export type NodeKind = 'hypothesis' | 'claim' | 'protocol' | 'run' | 'file' | 'cause' | 'section';
export interface GraphNode { id: string; kind: NodeKind; label: string; detail?: string; ref?: { run_id?: string; path?: string } }
export interface GraphEdge { from: string; to: string; kind: 'tested_by' | 'fixes' | 'evaluates' | 'confirms' | 'uses' | 'supports' | 'cited_in'; label?: string }
export interface EvidenceGraph { target_id: string; nodes: GraphNode[]; edges: GraphEdge[]; gaps: { node: string; problem: string }[]; graph_hash: string }

const short = (id: string) => id.slice(0, 8);

export function buildEvidenceGraph(t: ReplicationTarget, runs: readonly RunSummary[], protocols: readonly any[], manuscript: Manuscript): EvidenceGraph {
  const nodes = new Map<string, GraphNode>(), edges: GraphEdge[] = [], gaps: { node: string; problem: string }[] = [];
  const add = (n: GraphNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); return n.id; };
  const edge = (e: GraphEdge) => { if (nodes.has(e.from) && nodes.has(e.to)) edges.push(e); };
  const dossier = t.dossier ?? {};
  const file = (path: string, label?: string) => add({ id: `file:${path}`, kind: 'file', label: label ?? path.split('/').pop()!, detail: path, ref: { path } });

  for (const h of dossier.hypotheses ?? []) add({ id: `hypothesis:${h.id}`, kind: 'hypothesis', label: h.id, detail: h.statement });
  for (const c of t.target.claims ?? []) add({ id: `claim:${c.claim_key}`, kind: 'claim', label: c.claim_key,
    detail: `${c.statistic}, ${c.tolerance_kind === 'interval' ? `[${c.tolerance_value}; ${c.interval_upper}]` : `≥ ${c.tolerance_value}`}` });
  for (const h of dossier.hypotheses ?? []) {
    for (const k of h.tested_by ?? []) edge({ from: `hypothesis:${h.id}`, to: `claim:${k}`, kind: 'tested_by' });
    if (!(h.tested_by ?? []).length) gaps.push({ node: `hypothesis:${h.id}`, problem: 'no pre-registered claim tests this hypothesis' });
  }
  if (dossier.protocol?.document) {
    const pre = file(dossier.protocol.document, 'prerejestracja');
    for (const c of t.target.claims ?? []) edge({ from: pre, to: `claim:${c.claim_key}`, kind: 'fixes', label: dossier.protocol.registered_in_commit ?? undefined });
  }
  for (const p of protocols) {
    const id = add({ id: `protocol:${p.id}`, kind: 'protocol', label: p.name, detail: `${p.frozen_at.slice(0, 16)} · sha256 ${p.content_hash.slice(0, 12)}` });
    for (const e of p.body.family ?? []) edge({ from: id, to: `claim:${e.claim_key}`, kind: 'fixes' });
  }

  const evaluated = new Set<string>();
  for (const r of runs) {
    const id = add({ id: `run:${r.run_id}`, kind: 'run', label: short(r.run_id), detail: `${r.provenance_label}${r.variant ? ` · ${r.variant}` : ''} · ${r.status}${r.evaluation && !r.evaluation.complete ? ' · niekompletny' : ''}`, ref: { run_id: r.run_id } });
    if (r.manifest_sha256) edge({ from: add({ id: `file:manifest:${r.run_id}`, kind: 'file', label: `manifest ${short(r.run_id)}`, detail: `sha256 ${r.manifest_sha256}`, ref: { run_id: r.run_id } }), to: id, kind: 'supports', label: r.source_run_id ? `${r.own_fetches} pobrań; liczby z ${short(r.source_run_id)}` : `${r.fetches} pobrań` });
    for (const v of r.evaluation?.verdicts ?? []) {
      edge({ from: id, to: `claim:${v.claim_key}`, kind: 'evaluates', label: v.verdict });
      if (r.status === 'COMPLETED' && r.evaluation.complete && v.verdict !== 'not_computable') evaluated.add(v.claim_key);
    }
    const role = dataRole(r, protocols as any);
    if (role.role === 'confirmation' && role.protocol_id) edge({ from: id, to: `protocol:${role.protocol_id}`, kind: 'confirms' });
  }
  for (const c of t.target.claims ?? []) if (!evaluated.has(c.claim_key)) gaps.push({ node: `claim:${c.claim_key}`, problem: 'no complete run evaluates this claim yet' });

  for (const ref of [t.interpretation?.reference_ref, t.interpretation?.published_values_ref].filter(Boolean) as string[]) {
    const f = file(ref);
    for (const r of runs) if (r.evaluation) edge({ from: f, to: `run:${r.run_id}`, kind: 'uses' });
  }
  for (const d of dossier.diagnosis ?? []) {
    const id = add({ id: `cause:${canonicalHash(d.cause).slice(0, 12)}`, kind: 'cause', label: d.cause, detail: d.status });
    const files = (d.evidence ?? []).filter((e: any) => e.path), kinds = (d.evidence ?? []).filter((e: any) => e.runs_kind).map((e: any) => e.runs_kind);
    for (const e of files) edge({ from: file(e.path, e.label), to: id, kind: 'supports' });
    // Only finished, complete runs of the named kind count as evidence; a partial run shows nothing.
    const byKind = runs.filter(r => kinds.includes(r.provenance) && completeRun(r));
    for (const r of byKind) edge({ from: `run:${r.run_id}`, to: id, kind: 'supports' });
    // An unresolved cause has, by definition, nothing that shows it; any other status must point at evidence.
    if (d.status !== 'unresolved' && !files.length && !byKind.length) gaps.push({ node: id, problem: `a diagnosis marked '${d.status}' names no evidence` });
  }

  for (const s of manuscript.sections) {
    const id = add({ id: `section:${s.id}`, kind: 'section', label: s.title });
    s.blocks.forEach((b, i) => {
      for (const src of b.sources ?? []) {
        if ('run_id' in src) edge({ from: `run:${src.run_id}`, to: id, kind: 'cited_in' });
        else if ('path' in src && src.path) edge({ from: file(src.path), to: id, kind: 'cited_in' });
      }
      if (b.type === 'table' && b.rows.length && !(b.sources ?? []).length) gaps.push({ node: id, problem: `table ${i + 1} has no source` });
    });
  }

  const sortedNodes = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const key = (e: GraphEdge) => `${e.from}|${e.to}|${e.kind}|${e.label ?? ''}`;
  const sortedEdges = [...new Map(edges.map(e => [key(e), e])).values()].sort((a, b) => key(a).localeCompare(key(b)));
  const sortedGaps = gaps.sort((a, b) => a.node.localeCompare(b.node) || a.problem.localeCompare(b.problem));
  return { target_id: t.target.target_id, nodes: sortedNodes, edges: sortedEdges, gaps: sortedGaps, graph_hash: canonicalHash({ sortedNodes, sortedEdges, sortedGaps }) };
}
