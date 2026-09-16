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
