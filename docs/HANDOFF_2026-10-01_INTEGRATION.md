# WatchDog — three-package integration

Status: integration in progress, 2026-10-01 Europe/Amsterdam.
Owner authorized integration; ordinary development/merge decisions do not need
another confirmation. No live VM deployment or scientific approval is implied.

## Recovery point

- Base main: `9a8adba8a22671769ecd2b0291e23e1007d8c6fc`.
- Integration branch: `codex/watchdog-integration-20261001`.
- Published initial combined commit: `c1e1c8967a61f74e5641b592b5bc9cb75a67a232`.
- Combined tree: `36cb6235f8cf96178fb1bce8caf585e6e7380b97`.
- Parents preserve all three original worker histories. Original branches must
  not be reset or deleted during integration.

| Package | PR / retained head | Delivered scope |
| --- | --- | --- |
| OPERATIONS | #8 / `92ae68b93ed44e3227e94e4f87abae424ad9df68` | Versioned backup, isolated restore, explicit update recovery |
| RESEARCH | #7 / `93f98ed2d1bfdc76f9a5233d7c52bf8c498e71c4` | E5.7d reviewed scalar comparison, fresh frozen execution, UI and export |
| CLINICAL | #6 / `0b013b5bca7dff536fb7e2965d55bf1483018e9e` | E6.4a/b and E6.5a synthetic core, profile selector and CLI |

Each worker's CI passed independently. That is not a combined-head acceptance.
No textual merge conflicts occurred. Global ledger completion awaits integration.

## Independent review and corrections

- OPERATIONS: no blocker found; 27/27 backup/update tests rerun on the combined
  checkout, including restored schema with RESEARCH migration 022. The synthetic
  vault secret decrypts after restore. General archive verification checks key
  presence/format, not decryptability of every credential. Image bytes are not
  included; restored directories are inert. Sole stopped writer and trusted
  parent directories remain explicit requirements.
- RESEARCH: scalar comparison inherited a false `pre-registered` rationale from
  the historical replication evaluator. Correct only the comparison adapter and
  standalone verifier; preserve JH16 evaluator semantics. Add a regression.
- CLINICAL: a superseding observation with a revoked source could hide a
  contradiction before its provenance was checked. Gate evidence used in
  supersession, including chains, and regress the reproduced case.

## Next action

Finish the two scoped corrections, run focused tests and combined lint/build/test
validation, publish a reviewable integration PR and require successful verify and
container jobs before merging. Local Chromium launch restrictions are not a pass;
use the existing CI browser/container gate. Record exact tested head, tree, run,
counts and final merge here, then update state/ledger and coordination.

Full E5.7b and E6.4/E6.5 remain open. CLINICAL has no product API, persistence or UI.
No production VM or real patient/research data was touched.

## Local combined evidence before final CI

Initial combined lint/build passed. `npm run test:all` reported 549 tests:
522 passed, 27 failed before browser interaction because the Playwright Chromium
executable was missing; zero skipped/cancelled. This is not a green full gate.
`npm run demo:jh16` passed with 32 observations, 16 Pi, 16 Hi and the existing
`pipeline_self_check` meaning. Its historical JH16 rationale remains unchanged.

The scoped RESEARCH correction passed all scientific tests plus the comparison
integration suite: 68/68, zero failures/skips. This covers the standalone export
verifier, old package readers, restart and revoked review receipts. Full combined
CI must use the final corrected tree, not this earlier local suite result.

Both integration corrections are implemented. CLINICAL now checks every relevant
supersession chain link and records consulted provenance in deterministic trace
operations. Regressions cover revoked/unreviewed/unreadable/missing/changed source
states, intermediate and final links, unrelated chains and archive immutability.
All 67 clinical tests pass; final typecheck passes. The RESEARCH wording correction
and independent verifier agree. No changes to locked JH16 methods or evaluator.
