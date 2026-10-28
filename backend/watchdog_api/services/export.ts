import { AnalysisResultValue } from '../domain/method_spec';
import { Narrative } from './narrative';
import { approvalState, Approvable } from '../domain/approval';

/**
 * Export (E1.18).
 *
 * Exports consume **stored** results. They never recompute and never re-fetch —
 * an export that recalculates is a second implementation of the science, and
 * the two will diverge.
 *
 * Generated prose is visually distinguishable in every format that supports it,
 * so a reader who did not run the analysis can still tell which parts a machine
 * wrote.
 */

export class UnapprovedArtifactExportError extends Error {
  readonly code = 'export_error';
  constructor(what: string) {
    super(`Refusing to export ${what}: it is PROPOSED and has not been approved.`);
    this.name = 'UnapprovedArtifactExportError';
  }
}

export interface ExportInput {
  runId: string;
  results: readonly AnalysisResultValue[];
  narrative?: Narrative | null;
  /** The approvable record for the narrative, if one is being included. */
  narrativeApprovable?: Approvable | null;
  missingObservations?: readonly { entity_id: string; query_role: string; missing_reason: string }[];
  qualityFlags?: readonly string[];
  /** The stored counts the results were computed from, with their provenance. */
  observations?: readonly ExportObservation[];
  /** The stored JH16 evaluation artifact, exported as recorded. */
  evaluation?: Record<string, any> | null;
  run?: { preset_id: string | null; preset_version: string | null; source_id: string | null; effective_config_hash: string | null;
    manifest_sha256: string | null; git_commit: string | null; app_version: string | null } | null;
}

export interface ExportObservation {
  entity_id: string; query_role: string; query_text: string; value_numeric: number | null; is_missing: boolean;
  missing_reason: string | null; provider_id: string | null; retrieved_at: string; quality_flags: readonly string[];
  /** The period the value describes, for time series; absent for a present-day count. */
  observed_at?: string | null;
}

function sortedObservations(input: ExportInput) {
  return [...(input.observations ?? [])].sort((a, b) => a.entity_id.localeCompare(b.entity_id) || a.query_role.localeCompare(b.query_role) || (a.observed_at ?? '').localeCompare(b.observed_at ?? ''));
}

function assertExportable(input: ExportInput) {
  if (!input.narrative) return;
  // An unapproved narrative cannot reach an export.
  const state = input.narrativeApprovable
    ? approvalState(input.narrativeApprovable)
    : input.narrative.approvalState;
  if (state !== 'APPROVED') throw new UnapprovedArtifactExportError('the generated narrative');
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Missing values are written as an empty field with `is_missing=true`, never as
 * `0` and never as a blank that reads as zero.
 */
export function exportCsv(input: ExportInput): string {
  assertExportable(input);

  const header = ['run_id', 'entity_id', 'metric_key', 'value_numeric', 'unit', 'is_missing'];
  const rows = [...input.results]
    .sort((a, b) => a.metricKey.localeCompare(b.metricKey) || (a.entityId ?? '').localeCompare(b.entityId ?? ''))
    .map(r => [
      input.runId,
      r.entityId ?? '',
      r.metricKey,
      r.isMissing ? '' : r.valueNumeric,
      r.unit ?? '',
      r.isMissing ? 'true' : 'false',
    ].map(csvEscape).join(','));

  const lines = [header.join(','), ...rows];

  if (input.observations?.length) {
    // The counts are measurements and the rows above are derived from them, so
    // they are a separate table rather than more metric rows.
    lines.push('', '# OBSERVATIONS (stored provider counts; Ni = popularity, Ni_harm = harm)');
    lines.push(['run_id', 'entity_id', 'query_role', 'query_text', 'count', 'is_missing', 'missing_reason', 'provider_id', 'retrieved_at', 'quality_flags', 'observed_at'].join(','));
    for (const o of sortedObservations(input)) lines.push([input.runId, o.entity_id, o.query_role, o.query_text, o.is_missing ? '' : o.value_numeric,
      o.is_missing ? 'true' : 'false', o.missing_reason ?? '', o.provider_id ?? '', o.retrieved_at, [...o.quality_flags].sort().join(' '), o.observed_at ?? ''].map(csvEscape).join(','));
  }

  const ev = input.evaluation;
  if (ev) {
    lines.push('', `# JH16 EVALUATION (${ev.attempt_kind}; reference ${ev.reference?.set_key} ${ev.reference?.version}; complete=${ev.complete})`);
    lines.push(['run_id', 'comparison', 'statistic', 'value', 'p_two_sided', 'n'].join(','));
    const stat = (name: string, s: any) => lines.push([input.runId, name, s.statistic, s.value ?? '', s.p_two_sided ?? '', s.n].map(csvEscape).join(','));
    for (const s of ev.hi_vs_reference ?? []) stat('Hi_vs_reference', s);
    for (const s of ev.pi_vs_reference ?? []) stat('Pi_vs_reference', s);
    if (ev.pi_vs_published) stat('Pi_vs_published_table1', ev.pi_vs_published);
    for (const x of ev.exploratory ?? []) for (const s of x.hi_vs_reference) stat(`EXPLORATORY_${x.id}_Hi_vs_reference`, s);
    lines.push(['run_id', 'claim_key', 'verdict', 'observed', 'rationale'].join(','));
    for (const v of ev.verdicts ?? []) lines.push([input.runId, v.claim_key, v.verdict, v.observed_value ?? '', v.rationale].map(csvEscape).join(','));
    lines.push(['run_id', 'hypothesis', 'reading', 'rule'].join(','));
    lines.push([input.runId, 'H-harm', ev.hypothesis_harm?.reading, ev.hypothesis_harm?.rule].map(csvEscape).join(','));
  }

  if (input.narrative) {
    // CSV has no styling, so the distinction is carried in the data itself.
    lines.push('');
    lines.push('# GENERATED NARRATIVE (machine-written, human-approved). Not a measured value.');
    for (const line of input.narrative.content.split('\n')) lines.push(`# ${line}`);
  }

  return lines.join('\n') + '\n';
}

export function exportJson(input: ExportInput): string {
  assertExportable(input);

  const payload = {
    run_id: input.runId,
    _note: 'Exported from stored results. Nothing here was recomputed at export time.',
    results: [...input.results]
      .sort((a, b) => a.metricKey.localeCompare(b.metricKey) || (a.entityId ?? '').localeCompare(b.entityId ?? ''))
      .map(r => ({
        entity_id: r.entityId ?? null,
        metric_key: r.metricKey,
        value_numeric: r.isMissing ? null : r.valueNumeric,
        unit: r.unit ?? null,
        is_missing: r.isMissing,
      })),
    missing_observations: [...(input.missingObservations ?? [])]
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id) || a.query_role.localeCompare(b.query_role)),
    quality_flags: [...new Set(input.qualityFlags ?? [])].sort(),
    run: input.run ?? null,
    observations: sortedObservations(input).map(o => ({ ...o, quality_flags: [...o.quality_flags].sort() })),
    evaluation: input.evaluation ?? null,
    narrative: input.narrative
      ? {
          // Machine-written content is labelled as such in the structure, not
          // just in prose a consumer might drop.
          content_kind: 'GENERATED',
          generated_by_machine: true,
          approval_state: input.narrative.approvalState,
          provider_id: input.narrative.providerId,
          model: input.narrative.model,
          input_payload_hash: input.narrative.inputPayloadHash,
          content: input.narrative.content,
        }
      : null,
  };

  return JSON.stringify(payload, null, 2) + '\n';
}

export interface ExportBundle {
  csv: string;
  json: string;
}

export function exportAll(input: ExportInput): ExportBundle {
  return { csv: exportCsv(input), json: exportJson(input) };
}
