import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  RUN_STATES, canTransition, assertTransition, isTerminal, IllegalRunTransitionError,
  numericOrNull, requireNumeric, isMissing, MissingNotZeroError,
  Observation, PresentObservation, MissingObservation,
  approvalState, requireApproved, approve, currentHash, ApprovalRequiredError, Approvable,
  ERROR_CODES, isErrorCode,
  LOCAL_USER, LOCAL_USER_ID, DEFAULT_VISIBILITY, LocalUserIdentityProvider,
  EVIDENCE_TIERS, isStrongerThan, assertWithinCeiling, VISUAL_MATCH_TIER_CEILING,
  EvidenceTierCeilingError,
  canonicalHash, canonicalizeJson
} from '../../backend/watchdog_api/domain';

const DOMAIN_DIR = path.join(process.cwd(), 'backend', 'watchdog_api', 'domain');

// ---------------------------------------------------------------------------
// E1.2's stated test: "the whole `domain` module imports and its tests pass
// with no database, network or filesystem available."
//
// Asserting that by inspection of the import graph rather than by convention —
// a leak here is the boundary violation 01_ARCHITECTURE.md calls a bug.
// ---------------------------------------------------------------------------

test('Domain: the module imports cleanly and exports its full surface', () => {
  assert.ok(RUN_STATES.length > 0);
  assert.ok(ERROR_CODES.length > 0);
  assert.ok(EVIDENCE_TIERS.length > 0);
  assert.strictEqual(typeof canonicalHash, 'function');
});

test('Domain: no I/O-capable dependency anywhere in the layer', () => {
  const files = fs.readdirSync(DOMAIN_DIR).filter(f => f.endsWith('.ts'));
  assert.ok(files.length >= 8, `expected the domain layer to have files, found ${files.length}`);

  // node:crypto is pure computation and is allowed; everything else that could
  // reach a database, a socket or a disk is not.
  const forbidden = [
    'node:fs', 'node:net', 'node:http', 'node:https', 'node:dgram', 'node:child_process',
    'node:worker_threads', 'node:os', 'node:process', 'node:dns', 'node:tls', 'node:readline',
    'better-sqlite3', 'drizzle-orm', 'express', 'zod'
  ];

  for (const file of files) {
    const src = fs.readFileSync(path.join(DOMAIN_DIR, file), 'utf-8');
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);

    for (const spec of imports) {
      assert.ok(
        !forbidden.includes(spec),
        `domain/${file} imports '${spec}' — the domain layer must have no I/O dependency`
      );
      // Must not reach up into sibling layers either.
      assert.ok(
        !/^\.\.\//.test(spec),
        `domain/${file} imports '${spec}' from outside the domain layer; dependencies point downward only`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Run state machine
// ---------------------------------------------------------------------------

test('Domain: run state machine advances one stage at a time', () => {
  assert.ok(canTransition('CREATED', 'VALIDATING'));
  assert.ok(canTransition('ANALYZING', 'EXPORTING'));
  assert.ok(canTransition('EXPORTING', 'COMPLETED'));

  // Skipping a stage is illegal: a run that never normalised must not claim
  // to have analysed.
  assert.ok(!canTransition('QUEUED', 'ANALYZING'));
  assert.ok(!canTransition('CREATED', 'COMPLETED'));

  // No going backwards.
  assert.ok(!canTransition('ANALYZING', 'RUNNING'));

  // Any active stage may fail or be cancelled.
  assert.ok(canTransition('RUNNING', 'FAILED'));
  assert.ok(canTransition('NORMALIZING', 'CANCELLED'));

  // Terminal states are terminal.
  for (const terminal of ['COMPLETED', 'FAILED', 'CANCELLED'] as const) {
    assert.ok(isTerminal(terminal));
    for (const to of RUN_STATES) {
      assert.ok(!canTransition(terminal, to), `${terminal} → ${to} must be illegal`);
    }
  }

  assert.throws(() => assertTransition('CREATED', 'COMPLETED'), IllegalRunTransitionError);
});

// ---------------------------------------------------------------------------
// Observation missingness — "missing is not zero" at the type level
// ---------------------------------------------------------------------------

const baseObs = {
  seriesId: 's1',
  entityId: 'alcohol',
  queryRole: 'popularity',
  queryText: '"alcohol"',
  retrievedAt: '2026-01-01T00:00:00.000Z',
  sourceId: 'fixture',
  sourceAdapterVersion: '1.0.0',
  language: 'en-GB',
  queryExpansionMode: 'STRICT_CANONICAL',
  qualityFlags: [] as const
};

test('Domain: a missing observation never reads as zero', () => {
  const present: PresentObservation = { ...baseObs, isMissing: false, numericValue: 1000 };
  const missing: MissingObservation = { ...baseObs, isMissing: true, numericValue: null, missingReason: 'PARSE_FAILED' };

  assert.strictEqual(numericOrNull(present), 1000);
  assert.strictEqual(numericOrNull(missing), null, 'missing must read as null, never 0');
  assert.notStrictEqual(numericOrNull(missing), 0);

  assert.ok(!isMissing(present));
  assert.ok(isMissing(missing));

  assert.strictEqual(requireNumeric(present, 'test'), 1000);
  assert.throws(() => requireNumeric(missing, 'Pi computation'), MissingNotZeroError);
});

test('Domain: a missing observation carries a reason', () => {
  const missing: Observation = { ...baseObs, isMissing: true, numericValue: null, missingReason: 'FETCH_FAILED' };
  assert.ok(isMissing(missing) && missing.missingReason === 'FETCH_FAILED');
});

// ---------------------------------------------------------------------------
// Approval gate — hash-bound, per D7
// ---------------------------------------------------------------------------

function spec(name: string): Approvable<{ name: string; steps: string[] }> {
  return { id: 'm1', kind: 'method_spec', content: { name, steps: ['ratio', 'scale'] } };
}

test('Domain: an unapproved artifact cannot reach the executor', () => {
  const proposed = spec('jh2016');
  assert.strictEqual(approvalState(proposed), 'PROPOSED');
  assert.throws(() => requireApproved(proposed), ApprovalRequiredError);
});

test('Domain: approving then editing reverts to PROPOSED with no explicit action', () => {
  const approved = approve(spec('jh2016'), 'a-human', '2026-01-01T00:00:00.000Z');
  assert.strictEqual(approvalState(approved), 'APPROVED');
  assert.doesNotThrow(() => requireApproved(approved));

  // Edit the content, keeping the recorded approval exactly as it was.
  const edited = { ...approved, content: { ...approved.content, name: 'jh2016-tweaked' } };

  assert.strictEqual(
    approvalState(edited), 'PROPOSED',
    'editing approved content must revert state with no action taken — the check is a comparison, not a stored flag'
  );
  assert.throws(() => requireApproved(edited), ApprovalRequiredError);
});

test('Domain: approval is hash-bound and order-insensitive', () => {
  const a: Approvable = { id: 'x', kind: 'narrative', content: { b: 2, a: 1 } };
  const b: Approvable = { id: 'x', kind: 'narrative', content: { a: 1, b: 2 } };
  assert.strictEqual(currentHash(a), currentHash(b), 'key order must not change the approved hash');
});

test('Domain: approval requires an identified human actor', () => {
  assert.throws(() => approve(spec('jh2016'), '', '2026-01-01T00:00:00.000Z'), ApprovalRequiredError);
  assert.throws(() => approve(spec('jh2016'), '   ', '2026-01-01T00:00:00.000Z'), ApprovalRequiredError);
});

// ---------------------------------------------------------------------------
// Error taxonomy, principal, evidence tier
// ---------------------------------------------------------------------------

test('Domain: error taxonomy is the closed set from 01_ARCHITECTURE.md', () => {
  assert.ok(isErrorCode('approval_required'));
  assert.ok(isErrorCode('scientific_input_error'));
  assert.ok(!isErrorCode('something_invented'));
  assert.strictEqual(ERROR_CODES.length, 14);
});

test('Domain: the E1 principal is the local-user constant', async () => {
  assert.strictEqual(LOCAL_USER.id, LOCAL_USER_ID);
  assert.strictEqual(LOCAL_USER.email, null);
  assert.strictEqual(LOCAL_USER.identityProvenance, 'local-constant');
  assert.strictEqual(DEFAULT_VISIBILITY, 'private');

  const resolved = await new LocalUserIdentityProvider().resolve({});
  assert.deepStrictEqual(resolved, { id: 'local-user', email: null, roles: ['owner'], identityProvenance: 'local-constant' });

  // Mutating a resolved principal must not corrupt the shared constant.
  resolved.roles.push('admin');
  assert.deepStrictEqual([...LOCAL_USER.roles], ['owner']);
});

test('Domain: evidence tier ordering and the visual-match ceiling', () => {
  assert.strictEqual(EVIDENCE_TIERS.length, 6);
  assert.ok(isStrongerThan('PRIMARY_EMPIRICAL', 'CURATED_SECONDARY'));
  assert.ok(isStrongerThan('MODELED_PREDICTED', 'SPECULATIVE'));
  // UNKNOWN is weakest, not middling.
  assert.ok(isStrongerThan('SPECULATIVE', 'UNKNOWN'));

  // A visual match is a prediction however confident it looks.
  assert.doesNotThrow(() => assertWithinCeiling('MODELED_PREDICTED', VISUAL_MATCH_TIER_CEILING, 'visual match'));
  assert.doesNotThrow(() => assertWithinCeiling('SPECULATIVE', VISUAL_MATCH_TIER_CEILING, 'visual match'));
  assert.throws(
    () => assertWithinCeiling('PRIMARY_EMPIRICAL', VISUAL_MATCH_TIER_CEILING, 'visual match'),
    EvidenceTierCeilingError
  );
  assert.throws(
    () => assertWithinCeiling('CURATED_SECONDARY', VISUAL_MATCH_TIER_CEILING, 'visual match'),
    EvidenceTierCeilingError
  );
});

test('Domain: evidence tier and approval state are independent axes', () => {
  // A human approving a prediction does not make it an empirical measurement.
  const match: Approvable<{ tier: string; pill: string }> =
    { id: 'p1', kind: 'extraction_candidate', content: { tier: 'MODELED_PREDICTED', pill: 'blue-star' } };
  const approvedMatch = approve(match, 'a-human', '2026-01-01T00:00:00.000Z');

  assert.strictEqual(approvalState(approvedMatch), 'APPROVED');
  assert.strictEqual(approvedMatch.content.tier, 'MODELED_PREDICTED', 'approval must not upgrade the tier');
});

test('Domain: canonical hashing is stable under key reordering', () => {
  assert.strictEqual(canonicalizeJson({ b: 1, a: [2, 1] }), canonicalizeJson({ a: [2, 1], b: 1 }));
  assert.strictEqual(canonicalHash({ b: 1, a: 2 }), canonicalHash({ a: 2, b: 1 }));
  // Array order is meaningful and must not be normalised away.
  assert.notStrictEqual(canonicalizeJson({ a: [1, 2] }), canonicalizeJson({ a: [2, 1] }));
});
