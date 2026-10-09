# DATA / GRAPH / ENGINE — 2026-10-09

## Current continuation state — WD-003

Continuation baseline: `61ae2463541a9c8ce438b9d44265b3dd35ba8b97` on
`gpt/data-graph-engine-2026-10-09`. Fresh fetch inspected all 20 remote heads;
`origin/main` remains `58a0c93bd0135e3715dcbc4d92fb80e61bd31215`.
WD-002 is already published; historical checkpoints below are not the next task.
WD-003 implementation has current focused acceptance: 32/32 PASS and lint PASS.
Current full local matrix (the test:all sequence: lint → build → test) PASS:
624/624 tests, zero failures/skips/cancellations, 64.534 seconds for the test phase,
including actual Chromium. Source/config/build-output receipt was written after
build and BEFORE tests; log data-graph-watchdog-params-full.log and matching
receipt/patch. Published product commit: `263c8ab1` (full SHA is recorded below); push PASS.
Integration stays with Claude.

## Historical WD-002 receipts

Baseline: `58a0c93bd0135e3715dcbc4d92fb80e61bd31215` (fresh fetch, clean HEAD = main).
Branch: `gpt/data-graph-engine-2026-10-09`; main integration stays with Claude.
Read AGENTS/CLAUDE, state/ledger, handoff, coordination and design rules. Remote
inventory: 18 heads, fetched all without deleting or rewriting refs. No unmerged
branch changes primitives.ts beyond the preserved original history; WD-002 is
still present. Current owner task overrides the old E5.7b-only continuation.

Fresh baseline: npm run test:all PASS, 613/613, zero skips/failures/cancellations;
includes tsc, production build and actual Chromium browser tests. Log:
/workspace/.onboarding/logs/data-graph-watchdog-baseline.log.

Checkpoint before implementation: WD-B-002 / WD-002. ratio declares exclude but
retains missing rows as propagate. Implement the declared strategy with aligned
IDs and an explicit exclusion trace, version ratio/executor as 1.0.2. Preserve
propagate and fail plus undefined denominator behavior; locked JH16 data unchanged.

Decision (reversible implementation choice): exclude removes rows with a missing
operand; a nonpositive known denominator remains an undefined/null result.
Alternative: reject exclude as unsupported; not chosen because the existing
method contract already declares the strategy. Preserve historical finalized
runs and receipts; new execution records name the new executor version. This is
a contract repair, not scientific approval or a new JH16 methodology.

No paid calls, new services, CI, personal/patient data or main changes.
No finished increment yet. Next: code + direct and actual executor regressions,
then full local gate, commit/push and update receipts.

WD-002 implementation checkpoint: ratio/executor 1.0.2. The existing validated
MethodStep.missingPolicy now governs row exclusion; scalar/series denominators
retain identity alignment. Missing operands are removed only under exclude;
known nonpositive denominators still yield null and are separately recorded.
Optional watchdog.execution_trace/1 retains excluded/undefined IDs and exact
step/primitive version through downstream transforms. Workbench already stores
the entire artifact in its content-addressed result; no parallel store or DB
migration was added. Historical finalized payloads remain untouched.

Focused initial gates: method engine 24/24 PASS, workbench integration 8/8 PASS,
including approved execution, hashed trace readback and reopened repository
re-execution. Typecheck PASS. Final gates were subsequently completed below; this paragraph records the
initial focused checkpoint, not an outstanding verification. No scientific approval claimed.

Final local gates: npm run test:all PASS, 616/616, zero failures/skips/cancellations,
including production Chromium, tsc and build. New 3 tests cover distinct
propagate/exclude/fail, scalar/reordered series/all-missing and undefined
operands, refusal of implicit joining after exclusion, downstream scaling,
exact MethodSpec hash, approved Workbench execution, content-addressed trace
readback and repository reopen/re-execution. Frozen JH16 inputs/method files are
unchanged; the existing offline published-values self-check passes in test:all.
Standalone demo:jh16 was also executed (see log). No real replication claimed.
Logs: /workspace/.onboarding/logs/data-graph-watchdog-{baseline,focused,storage,final,demo}.log.

Resolved ID: WD-002 / WD-B-002. Other audit IDs remain open. Optional execution
trace is preserved by immutable Workbench payloads; the legacy run orchestrator
stores numeric rows and executor identity, and does not yet archive this entire
trace. No claim of complete trace coverage for every legacy caller.

Published product commit: `666775a` on `gpt/data-graph-engine-2026-10-09`; push succeeded. Main remains at baseline. Next concrete increment: WD-003, effective generation parameters must be capability-validated, protected against model/message/output-bound overrides, and recorded without credential values. No changes for WD-003 have been made yet.

## WD-003 continuation — effective parameters and existing ledger

Audit source: A `43cc61e0`, WD-003. Before change, real `ProfileGenerator` with
controlled HTTP transport omitted requested temperature/seed from OpenRouter and
Anthropic bodies, and returned no effective-parameter evidence. Synthetic repro:
`/workspace/.onboarding/watchdog-params/before.json`. Fresh baseline focused tests
passed 24/24 in 13.135 seconds (`data-graph-watchdog-params-baseline.log`). Their
previous success did not detect the parameter loss.

Implemented in the existing provider adapter and AssistantService: validated,
hashed provider/task/request layers, protected route/input/budget/tool fields,
model-catalog capability checking for OpenRouter, explicit invalid/undeclared
parameter errors, actual submitted-body hash and credential reference. Configuration
and successful execution evidence use the existing archived profiles and generation
ledger. Failed calls keep the existing held reservation, with prepared configuration
clearly distinguished from successful transport evidence. No second payer or ledger.
Invalid input is rejected before reservation and, for profile-invalid fields, before
catalog discovery; the transport tests assert zero calls and no created ledger rows.

The data source declares current temperature/seed capabilities for OpenRouter/OpenAI
and temperature for Anthropic. Model-specific or undeclared behavior is not presumed
available. All 16 existing adapters still exercise their prior valid empty request.
No live model calls or quality measurements were performed.

Migration and implementation decision: `assistant-routing-2` requires explicit task
`generationParameters`. Temperature 0 is moved from the previous intended service
policy into the bundled task data. Its actual appearance in a supported model request
is a bug fix: the old adapter silently dropped it. Existing direct adapter empty-request
bodies and the output/spending/privacy policies remain unchanged. Custom v1 packs
need explicit parameters (`{}` selects provider defaults) and schema-version migration;
missing fields fail validation. Archived packs and stored runs are untouched. Provider
capability declarations are additive/optional in `personal-providers-1`; absent means
no request override. Alternative considered: continue ignoring caller values or add
manual defaults in code; rejected because this would hide invalid input and duplicate
policy data. See [consumer and migration contract](../PERSONAL_PROVIDERS.md#effective-generation-parameters-wd-003-2026-10-09).

Acceptance covers controlled real protocol adapters, exact default-body compatibility,
data-only alternate task temperature, independently hashed effective parameters/body,
request precedence, forbidden envelope overrides, missing model capability, invalid
types, inherited-key bypass, zero unauthorized dispatch and actual SQLite close/reopen
with unchanged evidence and no credential canary. This is synthetic mechanical
acceptance, not an LLM quality result.

Focused checkpoint receipts are in `/workspace/.onboarding/logs/`:
`data-graph-watchdog-params-focused-final.log` (30/30 PASS, 13.378 seconds), followed
by additional configuration/default compatibility tests. The first lint attempt after
those tests exposed a TypeScript inferred-union issue involving the negative `toString`
case; explicit `Record<string, unknown>[]` preserves that test and fixes its type.
An attempted `npm run typecheck` was not a gate (script absent); the repository's
actual command is `npm run lint`. Final focused gate passed **32/32** in 17.269
seconds, zero failures/skips/cancellations; `data-graph-watchdog-params-focused-final-v2.log`.
Final `npm run lint` also passed; `data-graph-watchdog-params-lint-final-v2.log`.
These include explicit malformed parameter-container rejection and failure-reservation
configuration evidence. Full-matrix/publication remain pending. No assertion was
removed or skipped.

Remaining scopes: WD-001 template selection and A4-WD-001/002/003 are independent;
this change does not close method selection, source-run/manifest or duplicate-entity
issues. String/structured generation overrides and live account/model capability
acceptance remain outside the declared implementation. Next concrete action: run
the complete local test:all matrix, record its actual results, then commit/publish
this package before selecting the next confirmed audit finding.

## Current full gate and persistence checkpoint

`npm run lint`, `npm run build`, `npm run test` (the exact test:all sequence,
with a receipt between build and test) all PASS. 624/624, zero failures,
skips or cancellations. The controlled transport acceptance and production
Chromium tests ran on the changed tree. Evidence prefix:
`/workspace/.onboarding/logs/data-graph-watchdog-params-full`; receipt pins
source HEAD, all changed/untracked file SHA256 and built distribution files
before tests. The historical 616 result remains historical.

WD-003 scoped contract is ready for audit/Claude intake after publication.
No paid model calls, CI, services, frozen JH16 changes or main writes. Next
independent confirmed package is WD-001 template selection, not ratio.exclude.

Published WD-003: `263c8ab1b5ef02dc8e4b1f48914dfc1bbb18bc59`; branch push PASS. Main remains at the fresh baseline.
