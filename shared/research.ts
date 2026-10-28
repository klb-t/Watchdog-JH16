import { z } from 'zod';
const Text = z.string().trim().min(1).max(4000);
export const PaperInputSchema = z.object({ title: z.string().trim().min(1).max(500), source: z.string().trim().min(1).max(2000),
  text: z.string().max(500000), coverage: z.enum(['full_text', 'excerpt', 'abstract', 'identifier_only']),
  language: z.string().max(40).nullable(), geography: z.array(z.string().max(80)).max(30),
  // E5.8b: present when the text was converted from an HTML or PDF file; names the parser and the exact input bytes.
  conversion: z.object({ format: z.enum(['html', 'pdf']), rawSha256: z.string().regex(/^[a-f0-9]{64}$/), parser: z.string().max(40), parserVersion: z.string().max(40),
    textSha256: z.string().regex(/^[a-f0-9]{64}$/), pages: z.array(z.object({ page: z.number().int().min(1), startUtf16: z.number().int().min(0), endUtf16: z.number().int().min(0) }).strict()).max(500).nullable() }).strict().optional() }).strict()
  .refine(v => v.coverage === 'identifier_only' || v.text.trim().length > 0, 'Document text is required for this coverage');
export type PaperInput = z.infer<typeof PaperInputSchema>;
const Anchored = z.object({ statement: Text, quote: z.string().min(1).max(4000) }).strict();
export const PaperAssessmentSchema = z.object({
  methodology: z.array(Anchored).max(40),
  dataRequirements: z.array(Anchored.extend({ id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,59}$/),
    construct: Text, unit: z.string().max(160).nullable(), sourceLocator: z.string().max(2000).nullable(),
    acquisition: z.enum(['public_candidate', 'original_dataset', 'requires_experts', 'requires_experiment', 'unavailable', 'unknown']) })).max(30),
  operations: z.array(z.object({ name: z.string().min(1).max(100), quote: z.string().min(1).max(4000) }).strict()).max(40),
  ambiguities: z.array(Text).max(30), hypotheses: z.array(Text).max(20),
  alternatives: z.array(z.object({ requirementId: z.string().max(60), kind: z.enum(['original_data_reuse', 'prior_dataset', 'proxy_measure', 'new_expert_panel', 'synthetic_scenario']),
    proposal: Text, constructDifference: Text, validationNeeded: Text }).strict()).max(30),
}).strict();
export type PaperAssessment = z.infer<typeof PaperAssessmentSchema>;
export const SubstitutionSchema = z.object({ assessmentId: z.string().min(1), assessmentHash: z.string().regex(/^[a-f0-9]{64}$/), requirementId: z.string().min(1),
  kind: z.enum(['original_data_reuse', 'prior_dataset', 'proxy_measure', 'new_expert_panel', 'synthetic_scenario']),
  source: Text, sourceHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), constructDifference: Text, validationNeeded: Text }).strict();
export type SubstitutionInput = z.infer<typeof SubstitutionSchema>;
export interface SourceAnchor { quote: string; startUtf16: number; endUtf16: number; textHash: string }
export interface PaperDocument { id: string; hash: string; body: PaperInput; createdAt: string;
  origins?: {hash:string;discoveryId:string;discoveryHash:string;receiptId:string}[] }

const Pointer = z.string().max(1000).refine(v => v === '' || v.startsWith('/') && !/~(?![01])/.test(v), 'Use an RFC 6901 JSON Pointer');
export const CopyPlanSchema = z.object({ version: z.literal('copy-plan-1'), name: z.string().trim().min(1).max(160),
  format: z.enum(['json', 'csv', 'html', 'pdf']), rowsPointer: Pointer, fields: z.array(z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/),
    selector: z.string().max(1000), required: z.boolean() }).strict()).min(1).max(30),
  // HTML: which table (0-based, document order, nested tables counted) and which of its rows holds the column headers.
  table: z.object({ index: z.number().int().min(0).max(199), headerRowIndex: z.number().int().min(0).max(50) }).strict().optional(),
  // PDF: an explicit reading of positioned text (PDF units, y grows upwards); nothing is inferred at copy time.
  pdfTable: z.object({ page: z.number().int().min(1).max(500), top: z.number(), bottom: z.number(), columnBoundaries: z.array(z.number()).max(59),
    columnNames: z.array(z.string().trim().min(1).max(200)).min(1).max(60), rowTolerance: z.number().min(0).max(50), joinGap: z.number().min(0).max(50),
    raisedMarker: z.string().max(4).nullable(), raisedWindow: z.number().min(0).max(50) }).strict().optional() }).strict()
  .refine(v => new Set(v.fields.map(f => f.name)).size === v.fields.length, 'Output field names must be unique')
  .refine(v => v.format === 'json' ? v.fields.every(f => Pointer.safeParse(f.selector).success) : v.rowsPointer === '', 'CSV and HTML use column headers; JSON uses pointer paths')
  .refine(v => (v.format === 'html') === (v.table !== undefined), 'An HTML plan names its table; other formats do not')
  .refine(v => (v.format === 'pdf') === (v.pdfTable !== undefined), 'A PDF plan states its table reading; other formats do not')
  .refine(v => !v.pdfTable || new Set(v.pdfTable.columnNames).size === v.pdfTable.columnNames.length, 'PDF column names must be unique');
export type CopyPlan = z.infer<typeof CopyPlanSchema>;
