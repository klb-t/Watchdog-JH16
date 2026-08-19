import { canonicalHash } from '../domain/canonical';
import { ApprovalState } from '../domain/approval';

/**
 * Narrative service (E1.17).
 *
 * Consumes a **frozen** payload and its hash. It cannot read the database,
 * cannot recompute, and cannot alter a scientific value — the type it receives
 * is the only thing it sees, and the output carries the hash of what it was
 * given so any drift is detectable.
 *
 * Every generated paragraph is `PROPOSED` until a human approves it, and is
 * rendered visually distinct from deterministic content wherever it appears,
 * including in exports.
 */

export interface NarrativePayload {
  readonly runId: string;
  readonly presetId: string | null;
  /** Already-computed values. Read-only to this service by construction. */
  readonly results: readonly { metricKey: string; entityId?: string; valueNumeric: number | null; unit?: string }[];
  readonly missingCount: number;
  readonly qualityFlags: readonly string[];
}

export interface NarrativeRequest {
  payload: NarrativePayload;
  payloadHash: string;
  templateId: string;
  templateVersion: string;
  providerId: string | null;
  model: string | null;
  generationParams?: Record<string, unknown>;
}

export interface Narrative {
  runId: string;
  templateId: string;
  templateVersion: string;
  providerId: string | null;
  model: string | null;
  generationParams: Record<string, unknown> | null;
  inputPayloadHash: string;
  content: string;
  contentHash: string;
  approvalState: ApprovalState;
  /** Marks the text as machine-generated in every format that can show it. */
  generated: true;
}

export class NarrativePayloadTamperedError extends Error {
  readonly code = 'validation_error';
  constructor() {
    super('Narrative payload does not match its hash; refusing to describe data that may have changed under it.');
    this.name = 'NarrativePayloadTamperedError';
  }
}

export function hashNarrativePayload(payload: NarrativePayload): string {
  return canonicalHash(payload);
}

/**
 * The E1 narrative generator is deterministic and template-based rather than
 * model-backed. That is a deliberate E1 choice, not a stub: no language
 * provider is configured offline, and a template that states only what the
 * numbers say cannot invent a finding. E2 swaps the body for a real provider
 * behind the same interface and the same approval gate.
 *
 * The reporting-language rule in `03_JH2016_CONTRACT.md` applies here: this
 * never says "successful replication", only what was computed.
 */
export function generateNarrative(request: NarrativeRequest): Narrative {
  const actual = hashNarrativePayload(request.payload);
  if (actual !== request.payloadHash) throw new NarrativePayloadTamperedError();

  const { payload } = request;
  const pi = payload.results.filter(r => r.metricKey === 'Pi' && r.valueNumeric !== null);
  const hi = payload.results.filter(r => r.metricKey === 'Hi' && r.valueNumeric !== null);

  const ranked = [...pi].sort((a, b) => (b.valueNumeric ?? 0) - (a.valueNumeric ?? 0));
  const top = ranked.slice(0, 3).map(r => r.entityId).filter(Boolean);

  const lines = [
    `Methodological reproduction completed for run ${payload.runId}` +
      (payload.presetId ? ` under preset ${payload.presetId}` : '') + '.',
    `Data acquisition produced ${pi.length} computable popularity indices and ${hi.length} computable harm indices.`,
    payload.missingCount > 0
      ? `${payload.missingCount} observation(s) were missing and are enumerated in the manifest; they are not treated as zero.`
      : 'No observations were missing.',
    top.length > 0 ? `Ranked by popularity index, the highest were: ${top.join(', ')}.` : '',
    payload.qualityFlags.length > 0
      ? `Quality flags raised in this run: ${[...payload.qualityFlags].sort().join(', ')}.`
      : '',
    'Equivalence to previously published findings is not asserted here; see the replication verdicts for that comparison.',
  ].filter(Boolean);

  const content = lines.join(' ');

  return {
    runId: payload.runId,
    templateId: request.templateId,
    templateVersion: request.templateVersion,
    providerId: request.providerId,
    model: request.model,
    generationParams: request.generationParams ?? null,
    inputPayloadHash: request.payloadHash,
    content,
    contentHash: canonicalHash({ content }),
    // Always PROPOSED on creation. Nothing here can approve itself.
    approvalState: 'PROPOSED',
    generated: true,
  };
}
