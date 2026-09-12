# State and binding decisions

Last updated: 2026-09-09, Astra continuation. Update this file whenever a
decision changes or an epic completes.

---

## 1. Where the project actually is

**2026-09-08 continuation:** see `docs/ASTRA_PROGRESS.md` for the re-run baseline and runtime
limits. D18 below supersedes every old ordinal-role description in this document. The owner
has prioritised the general responder vertical (pill/market-label/region/time → composition →
cited reference facts and interactions), including evidence tier, category ordering, approval
and quality flags. “Green X” is an illustrative acceptance scenario, not a domain restriction.

**2026-09-09 workbench checkpoint:** implemented versioned JSON/CSV imports and aggregate sharing,
2D/3D/map figures with time/facet/color/size/alpha channels, source inspection and a shared tool
palette, approved descriptive/Pearson/Spearman analysis, favourite figure snapshots, vector/data
exports and developer diagnostics. See D19 and `docs/WORKBENCH.md` for boundaries and operation.

**Superseded by E0.1's audit (`docs/AUDIT.md`) — kept for lineage, resolved inline:**

- A repository exists and is connected to GitHub. ✓ still true.
- An AI Studio Build-mode agent (Gemini) completed roughly three passes over it. ✓ consistent
  with `git log`.
- Files observed by name in that agent's action history: `registry.ts`, `serp.ts`, an
  orchestrator, a schema/client pair, a repository module, and an orchestrator test.
  This establishes the implementation language as **TypeScript**, not Python. ✓ confirmed.
- `npm run test:all` was the agent's test command. ✓ confirmed, still canonical.
- The last pass was interrupted mid-repair. **Resolved (Q1 below): `git log`/`git status` show a
  clean, fully-pushed working tree.** Its actual defects — a duplicated/broken import in
  `sources/registry.ts`, a duplicated `const q` in `sources/serp.ts`, a run-status vocabulary
  mismatch between `run_orchestrator.ts` and its own tests, and a corrupted committed
  `data/watchdog.sqlite` — were identified and fixed before the v6 spec package landed.
- A twelve-point review list was produced against the repository by an external reviewer and
  partially applied. The list itself is not preserved, and E0.1's audit supersedes it as
  intended.

**Current state: E0, E1 and the D17 slice are complete. One item is blocked: the PostgreSQL
backend, deliberately and with its reasoning recorded.**

`npm run test:all` is green — 231 passing, 0 skipped, 0 failing — and `npm run demo:jh16`
has been verified on a clean clone, offline, with no credentials: it produces a run directory
whose Pi and Hi reproduce every value published in the paper's own tables, and two runs are
byte-identical apart from run id and timestamps.

**The D17 slice (see that decision) added, in this order:** the secret store; OpenRouter and
any OpenAI-compatible endpoint as a real `text.generate` provider; SerpApi as a real
`search.result_count` provider; provider and query-plan discontinuity detection; Google OIDC
with the `viewer < researcher < admin < dev` ladder and an RBAC matrix; a GCS blob store with
a startup durability gate; the readiness API and Setup page; and a container with a Cloud Run
runbook (`docs/DEPLOY_GCP.md`).

Nothing in that list is switched on by default. Every provider derives its status from live
credential state on each read, so an absent key yields `blocked` with the exact variable that
would fix it, and removing a key takes a provider out of service with no invalidation step.
The production bundle has been booted and probed directly (auth config, readiness, SPA); the
container image itself has **not** been built, because this environment has no Docker daemon —
`tests/integration/deployment.test.ts` asserts the Dockerfile's properties instead, and the
first real `docker build` remains unverified.

Two things worth carrying forward about how that slice was built. First, `E3.4` is only
half-done and says so: PostgreSQL could not be tested against a real server from here, so it
is registered `planned` and throws rather than shipping as an untested `implemented` adapter.
Second, three defects were caught by the project's own invariants rather than by inspection —
a repository placed outside the repository layer (the D2 SQL-boundary test), a hardcoded list
of owned tables that was simply wrong (caught while writing the migration test, then replaced
by schema introspection), and a spurious WORM violation whenever a database was reset while
its blob store survived. That last one was a latent bug in E1, not in the new work.

Done: the configuration loader, domain types, the full `02_DATA_MODEL.md` schema with
migrations, the diagnostics spine (tracer, redaction with a canary test, error cause chains,
diagnostic bundle), the fixture source with all 32 frozen queries and four edge cases, the
capability/provider/credential registries, the seven primitives, MethodSpec validation and
hashing, the approval gate, the deterministic executor, the JH2016 FAITHFUL preset expressed
as a MethodSpec, charts, narrative, export, manifest, the three UI pages with browser-driven
E2E, and `demo:jh16`.

**E1.20 is now done too, and how it was unblocked matters.** The maintainer delegated the
tolerance bands explicitly rather than setting them himself. That delegation does not weaken
the pre-registration rule, because the ordering is what the rule protects: the bands and their
full rationale were committed in `2e417c66514b3ac24aef6cc067d435168089f852` **before any verdict
existed anywhere in this repository**, and `config/replication/jh2016.json` names that commit so
the ordering is checkable rather than merely asserted.

One correction that came out of reading the primary source and is worth carrying forward: the
paper's prose says the coefficient is between "the harm score *ranking*" and the harm index,
which reads as a rank correlation. It is not. Recomputing from the paper's own Tables 1 and 3
gives Pearson r = 0.8162, matching the reported 81.6%, against Spearman rho = 0.5668, which does
not. Had the claim been registered as a rank correlation with the originally proposed 0.70 floor,
the paper's own data would have scored 0.57 and been recorded as `deviates` — a test that fails
against the very result it exists to check.

**And the limit of what the current verdicts mean.** The fixture attempt is registered as a
`pipeline_self_check`, not an `independent_attempt`, because its inputs are the paper's own
published counts. Both claims come back `reproduced`, and that means this pipeline computes what
the paper computed from the same numbers — nothing more. Whether the finding still holds needs
independently acquired counts, which is E3. The paper's own Table 2 (individual popularity
indices drifting up to +567% across 25 months) is reason to expect that answer to differ.

## 2. Lineage of this specification

Five sources were reconciled into this package. Where they conflict, this file governs.

| Source | Status |
|---|---|
| `watchdog_ai_studio_package_v3` (23 docs + config, produced externally) | Superseded on stack, auth, providers. Retained for scope, data model, source catalogue, diagnostics contract. |
| Package v5 (auth deferral, provider abstraction, method compiler, approval gate) | **Binding.** Carried forward in full. |
| Conversation archive, 156 threads, 2024-11 → 2026-04 | Historical seed. Already distilled; do not re-mine without a specific question. |
| AI Studio build session, 2026-08 | Source of the repository facts in §1 and of decision D9. |
| Six Claude-side conversations, 2025-09 → 2026-04, recovered 2026-08 (see D12) | Source of the field/clinical evidence-tier and responder-interface design in `10_EVIDENCE_TIER_AND_TRUST_UI.md` and `11_FIELD_AND_CLINICAL_INTERFACES.md`. This material predates v3 and was not carried into it — treat it as independently binding within its own scope, not as superseded by v3's silence on the topic. |

Note on how this fifth source was found: it was not volunteered by any package. The maintainer
asked directly whether responder-facing interfaces, symptom search, pill identification and a
colour-coded evidence system were included, and a targeted search of conversation history
turned up a materially complete design already worked out across those six threads — including
a maintainer-authored correction to the colour ordering, recorded verbatim in
`10_EVIDENCE_TIER_AND_TRUST_UI.md`, that a first-pass invention would not have reproduced.
Where a future gap is suspected, search before assuming the package is silent because nothing
exists.

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

Rejected: discarding the existing frontend. That spec text was written for an empty repository;
this repository is not empty. Deleting tested, working navigation to satisfy a framing written
before the code existed would be the "Rewrites" anti-pattern `CLAUDE.md` §2 warns against, and
would violate §0's rule that the repository wins when it disagrees with what the specification
assumed.

Consequence: "no dashboard" is read as "the E1 vertical slice's own tests do not depend on the
dashboard existing", not as permission to remove it. Removing it is a rewrite-adjacent call per
`CLAUDE.md` §4 and needs an explicit instruction.

### D12 — Evidence tier is a schema-level concept from E1; the field/clinical UI that exploits it is Epic E6

Recovered, not invented: across six 2025-09 → 2026-04 conversations, the maintainer independently
designed a colour-coded evidence classification for exactly this system, refined it through his
own correction, and separated it explicitly into two axes — see
`10_EVIDENCE_TIER_AND_TRUST_UI.md` for the full recovered design and its formalisation here.

The `evidence_tier` enum and its columns on `reference_scores` and the new field-reference
tables (`02_DATA_MODEL.md` §Field reference) are added now, following the same reasoning as D9:
the concept is cheap to seed as schema and expensive to retrofit once heterogeneous-provenance
data exists without it.

What is **not** pulled into E1: any UI that displays it, any real pill/symptom/toxicology
sourcing, and any automated evidence-fusion scoring. The maintainer's own history contains a
proposed numeric fusion-weight table (`10_EVIDENCE_TIER_AND_TRUST_UI.md` §Fusion weights); it is
recorded as a candidate, not implemented — an algorithm silently collapsing heterogeneous
evidence into one confidence number is exactly the pattern D7's approval gate exists to prevent,
and this project does not carve out an exception for it just because the sketch predates that
rule. Fusion, if it is ever built, goes through the same gate as everything else a machine
proposes.

The responder-facing interfaces, symptom search, pill identification and sourcing work that
actually use `evidence_tier` are **Epic E6**, decomposed when its turn comes — see
`11_FIELD_AND_CLINICAL_INTERFACES.md` and the epic table below. This is not a new sequencing
decision: the maintainer's own April 2026 prioritisation already marked responder tooling
"confirmed, post-MVP" against researcher tooling as "priority MVP." E1's narrow scope already
matches that ordering; this decision only formalises the schema seam so E6 does not require a
migration.

**Correction, same day:** the first draft of the Field reference schema omitted substance-to-
substance and substance-to-receptor edges entirely — `substances` had aliases and external
identifiers but no graph. Caught when the maintainer asked directly whether substance-centric
memory had graph elements; it did not. `substance_relations`, `receptors` and
`substance_receptor_bindings` were added to `02_DATA_MODEL.md` §Field reference under this same
decision — and were themselves superseded hours later by D14 below, which replaced all three
with a single generic mechanism rather than a growing pile of bespoke edge tables.

### D13 — Generic core / drug-vertical package separation

The maintainer supplied a second, independently produced recovery package (a different AI's
reconstruction of the same project history) specifically to catch what this side's search had
missed. Its first and most binding point: the generic research engine — `runs`, `observations`,
`series`, `fetch_events`, `manifests`, method compiler, approval gate — must not encode `drug`,
`substance`, `pill`, or any equivalent concept in its foundational shape. The drug/public-health
vertical, everything in `12_DRUG_DOMAIN_ONTOLOGY_AND_ASSERTIONS.md` and the field-reference
tables, is a package layered on top of a domain-neutral core, not fused into it.

This project has not violated the boundary in any way that requires code changes — E1's core
tables were already generic. What was missing was the explicit statement, which matters because
without it a future contributor has no way to tell which tables are safe to reuse for an
unrelated research vertical and which are not. This decision is the statement; no schema
changed because of it.

### D14 — A single assertion mechanism replaces bespoke drug-relation tables

Full rationale in `12_DRUG_DOMAIN_ONTOLOGY_AND_ASSERTIONS.md`. In short: bespoke tables
(`substance_relations`, `substance_receptor_bindings`, `substance_symptom_associations`) were
naked edges with no shared provenance shape, no contradiction handling, and no uniform regional
or temporal context — and the concrete requirement that surfaced this (searching interactions
for whatever is commonly sold as a given substance) needs exactly those three things across a
multi-hop query. A single reified `assertions` table, keyed by a controlled predicate
vocabulary, replaces all three. `market_labels` and `geographic_regions` are new for the same
reason: what something is sold as must be able to diverge from what it is, and region needs
real hierarchy, not a bare string.

Not affected: `pill_type_composition` stays a typed table by deliberate exception, stated in
`12_DRUG_DOMAIN_ONTOLOGY_AND_ASSERTIONS.md` — high-volume, stable-shaped lab data is exactly
what a typed column serves better than a generic value field.

### D15 — Query-plan identity extends to language and expansion mode

`01_ARCHITECTURE.md`'s `SourceRequest.dimension` fix (adapters never infer semantics from query
text) extends the same way to language/locale and to alias expansion: a query rendered in Dutch
is a different measurement plan from the same query in Polish, and expanding to slang/market
labels is a different plan from strict canonical naming. Both travel as explicit fields on the
query plan, both are versioned, and a change in either mid-series is a flagged discontinuity
(`QUERY_PLAN_DISCONTINUITY`, `ALIAS_SET_DISCONTINUITY`) exactly like a provider change already
is. The four-mode vocabulary (`STRICT_CANONICAL` / `SCIENTIFIC_SYNONYMS` / `LOCALIZED_SYNONYMS`
/ `EXPERIMENTAL_SLANG_EXPANSION`) is defined in full in
`12_DRUG_DOMAIN_ONTOLOGY_AND_ASSERTIONS.md`.

### D16 — `backend/watchdog_api/` stays the backend root; the layer *boundary* is what E1.3 tests, not the path

Numbered D16 rather than D13 as originally written: the v12 package introduced its own D13, D14
and D15, which other v12 documents cross-reference by number, so this one moved rather than
displacing them.

`01_ARCHITECTURE.md` §Repository layout specifies `src/{api,services,domain,analysis,adapters,repo,diag,ui}`
and E1.3's test says "no SQL exists outside `src/repo`". The repository instead has its backend
under `backend/watchdog_api/` and its React app under `src/`, and that same architecture file
says to "adapt to what exists rather than forcing a move".

Chosen: keep `backend/watchdog_api/` as the backend root and add new layers inside it
(`domain/` at E1.2). The repository layer is `backend/watchdog_api/db/`. E1.3's boundary test
asserts the *invariant* — no SQL and no `better-sqlite3` import outside the repository layer —
against that path.

Rejected: relocating twenty-odd working, tested files to match the spec's example tree. The
invariant D2 protects is "all persistence sits behind repository interfaces"; the directory name
is incidental, and a large mechanical move would bury the E1 work it was meant to enable.

Consequence: read every `src/<layer>` reference in the specification as naming the layer, not
the path.

### Conflict check — RBAC sequencing (resolved by precedence, not overridden)

The second recovery package flagged a genuine sequencing question: recovered pre-MVP material
describes a role ladder (`viewer < researcher < admin < dev`) with an access-request workflow,
which sits in tension with D3's full deferral of authentication to E4. This is recorded rather
than silently resolved, per that package's own instruction not to resolve conflicts quietly.

Resolution: **D3 stands.** The role ladder and access-request workflow are real requirements,
but they are exactly what E4 already is — "Identity, OIDC, RBAC, multi-user visibility" — and
D3's reasoning (a previous attempt died debugging OAuth before one feature worked end to end)
is the maintainer's own lived history, not a convenience this project talked itself into. The
recovered "pre-MVP" framing most plausibly describes readiness before real external users touch
the product, which is compatible with "not before E1's first working slice." E4's scope is
strengthened with the specific role ladder and the access-request workflow so this is a
completion of D3, not a reopening of it. If this reading is wrong, it is one sentence to
override — this paragraph exists so that sentence has something concrete to contradict.

### D17 — Live providers, identity and a deployed instance are pulled forward, ahead of the rest of E2–E5

Decided by the maintainer, 2026-08-19, in one sentence: *"takie rzeczy muszą być bo to jest
pierwsze na czym będę testował"* — live LLM access, OpenRouter, SerpApi, OAuth and a GCP
deployment have to exist, because they are the surface he will first evaluate the system on.

This is the override D3's conflict-check paragraph explicitly invited, and it is the
maintainer's call to make. It does **not** repeal D3's reasoning. The anti-pattern D3 guards
against is *infrastructure before flow* — a previous attempt died debugging OAuth before one
feature worked end to end. That condition no longer holds: E1 exits complete, the slice runs
end to end offline, and `demo:jh16` is reproducible from a clean clone. Building identity and
live acquisition now is therefore sequencing work after the flow exists, which is what D3
actually asked for, not a reversal of it.

Chosen: decompose the minimum cross-cutting slice of E2, E3 and E4 that makes a real,
reachable, credentialled instance possible, and build that before the remainder of any of the
three epics. Specifically: the secret store, one real `text.generate` provider (OpenRouter),
one real `search.result_count` provider (SerpApi), provider stamping and discontinuity
detection, cloud-durable persistence, OIDC, and a container.

Rejected: deploying first and migrating persistence later. On Cloud Run the filesystem is
ephemeral, so a deploy that keeps E1's SQLite file and local blob directory loses the database,
the manifests and the content-addressed raw payloads on every restart while continuing to
render charts. That is not a degraded deployment, it is a system that reports provenance it no
longer holds, and it voids rule 6. Cloud-durable storage is therefore a precondition of the
deployment task, not a follow-up to it — enforced by a startup check, not by a note.

Rejected: a credential-entry form in the UI. Secrets arrive from the environment or the secret
store only. A paste-a-key screen would put credential handling on an internet-reachable surface
before identity exists, and would create a second place a key could be persisted.

Consequence for ordering: the four remaining bullets of E2, the workbench in E5 and all of E6
stay untouched. This is a vertical slice through three epics, not the start of doing them
breadth-first — the anti-pattern in `CLAUDE.md` §2 still applies to everything else in them.

Consequence for cost: two of these providers are metered. `CLAUDE.md` §4 reserves spending
decisions to the maintainer, so the adapters are built complete and left credential-less; each
reports `absent` until a key is present in the environment. No account is created and no
spending is committed by the agent.

### D18 — Capability bundles and responder priority (owner correction, 2026-09-08)

The earlier ladder was the first implementation. `researcher` and `responder` are peers;
their union grants both workflows. `institutional` and `law_enforcement` grant restricted
reference lookup, with no private research, evidence curation, audit-history review or role
management. `admin` is operational; `developer` adds principal management and diagnostics.
`dev` remains an equivalent compatibility alias for existing grants and signed sessions.

The single versioned MVP profile is `shared/authorization.ts`; API enforcement and `/auth/me`
use its union resolver. The UI consumes those capabilities for navigation and route gates.
The principal repository preserves the full set instead of choosing an ordinal maximum.
New role rows are an additive migration; existing OIDC subjects and ownership remain intact.

The owner has brought the responder vertical forward after this foundation. The compiler,
worker and generic-workbench tasks remain open; their unfinished status does not block the
explicitly requested E6 flow. Keep the graph and its four independent presentation dimensions
(evidence tier, content category, approval and quality flags) general, not tied to one pill.

### D19 — Visual workbench, institutional aggregates and profile identity (2026-09-09)

The owner's subsequent instructions explicitly bring forward maps, chart/map tool palettes,
favourites, publication settings, 3D and additional dimensions; spec/13 records the authority
and supersedes E5's old unscheduled-3D wording. This is a working first workbench slice, not
completion of the full advanced-statistics, causal-analysis or paper-generation backlog.

Datasets are versioned source documents with per-owner approval and explicit aggregate sharing.
Institutional profiles see approved shared aggregates, keep their own figure/result history,
and do not acquire private research, curation or diagnostic permissions. A figure pins its
source hash, renderer version and visualization-profile hash. An altered profile is reported
as unavailable for that figure, never silently substituted. Full profiles accompany exports.
Providers, renderers, palettes and shared evidence displays are validated configuration.

Method proposals pin the exact statistical inputs, units, filters and missing-value policy;
individual human approval is required. Styling does not change the statistical method hash.
Runs use the existing deterministic primitives, state machine, analysis tables, object store
and immutable manifests. Result links are checked against ownership, current approval and
selection identity. No live Trends access, synthetic surveillance feed, sentiment model or
verified distribution-route engine is claimed. Imported annotations preserve their own tiers.

Developer diagnostics expose redacted request metadata, persisted trace events/errors and ZIP
bundles. Concurrent spans now share one trace sequence. Changes to recorder mode are audited.

## 4. Open questions for the maintainer

Do not block on these. Proceed with the stated default and flag the assumption.

| # | Question | Default until answered |
|---|---|---|
| Q1 | Are the ~7 files from the interrupted AI Studio pass committed and pushed? | **Answered by E0.1.** Clean, fully-pushed tree; that pass's specific defects were found and fixed. |
| Q2 | Do SerpApi credits exist and on which plan? | Irrelevant to E1 and E2 — all work runs on frozen fixtures |
| Q3 | Which LLM provider for the compiler in E2? | Any configured provider; the compiler is provider-neutral by D5 |
| Q4 | Is the reference harm-score set (Nutt et al. 2010) available as data? | E2 loads it from a versioned config file; ship a fixture with a clear placeholder marker if the real scores are not to hand |
| Q5 | What retention and access policy applies to a responder's lookup history in E6? | Default to no patient-identifying fields accepted anywhere in the field interface (§`11_FIELD_AND_CLINICAL_INTERFACES.md`), audit events retained per the standard `audit_events` policy, visible only to the querying principal and an explicitly granted reviewer role. Revisit when E4 identity exists and real roles can be defined. |
| Q6 | Which regional emergency and poison-control contacts ship as defaults in E6? | None hardcoded; a configuration table keyed by geography, empty until populated. The Dutch entry, when added, should be verified against current NVIC and 112 routing rather than assumed from training data. |
| Q7 | Deployment posture: controlled academic/research service, institutional licence, public read-only harm-reduction surface, or open distribution? | Genuinely undecided, not defaulted. This changes access-control and licensing requirements well beyond E4's RBAC scope. Preserve as a strategy question; do not let any epic's design quietly assume one answer. |

## 5. Epic overview

| Epic | Contents | Exit condition |
|---|---|---|
| **E0** | Repository audit and ledger reconciliation | An honest KEEP/REFACTOR/REPLACE/MISSING matrix exists and tests run |
| **E1** | Vertical slice: fixtures → method → approval → compute → chart → export → manifest | `npm run demo:jh16` runs offline and produces a complete, reproducible run directory |
| **E2** | Method compiler, approval gate, reference-set correlation | Known-answer test on JH2016 prose passes |
| **E3** | Live acquisition, provider abstraction, Postgres/S3 migration | A live JH2016 run completes with provider stamping and discontinuity detection |
| **E4** | Identity, OIDC, RBAC, multi-user visibility | RBAC matrix tests pass; `local-user` rows migrate cleanly |
| **E5** | Generic workbench, replication engine, paper pipeline | An arbitrary CSV can be transformed, analysed and charted without a source-code change |
| **E6** | Field and clinical interfaces: symptom search, pill/sample identification, evidence-tier UI, offline responder mode | A responder card renders end to end from fixtures, entirely offline, with every fact's evidence tier visible and every pill match capped below `PRIMARY_EMPIRICAL` |

Only E0 and E1 are broken into tasks in `07_EPICS_AND_TASKS.md`. Later epics are deliberately
coarse; they will be decomposed when their turn comes, against the repository as it is then.


### E5.4 implementation checkpoint — 2026-09-09

Visualization settings now resolve immutable archived profiles; portable imports cannot restore
source approval or someone else's analysis. Publication ZIPs retain complete source and method
provenance with file hashes, independent verification and the actual rendered SVG. Rendering
code is shared between browser and server. Legacy run/resource API ownership gates also apply
to workbench-created results, preventing access through an older route. See WORKBENCH.md and
ASTRA_PROGRESS.md for verified behavior, test evidence and remaining scope.


### E5.5 implementation checkpoint — 2026-09-10

Regional fills use separately versioned/reviewed geometry with exact identifiers and optional
explicit mapping data. Missing values, absent observations, ambiguous multi-row joins and
unmatched source codes remain distinct; no aggregation is inferred. Polygon/MultiPolygon,
holes, time/panels, color classes and alpha use the shared renderer and persist in favourites.
Boundary ID/hash pins are access-checked during save, restore and export. Publication packages
preserve original GeoJSON, geometry receipts and independently verifiable join reports. The
bundled map requires explicit import and review; its pre-existing collapsed PRK part is retained
and flagged. Transform DAGs, advanced spatial/causal methods and paper generation remain open.

### E3.6 / E5.6 checkpoint — 2026-09-11

Durable public acquisition and daily/interval schedules are published and CI-verified.
The personal wizard adds encrypted owner keys, cost ceilings, archived model prices,
independent exploration dimensions and an idempotent approved JH16 MethodSpec launch.
UI modes do not change role grants. See PERSONAL_SETUP.md and ASTRA_PROGRESS.md.
The latest maintainer direction supersedes the early narrow product scope: goal-oriented
contextual flows, many provider profiles, measured task routing, arbitrary paper intake
and tested extension proposals. PRODUCT_PRINCIPLES_AND_NEXT.md records precise acceptance
criteria and what remains; it is not a list of already implemented capabilities.

The next checkpoint adds 16 personal text provider profiles and seven task profiles.
Direct-provider prices and task benchmarks have explicit reviewed provenance, validity
and owner scope; unknown quality or price is not inferred from model name or another
vendor. Details and remaining acquisition/benchmark automation are in PERSONAL_PROVIDERS.md.

### E5.7a / E5.8a checkpoint — 2026-09-11

Arbitrary submitted paper text and discovered abstracts now enter an immutable research
workspace. Methodology proposals retain exact source anchors and separate missing inputs,
operations, hypotheses and explicit substitutes. Reusing original data means reanalysis;
simulated expert answers remain simulation. Assessment is not executable method approval.
Owned daily/interval reviews respect task budgets, cancellation and no automatic rebilling
of failed/interrupted attempts. Source revisions retain discovery and raw-receipt lineage.

Strict JSON/CSV copy profiles extend extraction through data, not new bespoke source code.
LLMs propose structure selectors; deterministic code copies source values as lexical strings.
Activation requires an exact-output fixture test of the pinned profile. History/raw input,
provenance and failed trials remain inspectable. Goal navigation leads to existing workflows;
source/variant/parser forms expose common actions without requiring JSON editing. General
scientific replication, generated executable modules and advanced inference remain open.

### E5.8c checkpoint — 2026-09-12

A tested parser execution can now become a proposed statistical dataset through explicit
column types, units, missingness and source context. Import preserves and verifies the exact
source/execution lineage. The interface links directly to that dataset's existing review and
analysis workflow. Profile data controls the new form's wording/options. Whole source files,
including unselected fields, accompany later publication. Export packages replay copying and
numeric conversion offline. Decimal precision loss is rejected; calculations remain binary64.
This stage connects acquired values to existing statistics; it does not infer an executable
method from a paper, generate missing observations or certify an independent replication.

### E5.8d checkpoint — reusable mapping profiles

Named private extraction mappings now survive repeated source imports as immutable templates.
Reuse restores explicit settings for the exact parser; it never supplies old observations,
citations, evidence classifications or approvals. Origin IDs/hashes and later mapping edits
remain visible in provenance. The normal dataset/method review and numeric precision contract
continue to apply. This is a saved workflow step, not autonomous arbitrary-paper execution.
