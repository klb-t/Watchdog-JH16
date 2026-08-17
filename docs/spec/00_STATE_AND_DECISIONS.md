# State and binding decisions

Last updated: 2026-08-17, after E0 (repository audit) completed. Update this file whenever a
decision changes or an epic completes.

---

## 1. Where the project actually is

**Superseded by E0.1's audit (`docs/AUDIT.md`) — kept below for lineage, resolved inline:**

- A repository exists and is connected to GitHub. ✓ still true.
- An AI Studio Build-mode agent (Gemini) completed roughly three passes over it. ✓ consistent
  with `git log`: an initial commit, a scaffolding commit, and a "feat: enhance data provenance
  and analytic robustness" commit that introduced the defects described next.
- Files observed by name in that agent's action history: `registry.ts`, `serp.ts`, an
  orchestrator, a schema/client pair, a repository module, and an orchestrator test.
  This establishes the implementation language as **TypeScript**, not Python. ✓ confirmed.
- `npm run test:all` was the agent's test command. ✓ confirmed, still the canonical command.
- The last pass was interrupted mid-repair, with roughly seven modified files left in an
  unclear state. **Resolved (Q1 below): `git log`/`git status` show a clean, fully-pushed
  working tree.** The interrupted pass's actual defects — a duplicated/broken import in
  `sources/registry.ts`, a duplicated `const q` in `sources/serp.ts`, a run-status vocabulary
  mismatch between `run_orchestrator.ts` and its own tests, and a corrupted committed
  `data/watchdog.sqlite` — were identified and fixed before this spec package was added.
- A twelve-point review list was produced against the repository by an external reviewer and
  partially applied. The list itself is not preserved, and E0.1's audit (`docs/AUDIT.md`)
  supersedes it as intended: full source tree, KEEP/REFACTOR/REPLACE verdicts per file, unused
  dependencies, and the anti-fabrication sweep are all there now.

**Current state, in one paragraph:** `npm run test:all` is green (25 passing, 1 explicitly
skipped, 0 failing). No E1 task is genuinely complete against its literal stated test, but
several have substantial, tested, reusable partial implementations already: the config loader
(E1.1, not yet wired into the running server), the flight recorder and redaction layer
(E1.4-E1.6, missing the full event vocabulary and the diagnostic bundle), the content-addressed
WORM blob store (part of E1.3), and three fixture-status source adapters (E1.8's protocol,
though fixture data is inline rather than file-based per E1.9). See `docs/AUDIT.md` for the
complete per-file breakdown and `07_EPICS_AND_TASKS.md`'s E0.5 additions (E1.25-E1.28) for the
concrete gaps the audit found that the original ledger didn't call out.

## 2. Lineage of this specification

Four sources were reconciled into this package. Where they conflict, this file governs.

| Source | Status |
|---|---|
| `watchdog_ai_studio_package_v3` (23 docs + config, produced externally) | Superseded on stack, auth, providers. Retained for scope, data model, source catalogue, diagnostics contract. |
| Package v5 (auth deferral, provider abstraction, method compiler, approval gate) | **Binding.** Carried forward in full. |
| Conversation archive, 156 threads, 2024-11 → 2026-04 | Historical seed. Already distilled; do not re-mine without a specific question. |
| AI Studio build session, 2026-08 | Source of the repository facts in §1 and of decision D9. |

## 3. Binding decisions

Each decision states what was chosen, what was rejected, and the reason. The reason matters:
an agent that knows why a rule exists can tell when a situation is genuinely outside it.

### D1 — Language and runtime: TypeScript on Node

Chosen because working code already exists in it and three agent passes are embedded in it.
A rewrite to Python would discard that for a benefit that does not exist yet.

Rejected: Python/FastAPI (the v3 assumption). Its real advantage is the scientific stack —
scipy, statsmodels, pandas. That advantage is worth nothing in E1: the JH2016 metrics are
ratios, and Pearson and Spearman are twenty lines each. It becomes real around E5 (Granger,
VAR, changepoint, mixed models).

Consequence, and this is a load-bearing part of the decision: the method-execution layer is
defined by a protocol, not by a language. `MethodExecutor` takes a `MethodSpec` and typed
series and returns typed results. The TypeScript executor is the first implementation. A
Python sidecar executor is the intended second. Nothing in the analysis layer may assume
in-process execution.

### D2 — Persistence for E1: SQLite plus a local content-addressed blob directory

Chosen because it makes the entire E1 vertical slice runnable with `npm install && npm test`
and no infrastructure. The prior stall was caused by infrastructure preceding flow.

Rejected: PostgreSQL, MinIO, Docker Compose at E1. These remain the target for E3 and the
schema is written so the migration is mechanical.

The rule that makes this safe: **all persistence sits behind repository interfaces**. No SQL
outside `src/repo/*`. No filesystem calls outside the blob store module. If a swap to
Postgres requires touching anything in `src/domain` or `src/analysis`, the boundary has been
violated and that is a bug to fix before proceeding.

### D3 — Authentication deferred to E4

From E1, every study, run and artifact row carries `owner_principal_id` and `visibility`.
`owner_principal_id` is the constant string `"local-user"` until E4. `visibility` defaults to
`"private"`.

The invariant that must exist from E1, so that E4 is an implementation rather than a
migration:

```ts
interface Principal { id: string; email: string | null; roles: string[]; identityProvenance: string; }
interface IdentityProvider { resolve(request: Request): Promise<Principal>; }
```

E1 ships `LocalUserIdentityProvider`, which returns the constant principal. E4 adds an OIDC
implementation behind the same interface.

Rejected: email-plus-password, at any stage, on grounds of credential custody — this project
should never hold a password hash.

Rejected: authentication before a working feature. A previous attempt died there.

### D4 — Firebase is not the data layer

Asked and answered here because it was raised and never resolved.

Rejected as the data layer. The core of this system is immutable, content-addressed, hashed
provenance with a WORM discipline. Firestore's document model, its lack of a natural
content-addressed blob identity, and its query semantics all work against that, and the
resulting lock-in contradicts D5, which exists specifically to prevent vendor coupling.

Permitted, if and when the maintainer wants it: Firebase Hosting for the static frontend, and
Firebase Auth as one concrete `IdentityProvider` implementation at E4. Both are leaf choices
behind interfaces and neither touches the data model.

### D5 — Capability / Provider / Credential are three orthogonal concepts

A **source** is an epistemic entity: what is being measured. "Estimated Google result count
for a quoted query" is a source.

A **provider** is a commercial instance that can serve a capability. SerpApi, Serper and
DataForSEO are interchangeable providers of the same capability. So are Anthropic, OpenAI,
Google, xAI, Mistral, OpenRouter and Together for the language capability, alongside a
first-class manually configured OpenAI-compatible endpoint.

Providers are configured in stack settings. They never appear on the Sources page.

The safety condition without which this abstraction is dangerous: **provider identity travels
with the data.** `provider_id` and `provider_version` are stamped on every fetch event, every
observation and every manifest. Two vendors scraping the same search engine return different
numbers — different geography, different personalisation, different parsing. A series that
spans more than one provider carries `PROVIDER_DISCONTINUITY`, and that flag appears in
analysis output, in every export and in the manifest. Without it, swapping vendors mid-study
is an undocumented confounder, which is precisely the class of error this system exists to
prevent.

Provider auto-discovery is permitted but gated: a discovered provider is `proposed` until a
human approves it.

### D6 — The method compiler emits a specification, never code

A researcher describes a method in prose. A language model compiles that prose into a
`MethodSpec`: a declarative structure over a registry of deterministic primitives. It never
emits executable code, and the executor never accepts anything but a validated `MethodSpec`.

The known-answer test: feed the compiler the prose methodology of JH2016 and assert that the
emitted spec computes `Pi = Ni / max(Ni) × 100` and `Hi = Ni_harm / Ni × 100`. If the compiler
cannot recover a known method from its own paper, it does not work.

### D7 — The approval gate is enforced in the backend

Two states: `PROPOSED` (rendered red) and `APPROVED` (rendered green). Everything a model
proposes — a method spec, a narrative paragraph, a discovered provider, an extraction
candidate — starts `PROPOSED`.

Enforcement lives in the domain layer, not the UI. A `PROPOSED` artifact reaching computation
or export raises `ApprovalRequiredError`. Approval binds to the artifact's content hash, so
any subsequent edit reverts the state to `PROPOSED` automatically. There is no code path that
approves without a human action, and no bulk-approve.

### D8 — JH2016 is one locked preset, not the application

WatchDog is a general pipeline. The FAITHFUL preset is a benchmark that must always reproduce.
`ENHANCED` and `LONGITUDINAL` presets are derived and must declare every difference. FAITHFUL
history is never modified.

### D9 — Replication is a first-class object from E1

New in this package. The maintainer's insight: a system that can replicate JH2016 from its
published description is, structurally, a system that can attempt replication of other
published work — and the replication crisis is a real target.

The cheap move taken now: `replication_targets` and `replication_verdicts` exist in the schema
from E1, and the JH2016 run is recorded as replication target #1, with the paper's published
numbers and explicit tolerance bands. This costs almost nothing today and means the later
capability is a feature rather than a redesign.

Deferred to E5: autonomous discovery of replicable papers, automated extraction of claimed
values, scheduled replication attempts. See `08_REPLICATION_ENGINE.md`.

### D10 — Diagnostics before features

The flight-recorder contract in `06_DIAGNOSTICS.md` is implemented as E1 task group 2, before
feature work. Reason, stated by the maintainer: an agent debugging this system must read what
actually happened, not infer probabilistically from a final exception. This is a direct
investment in unsupervised agent work and it pays for itself the first time something breaks.

### D11 — Keep the existing multi-page UI shell; add E1's pages into it (decided at E0.5)

`07_EPICS_AND_TASKS.md` Group 6 describes E1's frontend as "minimal — one workflow, end to end,
no dashboard, no settings pages, no navigation framework." The repository, per the E0.1 audit,
already has a working, tested multi-page shell from the AI-Studio passes: a `Layout` with nav,
plus Dashboard, Sources, Runs, RunDetails and Analyzers pages, exercised by
`tests/integration/api.test.ts`.

Chosen: E1.21-23 add the Study/Method-Review/Results flow as pages inside the existing shell,
rather than deleting the shell to match the spec's literal "no dashboard" framing.

Rejected: discarding the existing frontend to build the minimal single-workflow shell the spec
describes. That spec text was written for an empty repository; this repository is not empty.
Deleting tested, working navigation to satisfy a framing written before the code existed would
be the exact "Rewrites" anti-pattern `CLAUDE.md` §2 warns against, and would violate §0's rule
that the repository wins when it disagrees with what the specification assumed.

Consequence: "no dashboard" is read as "the E1 vertical slice's own tests do not depend on the
dashboard existing", not as permission to remove it. If the maintainer wants the dashboard
actually removed for a leaner MVP, that is a rewrite-adjacent call per `CLAUDE.md` §4 and should
be an explicit instruction, not an agent-initiated deletion.

## 4. Open questions for the maintainer

Do not block on these. Proceed with the stated default and flag the assumption.

| # | Question | Default until answered |
|---|---|---|
| Q1 | Are the ~7 files from the interrupted AI Studio pass committed and pushed? | **Answered by E0.1 (`docs/AUDIT.md`).** `git log`/`git status` show a clean working tree with every commit pushed; there is no uncommitted AI-Studio work sitting in the repository. The specific defects the interrupted pass left behind (a duplicated/broken import in `sources/registry.ts`, a duplicated `const q` in `sources/serp.ts`, a status-vocabulary mismatch between `run_orchestrator.ts` and its own tests, and a corrupted committed `data/watchdog.sqlite`) were identified and fixed in the commit immediately preceding this spec package. |
| Q2 | Do SerpApi credits exist and on which plan? | Irrelevant to E1 and E2 — all work runs on frozen fixtures |
| Q3 | Which LLM provider for the compiler in E2? | Any configured provider; the compiler is provider-neutral by D5 |
| Q4 | Is the reference harm-score set (Nutt et al. 2010) available as data? | E2 loads it from a versioned config file; ship a fixture with a clear placeholder marker if the real scores are not to hand |

## 5. Epic overview

| Epic | Contents | Exit condition |
|---|---|---|
| **E0** | Repository audit and ledger reconciliation | An honest KEEP/REFACTOR/REPLACE/MISSING matrix exists and tests run |
| **E1** | Vertical slice: fixtures → method → approval → compute → chart → export → manifest | `npm run demo:jh16` runs offline and produces a complete, reproducible run directory |
| **E2** | Method compiler, approval gate, reference-set correlation | Known-answer test on JH2016 prose passes |
| **E3** | Live acquisition, provider abstraction, Postgres/S3 migration | A live JH2016 run completes with provider stamping and discontinuity detection |
| **E4** | Identity, OIDC, RBAC, multi-user visibility | RBAC matrix tests pass; `local-user` rows migrate cleanly |
| **E5** | Generic workbench, replication engine, paper pipeline | An arbitrary CSV can be transformed, analysed and charted without a source-code change |

Only E0 and E1 are broken into tasks in `07_EPICS_AND_TASKS.md`. Later epics are deliberately
coarse; they will be decomposed when their turn comes, against the repository as it is then.
