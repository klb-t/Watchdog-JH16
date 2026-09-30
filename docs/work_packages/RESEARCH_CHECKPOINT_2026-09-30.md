# RESEARCH checkpoint 1 — audit and proposed comparison contract

Historical audit below; the assigned implementation and current acceptance are
recorded in **Checkpoint 2 — E5.7d implementation** at the end of this document.

Recorded: 2026-09-30T22:08:10Z. Owner: Codex RESEARCH session e15f2c5a4cd2.
Base: `312ba246f9bdeb035019e2ff4c1a09aaef0a734c`, tree
`6e142be013eed96393770067f02051507b382c97`. Branch:
`codex/watchdog-research-20260930`. This is an audit and an implementation
proposal, **not an implemented comparison workflow or scientific approval**.

## Coordination and exact next action

The supplied RESEARCH package permits audit before file assignment and requires
the integrator to assign implementation files, a slice identifier, migrations,
shared API and export changes. No such assignment was present in the package,
main coordination file or published branch inventory. Do not turn this audit
into a self-issued implementation reservation. The global ledger is unchanged.

The final wave handoff authorizes using current main containing PR #5; this base
does. Remote heads were read through Git and the connector. At that observation:

| Branch | Head | Relevant scope |
| --- | --- | --- |
| main | `312ba246f9bdeb035019e2ff4c1a09aaef0a734c` | Merged wave and final documentation |
| codex/watchdog-wave1-20260930 | `a1449bd5acb8a1a3fb211d849a6f3d179634435f` | Completed wave, preserved |
| codex/clinical-audit-20260930 | `67c10315f2257b5cf432b7fb1d9c6b01d98f2cb5` | Separate clinical audit; no takeover |
| codex/watchdog-operations-20260930 | `32b4c0d2282da75545500ef10e7afe411a82b225` | Published operations claim; scripts/deployment/tests |

These are snapshots, not leases. Re-read heads before implementation. This
checkout is isolated; no other checkout was edited. Only this document and the
RESEARCH package's audit status are changed here.

**Integrator action:** assign the file sets below, allocate the new migration
identifier, confirm `E5.7d` (proposed identifier only), and publish the decision.
Then implement the frozen claim core before API/UI/export, using the existing
executor. E5.7b remains open. No scientific choice or owner approval is needed
for this routing decision; actual scientific review remains an explicit human
operation when non-fixture work is performed.

## What the code already does

| Source and entry point | Observed behavior | Missing part for this package |
| --- | --- | --- |
| `services/paper_operations.ts`: prepare/approve/execute | Exact paper quote and document, approved dataset, selected columns, origin declarations, missing policy and optional cohort are bound to a method. | No separately reviewed expected scalar/tolerance. |
| `db/repositories/paper_operations.ts`: save/get/runs | Immutable context and owned source checks; execution history. | `runs()` limits results to 100; it cannot stand for complete prior exposure/history. |
| `workbench/service.ts`: execute | Creates a fresh run, uses TypeScriptMethodExecutor and persists real outputs. | Run configuration does not pin a comparison or its freeze receipt. |
| `db/repositories/workbench.ts`: persistResult | Checks method/data approval and paper context again during finalization after blob I/O. | Equivalent comparison-review checks and immutable attempt linkage are absent. |
| `services/replication.ts`: evaluateClaim | Existing absolute/relative comparison and four verdicts. | No unit, source, finite-number, review, ownership or chronology enforcement. |
| `workbench/publication.ts` and `config/workbench/export/verify.mjs` | Source-linked export, quote/cohort/input/hash checks; paper-operation-1 and -2. | No frozen comparison record, attempt receipt or comparison verification. Statistics are not recomputed by the existing verifier. |
| `domain/approval.ts` | Hash-bound approval vocabulary already includes replication_claim. | Vocabulary alone does not create durable comparison approval or a workflow. |

Paths beginning services/, db/, workbench/ or domain/ in this document are
relative to `backend/watchdog_api/`. No general paper compiler is required.
Research projects freeze linked evidence after it exists; that does not establish
a comparison frozen before a future execution.

## Proposed minimal contract: paper-comparison-1

Use a strict schema and canonical hashing, separate from the existing operation.
Do not modify the locked JH16 preset or retrofit its historical registration.

| Field group | Required contents |
| --- | --- |
| Identity | schema version; owned comparison series; immutable revision; predecessor id/hash or null |
| Source claim | exact owned document id/hash; unique quote and UTF-16 anchor from anchorQuote; expected scalar or explicit null; explicit unit or null; rationale; fixture/manual-source provenance |
| Result selector | exact supported statistic/metricKey; exactly one scalar result must match, never the first arbitrary result |
| Tolerance | absolute or relative; finite nonnegative value; separate rationale; no automatically selected tolerance |
| Bound plan | operation id/hash, method id/hash, dataset id/hash, selection hash |
| Prior exposure | server-recorded snapshot of earlier versions and known prior attempts/results; explicit incomplete/unknown exposure outside this system |
| Limitations | inherit cohort, missing policy, origins, meaning and unresolved requirements from the immutable operation; no competing mutable copies |

The numeric value is entered from retained source or a labeled fixture. Presence
of a quote does not prove the interpretation of a numeric claim. Reject NaN,
Infinity and negative tolerances **before hashing**; canonical JSON otherwise
serializes nonfinite numbers as null. Preserve explicit absent values as absent.
This is schema validation, not an LLM numerical path.

First selector set: `pearson`, `spearman`, and `describe.mean`, `.median`, `.sd`,
`.min`, `.max`. Correlations require `dimensionless`. Describe uses the actual
result's source unit. Do not silently convert units or equate percent and fraction.

Exclude `describe.count`, `.valid_count`, `.missing_count` from the first selector
set: `analysis/primitives.ts:describePrimitive` returns one source unit for the
record and `analysis/executor.ts:toResultValues` copies it onto all entries,
including counts. Correcting that established result-unit contract is a separate
reviewed change; the comparison must not invent corrected units in an old artifact.

### Review, freeze and run chronology

1. Persist an immutable proposal. Changes append a revision, preserve its
   predecessor and record known previous results. A repeated identical save may
   be idempotent; it must not erase the fact of a previous attempt.
2. A distinct human action creates an immutable review receipt for the exact
   comparison hash. Method and dataset approvals remain separately required.
   Separate review means a separate action/receipt, not an invented requirement
   for a second human identity. Actor identity comes from the server session.
3. Persist a freeze receipt before a fresh run is created. Use a durable sequence
   and foreign-key/transaction constraints, not only wall-clock timestamps.
   Reject stale review hashes and foreign records. No API may attach an old run.
4. Atomically create the new run and its attempt association, pinning comparison
   hash, freeze receipt and exact review receipt in effective_config. A gap between
   run creation and linking must not permit an orphan to be adopted after restart.
   Reuse the existing workbench execution path; do not implement another executor.
5. Persist attempts through success, error and interruption. Never discard a failed
   run because the caller received an exception. Restart exposes incomplete attempts;
   retry creates a new attempt rather than silently rewriting history.
6. Check live ownership, access and exact approval receipts after relevant async
   reads/writes and before finalization. Revocation followed by reapproval must
   invalidate an in-flight attempt bound to the old receipt. Recheck on read/export.

The successful freeze establishes ordering recorded by this system. It does not
establish that the researcher had never seen the data/result, nor independence.
Prior-exposure history must paginate or enumerate all records, not use the existing
100-run summary as if it were complete.

### Verdict adapter and deterministic output

Validate the selected result's metric, cardinality, unit and missing flag before
calling the existing absolute/relative evaluator. Preserve the selected value,
unit, deviation, reason code and textual rationale in the comparison artifact.

| Condition | Proposed handling |
| --- | --- |
| Nonfinite numbers, invalid tolerance, unknown schema/selector | Reject invalid input; do not emit a scientific verdict |
| Missing result or explicit missing scalar | not_computable |
| Multiple matches or incompatible selector | method_unclear; do not choose one |
| Missing or unequal unit | method_unclear, with both units retained |
| Absent expected value | Preserve existing absolute → method_unclear / relative → not_computable distinction with explicit reason |
| Relative expected value zero | not_computable |
| Valid supported inputs | Existing inclusive absolute/relative comparison |

If several conditions apply, preserve all issue codes in a fixed order and use
a documented precedence (method ambiguity before numeric computability). This
precedence belongs in versioned comparison semantics, not an accidental if order.

Keep three independent axes: execution state, comparison verdict and attempt
meaning. Also retain method/data/population/analysis fidelity as separate declared
or unresolved fields. `reproduced` must not erase simulation/reanalysis/proxy labels.

Define a deterministic calculation core: schema/evaluator version, pinned plan,
typed inputs and their hash, executor artifact, selected scalar/unit, comparison
and ordered diagnostics. Separately store the event envelope: run/trace ids,
review/freeze receipts, times and manifest references. Existing workbench results
contain random run/trace ids; byte equality of two new run envelopes is not a
valid determinism criterion. Compare core bytes/hashes; repeat export of the same
immutable attempt may still be byte-identical.

### Export and UI proposal

Add contextual prepare/review/freeze-and-run controls and version/attempt history
inside PaperOperations. The review shows the exact quote, expected scalar/unit,
tolerance rationale, cohort and known previous attempts. No new primary screen.

Assign the export version with the integrator. Retain old package/operation readers.
The new export includes the comparison revision, predecessor/history references,
review and freeze receipts, attempt/run linkage and deterministic comparison core.
The verifier checks hashes, source anchors, selected metric/unit, plan identity and
recorded event ordering; it can recompute scalar-versus-tolerance arithmetic.
It must explicitly say that it does **not** recompute the underlying statistic,
authenticate the human, prove a trustworthy clock or establish scientific validity.
A separately retained manifest hash is needed to detect wholesale replacement.
Full source text and excluded dataset rows remain part of the existing export.

## Requested file ownership, not an assignment

| Set | Proposed files |
| --- | --- |
| New core | `shared/paper_comparison.ts`; `backend/watchdog_api/services/paper_comparisons.ts`; `backend/watchdog_api/db/repositories/paper_comparisons.ts` |
| New validation | `tests/scientific/paper_comparison.test.ts`; `tests/integration/paper_comparisons.test.ts`; labeled `fixtures/research_comparison/` |
| Shared run seam | `backend/watchdog_api/workbench/service.ts`; `backend/watchdog_api/db/repositories/workbench.ts`; paper operation service only if needed |
| Shared integration | `backend/watchdog_api/api/research_routes.ts`; `server.ts`; new migration with allocated number; `backend/watchdog_api/db/migrations/index.ts` |
| Shared export/UI | `backend/watchdog_api/workbench/publication.ts`; `config/workbench/export/verify.mjs`; `src/components/PaperOperations.tsx`; `config/paper-operation-ui.json`; associated shared profile schema; dedicated browser test |
| Documentation | this package/checkpoint and `docs/PAPER_ANALYSES.md`; global ledger/state remain integrator-owned |

No assignment of these files is inferred from this table. There is no change to
config/replication/jh2016.json, primitive formulas, scientific thresholds or a live
installation. After assignment, use disjoint writers and independent review.

## Executed validation on the unchanged base

Dependencies reused from the existing wave checkout through a local symlink;
no dependency or lockfile mutation and no claim of a fresh npm ci in this session.
Lockfile SHA-256: `7daa048218afc321a94c0bd7d35345da6fe7b7d2a6a7b65a833c30a22fa2f159`.

| Command | Exit / observed result |
| --- | --- |
| `node --import tsx --test tests/integration/paper_operations.test.ts tests/integration/research_projects.test.ts tests/integration/research_package.test.ts tests/scientific/replication.test.ts` | 0; 29/29 pass |
| `npm run test:all` | 1; lint/build pass, 434 tests: 409 pass, 25 fail, 0 skipped/cancelled |
| `npm run demo:jh16` | 0; 32 observations, 16 Pi, 16 Hi, both existing verdicts reproduced; pipeline_self_check retained |

All 25 failures report a missing Playwright Chromium headless-shell executable,
before browser interaction. This session does not have a green full gate. The
earlier CI 434/434 result is historical evidence for the base, not a new local pass.
Build emitted existing chunk-size and CJS import.meta warnings. No UI was changed.

Direct adversarial probes of evaluateClaim confirmed: missing observation gives
not_computable; absent absolute expected value gives method_unclear; zero relative
base gives not_computable; missing unit still permits reproduced; infinite
tolerance still permits reproduced; negative tolerance yields deviates rather
than validation failure. `canonicalHash({value: Infinity})` equals the null-value
hash. These are raw helper boundary observations, not evidence that an existing
HTTP endpoint admits these inputs or that valid JH16 outputs are incorrect.

Independent read-only agent review confirmed the same service seams, count-unit
limitation and distinction between deterministic artifacts and volatile envelopes.

## Acceptance tests to add after assignment

Proposed new command (files do not yet exist):

```bash
node --import tsx --test tests/integration/paper_comparisons.test.ts tests/scientific/paper_comparison.test.ts
```

Cover unreviewed/stale/foreign review rejection; no ex-post run attachment; immutable
revisions and all attempts; real file-backed database reopen; two owners and revoked
shared input; revoke/reapprove during I/O; missing scalar/unit, mismatched units,
relative zero, invalid nonfinite input; exact metric matching; identical calculation
core for two new executions; explicit cohort with null and preserved scope; tampered
export and internally rehashed semantic mismatch; old package formats. Inject a
constant timestamp to ensure ordering does not depend on clock resolution. Inject
failure after reservation/run creation and verify restart leaves a visible attempt.

Then lint/build, the existing focused command above, JH16 demo and real production
browser flow. The package's required browser commands remain:

```bash
npm run build
node --import tsx --test tests/e2e/workbench_field.test.ts tests/e2e/research_projects.test.ts
```

Add the new comparison flow to the actual browser suite, and record its exact
command. Missing Chromium is a blocker, never passed. The integrator owns the
full combined-head gate. Fixture software acceptance is not scientific validation.

## Checkpoint 2 — E5.7d implementation

Assignment: remote `docs/WORK_COORDINATION.md` at integrator commit `9a8adba`,
read before implementation. Confirmed base remains
`312ba246f9bdeb035019e2ff4c1a09aaef0a734c`; claim published as
`da0b051e08152239a160efb53fe3203f9bacd6ba`. Migration 022 and the exact
assigned RESEARCH paths were used. No shared ledger, locked JH16 preset or
other worker's checkout was edited. PR: https://github.com/klb-t/Watchdog-JH16/pull/7.

Published implementation checkpoints:

| Remote commit | Scope |
| --- | --- |
| `17518dd1b21ad00d26259be5e6d5b6114fbe2ec4` | Strict scalar claim, immutable revisions/events/attempts, transactional fresh-run birth and approval-event binding |
| `bab9ad19ef6dccb894bf492a962d01c3ac852d1d` | API, standalone v2 comparison export, adversarial integration tests and continued execution after account adoption |
| `21ad029327ea368a0955ab041e82db58fc1f4a67` | Contextual review UI, archived UI profile compatibility, production browser tests and user documentation |

The final implementation tree is `ac60c933c74cee160ed5182b671bb7d7be9cc36c`.
Local commits and API-published commits differ in commit metadata; each published
tree was compared exactly with its corresponding local commit tree. No force push.

Implemented flow: exact retained quotation → immutable scalar claim and explicit
tolerance → separate hash-bound review → freeze receipt → new bound run →
deterministic comparison core and durable attempt → portable verified export.
The service invokes the existing executor and wraps the existing comparison
semantics. It adds no statistic, generated numerical code or tolerance inference.
See `docs/PAPER_ANALYSES.md` for the UI, API and export contract.

The claim pins source, operation, method, dataset and selection hashes. Revision
and freeze snapshots retain known prior exposure; external exposure remains
unknown. Run creation and ATTEMPT reservation share a transaction. Historical
actors survive account adoption, while new freezes/attempts identify the new
owner. Comparison, method and dataset approval-event identities are checked
before and after asynchronous input reads, at finalization and at result/export
read. Same-clock revoke/reapprove cannot revive an old execution. Failed or
interrupted attempts remain visible after reopening SQLite.

The core binds the complete claim, executor/version, plan, typed inputs and
artifact hash; run IDs, receipts and clocks remain in a separate envelope.
Repeated executions of the same claim/data have byte-identical cores and
distinct run envelopes. Source/method ambiguity and unit issues remain distinct
from missing numbers. Counts are excluded until their inherited units are
resolved. Nonfinite input and arithmetic overflow cannot become valid evidence.

`watchdog-research-package-2` adds `research/comparison.json` and `COMPARISON.md`.
The standalone verifier checks exact quotations, all bindings and receipt order,
and recomputes scalar-versus-tolerance arithmetic. It does not recompute the
underlying statistic, authenticate a human/clock or prove independence. An
externally retained manifest hash remains necessary against wholesale rewriting.
Uncompared packages stay v1; old operation/UI formats remain readable.

### Acceptance and independent review

Five subagents worked on disjoint backend, export, tests and UI scopes plus a
read-only independent audit; integration/API/documentation stayed with the root.
The audit found and verified corrections for approval-epoch I/O races, the last
asynchronous result read, overflow, intervening exposure and account adoption.
It reported no remaining material backend/export blocker.

Focused command:

```bash
node --import tsx --test tests/scientific/paper_comparison.test.ts tests/integration/paper_comparisons.test.ts
```

Result: **21/21 pass**, independently repeated after the last adoption fix.
Tests cover stale/foreign approvals, ex-post run injection, immutable revisions,
real database reopen/interruption/rollback, more than 100 attempts, two owners,
revoked shared inputs, all three same-clock revoke/reapprove races, late-read
revocation, continued account adoption, scalar/unit/missingness/overflow cases,
cohort scope, deterministic cores, v1 compatibility and five internally rehashed
semantic corruptions of the export. The prior operation/project/package/
replication regression command above also passed **29/29**.

Production browser command (after `npm run build`):

```bash
node --import tsx --test tests/e2e/paper_comparisons.test.ts tests/e2e/workbench_field.test.ts tests/e2e/research_projects.test.ts
```

The two new browser tests use the real production server, HTTP API, SQLite and
Chromium. They cover review gating, execution, reload, download and standalone
verification, a null-valued superseding revision, mobile containment and durable
executor failure. Local Chromium could not start (missing installed headless
shell; an available binary also failed with `socket(): Operation not permitted`).
No local browser assertion is claimed as passed; CI is the browser acceptance.

The first core checkpoint CI run `36786796560` passed both `verify` and
`container`: **440/440 tests**, zero skipped, JH16 demo and the actual container
persistence check. This is intermediate evidence, not acceptance of later UI/API.

Final acceptance recorded 2026-09-30T22:49:00Z for implementation head
`21ad029327ea368a0955ab041e82db58fc1f4a67`:

| Gate | Observed result |
| --- | --- |
| Local `npm run lint` | exit 0 |
| Local `npm run test:all` | lint/build pass; 457 tests, 430 pass, 27 browser-launch failures, zero skipped; exit 1 |
| Local `npm run demo:jh16` | exit 0; 32 observations, 16 Pi, 16 Hi, both existing verdicts reproduced, pipeline_self_check retained |
| CI `verify`, job `110131979221` | success; clean npm ci, lint/build, **457/457 pass**, zero skipped, JH16 demo pass |
| CI `container`, job `110131979398` | success; full image test gate **457/457 pass**, zero skipped; real production start, non-root/read-only image, loopback HTTP, API write and persistence pass |

CI run: https://github.com/klb-t/Watchdog-JH16/actions/runs/36787396456.
Both new E5.7d browser tests passed in both CI jobs. The 27 local failures all
report the missing Playwright headless-shell executable, before browser
interaction; they are recorded as failures, not skipped or passed. Existing
chunk-size and CJS import.meta build warnings remain. Dependencies/lockfile
were not changed. This final checkpoint commit changes only documentation;
the exact tested implementation head above is retained for reproducibility.

### Integrator handoff

Proposed ledger change: mark only **E5.7d** implemented after accepting this PR
and running the combined-head gate. Keep **E5.7b** open. Preserve the distinction
between software fixture acceptance and scientific approval, and between the
comparison verdict and method/data/population/analysis fidelity. The latter are
explicitly unassessed by this slice.

Next action: integrate PR #7 with the other assigned packages, retain migration
022 and API/export bindings, resolve shared imports without discarding adjacent
work, then run `npm run test:all`, `npm run demo:jh16` and the existing production
container persistence gate on that exact combined head. No new paid service,
real patient data, live measurement, real scientific review or VM deployment
was performed by this package.
