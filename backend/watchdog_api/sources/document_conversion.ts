import { createHash } from 'node:crypto';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { AutomationError } from '../db/repositories/automation';

/**
 * E5.8b — deterministic document conversion.
 *
 * HTML is parsed by parse5 (the WHATWG HTML parsing algorithm), so malformed
 * markup is repaired exactly as a browser would and never by a guess. PDF text
 * is read by Mozilla's pdf.js with script evaluation off. No model sees or
 * produces any value here; every output names its parser and version and the
 * sha256 of the exact input bytes. Tables are read from HTML only: a PDF has no
 * table structure, and inferring one from glyph positions is a separate method
 * that is not implemented.
 */

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

export const PARSE5_VERSION = '7.3.0';
export const PDFJS_VERSION = '4.10.38';
export const LIMITS = { htmlBytes: 2_000_000, pdfBytes: 20_000_000, pdfPages: 500, tables: 200, tableRows: 10_000, tableColumns: 60 };

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'svg', 'math', 'iframe', 'object']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'li', 'ul', 'ol', 'table', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'br', 'hr', 'caption', 'tbody', 'thead', 'tfoot', 'form', 'fieldset', 'address']);
const isElement = (n: Node): n is Element => 'tagName' in n;

function parseHtml(html: string) {
  if (Buffer.byteLength(html) > LIMITS.htmlBytes) throw new AutomationError('HTML input exceeds 2 MB');
  return parse(html, { sourceCodeLocationInfo: true });
}

function textOf(node: Node, out: string[]) {
  if (node.nodeName === '#text') { out.push((node as any).value); return; }
  if (!isElement(node) && node.nodeName !== '#document' && node.nodeName !== '#document-fragment') return;
  if (isElement(node) && SKIP.has(node.tagName)) return;
  const block = isElement(node) && BLOCK.has(node.tagName);
  if (block) out.push('\n');
  for (const child of (node as any).childNodes ?? []) textOf(child, out);
  if (isElement(node) && (node.tagName === 'td' || node.tagName === 'th')) out.push('\t');
  if (block) out.push('\n');
}

const tidy = (s: string) => s.replace(/[ \t ]+/g, m => (m.includes('\t') ? '\t' : ' ')).split('\n').map(l => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

export function htmlToText(html: string) {
  const doc = parseHtml(html), out: string[] = [];
  textOf(doc, out);
  const title = findAll(doc, 'title')[0];
  return { format: 'html' as const, text: tidy(out.join('')), title: title ? tidy(cellText(title)) : null, rawSha256: sha(html),
    parser: { id: 'parse5', version: PARSE5_VERSION }, pages: null };
}

function findAll(node: Node, tag: string, acc: Element[] = []): Element[] {
  if (isElement(node) && node.tagName === tag) acc.push(node);
  if (isElement(node) && SKIP.has(node.tagName) && tag !== 'title') return acc;
  for (const c of (node as any).childNodes ?? []) findAll(c, tag, acc);
  if (isElement(node) && node.tagName === 'template') for (const c of (node as any).content?.childNodes ?? []) findAll(c, tag, acc);
  return acc;
}

function cellText(el: Node): string { const out: string[] = []; for (const c of (el as any).childNodes ?? []) textOf(c, out); return out.join('').replace(/\s+/g, ' ').trim(); }

/** Rows of one table, nested tables excluded, colspan/rowspan expanded into a rectangular grid. */
function tableGrid(table: Element) {
  const rows: Element[] = [];
  const collect = (n: Node) => { for (const c of (n as any).childNodes ?? []) { if (!isElement(c)) continue; if (c.tagName === 'tr') rows.push(c); else if (['thead', 'tbody', 'tfoot'].includes(c.tagName)) collect(c); } };
  collect(table);
  if (rows.length > LIMITS.tableRows) throw new AutomationError('Table row limit exceeded');
  const grid: { text: string; header: boolean; start: number | null; end: number | null; spanned: boolean }[][] = [];
  rows.forEach((tr, r) => {
    grid[r] = grid[r] ?? []; let c = 0;
    for (const cell of tr.childNodes.filter(isElement).filter(x => x.tagName === 'td' || x.tagName === 'th')) {
      while (grid[r][c]) c++;
      const colspan = Math.min(Math.max(1, Number(cell.attrs.find(a => a.name === 'colspan')?.value) || 1), LIMITS.tableColumns);
      const rowspan = Math.min(Math.max(1, Number(cell.attrs.find(a => a.name === 'rowspan')?.value) || 1), rows.length - r);
      const loc = cell.sourceCodeLocation, value = { text: cellText(cell), header: cell.tagName === 'th', start: loc?.startOffset ?? null, end: loc?.endOffset ?? null };
      for (let dr = 0; dr < rowspan; dr++) for (let dc = 0; dc < colspan; dc++) {
        grid[r + dr] = grid[r + dr] ?? [];
        if (c + dc >= LIMITS.tableColumns) throw new AutomationError('Table column limit exceeded');
        grid[r + dr][c + dc] = { ...value, spanned: dr > 0 || dc > 0 };
      }
      c += colspan;
    }
  });
  const width = Math.max(0, ...grid.map(r => r.length));
  return grid.map(r => Array.from({ length: width }, (_, i) => r[i] ?? { text: '', header: false, start: null, end: null, spanned: true }));
}

/** Tables with their captions and header rows; values are not included (structure for review or a model). */
export function htmlTableStructure(html: string) {
  const tables = findAll(parseHtml(html), 'table');
  if (tables.length > LIMITS.tables) throw new AutomationError('Table count limit exceeded');
  return tables.map((t, index) => {
    const grid = tableGrid(t), caption = t.childNodes.filter(isElement).find(x => x.tagName === 'caption');
    return { index, caption: caption ? cellText(caption) : null, rows: grid.length, columns: grid[0]?.length ?? 0, firstRow: (grid[0] ?? []).map(c => c.text) };
  });
}

/** Records of one table with exact cell text and its source offsets (UTF-16 code units of the input). */
export function htmlTableRecords(html: string, index: number, headerRowIndex: number) {
  const tables = findAll(parseHtml(html), 'table');
  if (!tables[index]) throw new AutomationError(`No table ${index}; the document has ${tables.length}`);
  const grid = tableGrid(tables[index]);
  if (!grid[headerRowIndex]) throw new AutomationError('The header row does not exist');
  const headers = grid[headerRowIndex].map(c => c.text);
  if (headers.some(h => !h) || new Set(headers).size !== headers.length) throw new AutomationError('Table header cells must be non-empty and unique');
  return { headers, rows: grid.slice(headerRowIndex + 1).map((r, i) => ({ rowIndex: headerRowIndex + 1 + i, cells: r })) };
}

export async function pdfToText(bytes: Buffer) {
  if (bytes.length > LIMITS.pdfBytes) throw new AutomationError('PDF input exceeds 20 MB');
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AutomationError('Not a PDF file');
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  try {
    if (doc.numPages > LIMITS.pdfPages) throw new AutomationError(`PDF has ${doc.numPages} pages; the limit is ${LIMITS.pdfPages}`);
    let text = ''; const pages: { page: number; startUtf16: number; endUtf16: number }[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      const pageText = tidy(content.items.map((it: any) => (it.str ?? '') + (it.hasEOL ? '\n' : '')).join(''));
      if (text) text += '\n\n';
      const start = text.length; text += pageText; pages.push({ page: p, startUtf16: start, endUtf16: text.length });
    }
    const info = await doc.getMetadata().catch(() => null);
    return { format: 'pdf' as const, text, title: info?.info?.Title ? String(info.info.Title) : null, rawSha256: sha(bytes),
      parser: { id: 'pdfjs-dist', version: PDFJS_VERSION }, pages,
      ...(text.trim() ? {} : { warning: 'No text layer found (a scanned PDF needs OCR, which is not part of this conversion)' }) };
  } finally { await doc.destroy(); }
}
