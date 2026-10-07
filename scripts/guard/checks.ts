import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Principles guard (docs/PRINCIPLES.md): deterministic checks that report
 * evidence, or the absence of it, for the rules that can be checked
 * mechanically. Pure functions over file contents, so tests can feed them
 * fixtures; all paths and lists come from config/guard/policy.json.
 *
 * The guard never decides whether science is right and never replaces a test.
 * Rules it cannot check are reported as such, not as passes.
 */

export type Status = 'pass' | 'fail' | 'manual';
export interface Finding { check: string; principles: string[]; status: Status; summary: string; details: string[] }

export interface Inventory {
  routes: string[];
  api: string[];
  capabilities: string[];
  migrations: Record<string, string>;
}

export interface Removal { item: string; reason: string; approved_by: string; date: string }

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();
export const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

// ---------- inventory (P01, P02) ----------

export function routesOf(appSource: string): string[] {
  return sorted([...appSource.matchAll(/<Route\b[^>]*?\bpath="([^"]+)"/g)].map(m => m[1]));
}

export function apiEndpointsOf(fileName: string, source: string): string[] {
  const base = path.basename(fileName);
  return sorted([...source.matchAll(/\b\w+\.(get|post|put|patch|delete)\(\s*(['"`])(\/[^'"`]*)\2/g)]
    .map(m => `${m[1].toUpperCase()} ${m[3]} (${base})`));
}

export function capabilitiesOf(authorizationSource: string): string[] {
  const block = /CAPABILITIES\s*=\s*\[([\s\S]*?)\]/.exec(authorizationSource);
  if (!block) throw new Error('CAPABILITIES array not found');
  return sorted([...block[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]));
}

export function inventoryItems(inv: Inventory): string[] {
  return [
    ...inv.routes.map(r => `route ${r}`),
    ...inv.api.map(a => `api ${a}`),
    ...inv.capabilities.map(c => `capability ${c}`),
    ...Object.keys(inv.migrations).map(m => `migration ${m}`),
  ].sort();
}

export function compareInventory(lock: Inventory, current: Inventory, removals: Removal[]): { removed: string[]; approved: string[]; added: string[]; changedMigrations: string[] } {
  const before = new Set(inventoryItems(lock));
  const now = new Set(inventoryItems(current));
  const allowed = new Set(removals.filter(r => r.reason?.trim() && r.approved_by?.trim()).map(r => r.item));
  const gone = [...before].filter(i => !now.has(i)).sort();
  return {
    removed: gone.filter(i => !allowed.has(i)),
    approved: gone.filter(i => allowed.has(i)),
    added: [...now].filter(i => !before.has(i)).sort(),
    // A migration is never edited after it exists, approved removal or not.
    changedMigrations: Object.keys(lock.migrations)
      .filter(m => m in current.migrations && current.migrations[m] !== lock.migrations[m]).sort(),
  };
}

// ---------- numerical path (hard rules 2 and 7) ----------

const IMPORT = /(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Runtime edges only: `import type` / `export type` vanish at compile time and cannot carry a model call. */
export function localImportsOf(source: string): string[] {
  return [...source.matchAll(IMPORT)]
    .filter(m => !/^(?:import|export)\s+type\s/.test(m[0]))
    .map(m => m[1] ?? m[2] ?? m[3]).filter(s => s.startsWith('.'));
}

export function resolveImport(fromFile: string, spec: string, exists: (p: string) => boolean): string | null {
  const base = path.normalize(path.join(path.dirname(fromFile), spec));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (/\.(ts|tsx)$/.test(candidate) && exists(candidate)) return candidate;
  }
  return null;
}

/** Every local file reachable from the roots, with the import chain that reached it. */
export function importClosure(roots: string[], read: (p: string) => string, exists: (p: string) => boolean): Map<string, string[]> {
  const chain = new Map<string, string[]>();
  const queue = [...roots].sort().map(r => { chain.set(r, [r]); return r; });
  while (queue.length) {
    const file = queue.shift()!;
    for (const spec of localImportsOf(read(file)).sort()) {
      const target = resolveImport(file, spec, exists);
      if (target && !chain.has(target)) { chain.set(target, [...chain.get(file)!, target]); queue.push(target); }
    }
  }
  return chain;
}

export function numericalViolations(closure: Map<string, string[]>, forbiddenTargets: string[], forbiddenCalls: string[], read: (p: string) => string): string[] {
  const out: string[] = [];
  for (const [file, via] of [...closure.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const norm = file.split(path.sep).join('/');
    const hit = forbiddenTargets.find(t => norm === t || norm.startsWith(`${t}/`));
    if (hit) out.push(`${norm} is reachable from the numerical path: ${via.join(' → ')}`);
    for (const call of forbiddenCalls) if (read(file).includes(call)) out.push(`${norm} calls ${call} inside the numerical path`);
  }
  return out;
}

// ---------- commits (P07, P13) ----------

export interface Commit { sha: string; message: string; files: string[] }

export function skipCiViolations(commits: Commit[], documentationPaths: string[]): string[] {
  const isDoc = (f: string) => documentationPaths.some(p => p.endsWith('/') ? f.startsWith(p) : f === p);
  return commits
    .filter(c => /\[(skip ci|ci skip|no ci|skip actions|actions skip)\]/i.test(c.message))
    .map(c => ({ c, code: c.files.filter(f => !isDoc(f)) }))
    .filter(({ code }) => code.length > 0)
    .map(({ c, code }) => `${c.sha.slice(0, 7)} skips CI but changes ${code.length} non-documentation file(s), e.g. ${code.slice(0, 3).join(', ')}`);
}

// ---------- tests (P07, rule 8) ----------

export function browserLaunchViolations(files: Record<string, string>, resolverName: string): string[] {
  return Object.keys(files).sort().flatMap(f => {
    const src = files[f];
    const launches = [...src.matchAll(/chromium\.launch\(([^)]*)\)/g)];
    const bad = launches.filter(m => !m[1].includes(resolverName));
    const local = new RegExp(`function\\s+${resolverName}\\s*\\(`).test(src);
    return [
      ...bad.map(() => `${f} launches Chromium without the shared ${resolverName}()`),
      ...(local ? [`${f} defines its own ${resolverName}() instead of importing tests/helpers/browser.ts`] : []),
    ];
  });
}

export function testSkipViolations(files: Record<string, string>, patterns: string[]): string[] {
  return Object.keys(files).sort().flatMap(f => patterns.filter(p => files[f].includes(p)).map(p => `${f} contains ${p}`));
}

// ---------- ledger (P13) ----------

export function ledgerDuplicates(ledger: string): string[] {
  const ids = [...ledger.matchAll(/^- \[[ x]\] \*\*(E\d+\.\d+[a-z]?) —/gm)].map(m => m[1]);
  return sorted(ids.filter((id, i) => ids.indexOf(id) !== i));
}

// ---------- filesystem helpers ----------

export function walk(dir: string, accept: (f: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(e => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p, accept);
      return accept(p) ? [p] : [];
    });
}
