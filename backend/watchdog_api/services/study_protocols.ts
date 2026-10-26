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
 *
 * E5.7b-2: a protocol may declare several comparison families in priority
 * order. Each family lists its endpoints in priority order and has its own
 * procedure (fixed_sequence tests them in that order). Under serial gating a
 * later family is tested only if every hypothesis of the earlier families was
 * rejected, which keeps the familywise error at alpha across families.
 * Protocols frozen before this (one `family`, sorted) evaluate exactly as before.
 */

export function readProtocolOptions(root = process.cwd()) {
  return JSON.parse(fs.readFileSync(path.join(root, 'config/replication/protocol-options.json'), 'utf8'));
}

export interface FamilyInput { label: string; endpoints: string[]; multiplicity: string }
export interface ProtocolInput { name: string; primary: string[]; family?: string[]; multiplicity?: string; families?: FamilyInput[]; gating?: string;
  alpha: number; rationale: string; expectedDossierHash: string }
export interface Endpoint { claim_key: string; label: string; hypothesis: string; p_value: string; claim: any }
export interface Family { id: string; label: string; multiplicity: string; endpoints: Endpoint[] }
export interface Protocol { id: string; target_id: string; name: string; frozen_at: string; content_hash: string;
  body: { name: string; target_id: string; hypotheses: any[]; primary: string[]; family: Endpoint[];
    multiplicity: string; alpha: number; rationale: string; claims_hash: string; interpretation_hash: string | null; dossier_hash: string; confirmation_sources: string[]; frozen_at: string;
    protocol_version?: 2; families?: Family[]; gating?: 'serial' | 'independent' } }

/** The families of a protocol; a protocol frozen before E5.7b-2 has one. */
export function familiesOf(body: Protocol['body']): { families: Family[]; gating: 'serial' | 'independent' } {
  if (body.families) return { families: body.families, gating: body.gating ?? 'serial' };
  return { families: [{ id: 'F1', label: 'Rodzina porównań', multiplicity: body.multiplicity, endpoints: body.family }], gating: 'independent' };
}

export class ProtocolError extends Error { readonly status = 409; }

/**
 * Adjusted p-values in input order: Holm step-down, Bonferroni, none, or
 * fixed_sequence (the running maximum in the declared order; a missing p-value
 * stops the sequence, so every later hypothesis is untested).
 */
export function adjustPValues(ps: (number | null)[], procedure: string): (number | null)[] {
  const m = ps.filter(p => p !== null).length;
  if (procedure === 'none') return [...ps];
  if (procedure === 'fixed_sequence') {
    let running = 0, stopped = false;
    return ps.map(p => { if (stopped || p === null) { stopped = true; return null; } running = Math.max(running, p); return running; });
  }
  if (procedure === 'bonferroni') return ps.map(p => p === null ? null : Math.min(1, p * m));
  if (procedure !== 'holm') throw new Error(`Unknown multiplicity procedure '${procedure}'`);
  const order = ps.map((p, i) => ({ p, i })).filter(x => x.p !== null).sort((a, b) => a.p! - b.p! || a.i - b.i);
  const out: (number | null)[] = ps.map(() => null); let running = 0;
  order.forEach((x, k) => { running = Math.max(running, Math.min(1, (m - k) * x.p!)); out[x.i] = running; });
  return out;
}

function pAt(evaluation: any, ref: string): number | null {
  if (ref === 'pi_vs_published') return evaluation.pi_vs_published?.p_two_sided ?? null;
  if (ref.startsWith('comparisons.')) return evaluation.comparisons?.find((c: any) => c.id === ref.slice('comparisons.'.length))?.p_two_sided ?? null;
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
  const { families, gating } = familiesOf(p.body);
  return { protocol_id: p.id, gating, confirmation_runs: confirmation.map(r => {
    let gateOpen = true, closedBy: string | null = null;
    const endpoints = families.flatMap(f => {
      const raw = f.endpoints.map(e => r.evaluation.complete ? pAt(r.evaluation, e.p_value) : null);
      const adjusted = gateOpen ? adjustPValues(raw, f.multiplicity) : raw.map(() => null);
      const rows = f.endpoints.map((e, i) => {
        const tested = gateOpen && adjusted[i] !== null;
        const not_tested_reason = tested ? null : !gateOpen ? `gate closed: family ${closedBy} not fully rejected`
          : raw[i] === null ? 'p-value not available' : 'sequence stopped at an earlier hypothesis';
        return { claim_key: e.claim_key, label: e.label, primary: p.body.primary.includes(e.claim_key), family_id: f.id, priority: p.body.families ? i + 1 : null,
          verdict: r.evaluation.verdicts.find((v: any) => v.claim_key === e.claim_key)?.verdict ?? 'not_computable',
          p_raw: raw[i], p_adjusted: tested ? adjusted[i] : null, significant: tested ? adjusted[i]! < p.body.alpha : null, tested, not_tested_reason };
      });
      if (gating === 'serial' && gateOpen && !rows.every(x => x.significant === true)) { gateOpen = false; closedBy = f.id; }
      return rows;
    });
    return { run_id: r.run_id, created_at: r.created_at, complete: r.evaluation.complete, endpoints };
  }), exploratory_runs: runs.filter(r => dataRole(r, [p]).role !== 'confirmation').length };
}
