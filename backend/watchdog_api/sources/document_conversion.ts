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

// --------------------------------------------------------------------------
// PDF tables. A PDF has positioned text, not tables. The layout below is the
// exact pdf.js output (positions rounded to 0.01 units for platform-stable
// bytes); a table is read from it only by an explicit plan: page, vertical
// range, column boundaries, column names, row tolerance, the gap under which
// fragments join without a space, and how raised text (exponents) is marked.
// --------------------------------------------------------------------------

export interface PdfLayoutItem { i: number; str: string; x: number; y: number; w: number; h: number }
export interface PdfLayout { version: 'pdf-layout-1'; rawSha256: string; parser: { id: string; version: string }; pages: { page: number; width: number; height: number; items: PdfLayoutItem[] }[] }
export interface PdfTableSpec { page: number; top: number; bottom: number; columnBoundaries: number[]; columnNames: string[]; rowTolerance: number; joinGap: number; raisedMarker: string | null; raisedWindow: number }

const r2 = (v: number) => Math.round(v * 100) / 100;

export async function pdfLayout(bytes: Buffer): Promise<PdfLayout> {
  if (bytes.length > LIMITS.pdfBytes) throw new AutomationError('PDF input exceeds 20 MB');
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AutomationError('Not a PDF file');
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  try {
    if (doc.numPages > LIMITS.pdfPages) throw new AutomationError(`PDF has ${doc.numPages} pages; the limit is ${LIMITS.pdfPages}`);
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p), view = page.view, content = await page.getTextContent();
      const items: PdfLayoutItem[] = content.items.filter((it: any) => typeof it.str === 'string' && it.str.trim() !== '')
        .map((it: any, i: number) => ({ i, str: it.str, x: r2(it.transform[4]), y: r2(it.transform[5]), w: r2(it.width), h: r2(it.height) }));
      pages.push({ page: p, width: r2(view[2] - view[0]), height: r2(view[3] - view[1]), items });
    }
    return { version: 'pdf-layout-1', rawSha256: sha(bytes), parser: { id: 'pdfjs-dist', version: PDFJS_VERSION }, pages };
  } finally { await doc.destroy(); }
}

export function parsePdfLayout(raw: string): PdfLayout {
  let layout: PdfLayout;
  try { layout = JSON.parse(raw); } catch { throw new AutomationError('A PDF table source must be a pdf-layout-1 document (convert the PDF first)'); }
  if (layout?.version !== 'pdf-layout-1' || !Array.isArray(layout.pages) || !/^[a-f0-9]{64}$/.test(layout.rawSha256 ?? '')) throw new AutomationError('Not a pdf-layout-1 document');
  return layout;
}

/**
 * Text lines of a region: items grouped by baseline within the tolerance. With
 * a raised window, a line made only of smaller text that sits at most that far
 * above the next line (exponents, footnote marks) joins that line.
 */
function pdfRows(items: PdfLayoutItem[], tolerance: number, raisedWindow = 0) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x), rows: { y: number; items: PdfLayoutItem[] }[] = [];
  for (const it of sorted) {
    const row = rows.find(r => Math.abs(it.y - r.y) <= tolerance);
    if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  rows.sort((a, b) => b.y - a.y);
  for (let k = 0; raisedWindow > 0 && k < rows.length - 1; k++) {
    const above = rows[k], below = rows[k + 1], gap = above.y - below.y;
    if (gap > tolerance && gap <= raisedWindow && Math.max(...above.items.map(i => i.h)) < Math.max(...below.items.map(i => i.h))) {
      below.items.push(...above.items); rows.splice(k, 1); k--;
    }
  }
  return rows.map(r => ({ y: r.y, items: r.items.sort((a, b) => a.x - b.x || a.i - b.i) }));
}

export function pdfPageLines(layout: PdfLayout, page: number, tolerance = 2, top?: number, bottom?: number, raisedWindow = 0) {
  const p = layout.pages.find(x => x.page === page);
  if (!p) throw new AutomationError(`No page ${page}; the document has ${layout.pages.length}`);
  const items = p.items.filter(it => (top === undefined || it.y <= top) && (bottom === undefined || it.y >= bottom));
  const rows = pdfRows(items, tolerance, raisedWindow);
  // Proposal only: x positions inside gaps shared by at least 60% of rows. The plan must state boundaries itself.
  const width = Math.ceil(p.width), covered = new Array(width + 1).fill(0);
  for (const r of rows) { const mask = new Array(width + 1).fill(false); for (const it of r.items) for (let x = Math.max(0, Math.floor(it.x)); x <= Math.min(width, Math.ceil(it.x + it.w)); x++) mask[x] = true; mask.forEach((m, x) => { if (m) covered[x]++; }); }
  const minX = Math.min(...items.map(i => i.x)), maxX = Math.max(...items.map(i => i.x + i.w)), proposals: number[] = [];
  let start = -1;
  for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
    const empty = rows.length > 0 && covered[x] <= rows.length * 0.4;
    if (empty && start < 0) start = x;
    if (!empty && start >= 0) { if (x - start >= 4) proposals.push(r2((start + x) / 2)); start = -1; }
  }
  return { page, width: p.width, height: p.height, lines: rows.map(r => ({ y: r.y, text: r.items.map(i => i.str).join(' '), items: r.items.map(i => ({ i: i.i, x: i.x, w: i.w, str: i.str })) })),
    proposedBoundaries: proposals, note: 'Proposed boundaries are gaps shared by most rows; review them before use.' };
}

export function pdfTableRecords(layout: PdfLayout, spec: PdfTableSpec) {
  const p = layout.pages.find(x => x.page === spec.page);
  if (!p) throw new AutomationError(`No page ${spec.page}`);
  const b = spec.columnBoundaries;
  if (b.some((v, i) => i > 0 && v <= b[i - 1])) throw new AutomationError('Column boundaries must increase');
  if (spec.columnNames.length !== b.length + 1) throw new AutomationError('Give one column name more than there are boundaries');
  if (spec.top <= spec.bottom) throw new AutomationError('top must be above bottom (PDF y grows upwards)');
  const rows = pdfRows(p.items.filter(it => it.y <= spec.top && it.y >= spec.bottom), spec.rowTolerance, spec.raisedWindow);
  if (rows.length > LIMITS.tableRows) throw new AutomationError('Table row limit exceeded');
  return rows.map((row, rowIndex) => {
    const cells = spec.columnNames.map(() => ({ text: '', items: [] as number[], raised: false, bbox: null as null | [number, number, number, number] }));
    const lastEnd: number[] = spec.columnNames.map(() => -Infinity);
    for (const it of row.items) {
      const col = b.filter(v => it.x + it.w / 2 > v).length, cell = cells[col];
      const raised = it.y > row.y + spec.rowTolerance;
      const piece = raised && spec.raisedMarker !== null ? `${spec.raisedMarker}${it.str}` : it.str;
      cell.text += cell.text === '' || it.x - lastEnd[col] < spec.joinGap ? piece : ` ${piece}`;
      lastEnd[col] = it.x + it.w; cell.items.push(it.i); cell.raised ||= raised;
      cell.bbox = cell.bbox ? [Math.min(cell.bbox[0], it.x), Math.min(cell.bbox[1], it.y), Math.max(cell.bbox[2], it.x + it.w), Math.max(cell.bbox[3], it.y + it.h)] : [it.x, it.y, it.x + it.w, it.y + it.h];
    }
    return { rowIndex, y: row.y, cells: cells.map(c => ({ ...c, text: c.text.trim() })) };
  });
}

/**
 * JATS XML (PubMed Central / Europe PMC full text) to plain text: the article
 * title, the abstract and the body; references (<back>) are left out. Block
 * elements become line breaks, table cells tabs; entities are decoded. A small
 * explicit reader, not an XML schema validator: it never invents content.
 */
export const JATS_TEXT_VERSION = '1';
const JATS_BLOCK = /<\/?(p|sec|title|abstract|table-wrap|caption|tr|list-item|fig|disp-formula|label|boxed-text)\b[^>]*>/gi;
const decode = (s: string) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
export function jatsToText(xml: string) {
  if (Buffer.byteLength(xml) > LIMITS.htmlBytes * 5) throw new AutomationError('JATS input exceeds 10 MB');
  const part = (re: RegExp) => xml.match(re)?.[1] ?? '';
  const plain = (s: string) => tidy(decode(s.replace(JATS_BLOCK, '\n').replace(/<\/?(td|th)\b[^>]*>/gi, '\t').replace(/<[^>]+>/g, '')));
  const title = plain(part(/<article-title[^>]*>([\s\S]*?)<\/article-title>/i)) || null;
  const abstract = plain(part(/<abstract[^>]*>([\s\S]*?)<\/abstract>/i)), body = plain(part(/<body[^>]*>([\s\S]*?)<\/body>/i));
  const bodyXml = part(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const sections = [...bodyXml.matchAll(/<sec\b[^>]*>\s*<title[^>]*>([\s\S]*?)<\/title>/gi)].map(m => plain(m[1])).filter(Boolean);
  return { format: 'jats' as const, text: [title, abstract, body].filter(Boolean).join('\n\n'), title, sections, tables: (bodyXml.match(/<table-wrap\b/gi) ?? []).length,
    rawSha256: sha(xml), parser: { id: 'jats-text', version: JATS_TEXT_VERSION } };
}
