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
    const endpoint = (k: string) => { const e: any = endpoints.get(k); return { claim_key: k, label: e.label, hypothesis: e.hypothesis, p_value: e.p_value, claim: t.target.claims.find((c: any) => c.claim_key === k) }; };
    const known = (m: string) => options.multiplicity_procedures.some((x: any) => x.id === m);
    if (!(input.alpha > 0 && input.alpha < 1)) throw new ProtocolError('Alpha must be between 0 and 1');
    const frozen_at = new Date().toISOString();
    const common = { name: input.name, target_id: t.target.target_id, hypotheses: t.dossier.hypotheses };
    const tail = { alpha: input.alpha, rationale: input.rationale, claims_hash: t.hashes.claims, interpretation_hash: t.hashes.interpretation ?? null,
      dossier_hash: t.hashes.dossier, confirmation_sources: t.dossier.confirmation_sources ?? [], frozen_at };
    let body: Protocol['body'];
    if (input.families) {
      // E5.7b-2: families and their endpoints keep the declared priority order.
      if (input.family || input.multiplicity) throw new ProtocolError('Give either families or a single family, not both');
      if (!input.families.length) throw new ProtocolError('A protocol needs at least one comparison family');
      const seen = new Set<string>();
      for (const f of input.families) {
        if (!f.label.trim()) throw new ProtocolError('Every family needs a name');
        if (!f.endpoints.length) throw new ProtocolError(`Family '${f.label}' has no comparisons`);
        if (!known(f.multiplicity)) throw new ProtocolError(`Unknown multiplicity procedure '${f.multiplicity}'`);
        for (const k of f.endpoints) {
          if (!endpoints.has(k)) throw new ProtocolError(`'${k}' is not an endpoint of this target`);
          if (seen.has(k)) throw new ProtocolError(`'${k}' appears in more than one place; a comparison belongs to one family once`);
          seen.add(k);
        }
      }
      const gating = input.gating ?? options.default_gating;
      if (!options.gating_procedures.some((g: any) => g.id === gating)) throw new ProtocolError(`Unknown gating '${gating}'`);
      if (!input.primary.length || input.primary.some(k => !seen.has(k))) throw new ProtocolError('Primary endpoints must be members of a comparison family');
      const families = input.families.map((f, i) => ({ id: `F${i + 1}`, label: f.label.trim(), multiplicity: f.multiplicity, endpoints: f.endpoints.map(endpoint) }));
      body = { ...common, primary: [...new Set(input.primary)].sort(), family: families.flatMap(f => f.endpoints),
        multiplicity: families.length === 1 ? families[0].multiplicity : 'per_family', ...tail, protocol_version: 2, families, gating };
    } else {
      // The E5.7b-1 form: one family, stored sorted, so its order carries no priority.
      const family = [...new Set(input.family ?? [])].sort();
      if (!family.length) throw new ProtocolError('A protocol needs at least one comparison in its family');
      for (const k of family) if (!endpoints.has(k)) throw new ProtocolError(`'${k}' is not an endpoint of this target`);
      if (!input.primary.length || input.primary.some(k => !family.includes(k))) throw new ProtocolError('Primary endpoints must be members of the comparison family');
      if (!input.multiplicity || !known(input.multiplicity)) throw new ProtocolError(`Unknown multiplicity procedure '${input.multiplicity}'`);
      if (input.multiplicity === 'fixed_sequence') throw new ProtocolError('A fixed sequence needs an explicit order; declare it as a family');
      body = { ...common, primary: [...new Set(input.primary)].sort(), family: family.map(endpoint), multiplicity: input.multiplicity, ...tail };
    }
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

