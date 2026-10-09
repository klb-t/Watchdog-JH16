# DATA / GRAPH / ENGINE — 2026-10-09

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
re-execution. Typecheck PASS. Final local test:all and unchanged locked JH16
self-check still to run before commit. No scientific approval claimed.

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
