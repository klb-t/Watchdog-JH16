import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { UiBundleSchema, fillText } from '../../shared/ui_text';

/**
 * Hard rule 3 for the interface: every page renders its words from `config/ui/*.json`
 * in both languages. The bundle test checks the data; the scan checks the code, so a
 * new hardcoded sentence on a page fails here instead of reaching a reader in the
 * wrong language.
 */
const UI_DIR = path.join(process.cwd(), 'config/ui');
const bundles = fs.readdirSync(UI_DIR).filter(f => f.endsWith('.json')).sort();

test('every interface text bundle has both languages with the same keys and placeholders', () => {
  assert.ok(bundles.includes("common.json"));
  for (const file of bundles) {
    const parsed = UiBundleSchema.safeParse(JSON.parse(fs.readFileSync(path.join(UI_DIR, file), 'utf8')));
    assert.ok(parsed.success, `${file}: ${parsed.success ? '' : parsed.error.issues.map(i => i.message).join('; ')}`);
    assert.equal(parsed.data.version.startsWith(`ui-${file.replace(/\.json$/, '').replace(/_/g, '-')}-`), true, `${file}: version names the bundle`);
  }
});

test('placeholders are filled and an unknown key stays visible rather than blank', () => {
  const b = { version: 'ui-x-1', languages: { pl: { a: 'Ma {n} wierszy' }, en: { a: 'Has {n} rows' }, nl: { a: 'Heeft {n} rijen' } } };
  assert.equal(fillText(b, 'pl', 'a', { n: 3 }), 'Ma 3 wierszy');
  assert.equal(fillText(b, 'en', 'a'), 'Has {n} rows');
  assert.equal(fillText(b, 'en', 'missing'), 'missing');
});

// Files whose visible words are not interface wording, each with the reason.
const NOT_SCANNED: Record<string, string> = {
  'src/components/FigureCanvas.tsx': 're-export only',
};
// Literals that are the same in both languages: names, symbols, units and formats.
const SAME_IN_BOTH = new Set(['WatchDog', 'JH16', 'CR2014', 'JSON', 'CSV', 'PDF', 'HTML', 'SVG', 'PNG', 'URL', 'DOI', 'ID', 'SHA-256', 'SerpApi', 'Google Trends',
  'OpenRouter', 'PubChem', 'Spearman', 'Pearson', 'Kendall', 'API', 'LLM', 'ρ', 'r', 'n', 'p', 'N', 'k', 'OK', 'Polski', 'English', 'GeoJSON', 'ZIP', 'Markdown', 'TSV', 'XLSX', '· doi:', '· sha256']);
const VISIBLE_ATTRIBUTES = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'aria-description', 'aria-placeholder']);
const LETTERS = /\p{L}{2,}/u;
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
const looksLikeClasses = (s: string) => s.trim().split(/\s+/).every(w => /^[!a-z0-9:\-/[\].%#_()&>*,='"]+$/.test(w)) && /[-:]/.test(s);

function hardcodedTexts(file: string): string[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const report = (node: ts.Node, text: string) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!LETTERS.test(clean) || SAME_IN_BOTH.has(clean)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart());
    found.push(`${file}:${line + 1}: ${clean.slice(0, 90)}`);
  };
  const literalText = (n: ts.Node): string | null =>
    ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text
      : ts.isTemplateExpression(n) ? [n.head.text, ...n.templateSpans.map(s => s.literal.text)].join(' ') : null;
  /** Strings that reach the screen as they are: JSX children and the branches of a JSX expression. */
  const visibleBranches = (n: ts.Expression): ts.Expression[] => {
    if (ts.isParenthesizedExpression(n)) return visibleBranches(n.expression);
    if (ts.isConditionalExpression(n)) return [...visibleBranches(n.whenTrue), ...visibleBranches(n.whenFalse)];
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(n.operatorToken.kind))
      return [...(n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? [] : visibleBranches(n.left)), ...visibleBranches(n.right)];
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) return [...visibleBranches(n.left), ...visibleBranches(n.right)];
    return [n];
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxText(node)) report(node, node.text);
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      for (const b of visibleBranches(node.expression)) { const s = literalText(b); if (s !== null && !looksLikeClasses(s)) report(b, s); }
    }
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(source);
      if (VISIBLE_ATTRIBUTES.has(name)) {
        const init = node.initializer;
        const exprs = ts.isStringLiteral(init) ? [init] : ts.isJsxExpression(init) && init.expression ? visibleBranches(init.expression) : [];
        for (const e of exprs) { const s = literalText(e); if (s !== null) report(e, s); }
      }
    }
    // Polish wording anywhere in code (a message, a label, an option list) is interface text out of configuration.
    const s = literalText(node);
    if (s !== null && POLISH.test(s) && !ts.isRegularExpressionLiteral(node)) report(node, s);
    // An English sentence handed to an error or a status setter reaches the reader the same way.
    if (s !== null && !POLISH.test(s) && /^[A-Z][a-z]+(?: [a-zA-Z'(),.;:-]+){2,}/.test(s.trim()) && !looksLikeClasses(s)) {
      const p = node.parent;
      const callee = p && ts.isCallExpression(p) ? p.expression.getText(source) : ts.isNewExpression(p) ? p.expression.getText(source) : '';
      if (/^(set[A-Z]\w*|Error|alert|confirm|setError|setStatus|setMessage|setNotice)$/.test(callee)) report(node, s);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test('pages and components take their visible words from configuration, not from code', () => {
  const files = ['src/pages', 'src/components'].flatMap(dir => fs.readdirSync(dir).filter(f => f.endsWith('.tsx')).map(f => `${dir}/${f}`))
    .concat(['src/App.tsx']).filter(f => !(f in NOT_SCANNED)).sort();
  const found = files.flatMap(hardcodedTexts);
  assert.deepEqual(found, [], `Move these texts to config/ui/*.json (both languages):\n${found.join('\n')}`);
});
