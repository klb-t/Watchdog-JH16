/** Domain-neutral, versioned data and figure contracts. No drug-specific concepts. */
import { z } from 'zod';
import { EVIDENCE_TIERS } from '../backend/watchdog_api/domain/evidence_tier';
export class WorkbenchInputError extends Error { readonly code = 'validation_error'; }
const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.:-]{0,99}$/);
const text = z.string().trim().min(1).max(500);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const cell = z.union([z.string().max(1000), z.number().finite(), z.null()]);
const citation = z.object({ url: z.url().refine(s => new URL(s).protocol === 'https:' && !new URL(s).username && !new URL(s).password),
  title: text, publisher: text, retrievedAt: z.iso.datetime(), license: text, sourceRecordId: text }).strict();
export const DatasetSchema = z.object({ version: z.literal('workbench-dataset-1'), key, name: text, description: text,
  source: citation, providerProfileId: key,
  rawInput: z.object({ mediaType: z.literal('text/csv'), text: z.string().max(1_000_000), separator: z.enum([',', ';', '\t']), headerRecord: z.number().int().min(1) }).strict().optional(),
  measure: text, normalization: z.enum(['none', 'within_export_0_100', 'consistently_scaled', 'unknown']),
  comparisonScope: text, languageMeaning: z.enum(['query_term_language', 'corpus_language', 'interface_language', 'unknown']),
  columns: z.array(z.object({ key, label: text, type: z.enum(['number', 'text', 'date']), unit: text.nullable(),
    semanticType: z.enum(['count', 'proportion', 'percentage', 'score', 'rank', 'coefficient', 'dimension']), description: text }).strict()).min(2).max(60),
  rows: z.array(z.object({ id: key, values: z.record(key, cell), evidenceTier: z.enum(EVIDENCE_TIERS),
    qualityFlags: z.array(key).max(30), missingReasons: z.record(key, text) }).strict()).min(1).max(10000),
}).strict();
export type DatasetDocument = z.infer<typeof DatasetSchema>;
export function validateDataset(input: unknown): DatasetDocument {
  const d = DatasetSchema.parse(input);
  if (new Set(d.columns.map(c => c.key)).size !== d.columns.length || new Set(d.rows.map(r => r.id)).size !== d.rows.length)
    throw new WorkbenchInputError('Dataset column and row identifiers must be unique.');
  const names = new Set(d.columns.map(c => c.key));
  for (const row of d.rows) {
    if (Object.keys(row.values).length !== names.size || Object.keys(row.values).some(k => !names.has(k))) throw new WorkbenchInputError('Every row must contain exactly the declared columns, including explicit nulls.');
    for (const c of d.columns) {
      const value = row.values[c.key];
      if (value === null) { if (!row.missingReasons[c.key]) throw new WorkbenchInputError(`Missing value in ${row.id}/${c.key} requires a reason.`); continue; }
      if (c.type === 'number' ? typeof value !== 'number' : typeof value !== 'string') throw new WorkbenchInputError(`Incorrect type in ${row.id}/${c.key}.`);
      if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) throw new WorkbenchInputError(`Unsafe integer in ${row.id}/${c.key}; retain it as source text instead of rounding.`);
      if (c.type === 'date' && !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(String(value))) throw new WorkbenchInputError('Dates must be ISO formatted.');
      if (c.type === 'date' && !Number.isFinite(Date.parse(String(value)))) throw new WorkbenchInputError('Date value is invalid.');
    }
  }
  return d;
}
export interface DatasetRecord { id: string; document: DatasetDocument; contentHash: string; approvalState: 'PROPOSED' | 'APPROVED';
  approvedHash: string | null; approvedBy: string | null; approvedAt: string | null; ownerId: string; visibility: 'private' | 'shared_aggregate' }
const optionalColumn = key.nullable();
export const FigureSchema = z.object({ version: z.literal('figure-1'), rendererVersion: z.literal('svg-workbench-1'),
  name: text, datasetId: z.string().min(1), datasetHash: hash, profileHash: hash, renderer: key,
  channels: z.object({ x: key, y: key, z: optionalColumn, color: optionalColumn, size: optionalColumn,
    alpha: optionalColumn, label: optionalColumn, series: optionalColumn, facet: optionalColumn, time: optionalColumn, region: optionalColumn }).strict(),
  filters: z.array(z.object({ column: key, operator: z.enum(['equals', 'contains', 'range']), values: z.array(cell).min(1).max(2) }).strict()).max(30),
  selectedIds: z.array(key).max(10000),
  style: z.object({ title: z.string().max(250), subtitle: z.string().max(500), xLabel: z.string().max(150), yLabel: z.string().max(150),
    palette: key, opacity: z.number().min(0.1).max(1), pointSize: z.number().min(2).max(20), lineWidth: z.number().min(0.5).max(8),
    fontSize: z.number().min(8).max(24), labels: z.boolean(), grid: z.boolean(), legend: z.boolean(),
    domainScope: z.enum(['dataset', 'filtered']).optional(),
    xScale: z.enum(['linear', 'log']), yScale: z.enum(['linear', 'log']) }).strict(),
  camera: z.object({ yaw: z.number().min(-180).max(180), pitch: z.number().min(-90).max(90), zoom: z.number().min(0.5).max(8), centerLongitude: z.number().min(-180).max(180), centerLatitude: z.number().min(-90).max(90) }).strict(),
  timeValue: z.union([z.string(), z.number(), z.null()]),
  analysis: z.object({ methodId: text, methodHash: hash, resultHash: hash }).strict().nullable(),
}).strict();
export type FigureSpec = z.infer<typeof FigureSchema>;
export interface SavedFigure { id: string; ownerId: string; favorite: boolean; spec: FigureSpec; hash: string; savedAt: string }
export interface WorkbenchProfile { version: string; contentHash: string; evidenceDisplay: Record<string, { label: string; color: string; icon: string; bucket: string }>; renderers: { id: string; label: string; dimensions: number; description: string }[];
  palettes: { id: string; label: string; colors: string[] }[]; methods: { id: string; label: string; description: string }[];
  providerProfiles: { id: string; label: string; measure: string; normalizations: string[]; languageMeanings: string[]; notices: string[] }[] }
export function defaultFigure(record: DatasetRecord, profile: WorkbenchProfile): FigureSpec {
  const numeric = record.document.columns.filter(c => c.type === 'number');
  return { version: 'figure-1', rendererVersion: 'svg-workbench-1', name: record.document.name, datasetId: record.id, datasetHash: record.contentHash, profileHash: profile.contentHash,
    renderer: 'scatter', channels: { x: numeric[0]?.key ?? record.document.columns[0].key, y: numeric[1]?.key ?? numeric[0]?.key ?? record.document.columns[1].key,
      z: numeric[2]?.key ?? null, color: null, size: null, alpha: null, label: null, series: null, facet: null, time: null, region: null },
    filters: [], selectedIds: [], style: { title: record.document.name, subtitle: '', xLabel: '', yLabel: '', palette: 'accessible', opacity: 0.85,
      pointSize: 5, lineWidth: 1.5, fontSize: 12, labels: false, grid: true, legend: true, domainScope: 'dataset', xScale: 'linear', yScale: 'linear' },
    camera: { yaw: 25, pitch: 20, zoom: 1, centerLongitude: 0, centerLatitude: 0 }, timeValue: null, analysis: null };
}
export function filterRows(document: DatasetDocument, spec: FigureSpec) {
  return document.rows.filter(r => spec.filters.every(f => {
    const value = r.values[f.column];
    if (value === null || value === undefined) return false;
    if (f.operator === 'equals') return value === f.values[0];
    if (f.operator === 'contains') return String(value).normalize('NFKC').toLowerCase().includes(String(f.values[0]).normalize('NFKC').toLowerCase());
    return value >= f.values[0] && value <= f.values[1];
  }) && (!spec.channels.time || spec.timeValue === null || r.values[spec.channels.time] === spec.timeValue));
}
/** Presentation is deliberately absent from the identity of statistical inputs. */
export function selectionIdentity(spec: FigureSpec, columns: string[]) {
  return { datasetHash: spec.datasetHash, columns, filters: spec.filters, selectedIds: [...new Set(spec.selectedIds)].sort(), time: spec.channels.time, timeValue: spec.timeValue };
}
export function checkFigureProfile(spec: FigureSpec, profile: WorkbenchProfile) {
  if (spec.profileHash !== profile.contentHash) throw new WorkbenchInputError('This figure pins a different visualization profile. Restore that profile before rendering or exporting; settings will not be silently substituted.');
  if (!['scatter', 'line', 'bar', 'scatter3d', 'map'].includes(spec.renderer)) throw new WorkbenchInputError(`Renderer implementation '${spec.renderer}' is unavailable in this release.`);
  if (!profile.renderers.some(r => r.id === spec.renderer) || !profile.palettes.some(p => p.id === spec.style.palette)) throw new WorkbenchInputError('Unknown renderer or palette profile.');
  if (spec.renderer === 'scatter3d' && !spec.channels.z) throw new WorkbenchInputError('The 3D renderer requires a Z column.');
  if (spec.renderer === 'map' && (spec.style.xScale !== 'linear' || spec.style.yScale !== 'linear')) throw new WorkbenchInputError('Geographic coordinates must use linear longitude/latitude axes.');
  if (spec.renderer === 'bar' && spec.style.yScale === 'log') throw new WorkbenchInputError('Bars require a linear Y axis with an explicit zero baseline. Use a scatter or line view for logarithmic values.');
}
export function checkFigureBindings(spec: FigureSpec, document: DatasetDocument) {
  const columns = new Map(document.columns.map(c => [c.key, c]));
  for (const value of Object.values(spec.channels)) if (value && !columns.has(value)) throw new WorkbenchInputError(`Unknown figure column '${value}'.`);
  for (const name of ['y', ...(spec.renderer === 'scatter3d' ? ['x', 'z'] : []), 'size', 'alpha']) {
    const key = spec.channels[name as keyof FigureSpec['channels']];
    if (key && columns.get(key)!.type !== 'number') throw new WorkbenchInputError(`${name.toUpperCase()} requires a numeric column.`);
  }
  for (const axis of ['x', 'y'] as const) if (spec.style[`${axis}Scale`] === 'log' && columns.get(spec.channels[axis])!.type !== 'number') throw new WorkbenchInputError('Logarithmic axes require numeric columns.');
  if (spec.renderer === 'map') for (const [axis, unit] of [['x', 'degrees_east'], ['y', 'degrees_north']] as const) {
    const column = columns.get(spec.channels[axis])!;
    if (column.type !== 'number' || !['degrees', unit].includes(column.unit ?? '')) throw new WorkbenchInputError(`Map ${axis.toUpperCase()} must be ${axis === 'x' ? 'longitude' : 'latitude'} declared in degrees.`);
  }
  for (const f of spec.filters) {
    const column = columns.get(f.column);
    if (!column || f.values.length !== (f.operator === 'range' ? 2 : 1) || f.values.some(v => v === null || (column.type === 'number' ? typeof v !== 'number' : typeof v !== 'string'))) throw new WorkbenchInputError('Filter values must match their declared column type.');
    if (f.operator === 'range' && f.values[0]! > f.values[1]!) throw new WorkbenchInputError('Filter range must run from lower to upper value.');
  }
  const ids = new Set(document.rows.map(r => r.id));
  if (new Set(spec.selectedIds).size !== spec.selectedIds.length || spec.selectedIds.some(id => !ids.has(id))) throw new WorkbenchInputError('Figure selection must contain distinct existing rows.');
}
/** Axes transforms only affect geometry; the returned raw value is never overwritten. */
export function axisValue(value: string | number | null, type: string, scale: string): number | null {
  if (value === null || value === undefined) return null;
  const number = type === 'date' ? Date.parse(String(value)) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(number) || scale === 'log' && number <= 0) return null;
  return scale === 'log' ? Math.log10(number) : number;
}
export function csvExport(record: DatasetRecord, spec: FigureSpec): string {
  // Formula-safe CSV for spreadsheet applications. Missing remains empty and reasons stay in the file.
  const quote = (v: unknown) => '"' + (typeof v === 'string' ? v.replace(/^[=+@-]/, m => "'" + m) : String(v ?? '')).replaceAll('"', '""') + '"';
  const keys = record.document.columns.map(c => c.key);
  const header = ['row_id', ...keys, 'evidence_tier', 'approval_state', 'quality_flags', 'missing_reasons', 'source_url', 'dataset_hash', 'comparison_scope'];
  const rows = filterRows(record.document, spec).filter(r => !spec.selectedIds.length || spec.selectedIds.includes(r.id)).map(r => [r.id, ...keys.map(k => r.values[k]), r.evidenceTier, record.approvalState,
    r.qualityFlags.join('|'), JSON.stringify(r.missingReasons), record.document.source.url, record.contentHash, record.document.comparisonScope]);
  return [header, ...rows].map(r => r.map(quote).join(',')).join('\n') + '\n';
}
