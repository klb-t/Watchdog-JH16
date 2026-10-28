/**
 * E5.8b: deterministic HTML/PDF conversion and HTML tables in copy plans.
 * The documents are fictional fixtures built here; they are not real studies.
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { htmlToText, htmlTableStructure, htmlTableRecords, pdfToText, pdfLayout, pdfPageLines, pdfTableRecords } from '../../backend/watchdog_api/sources/document_conversion';
import { copySource } from '../../backend/watchdog_api/sources/copy_plan';
import { CopyPlanSchema } from '../../shared/research';
import { ResearchRepository } from '../../backend/watchdog_api/db/repositories/research';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';

const HTML = `<!doctype html><html><head><title>Fictional &amp; test</title><style>td{color:red}</style><script>var x = "1,000";</script></head>
<body><h1>Fictional fixture</h1><p>Not a real study. Values &lt;1&gt; stay&nbsp;text.<p>Second paragraph
<table><caption>Counts</caption><thead><tr><th>substance</th><th colspan="2">count</th></tr><tr><th>name</th><th>2014</th><th>2026</th></tr></thead>
<tbody><tr><td rowspan="2">alpha</td><td>1,200</td><td>3.4e5</td></tr><tr><td></td><td>  7 </td></tr>
<tr><td>beta<table><tr><td>nested</td></tr></table></td><td>-0,5</td><td>n/a</td></tr></tbody></table></body></html>`;

test('HTML text follows the HTML parsing algorithm: scripts and styles dropped, entities decoded, blocks separated', () => {
  const r = htmlToText(HTML);
  assert.strictEqual(r.title, 'Fictional & test');
  assert.match(r.text, /^Fictional fixture\n\nNot a real study\. Values <1> stay text\.\n\nSecond paragraph/);
  assert.ok(!r.text.includes('var x') && !r.text.includes('color:red'));
  assert.strictEqual(r.rawSha256, createHash('sha256').update(HTML).digest('hex'));
  assert.deepStrictEqual(r.parser, { id: 'parse5', version: '7.3.0' });
});

test('HTML tables: nested tables are separate, spans are expanded, every cell keeps its source span', () => {
  const tables = htmlTableStructure(HTML);
  assert.deepStrictEqual(tables.map(t => [t.index, t.caption, t.rows, t.columns]), [[0, 'Counts', 5, 3], [1, null, 1, 1]]);
  const { headers, rows } = htmlTableRecords(HTML, 0, 1);
  assert.deepStrictEqual(headers, ['name', '2014', '2026']);
  assert.deepStrictEqual(rows.map(r => r.cells.map(c => c.text)), [['alpha', '1,200', '3.4e5'], ['alpha', '', '7'], ['beta nested', '-0,5', 'n/a']]);
  const cell = rows[0].cells[1];
  assert.match(HTML.slice(cell.start!, cell.end!), /^<td>1,200<\/td>$/);
  assert.strictEqual(rows[1].cells[0].spanned, true, 'a rowspan copy is marked as spanned');
  assert.throws(() => htmlTableRecords(HTML, 0, 0), /unique/, 'duplicate header cells (from colspan) are refused');
  assert.throws(() => htmlTableRecords(HTML, 5, 0), /No table 5/);
});

test('an HTML copy plan copies lexical cell text with provenance; empty cells are missing, not zero', () => {
  const plan = CopyPlanSchema.parse({ version: 'copy-plan-1', name: 'fixture', format: 'html', rowsPointer: '', table: { index: 0, headerRowIndex: 1 },
    fields: [{ name: 'name', selector: 'name', required: true }, { name: 'n2014', selector: '2014', required: true }, { name: 'n2026', selector: '2026', required: false }] });
  const out = copySource(HTML, plan);
  assert.deepStrictEqual(out.records.map(r => ({ ...r })), [{ name: 'alpha', n2014: '1,200', n2026: '3.4e5' }, { name: 'alpha', n2014: null, n2026: '7' }, { name: 'beta nested', n2014: '-0,5', n2026: 'n/a' }]);
  assert.strictEqual(out.provenance[1].n2014.missing, true);
  assert.strictEqual(out.provenance[0].n2014.tableIndex, 0);
  assert.throws(() => CopyPlanSchema.parse({ ...plan, table: undefined }), /names its table/);
  assert.throws(() => CopyPlanSchema.parse({ ...plan, format: 'csv' }), /names its table/);
});

/** A minimal PDF with a standard font, written byte by byte; a page is text runs [x, y, size, text] or one string. */
function pdf(pages: (string | [number, number, number, string][])[]): Buffer {
  const objects: string[] = [];
  const add = (s: string) => { objects.push(s); return objects.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [], pagesId = 2 + pages.length * 2;
  for (const text of pages) {
    const runs = typeof text === 'string' ? [[72, 720, 12, text] as [number, number, number, string]] : text;
    const stream = runs.map(([x, y, size, t]) => `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${t}) Tj ET`).join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  assert.strictEqual(add(`<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`), pagesId);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let body = '%PDF-1.4\n'; const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

test('PDF text is read page by page with page offsets; a non-PDF is refused', async () => {
  const r = await pdfToText(pdf(['Fictional page one: Hi = 27.5', 'Page two 0,816']));
  assert.strictEqual(r.pages!.length, 2);
  assert.strictEqual(r.text.slice(r.pages![0].startUtf16, r.pages![0].endUtf16), 'Fictional page one: Hi = 27.5');
  assert.strictEqual(r.text.slice(r.pages![1].startUtf16, r.pages![1].endUtf16), 'Page two 0,816');
  assert.deepStrictEqual(r.parser, { id: 'pdfjs-dist', version: '4.10.38' });
  await assert.rejects(() => pdfToText(Buffer.from('<html></html>')), /Not a PDF/);
});

test('a document keeps its conversion record only for the exact converted text', () => {
  const db = new Database(':memory:'); runMigrations(db);
  const repo = new ResearchRepository(db as any), text = htmlToText(HTML).text;
  const conversion = { format: 'html' as const, rawSha256: createHash('sha256').update(HTML).digest('hex'), parser: 'parse5', parserVersion: '7.3.0',
    textSha256: createHash('sha256').update(text).digest('hex'), pages: null };
  const base = { title: 'Fictional', source: 'fixture:html', coverage: 'full_text' as const, language: 'en', geography: [] };
  assert.strictEqual(repo.saveDocument('owner', { ...base, text, conversion }).body.conversion?.parser, 'parse5');
  assert.throws(() => repo.saveDocument('owner', { ...base, text: text + ' edited', conversion }), /differs from the converted file/);
  db.close();
});

test('the conversion endpoint takes the file as its body from this origin only, and refuses form-capable content types', async () => {
  const express = (await import('express')).default;
  const { buildResearchRouter } = await import('../../backend/watchdog_api/api/research_routes');
  const app = express(); app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { (req as any).principal = { id: 'owner', roles: ['dev'], email: null, identityProvenance: 'test' }; next(); });
  app.use('/api/research', buildResearchRouter({} as any, {} as any, {} as any, {} as any, {} as any));
  const server = app.listen(0); await new Promise(r => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/research/convert`;
  try {
    const ok = await fetch(`${url}?format=pdf`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: pdf(['Fictional upload']) });
    assert.strictEqual(ok.status, 200); assert.match((await ok.json()).text, /Fictional upload/);
    const html = await fetch(`${url}?format=html`, { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: HTML });
    assert.strictEqual((await html.json()).tables.length, 2);
    assert.strictEqual((await fetch(`${url}?format=html`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: HTML })).status, 415);
    assert.strictEqual((await fetch(`${url}?format=pdf`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', Origin: 'https://evil.example' }, body: pdf(['x']) })).status, 403);
  } finally { server.close(); }
});

test('a PDF table is read only as the plan states: rows by baseline, columns by boundaries, exponents marked, every cell traced', async () => {
  const page: [number, number, number, string][] = [[72, 700, 10, 'Model'], [200, 700, 10, 'Score'], [300, 700, 10, 'Cost'],
    [72, 680, 10, 'Alpha'], [200, 680, 10, '27.3'], [300, 680, 10, '3.3'], [316, 680, 10, 'x 10'], [334.9, 684, 7, '18'],
    [72, 660, 10, 'Beta'], [300, 660, 10, '1.0'], [72, 600, 10, 'Outside the table']];
  const layout = await pdfLayout(pdf([page]));
  const lines = pdfPageLines(layout, 1, 2, 710, 650, 5);
  assert.strictEqual(lines.lines.length, 3, 'the raised exponent joins its row');
  assert.ok(lines.proposedBoundaries.some(b => b > 110 && b < 200) && lines.proposedBoundaries.some(b => b > 220 && b < 300), JSON.stringify(lines.proposedBoundaries));
  const spec = { page: 1, top: 690, bottom: 650, columnBoundaries: [150, 250], columnNames: ['model', 'score', 'cost'], rowTolerance: 2, joinGap: 1, raisedMarker: '^', raisedWindow: 5 };
  const rows = pdfTableRecords(layout, spec);
  assert.deepStrictEqual(rows.map(r => r.cells.map(c => c.text)), [['Alpha', '27.3', '3.3 x 10^18'], ['Beta', '', '1.0']]);
  assert.strictEqual(rows[0].cells[2].raised, true);
  const plan = CopyPlanSchema.parse({ version: 'copy-plan-1', name: 'pdf', format: 'pdf', rowsPointer: '', pdfTable: spec,
    fields: [{ name: 'model', selector: 'model', required: true }, { name: 'score', selector: 'score', required: true }] });
  const out = copySource(JSON.stringify(layout), plan);
  assert.deepStrictEqual(out.records.map(r => ({ ...r })), [{ model: 'Alpha', score: '27.3' }, { model: 'Beta', score: null }]);
  assert.strictEqual(out.provenance[0].score.pdfSha256, layout.rawSha256);
  assert.strictEqual(out.provenance[0].score.page, 1);
  assert.ok(out.provenance[0].score.bbox[0] >= 199 && out.provenance[0].score.itemIndices.length === 1);
  assert.strictEqual(out.provenance[1].score.missing, true, 'an empty cell is missing, never zero');
  assert.throws(() => copySource('{"not":"a layout"}', plan), /pdf-layout-1/);
  assert.throws(() => pdfTableRecords(layout, { ...spec, columnNames: ['a', 'b'] }), /one column name more/);
  assert.throws(() => CopyPlanSchema.parse({ ...plan, pdfTable: undefined }), /PDF plan/);
  assert.throws(() => CopyPlanSchema.parse({ ...plan, pdfTable: { ...spec, columnNames: ['a', 'a', 'b'] } }), /unique/);
});
