import { createHash } from 'node:crypto';
import { CopyPlanSchema, type CopyPlan } from '../../../shared/research';
import { parseCsv } from '../../../shared/csv_import';
import { AutomationError } from '../db/repositories/automation';
import { canonicalHash } from '../domain/canonical';
type Node = { start: number; end: number; kind: 'object' | 'array' | 'string' | 'literal'; children?: Map<string, Node> };

/** JSON syntax parser retaining exact numeric lexemes and source spans. Numbers
 * never pass through JSON.parse or an LLM before being copied. Duplicate keys
 * are rejected instead of silently selecting whichever value was last. */
function jsonTree(raw: string): Node {
  let pos = 0, nodes = 0;
  const whitespace = () => { while (/\s/.test(raw[pos] ?? '') && pos < raw.length) { if (!' \r\n\t'.includes(raw[pos])) throw new AutomationError('Invalid JSON whitespace'); pos++; } };
  const string = () => { const start = pos++; while (pos < raw.length) { const c = raw[pos++]; if (c === '\\') { pos++; continue; } if (c === '"') { JSON.parse(raw.slice(start,pos)); return; } } throw new AutomationError('Unterminated JSON string'); };
  const parse = (depth: number): Node => {
    if (depth > 64 || ++nodes > 100000) throw new AutomationError('JSON nesting or node limit exceeded');
    whitespace(); const start = pos, c = raw[pos];
    if (c === '"') { string(); return { start, end: pos, kind: 'string' }; }
    if (c === '{' || c === '[') {
      pos++; const children = new Map<string, Node>(), close = c === '{' ? '}' : ']'; whitespace();
      if (raw[pos] !== close) while (pos < raw.length) {
        whitespace(); let key: string;
        if (c === '{') { if (raw[pos] !== '"') throw new AutomationError('JSON object key expected'); const k = pos; string(); key = JSON.parse(raw.slice(k,pos)); whitespace(); if (raw[pos++] !== ':') throw new AutomationError('JSON colon expected'); }
        else key = String(children.size);
        if (children.has(key)) throw new AutomationError('Duplicate JSON object key'); children.set(key, parse(depth + 1)); whitespace();
        if (raw[pos] === close) break; if (raw[pos++] !== ',') throw new AutomationError('JSON delimiter expected');
      }
      if (raw[pos++] !== close) throw new AutomationError('JSON container is incomplete'); return { start, end: pos, kind: c === '{' ? 'object' : 'array', children };
    }
    const match = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(pos));
    if (!match) throw new AutomationError('Invalid JSON value'); pos += match[0].length; return { start, end: pos, kind: 'literal' };
  };
  const root = parse(0); whitespace(); if (pos !== raw.length) throw new AutomationError('Trailing JSON input'); return root;
}
function select(node: Node, pointer: string): Node | undefined {
  let current: Node | undefined = node;
  for (const token of pointer === '' ? [] : pointer.slice(1).split('/')) current = current?.children?.get(token.replace(/~1/g,'/').replace(/~0/g,'~'));
  return current;
}
export function copySource(input: string, rawPlan: unknown) {
  const plan = CopyPlanSchema.parse(rawPlan); if (Buffer.byteLength(input) > 2000000) throw new AutomationError('Extraction input exceeds 2 MB');
  const rawHash = createHash('sha256').update(input).digest('hex'), records: Record<string, string | null>[] = [], provenance: any[] = [];
  if (plan.format === 'json') {
    const root = jsonTree(input), container = select(root, plan.rowsPointer);
    if (!container || container.kind !== 'array') throw new AutomationError('rowsPointer must select an existing JSON array');
    if (container.children!.size > 10000) throw new AutomationError('Extraction row limit exceeded');
    for (const [index, row] of container.children!) {
      const out: Record<string,string|null> = Object.create(null), source: any = Object.create(null);
      for (const field of plan.fields) {
        const node = select(row, field.selector); if (!node && field.required) throw new AutomationError(`Required field ${field.name} missing at row ${index}`);
        if (node && ['object','array'].includes(node.kind)) throw new AutomationError('A copied field must be scalar');
        const literal = node ? input.slice(node.start,node.end) : null;
        out[field.name] = literal === null || literal === 'null' ? null : node!.kind === 'string' ? JSON.parse(literal) : literal;
        source[field.name] = { pointer: `${plan.rowsPointer}/${index}${field.selector}`, missing: !node, explicitNull: literal === 'null',
          startUtf16: node?.start ?? null, endUtf16: node?.end ?? null, rawLiteral: literal };
      }
      records.push(out); provenance.push(source);
    }
  } else {
    const rows = parseCsv(input, ',', true), headers = rows.shift() ?? [];
    if (!headers.length || headers.some(h=>!h) || new Set(headers).size !== headers.length || rows.length > 10000) throw new AutomationError('CSV needs unique headers and at most 10000 records');
    for (const [i, row] of rows.entries()) {
      if (row.length !== headers.length) throw new AutomationError('CSV row width differs from header');
      const out: Record<string,string|null> = Object.create(null), source: any = Object.create(null);
      for (const f of plan.fields) { const index = headers.indexOf(f.selector); if (index < 0 && f.required) throw new AutomationError(`Required CSV column ${f.selector} is missing`);
        out[f.name] = index < 0 ? null : row[index]; source[f.name] = { recordIndex: i, column: f.selector, columnIndex: index < 0 ? null : index, missing: index < 0 }; }
      records.push(out); provenance.push(source);
    }
  }
  return { version: 'copied-source-1', planHash: canonicalHash(plan), rawHash, records, provenance,
    numericalMeaning: 'Copied lexical source values. Numeric parsing, units and method approval are separate explicit operations.' };
}
/** Structure only for the model: no source cell or numeric values. */
export function sourceStructure(input: string, format: CopyPlan['format']) {
  if (Buffer.byteLength(input) > 2000000) throw new AutomationError('Extraction input exceeds 2 MB');
  if (format === 'csv') return { format, headers: parseCsv(input)[0] ?? [], valuesIncluded: false };
  const tree = jsonTree(input), paths: { pointer: string; type: string }[] = [];
  const walk = (n: Node, pointer: string) => { if (paths.length >= 500) return; paths.push({ pointer, type: n.kind });
    for (const [k,v] of n.children ?? []) { walk(v, `${pointer}/${k.replace(/~/g,'~0').replace(/\//g,'~1')}`); if (n.kind === 'array') break; } };
  walk(tree, ''); return { format, paths, valuesIncluded: false, scope: 'at most 500 paths; first array member for schema discovery' };
}
