#!/usr/bin/env node
// Standalone family verifier (E5.7b.1a): Node.js built-ins only; no network, packages or database.
// It checks every byte, recomputes the family summary from the recorded events and the
// member packages, and runs each member's own verifier pinned to its manifest hash.
import { readFileSync, realpathSync, lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => value === null || value === undefined ? 'null' : typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const hash = value => sha(canonical(value));
const check = (condition, message) => { if (!condition) throw new Error(message); };

// Must stay identical in meaning to shared/paper_comparison_family.ts (a repository test compares them).
const OUTCOMES = ['reproduced', 'deviates', 'not_computable', 'method_unclear', 'failed', 'refused', 'pending', 'not_run'];
const VERDICTS = new Set(['reproduced', 'deviates', 'not_computable', 'method_unclear']);
function memberOutcome(events) {
  const last = [...events].sort((a, b) => a.sequence - b.sequence).at(-1);
  if (!last) return { outcome: 'not_run', reason: null, runId: null };
  if (last.kind === 'REFUSED') return { outcome: 'refused', reason: last.reason, runId: null };
  if (last.runStatus === 'FAILED') return { outcome: 'failed', reason: last.reason, runId: last.runId };
  if (!last.runStatus || !['COMPLETED', 'FAILED'].includes(last.runStatus)) return { outcome: 'pending', reason: null, runId: last.runId };
  if (last.verdict && VERDICTS.has(last.verdict)) return { outcome: last.verdict, reason: last.reason, runId: last.runId };
  return { outcome: 'method_unclear', reason: last.reason ?? 'unreadable_comparison_result', runId: last.runId };
}
export function summarize(members, eventsByMember) {
  const rows = members.map((m, position) => {
    const events = eventsByMember.get(m.comparisonId) ?? [];
    return { position, comparisonId: m.comparisonId, hash: m.hash, ...memberOutcome(events), attempts: events.filter(e => e.kind === 'ATTEMPT').length };
  });
  const counts = Object.fromEntries(OUTCOMES.map(o => [o, rows.filter(r => r.outcome === o).length]));
  return { version: 'paper-comparison-family-summary-1', denominator: members.length, counts, members: rows };
}

function main(dirArg, independentHash) {
  const root = realpathSync(dirArg);
  const read = rel => {
    const full = path.join(root, rel);
    check(!rel.includes('..') && realpathSync(full).startsWith(root + path.sep) && !lstatSync(full).isSymbolicLink(), `Unsafe path: ${rel}`);
    return readFileSync(full);
  };
  const json = rel => JSON.parse(read(rel).toString('utf8'));
  const manifest = json('family-manifest.json');
  const manifestHash = hash(manifest);
  check(manifest.version === 'watchdog-comparison-family-package-1', 'Unsupported family package version.');
  if (independentHash) check(independentHash === manifestHash, 'Family manifest does not match the independently supplied hash.');

  // Every listed file is present with its recorded bytes, and nothing unlisted is present.
  const listed = new Set(manifest.files.map(f => f.path));
  for (const f of manifest.files) { const b = read(f.path); check(b.length === f.bytes && sha(b) === f.sha256, `Changed file: ${f.path}`); }
  const walk = dir => readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e => {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    return e.isDirectory() ? walk(rel) : [rel];
  });
  for (const rel of walk('')) check(rel === 'family-manifest.json' || listed.has(rel), `Unlisted file: ${rel}`);

  const family = json('family.json'), events = json('events.json'), summary = json('summary.json');
  check(hash(family.body) === family.hash && family.hash === manifest.identity.familyHash && family.id === manifest.identity.familyId, 'Family identity mismatch.');
  check(family.body.version === 'paper-comparison-family-1' && Array.isArray(family.body.members) && family.body.members.length > 0, 'Unsupported family semantics.');
  check(hash(summary) === manifest.identity.summaryHash, 'Summary identity mismatch.');
  const memberIds = new Set(family.body.members.map(m => m.comparisonId));
  check(memberIds.size === family.body.members.length, 'Duplicate family member.');
  check(events.every((e, i) => memberIds.has(e.comparisonId) && ['ATTEMPT', 'REFUSED'].includes(e.kind) && Number.isSafeInteger(e.sequence) && (i === 0 || e.sequence > events[i - 1].sequence)), 'Family events are not an ordered record of members.');

  // Each member package is verified by its own bundled verifier, pinned to the recorded hash,
  // and its frozen comparison must be exactly the family member and the latest family attempt.
  const verdictByAttempt = new Map();
  for (const m of manifest.members) {
    const member = family.body.members[m.position];
    check(member && member.comparisonId === m.comparisonId, 'Member order mismatch.');
    if (!m.packageManifestHash) { check(typeof m.reason === 'string' && m.reason.length > 0, 'A member without a package needs a recorded reason.'); continue; }
    const dir = `members/${m.position}`;
    const run = spawnSync(process.execPath, [path.join(root, dir, 'verify.mjs'), path.join(root, dir), m.packageManifestHash], { encoding: 'utf8' });
    check(run.status === 0, `Member ${m.position} package failed its own verification: ${(run.stderr || run.stdout).trim()}`);
    const c = json(`${dir}/research/comparison.json`);
    check(c.comparison.id === member.comparisonId && c.comparison.hash === member.hash, `Member ${m.position} package is a different comparison version.`);
    const event = events.find(e => e.kind === 'ATTEMPT' && e.attemptId === c.attempt.id);
    check(event && event.comparisonId === member.comparisonId && event.runId === c.attempt.runId, `Member ${m.position} package is not a family attempt.`);
    verdictByAttempt.set(c.attempt.id, { verdict: c.core.verdict, reason: c.core.reason });
  }

  // Recompute the summary: latest family event per member, verdicts only from verified packages.
  const byMember = new Map();
  for (const e of events) {
    const v = e.attemptId ? verdictByAttempt.get(e.attemptId) : null;
    const reason = e.kind === 'REFUSED' ? e.data?.reason ?? null : v?.reason ?? e.data?.error ?? null;
    const list = byMember.get(e.comparisonId) ?? [];
    list.push({ kind: e.kind, sequence: e.sequence, runId: e.runId, runStatus: e.runStatus, verdict: v?.verdict ?? null, reason });
    byMember.set(e.comparisonId, list);
  }
  const recomputed = summarize(family.body.members, byMember);
  const essential = s => ({ denominator: s.denominator, counts: s.counts, members: s.members.map(r => ({ comparisonId: r.comparisonId, hash: r.hash, outcome: r.outcome, attempts: r.attempts, runId: r.runId })) });
  check(hash(essential(recomputed)) === hash(essential(summary)), 'The recorded summary does not follow from the events and member packages.');
  check(Object.values(recomputed.counts).reduce((a, b) => a + b, 0) === recomputed.denominator, 'Counts do not add up to the frozen denominator.');

  console.log(`Verified family ${family.id}: ${recomputed.denominator} frozen comparisons — ${OUTCOMES.filter(o => recomputed.counts[o]).map(o => `${recomputed.counts[o]} ${o}`).join(', ')}.`);
  console.log(`Family manifest SHA-256: ${manifestHash}`);
  console.log(independentHash ? 'Matches the independently supplied manifest hash.' : 'No independent hash supplied: internal consistency checked, not authorship.');
  console.log('No family verdict exists. Freezing is not preregistration; outside exposure is unknown. Member statistics were not rerun.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try { main(process.argv[2] ?? '.', process.argv[3]); } catch (error) { console.error(`Verification failed: ${error.message}`); process.exitCode = 1; }
}
