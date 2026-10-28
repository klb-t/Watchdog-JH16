import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunSummary } from './replication_dossier';

/**
 * E5.7b — frozen study protocols, data roles and comparison families.
 *
 * A protocol is frozen before confirmation data exist: hypotheses, primary
 * endpoints, the complete comparison family, the multiplicity procedure and
 * alpha. Runs carry a data role in their hashed configuration. Only runs that
 * cite a protocol by id and content hash, measure new data and were created
 * after the freeze count as confirmation; everything else is exploratory.
 * Adjusted p-values are computed deterministically from the p-values stored in
 * each confirmation run's evaluation.
 */

export function readProtocolOptions(root = process.cwd()) {
  return JSON.parse(fs.readFileSync(path.join(root, 'config/replication/protocol-options.json'), 'utf8'));
}

export interface ProtocolInput { name: string; primary: string[]; family: string[]; multiplicity: string; alpha: number; rationale: string; expectedDossierHash: string }
export interface Protocol { id: string; target_id: string; name: string; frozen_at: string; content_hash: string;
  body: { name: string; target_id: string; hypotheses: any[]; primary: string[]; family: { claim_key: string; label: string; hypothesis: string; p_value: string; claim: any }[];
    multiplicity: string; alpha: number; rationale: string; claims_hash: string; interpretation_hash: string | null; dossier_hash: string; confirmation_sources: string[]; frozen_at: string } }

export class ProtocolError extends Error { readonly status = 409; }

/** Holm step-down adjusted p-values (monotone, capped at 1), in input order. */
export function adjustPValues(ps: (number | null)[], procedure: string): (number | null)[] {
  const m = ps.filter(p => p !== null).length;
  if (procedure === 'none') return [...ps];
  if (procedure === 'bonferroni') return ps.map(p => p === null ? null : Math.min(1, p * m));
  if (procedure !== 'holm') throw new Error(`Unknown multiplicity procedure '${procedure}'`);
  const order = ps.map((p, i) => ({ p, i })).filter(x => x.p !== null).sort((a, b) => a.p! - b.p! || a.i - b.i);
  const out: (number | null)[] = ps.map(() => null); let running = 0;
  order.forEach((x, k) => { running = Math.max(running, Math.min(1, (m - k) * x.p!)); out[x.i] = running; });
  return out;
}

function pAt(evaluation: any, ref: string): number | null {
  if (ref === 'pi_vs_published') return evaluation.pi_vs_published?.p_two_sided ?? null;
  const [series, statistic] = ref.split('.');
  return evaluation[series]?.find((s: any) => s.statistic === statistic)?.p_two_sided ?? null;
}

/** A run's data role as recorded in its configuration, checked against the protocol it cites. */
export function dataRole(run: RunSummary, protocols: Protocol[]): { role: 'confirmation' | 'exploratory'; protocol_id: string | null; reason?: string } {
  const c = run.role_config;
  if (c.data_role !== 'confirmation') return { role: 'exploratory', protocol_id: null };
  const p = protocols.find(x => x.id === c.protocol_id);
  if (!p) return { role: 'exploratory', protocol_id: c.protocol_id ?? null, reason: 'cites an unknown protocol' };
  if (c.protocol_hash !== p.content_hash) return { role: 'exploratory', protocol_id: p.id, reason: 'protocol hash does not match' };
  if (run.created_at <= p.frozen_at) return { role: 'exploratory', protocol_id: p.id, reason: 'created before the protocol was frozen' };
  if (run.provenance !== 'new_fetch' || !p.body.confirmation_sources.includes(c.source_id)) return { role: 'exploratory', protocol_id: p.id, reason: 'not a new measurement from an allowed source' };
  return { role: 'confirmation', protocol_id: p.id };
}

export function evaluateProtocol(p: Protocol, runs: RunSummary[]) {
  const confirmation = runs.filter(r => dataRole(r, [p]).role === 'confirmation' && r.status === 'COMPLETED' && r.evaluation);
  return { protocol_id: p.id, confirmation_runs: confirmation.map(r => {
    const raw = p.body.family.map(f => r.evaluation.complete ? pAt(r.evaluation, f.p_value) : null), adjusted = adjustPValues(raw, p.body.multiplicity);
    return { run_id: r.run_id, created_at: r.created_at, complete: r.evaluation.complete, endpoints: p.body.family.map((f, i) => ({
      claim_key: f.claim_key, label: f.label, primary: p.body.primary.includes(f.claim_key),
      verdict: r.evaluation.verdicts.find((v: any) => v.claim_key === f.claim_key)?.verdict ?? 'not_computable',
      p_raw: raw[i], p_adjusted: adjusted[i], significant: adjusted[i] === null ? null : adjusted[i]! < p.body.alpha })) };
  }), exploratory_runs: runs.filter(r => dataRole(r, [p]).role !== 'confirmation').length };
}
