# DATA / GRAPH / ENGINE — 2026-10-09

## Current continuation — A4-WD-001 (focused PASS; full gate pending)

Fresh all-head fetch completed with clean local/remote B at
`bc2778e109d00602c124cabc1fad980b1007fa40`; main remains
`58a0c93bd0135e3715dcbc4d92fb80e61bd31215`. Published WD-011 and its 636/636 full
gate below are history, not validation of this new tree. Main stays with Claude.

A's pass4 `43cc61e0` A4-WD-001 was independently reproduced on that base. The
actual schema stripped method_spec_id/hash, personal_credentials and plan; the
resulting real orchestrator run COMPLETED with two results/manifest. The original
unstripped configuration correctly FAILED without either. The known valid
control produced identical results; SQLite reopen retained both states. The
baseline exercised schema/store/orchestrator, not HTTP. Public evidence remains
in `/workspace/.onboarding/watchdog-next-audit/`: `TRIAGE.md`,
`A4-WD001-before-receipt.json`, `A4-WD001-before.json`, its log and the separate
readonly persisted-state inspection. Zero network attempts or model calls.

Only the HTTP envelope/config z.object boundaries are now strict. The nine known
optional UI fields and open source_params/method_params records are unchanged.
Unknown fields return 400 before enqueueing, rather than silently selecting an
alternate effective configuration. The global submitJob and reviewed
ResearchPlanService.launch contracts are unchanged. R42 treats schema validation
as mechanism; no broad allowlist, data policy, new executor or graph was added.
[Canonical API and reversible migration](../RUN_SUBMISSION_API.md).

Actual current focused gate: **20/20 PASS**, zero failures/skips/cancellations,
17.906s. `A4-WD001-focused-receipt.json` pins sources before execution;
`data-graph-watchdog-run-submission-focused.log` contains the complete run. The
new real HTTP test delegates the actual queue and proves seven invalid requests
cause no submitJob, SQL change, ObjectStore write, source resolution or ledger
reservation. Source ownership denial remains404. A valid queued analysis matches
the baseline config bytes/hash and canonical results; explicit missingness and
stored manifest survive reopen. Direct unreviewed pins still fail. Existing
pipeline, access and reviewed wizard tests passed unchanged. The golden fixture
was captured from the unmodified baseline with its own before-receipt and
readonly synthetic store; no expected values were invented after the fix.

Lightweight gates were coordinated with e_intake during the serialized ChatADHD
matrix. `npm run lint` PASS (exit0), log `data-graph-watchdog-run-submission-lint.log`.
Independent static audit review found no blocker; the reviewer ran no additional
tests/build. `A4-WD001-HANDOFF.json` pins the final nine files and receipts. Full
WD lint/build/test and publication remain with root after its heavy slot becomes
available. No
paid CI, models, new services or changes to archived evidence. Next concrete
step: full current gate, commit/push this boundary fix, then independently
reproduce the still-open A4-WD-002/A4-WD-003 package before choosing work.


## Historical WD-011 continuation (published bc2778e; full gate PASS)

Fresh fetch of all remote heads completed on the existing B branch. Local HEAD
and remote B were `05e4f290121e91ad516e4db70ee1973d6a4062b3`, clean before edits;
main remains `58a0c93bd0135e3715dcbc4d92fb80e61bd31215`. WD-001 is published and
its 630/630 result below is historical for this new increment. No main/collaborator
branch changes, paid model calls, private fixtures or new services.

Audit A WD-011 at `43cc61e0` still reproduced: original/reverse ASCII sign,
Unicode minus and exponent-sign cases were incorrectly admitted. In addition to
the actual guard's 11-case baseline, the real OpenAiCompatibleGenerator and
`generateNarrativeWithProvider` accepted `Computed -4 indices.` for four Pi
entries as PROPOSED. The only adaptation to A's pass2 fixture was selecting the
real shipped template; its old nonexistent selector now correctly fails WD-001.
Receipts were captured before each baseline runner. Evidence:
`/workspace/.onboarding/watchdog-template/WD011-before*.json`,
`WD011-consumer-before.json` and `WD011-consumer-before-receipt.json`.
All transport was controlled in process; network attempts and paid calls were 0.

The existing guard now compares exact signed decimal strings, preserves whole
signed exponents in a distinct notation class, and retains supported grouping and
trailing-zero formatting. It does not evaluate scientific notation as decimals or
round through Number. Covered unsupported numeric-looking syntax is opaque rather
than split into known values. No new data policy/allowlist/configuration engine;
this grammar is a parser mechanism. Limits and reversible migration are explicit
in [the narrative contract](../NARRATIVE_RECIPES.md#signed-numeric-admission-wd-011-2026-10-09).

The actual API regression requires 400/no narrative artifact after a successful
controlled response with a changed sign; the existing ledger remains ESTIMATED,
with response, usage, cost and effective-parameter/body-hash evidence intact.
There is exactly one dispatch and no retry. SQLite close/reopen retains that
record, prior proposals and the unchanged finalised manifest. Existing failed
transport, ownership interleaving, approval and default-byte regressions remain.

First scoped run: **25/25 PASS**, 0 failures/skips/cancellations, 2.413s, including
real provider adapter and actual loopback API/store/ledger. Its pre-run receipt is
`WD011-focused-receipt.json`; log `data-graph-watchdog-numbers-focused.log`.
Subsequent self-review extended opaque-token coverage to repeated exponents and
signed radix-looking forms; the first receipt does not cover those two additions.
Final current-source focused rerun: **25/25 PASS**, 0 failures/skips/cancellations,
1.848s; `WD011-focused-final-receipt.json` was captured before execution and
`data-graph-watchdog-numbers-focused-final.log` is the complete log.
`npm run lint` PASS (exit 0), `data-graph-watchdog-numbers-lint-final.log`.
Exact baseline runners were then replayed against the corrected source with
`WD011-after-receipt.json` captured first: all 11/11 guard expectations passed;
the actual adapter consumer rejected `-4` with NarrativeFabricationError after
exactly one controlled dispatch, zero network attempts. Results are
`WD011-after.json` and `WD011-consumer-after.json`. Independent review then found a bare-prefix edge (`0` was authorising `0x`,
`0b` or `0o`). The lexer now consumes those entire opaque prefixes, with rejection
and unchanged-spelling controls. Review-fix rerun: **25/25 PASS**, zero
failures/skips/cancellations; `WD011-focused-review-receipt.json` was written before
`data-graph-watchdog-numbers-focused-review.log`. The earlier final receipt/lint
and exact-after runs remain evidence for their earlier source, not the bare-prefix
fix. The new full r2 gate below includes this correction and fresh lint/build.
`WD011-HANDOFF.json` pins the current final files; it is not a retrospective
pre-run receipt.
Full current lint/build/test r2 **636/636 PASS**, 0 failures/skips/cancellations,70.787s; this independently includes the corrected bare-prefix case. Exact source/config/dist receipt before tests and unchanged source afterward are retained under `data-graph-watchdog-numbers-r2-full-*`; browser selection uses the existing system Chromium. Earlier WD-001 PASS is not substituted. Next confirmed independent scope remains A4 method-selection/source-run-manifest/duplicate-entity findings; the ChatADHD coordinator is completing the combined native matrix.


## Historical WD-001 continuation (published 05e4f29)

Fresh baseline `867f83b695e93ac29445489c4c5408b0d0308cd8` on the existing B branch,
clean before edits. Explicit all-head fetch updated B to the same SHA;
`origin/main` remains `58a0c93bd0135e3715dcbc4d92fb80e61bd31215`. WD-002 and WD-003
are already published. No reset, main changes, other branch edits or private data.

WD-001 is implemented in the existing narrative service and real API: validated
catalog selection, byte-identical historical defaults, explicit alternate recipe,
actual provider prompts, exact producedBy evidence, existing artifact storage and
reopened reads. Focused 59/59 PASS plus lint PASS preceded the final ownership
recheck. The amended integration test then passed on rerun; it is not a sixtieth
distinct case, and no separate pre-rerun receipt was captured. The subsequent complete
current-tree test:all sequence (lint → build → test) passed **630/630**, zero
failures/skips/cancellations,62.674 seconds for tests including Chromium. The
source/config/build-output receipt was written BEFORE tests; source hashes match
afterward. Logs/receipt/patch/after: data-graph-watchdog-template-full-*.
Publication is on B only; main integration remains with Claude.
[Contract/migration](../NARRATIVE_RECIPES.md). The WD-003 heading below is history.


## Historical WD-003 continuation

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

## WD-001 — actual template selection and narrative provenance

Audit source: A branch `43cc61e0`, WD-001 plus current pass4 to avoid repeating
ratio.exclude/parameter work. Before: different and unknown template IDs produced
identical content, and an unknown ID dispatched once to a controlled generator.
Zero external network/model calls. Receipt `/workspace/.onboarding/watchdog-template/before.json`
retains baseline default content/hash and actual prompt/system bytes. The first
external TS runner attempt failed because top-level await was interpreted as CJS;
renaming the local runner to .mts produced the actual reproduction. Both logs are
retained; the failed setup attempt is not runtime evidence. Existing output/LLM
baseline: 26/26 PASS, which did not catch the missing selector.

New `config/narratives.json` is the versioned validated source. Metrics, ranking,
locale/text, and provider prompt are consumed by the same existing narrative
mechanism; no second graph/workflow/configuration engine. Default
jh2016-summary@1.0 content/hash and provider request bytes match the pre-change
fixture exactly. A Polish recipe and data-only topK/direction changes demonstrate
actual selection. Unknown ID/version, malformed/unknown fields and unsupported
bindings fail before provider calls/reservations. Arbitrary historical test labels
were replaced by the true existing recipe, retaining all prior assertions.

New `producedBy` snapshots bind source payload, exact recipe/catalog, mechanism,
prompt and available WD-003 generation evidence. JSON export retains this binding;
CSV remains unchanged. New explicit deterministic POST and existing successful
provider POSTs archive PROPOSED JSON through the existing ObjectStore and
ArtifactRepository. GET preview stays read-only. Archived reads verify bytes and
ownership without regenerating from the current catalog. No finalised manifest,
legacy narrative or historical receipt is rewritten. Absence of provenance on old
objects remains absence; no inferred migration. Documentation records the
reversible decision and alternatives; frozen scientific methodology is untouched.

Actual focused gate: **59/59 PASS**, zero failures/skips/cancellations, 14.914s;
`data-graph-watchdog-template-focused-final.log`. Source receipt was captured before
that run. It covers default bytes, two recipes, data-file reload, all/zero ranking,
explicit tie policy, mutable input preservation, prompt hashes, zero invalid
selector dispatch, approval/export, controlled real provider adapter and existing
ledger, actual HTTP API, immutable store and SQLite close/reopen, failed storage
and provider execution, held reservation, preserved finalised manifest and owner
isolation. `npm run lint` PASS. After the scope, the new archive I/O boundary gained
an ownership recheck plus a controlled interleaving assertion in the existing
integration test. That test was rerun successfully without a separately captured
pre-run receipt; the earlier focused receipt does not cover these later edits. No paid model calls, new service, CI or scientific result claimed.

Remaining work before a finished increment: full local lint→build→test sequence
with source/config/binary receipt before tests, then small commit/push by B root.
No full-matrix result from WD-003 is counted for this tree. Independent WD/A4
findings remain open; this slice adds no UI template picker or LLM quality claim.

Additional final scope: new archive ownership can change during asynchronous
ObjectStore.put; the regression now proves 404 and no registered proposal after
that interleaving. `data-graph-watchdog-template-ownership.log` records PASS1/1
(1.245s) for the modified existing integration test, followed by `npm run lint`
PASS (`...-lint-final2.log`). No pre-ownership-rerun receipt exists. HANDOFF.json
pins the final state after that run; it is not reconstructed pre-run evidence.
Root will capture a fresh source/config/binary receipt before the full current
gate. Product files are frozen
for root review/full gate. Fresh inventory has 20 remote refs; narrative-specific
non-main history only points to the archive-only checkpoint branch where the
product path is absent, not another unintegrated implementation.


## WD-001 final current-tree gate

Independent static review found no new product blocker and explicitly documented
the older scoped receipt gap. Root then ran the complete local lint → build → test
sequence on the final frozen product. **630/630 PASS**,0 skips/failures/cancellations,
62.674s for tests; actual Chromium and controlled provider/storage paths executed.
Fresh source/config/dist receipt before test, source hashes identical afterward:
`data-graph-watchdog-template-full-receipt.json`, `...-working.patch`, `...log`,
`...-after.json`. No historical gate is substituted. Full acceptance contains the
ownership interleaving regression. No paid model call, CI, new service or changes
to main/scientific frozen data. This is a candidate product increment for A/Claude.
Next confirmed audit packages remain A4 method selection/source-run manifest/duplicate
entities and WD-011 signed-number guard; no generic Office/product rewrite is implied.


## WD-011 full gate history and completed candidate

First full invocation: lint/build PASS; tests601/636 PASS,35 failures,0 skips,39.319s. Root omitted the existing environment setup in the wrapper, so browser launch looked for an absent Playwright download instead of system Chromium. All35 failures identify that missing executable. This is retained as a failed invocation, not hidden or relabelled PASS. No test/product fix or browser download was used to bypass it.

Fresh r2 sourced the existing env.sh, recorded explicit browser settings and repeated lint/build/test. **636/636 PASS**,0 failures/skips/cancellations,70.787s; source drift=false. The independent review and8-file manifest matched the final product; root publishes the small correction separately from WD-001. Model calls, paid CI and new services:0. Existing narratives/approvals/finalised manifests remain unchanged; narrower admission applies to new generation only. Evidence: `data-graph-watchdog-numbers-r2-full-receipt.json`, `...-working.patch`, `...log`, `...-after.json`; previous `data-graph-watchdog-numbers-full-*` preserved.
