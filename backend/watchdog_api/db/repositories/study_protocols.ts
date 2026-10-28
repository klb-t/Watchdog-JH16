import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { canonicalHash } from '../../domain/canonical';
import type { ReplicationTarget } from '../../services/replication_dossier';
import { ProtocolError, readProtocolOptions, type Protocol, type ProtocolInput } from '../../services/study_protocols';

/** Write-once study protocols (E5.7b). */

export class StudyProtocolRepository {
  constructor(private readonly db: BetterSQLite3Database<any>) {}
  freeze(owner: string, t: ReplicationTarget, input: ProtocolInput, options = readProtocolOptions()): Protocol {
    if (!t.dossier) throw new ProtocolError('This target has no dossier; endpoints cannot be resolved');
    if (input.expectedDossierHash !== t.hashes.dossier) throw new ProtocolError('The replication description changed; reload before freezing');
    const endpoints = new Map((t.dossier.endpoints ?? []).map((e: any) => [e.claim_key, e]));
    const family = [...new Set(input.family)].sort();
    if (!family.length) throw new ProtocolError('A protocol needs at least one comparison in its family');
    for (const k of family) if (!endpoints.has(k)) throw new ProtocolError(`'${k}' is not an endpoint of this target`);
    if (!input.primary.length || input.primary.some(k => !family.includes(k))) throw new ProtocolError('Primary endpoints must be members of the comparison family');
    if (!options.multiplicity_procedures.some((m: any) => m.id === input.multiplicity)) throw new ProtocolError(`Unknown multiplicity procedure '${input.multiplicity}'`);
    if (!(input.alpha > 0 && input.alpha < 1)) throw new ProtocolError('Alpha must be between 0 and 1');
    const frozen_at = new Date().toISOString();
    const body = { name: input.name, target_id: t.target.target_id, hypotheses: t.dossier.hypotheses, primary: [...new Set(input.primary)].sort(),
      family: family.map(k => { const e: any = endpoints.get(k); return { claim_key: k, label: e.label, hypothesis: e.hypothesis, p_value: e.p_value, claim: t.target.claims.find((c: any) => c.claim_key === k) }; }),
      multiplicity: input.multiplicity, alpha: input.alpha, rationale: input.rationale, claims_hash: t.hashes.claims, interpretation_hash: t.hashes.interpretation ?? null,
      dossier_hash: t.hashes.dossier, confirmation_sources: t.dossier.confirmation_sources ?? [], frozen_at };
    const id = randomUUID(), content_hash = canonicalHash(body);
    this.db.run(sql`INSERT INTO study_protocols VALUES (${id}, ${owner}, ${t.target.target_id}, ${JSON.stringify(body)}, ${content_hash}, ${frozen_at})`);
    return { id, target_id: t.target.target_id, name: input.name, frozen_at, content_hash, body };
  }
  list(owner: string, target: string): Protocol[] {
    return this.db.all<{ id: string; target_id: string; body_json: string; content_hash: string; frozen_at: string }>(
      sql`SELECT * FROM study_protocols WHERE owner_principal_id = ${owner} AND target_id = ${target} ORDER BY frozen_at, id`).map(r => {
      const body = JSON.parse(r.body_json);
      if (canonicalHash(body) !== r.content_hash) throw new Error('Study protocol integrity mismatch');
      return { id: r.id, target_id: r.target_id, name: body.name, frozen_at: r.frozen_at, content_hash: r.content_hash, body };
    });
  }
  get(owner: string, id: string): Protocol | null {
    const r = this.db.get<{ target_id: string }>(sql`SELECT target_id FROM study_protocols WHERE owner_principal_id = ${owner} AND id = ${id}`);
    return r ? this.list(owner, r.target_id).find(p => p.id === id) ?? null : null;
  }
}

