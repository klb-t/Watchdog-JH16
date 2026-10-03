# WatchDog — start here after a reset

Read `CLAUDE.md` (shared agent contract), then:

1. `docs/spec/00_STATE_AND_DECISIONS.md` and `docs/spec/07_EPICS_AND_TASKS.md`;
2. `docs/HANDOFF_2026-10-02_TO_CLAUDE.md` (Claude is the receiving integrator);
   `docs/REPORT_GPT_2026-10.md` separates integrated code from omitted branch work;
3. `docs/WORK_COORDINATION.md` and any assigned `docs/work_packages/` file;
4. `docs/DESIGN_RULES.md` and `docs/SPEC_RECONCILIATION_2026-09-30.md` when
   selecting or changing a contract. `ECOSYSTEM.md` is a brainstorm map.

Inspect `git status`, recent commits and remote heads before editing. Current
code and exact test evidence outrank stale completion claims. Follow later owner
instructions within their scope; do not restart completed work from old E1-only
directions or infer scientific approval from implementation autonomy.

Use small, tested, published checkpoints. Record the precise head, results,
limitations and next action. Do not keep essential state only in conversation.
Concurrent writers need disjoint ownership or isolated branches; the integrator
owns shared state/ledger updates. Never reset or overwrite another worker's work.

Preserve locked JH16 methods, explicit missingness, immutable provenance and
content-bound human review. A planned adapter, fixture test, inference or proposed
clinical rule is not a live measurement or independently replicated result.
Keep secrets and private user data out of this public repository.

Routine development and integration are authorized. New spending, real patient
data, external messages and actual scientific approvals require their own basis.
Move to an unblocked task after recording a genuine blocker; do not repeatedly ask
the owner to choose ordinary implementation details.

Documentation index: `docs/README.md`. Read the entire remote branch inventory before a new wave; current task IDs and historical collisions are mapped in `docs/TASK_ID_ALIASES.md`. Parallel GPT experiments do not own the integrator’s product files.

History contract: `docs/HISTORY_POLICY.md`. Preserve source experiment refs and receipts; new main increments are linear, accepted deltas only. Never rewrite existing ancestry for cosmetic linearity.
