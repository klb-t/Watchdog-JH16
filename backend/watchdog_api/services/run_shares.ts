import type { RunRepository } from '../db/repositories/runs';
import type { RunShareRepository, RunShareRow } from '../db/repositories/run_shares';
import { AdmissionError, hashSecret, newToken, normalizeEmail } from '../identity/admission';

/**
 * Read-only run sharing (owner's requirement of 2026-10-29): the owner of a run
 * lets an account, an address or the holder of a link read it — results,
 * evaluation, raw responses and its place in Replications. Nothing a share
 * grants can change a run. A run computed from another (an ANALYSIS
 * recomputation) brings its source along, so the reader sees the same
 * provenance the owner does.
 */

export interface ShareActor { id: string; email: string | null }
const LIMITS = { runs: 200, noteMax: 500, maxDays: 365 };

export class RunShares {
  constructor(private readonly repo: RunShareRepository, private readonly runs: RunRepository,
    private readonly audit: (actorId: string, action: string, objectType: string, objectId: string, requestId: string, metadata: unknown) => void,
    private readonly now: () => Date = () => new Date()) {}

  share(actor: ShareActor, input: { runIds?: unknown; kind?: unknown; target?: unknown; note?: unknown; expiresInDays?: unknown }, requestId: string) {
    const ids = Array.isArray(input.runIds) ? [...new Set(input.runIds.filter((x): x is string => typeof x === 'string'))] : [];
    if (!ids.length || ids.length > LIMITS.runs) throw new AdmissionError('validation_error', 400, `Choose 1–${LIMITS.runs} runs.`);
    const all = new Set<string>();
    for (const id of ids) {
      const run = this.runs.getOwnedRun(id, actor.id);
      if (!run) throw new AdmissionError('not_found', 404, `You do not own run ${id.slice(0, 8)}; only the owner can share it.`);
      all.add(id);
      const source = JSON.parse(run.effective_config ?? '{}').source_run_id;
      if (typeof source === 'string' && this.runs.getOwnedRun(source, actor.id)) all.add(source);
    }
    const kind = input.kind === 'email' || input.kind === 'principal' || input.kind === 'link' ? input.kind : null;
    if (!kind) throw new AdmissionError('validation_error', 400, "kind must be 'email', 'principal' or 'link'.");
    const target = kind === 'email' ? normalizeEmail(input.target) : kind === 'principal' ? (typeof input.target === 'string' && input.target.trim() ? input.target.trim() : null) : null;
    if (kind === 'principal' && !target) throw new AdmissionError('validation_error', 400, 'Name the account to share with.');
    if (target && (target === actor.id || target === actor.email)) throw new AdmissionError('validation_error', 400, 'You already own these runs.');
    const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, LIMITS.noteMax) : null;
    const days = input.expiresInDays === undefined || input.expiresInDays === null || input.expiresInDays === '' ? null : Number(input.expiresInDays);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > LIMITS.maxDays)) throw new AdmissionError('validation_error', 400, `Expiry must be 1–${LIMITS.maxDays} days.`);
    const at = this.now(), expires_at = days === null ? null : new Date(at.getTime() + days * 86_400_000).toISOString();
    const token = kind === 'link' ? newToken() : null;
    const shareIds = this.repo.transaction(() => [...all].sort().map(run_id => this.repo.insert({ run_id, owner_principal_id: actor.id, target_kind: kind, target,
      token_hash: token ? hashSecret(token) : null, via_share_id: null, note, created_by: actor.id, created_at: at.toISOString(), expires_at })));
    this.audit(actor.id, 'run.shared', 'run_share', shareIds[0], requestId, { kind, target, runs: [...all].sort(), expiresAt: expires_at, shares: shareIds });
    return { shares: shareIds.map(id => this.repo.get(id)!), link_token: token };
  }

  list(actor: ShareActor): RunShareRow[] { return this.repo.byOwner(actor.id); }

  /** Ends a share. Revoking any row of a link ends the whole link and everything redeemed from it. */
  revoke(actor: ShareActor, id: string, requestId: string) {
    const row = this.repo.get(id);
    if (!row || row.owner_principal_id !== actor.id) throw new AdmissionError('not_found', 404, 'No such share.');
    const at = this.now().toISOString();
    const rows = row.target_kind === 'link' && row.token_hash ? this.repo.byOwner(actor.id).filter(r => r.token_hash === row.token_hash) : [row];
    const ended = this.repo.transaction(() => rows.filter(r => this.repo.revoke(r.id, actor.id, at)).map(r => r.id));
    this.audit(actor.id, 'run.share_revoked', 'run_share', id, requestId, { ended });
    return { ended };
  }

  /** A signed-in holder of a share link gets principal shares naming the link; the link keeps governing them. */
  redeemLink(actor: ShareActor, token: unknown, requestId: string) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw new AdmissionError('share_invalid', 404, 'This share link is not valid.');
    const at = this.now().toISOString(), rows = this.repo.activeByToken(hashSecret(token), at);
    if (!rows.length) throw new AdmissionError('share_invalid', 404, 'This share link is not valid, was withdrawn or has expired.');
    if (rows[0].owner_principal_id === actor.id) return { runIds: rows.map(r => r.run_id), owner: true };
    this.repo.transaction(() => { for (const r of rows) if (!this.repo.redeemedBy(r.id, actor.id)) this.repo.insert({ run_id: r.run_id, owner_principal_id: r.owner_principal_id,
      target_kind: 'principal', target: actor.id, token_hash: null, via_share_id: r.id, note: r.note, created_by: actor.id, created_at: at, expires_at: r.expires_at }); });
    this.audit(actor.id, 'run.share_link_redeemed', 'run_share', rows[0].id, requestId, { runs: rows.map(r => r.run_id) });
    return { runIds: rows.map(r => r.run_id), owner: false };
  }

  readable(principalId: string, email: string | null): Set<string> { return this.repo.readableRunIds(principalId, email, this.now().toISOString()); }
}
