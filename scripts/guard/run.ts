import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  type Finding, type Inventory, type Removal, type Commit,
  routesOf, apiEndpointsOf, capabilitiesOf, compareInventory, importClosure, numericalViolations,
  skipCiViolations, browserLaunchViolations, testSkipViolations, ledgerDuplicates, walk, sha256,
} from './checks';

/**
 * `npm run guard` — the principles guard. Prints one line per check, writes
 * test-artifacts/guard-report.md, exits 1 on any failed check.
 * `npm run guard -- --update` records additions to the inventory lock; it
 * refuses while anything has disappeared without an approved removal or a
 * migration has changed.
 */

const root = process.cwd();
const policy = JSON.parse(fs.readFileSync('config/guard/policy.json', 'utf8'));
const read = (p: string) => fs.readFileSync(p, 'utf8');
const update = process.argv.includes('--update');

function currentInventory(): Inventory {
  const inv = policy.inventory;
  const migrations: Record<string, string> = {};
  for (const f of walk(inv.migrations_dir, p => p.endsWith('.ts') && path.basename(p) !== 'index.ts')) {
    migrations[path.basename(f)] = sha256(fs.readFileSync(f));
  }
  return {
    routes: routesOf(read(inv.frontend_routes_file)),
    api: [...new Set(inv.api_dirs.flatMap((d: string) => walk(d, p => p.endsWith('.ts')).flatMap(f => apiEndpointsOf(f, read(f)))))].sort() as string[],
    capabilities: capabilitiesOf(read(inv.capabilities_file)),
    migrations,
  };
}

function commitsSinceBaseline(): Commit[] | string {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  try { git('cat-file', '-e', `${policy.baseline_commit}^{commit}`); }
  catch { return `baseline ${policy.baseline_commit.slice(0, 7)} is not in this checkout (shallow clone?); fetch full history`; }
  const shas = git('rev-list', '--reverse', `${policy.baseline_commit}..HEAD`).split('\n').filter(Boolean);
  return shas.map(sha => ({
    sha,
    message: git('log', '-1', '--format=%B', sha),
    files: git('diff-tree', '--no-commit-id', '--name-only', '-r', '-m', sha).split('\n').filter(Boolean),
  }));
}

const findings: Finding[] = [];
const add = (check: string, principles: string[], problems: string[], ok: string, extra: string[] = []) =>
  findings.push({ check, principles, status: problems.length ? 'fail' : 'pass', summary: problems.length ? `${problems.length} problem(s)` : ok, details: [...problems, ...extra] });

// Inventory: nothing disappears silently; migrations never change.
const current = currentInventory();
const lockPath = policy.inventory.lock_file;
const removals: Removal[] = JSON.parse(read(policy.inventory.removals_file)).removals;
if (!fs.existsSync(lockPath)) {
  if (update) fs.writeFileSync(lockPath, `${JSON.stringify(current, null, 2)}\n`);
  add('inventory', ['P01', 'P02'], update ? [] : [`${lockPath} is missing; run npm run guard -- --update once`],
    `inventory recorded for the first time in ${lockPath}`);
} else {
  const lock: Inventory = JSON.parse(read(lockPath));
  const diff = compareInventory(lock, current, removals);
  const problems = [
    ...diff.removed.map(i => `removed without approval in ${policy.inventory.removals_file}: ${i}`),
    ...diff.changedMigrations.map(m => `migration edited after it existed: ${m} (add a new migration instead)`),
    ...(update ? [] : diff.added.map(i => `new, not yet recorded (npm run guard -- --update): ${i}`)),
  ];
  const blocking = diff.removed.length + diff.changedMigrations.length;
  if (update && blocking === 0) {
    fs.writeFileSync(lockPath, `${JSON.stringify(current, null, 2)}\n`);
  }
  add('inventory', ['P01', 'P02'], problems,
    `${current.routes.length} routes, ${current.api.length} API endpoints, ${current.capabilities.length} capabilities, ${Object.keys(current.migrations).length} migrations — all retained`,
    diff.approved.map(i => `approved removal: ${i}`));
}

// Numerical path: no language model reachable, no unseeded randomness.
const exists = (p: string) => fs.existsSync(p) && fs.statSync(p).isFile();
const roots = policy.numerical.roots.flatMap((d: string) => exists(d) ? [d] : walk(d, p => /\.(ts|tsx)$/.test(p)));
const closure = importClosure(roots, read, exists);
add('numerical-path', ['P05', 'rule 2', 'rule 7'],
  numericalViolations(closure, policy.numerical.forbidden_targets, policy.numerical.forbidden_calls, read),
  `${closure.size} files reachable from ${policy.numerical.roots.length} numerical roots; no LLM module, no Math.random`);

// Commits: code never bypasses CI after the baseline.
const commits = commitsSinceBaseline();
if (typeof commits === 'string') findings.push({ check: 'ci-not-skipped', principles: ['P07', 'P13'], status: 'fail', summary: 'no evidence', details: [commits] });
else add('ci-not-skipped', ['P07', 'P13'], skipCiViolations(commits, policy.documentation_paths),
  `${commits.length} commit(s) since ${policy.baseline_commit.slice(0, 7)}; none skips CI while changing code`);

// Tests: every browser suite uses the shared launcher; nothing is skipped.
const testFiles = Object.fromEntries(walk(policy.tests.dir, p => p.endsWith('.ts')).map(f => [f, read(f)]));
const browserFiles = Object.fromEntries(Object.entries(testFiles).filter(([f]) => f.startsWith(policy.tests.browser_dir)));
add('browser-launcher', ['P07', 'P10'], browserLaunchViolations(browserFiles, policy.tests.shared_browser_resolver),
  `${Object.keys(browserFiles).length} browser suites use the shared launcher`);
const ownFile = path.join('tests', 'unit', 'guard.test.ts');
add('no-skipped-tests', ['P07', 'rule 8'],
  testSkipViolations(Object.fromEntries(Object.entries(testFiles).filter(([f]) => f !== ownFile)), policy.tests.forbidden_patterns),
  `${Object.keys(testFiles).length} test files; none skipped or todo`);

// Ledger: one meaning per task ID.
add('ledger-ids', ['P13'], ledgerDuplicates(read(policy.ledger.file)).map(id => `task ID used twice: ${id} (see ${policy.ledger.aliases_file})`),
  'every task ID in the ledger is unique');

for (const m of policy.manual) {
  findings.push({ check: 'manual', principles: [m.principle], status: 'manual', summary: 'no automated evidence — check by review', details: [m.check] });
}

const icon = { pass: 'PASS  ', fail: 'FAIL  ', manual: 'MANUAL' } as const;
for (const f of findings) {
  console.log(`${icon[f.status]} ${f.check.padEnd(17)} [${f.principles.join(', ')}] ${f.summary}`);
  if (f.status === 'fail') for (const d of f.details) console.log(`         - ${d}`);
}
const report = [
  '# Principles guard report', '',
  `Commit: \`${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}\` · policy \`${policy.version}\``, '',
  '| Status | Check | Principles | Result |', '|---|---|---|---|',
  ...findings.map(f => `| ${f.status} | ${f.check} | ${f.principles.join(', ')} | ${f.summary}${f.status === 'manual' ? ': ' + f.details[0] : ''} |`), '',
  ...findings.filter(f => f.status === 'fail').flatMap(f => [`## ${f.check}`, ...f.details.map(d => `- ${d}`), '']),
].join('\n');
fs.mkdirSync('test-artifacts', { recursive: true });
fs.writeFileSync('test-artifacts/guard-report.md', `${report}\n`);
process.exit(findings.some(f => f.status === 'fail') ? 1 : 0);
