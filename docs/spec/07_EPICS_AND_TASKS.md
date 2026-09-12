# Task ledger

**This is the working document.** Tick a box only when its test passes. Commit the tick with
the work. If the repository contradicts a tick, the repository wins — untick it and say so.

Task IDs are stable. Do not renumber. Add new tasks with new numbers.

---

## Continuation checkpoints — 2026-09-11

- [x] **E3.6 — Public acquisition schedules and substance memory.** Durable owned jobs,
  daily/interval schedules, restart recovery, bounded public source adapters and immutable
  raw receipts. Published at `35deca9`; CI `34568553854`: 286/286, including Chromium.
- [x] **E3.7 — Personal settings and keys.** Owner-scoped encrypted vault, immutable settings
  snapshots, task/catalog provenance, reserved LLM budgets and personal SERP limits.
  Eight integration tests pass; malformed credential bodies cannot echo key fragments.
- [x] **E5.6 — Reviewed setup research plan.** Idempotent wizard launch through the actual
  JH16 MethodSpec executor; 32 fixture observations and manifest approval/hash checked.
  Separate language/geography and bounded public jobs. Browser coverage added for CI.
- [x] **E3.8 — Many personal providers and evidence-based task routing.** Sixteen protocol
  profiles, native Messages, private model catalogs, reviewed price ceilings, seven task
  profiles and comparable reviewed benchmarks plus operational history. 285 local tests
  pass. See PERSONAL_PROVIDERS.md; direct price feeds and semantic benchmark runners remain open.
- [x] **E5.7a — Paper intake and explicit substitution plans.** Immutable submitted text,
  discovery receipt lineage, source-anchored methodology and required inputs, explicit
  reanalysis/proxy/simulation meaning, owned bounded reviews and interrupted-attempt recovery.
  See RESEARCH_WORKSHOP.md for the supported text/abstract scope and validation evidence.
- [ ] **E5.7b — General executable replication and hypothesis studies.** Connect reviewed
  assessments to frozen MethodSpecs and actual acquired inputs; confirmation partitions,
  comparison families, hypothesis prioritization and project/draft evidence graphs remain open.
- [x] **E5.8a — Deterministic JSON/CSV extraction and goal navigation.** Form-based or LLM-
  proposed copy profiles, exact-output tests, hash-bound activation, lexical provenance,
  persistent test/execution history and exports; ten capability-filtered goal paths.
- [ ] **E5.8b — General extension execution and adaptive navigation.** HTML/PDF parsing,
  sandboxed generated modules, full compatibility contracts, saved workflow favourites
  and an autonomous natural-language goal planner remain open.
- [x] **E5.8c — Source extraction to reviewed statistical data.** Explicit field types,
  units, missingness and evidence classification; raw-source/execution lineage checked
  during import, owned dataset deep link, existing method review and statistical executor.
  Publication ZIP replays exact copying and conversion without external dependencies.
  Published `9f5b38d`; CI `34663543418`: 319/319, including the complete browser flow.
- [x] **E5.8d — Reusable extraction mapping templates.** Private immutable mapping snapshots
  from successfully imported data, pinned parser/data origins, explicit reuse and an accurate
  modification flag. No source values, citation, evidence tier or approval is copied from the
  old dataset. Restart/ownership-transfer and precision/lineage tests pass; browser reuse added.

## E0 — Repository audit

Nothing else starts until E0 is done. The specification describes intent; the repository is
fact, and they are known to differ.

- [x] **E0.1 — Inventory**
  Produce `docs/AUDIT.md` containing: the full source tree; for every file a verdict of
  KEEP / REFACTOR / REPLACE / DELETE with a one-line reason; every command that actually runs;
  every test and whether it passes; every declared dependency that is unused; every `TODO`,
  `FIXME` and stub that returns a plausible value without doing the work.
  *Done when:* `docs/AUDIT.md` exists and every source file appears in it exactly once.

- [x] **E0.2 — Fabrication sweep**
  From the audit, list every function that returns a number or a scientific-looking result
  without computing it from stored data. For each: either implement it, or make it throw
  `NotImplementedError` and register its capability as `planned`. There is no third option.
  *Done when:* no code path can return a fabricated measurement, and a test asserts the stubs
  throw.

- [x] **E0.3 — Secrets scan**
  Scan the full history, not just the working tree, for committed keys. If any are found, stop
  and tell the maintainer immediately — this is one of the few genuine interrupts.
  *Done when:* scan is clean or the maintainer has been told.

- [x] **E0.4 — Green baseline**
  Get `npm run test:all` to pass, by fixing or by explicitly marking and listing skipped
  tests in `docs/AUDIT.md`. A hidden failing test is worse than a listed skipped one.
  *Done when:* the command exits zero and every skip is listed with a reason.

- [x] **E0.5 — Reconcile the ledger**
  Compare the audit against E1 below. Tick any E1 task already genuinely complete. Add tasks
  for anything the repository needs that this ledger missed.
  *Done when:* ledger and repository agree.

---

## E1 — Vertical slice

One narrow path, working completely, offline, on frozen fixtures:

```
fixture source → observations → method (proposed → approved) → deterministic compute
              → chart → narrative (proposed → approved) → export → manifest
```

E1 is deliberately narrow. Resist widening it. The value of E1 is that it is *finished*.

### Group 1 — Foundations

- [x] **E1.1 — Configuration loader**
  Schema validation, canonicalisation, hashing. Invalid config fails at startup with the
  failing path and rule.
  *Test:* two semantically equal configs with different key order hash identically; an invalid
  config fails with a precise message; a missing required field never silently defaults.

- [x] **E1.2 — Domain types**
  Run state machine, `Observation` with explicit missingness, `Approvable`, error taxonomy,
  `Principal`, `MethodSpec` types. Pure — no I/O, importable with no database.
  *Test:* the whole `domain` module imports and its tests pass with no database, network or
  filesystem available.

- [x] **E1.3 — Persistence**
  SQLite schema per `02_DATA_MODEL.md`, including the empty datasets, transforms and
  replication tables, and the `evidence_tier` enum plus the empty E6 field-reference tables
  (symptoms, pill_types, tested_samples, pill_type_composition, assertions, targets,
  market_labels, geographic_regions, batch_alert_rules, batch_alerts) per D12/D14. Migrations.
  Repository interfaces with SQLite implementations. Local content-addressed blob store.
  *Test:* migration runs clean on an empty file; a blob round-trips by hash; two identical
  payloads share one blob row while two fetch-event rows survive; no SQL exists outside
  `src/repo`; every E6 table exists and is empty.

### Group 2 — Diagnostics spine

Before feature work. See `06_DIAGNOSTICS.md`.

- [x] **E1.4 — Tracer**
  Central diagnostics API, correlation context, event vocabulary, four modes, context
  propagation across the service and worker boundary.
  *Test:* a traced call chain produces ordered events with consistent `trace_id` and
  monotonic `sequence_no`.

- [x] **E1.5 — Redaction**
  Central layer before every sink.
  *Test:* the canary secret is absent from trace stream, logs, manifest, bundle and error
  envelope.

- [x] **E1.6 — Error envelopes and cause chains**
  Wrap at every boundary, preserve `cause` to the root.
  *Test:* an error raised four layers down arrives with its full chain and the state at
  failure.

- [x] **E1.7 — Diagnostic bundle**
  One command or one click produces the redacted ZIP.
  *Test:* a deliberately failed fixture run yields a bundle from which the direct cause is
  identifiable without re-running. This is the E1 diagnostics acceptance test.

### Group 3 — Acquisition

- [x] **E1.8 — SourceAdapter protocol and fixture adapter**
  `FixtureSourceAdapter` reads frozen JSON from `fixtures/jh2016/`. No network in E1 at all.
  `dimension`, `language` and `queryExpansionMode` all travel on `SourceRequest` from the
  preset; the adapter never infers any of them from query text (`01_ARCHITECTURE.md`
  §SourceAdapter, D15).
  *Test:* fetch → raw blob → normalize → observations, with the rendered query stored exactly
  and a missing count arriving as missing rather than zero; the adapter-neutrality test in
  `09_TESTS.md`.

- [x] **E1.9 — Fixtures**
  Frozen fixture set for all 32 JH2016 queries, plus deliberate edge cases: one missing count,
  one zero `Ni`, one unparseable count, one count formatted with grouping separators.
  *Test:* every fixture loads and the edge cases behave per `03_JH2016_CONTRACT.md`.

- [x] **E1.10 — Registry skeleton**
  Capability, provider and credential registries per `05_PROVIDERS_AND_CAPABILITIES.md`, with
  the fixture provider as the only `implemented` entry and the seed list registered as
  `planned`.
  *Test:* a `planned` provider cannot be selected for a run; the UI does not render it as
  available.

### Group 4 — Method and approval

- [x] **E1.11 — Primitive registry**
  The seven primitives in `04_METHOD_COMPILER_AND_APPROVAL.md`, each with a declared contract
  and explicit missing-value behaviour.
  *Test:* each primitive against hand-computed values, including its missing and failure cases.

- [x] **E1.12 — MethodSpec validation and hashing**
  Full validation: unknown primitive, unresolved reference, cycle, unit mismatch, undeclared
  missing policy. Canonical hashing.
  *Test:* each invalid case is rejected with a precise message; equal specs hash equally.

- [x] **E1.13 — Approval gate**
  Domain-layer enforcement, hash-bound, with audit events.
  *Test:* a `PROPOSED` spec reaching the executor throws `ApprovalRequiredError`; approving
  then editing reverts to `PROPOSED` with no explicit action; there is no code path that
  approves without a human action.

- [x] **E1.14 — TypeScript executor**
  `MethodExecutor` implementation. Deterministic, ordered, no clock, no random.
  *Test:* two executions of the same spec on the same inputs produce byte-identical artifacts.

- [x] **E1.15 — JH2016 FAITHFUL preset and analyzer**
  The locked preset as configuration; Pi and Hi expressed as a `MethodSpec` over the
  primitives, not as bespoke code.
  *Test:* the full golden-fixture suite in `03_JH2016_CONTRACT.md`.

### Group 5 — Output

- [x] **E1.16 — Charts**
  Pi and Hi bar charts, and a scatter of Hi against the reference set. Missing values render
  as visibly missing, never as zero or as a gap that reads as zero. A series carrying
  `PROVIDER_DISCONTINUITY` shows it in the legend.
  *Test:* a chart spec with a missing value renders it as missing; snapshot test on the golden
  fixture.

- [x] **E1.17 — Narrative service**
  Consumes a frozen payload and its hash. Cannot read the database. Output is `PROPOSED`,
  visually distinct, recorded with provider, model and generation parameters.
  *Test:* the service cannot alter any numeric value; unapproved narrative cannot reach an
  export.

- [x] **E1.18 — Export**
  CSV and JSON at minimum. Exports consume stored results; they never recompute and never
  re-fetch. Generated prose is visually distinguishable in every format that supports it.
  *Test:* exported values equal stored values byte-for-byte; an export attempted with an
  unapproved artifact is refused.

- [x] **E1.19 — Manifest**
  Every field in `02_DATA_MODEL.md` §manifest.
  *Test:* the manifest of a golden run contains every required field, every quality flag
  raised anywhere in the run, and an explicit list of missing observations.

- [x] **E1.20 — Replication target #1**
  Register JH2016 as `replication_targets` row 1 with its published claims and tolerance
  bands, per `08_REPLICATION_ENGINE.md`. Record a verdict for the fixture run.
  *Test:* the fixture run produces verdicts against every registered claim, using the
  vocabulary `reproduced` / `deviates` / `not_computable` / `method_unclear`.

### Group 6 — Frontend slice

Minimal. One workflow, end to end. No dashboard, no settings pages, no navigation framework.

*E0.5 note:* the repository already has a working, tested multi-page shell (`Layout` nav,
Dashboard, Sources, Runs, Analyzers). Per `CLAUDE.md` §0 ("if the ledger and the repository
disagree, the repository wins"), E1.21-23 add the required pages *into* that shell rather than
removing it. "No dashboard" means the vertical slice does not depend on one existing, not that
working tested navigation should be deleted. See D11.

- [x] **E1.21 — Study page**
  Source selection, run trigger, run status with live trace link.
  *Test:* a browser E2E test drives a full fixture run from the UI.

- [x] **E1.22 — Method review page**
  Prose input, proposed spec rendered step by step in red with its rationale, per-step
  approval, then green.
  *Test:* E2E — a proposal cannot be executed until approved; editing an approved spec turns
  it red again.

- [x] **E1.23 — Results page**
  Charts, the results table, the manifest link, the export button, the narrative in its
  approval state.
  *Test:* E2E — results, approval states and export are all reachable and correct.

### E1 exit

- [x] **E1.24 — `npm run demo:jh16`**
  From a clean clone, with no credentials and no network, this command produces a complete run
  directory: manifest, raw fixture copies, normalized observations, analysis output, charts,
  exports, replication verdicts and the trace.
  *Test:* run it twice; the two run directories are byte-identical apart from run id and
  timestamps. Verify on a clean clone, not on the working tree.

### E0.5 / v9 / v12 additions — found by the audit and by later spec merges

- [x] **E1.25 — Wire `ConfigLoader` into the running server**
  `config/{loader,schemas,canonicalize}.ts` pass their tests in isolation, but nothing in
  `server.ts` or `api/routes.ts` calls `loadEffectiveConfig`. Every run today executes whatever
  the HTTP request body contains, unvalidated by this system.
  *Test:* a run whose config fails schema validation is rejected before the orchestrator runs,
  with the failing path and rule in the error response.

- [x] **E1.26 — Persist `source_adapter_version` on observations**
  Closed by E1.3: it is a real column, so a real version round-trips and `'unknown'` appears
  only when the value genuinely was never recorded.

- [x] **E1.27 — Finalize a manifest at the end of a run**
  `run_orchestrator.ts` constructs an `ArtifactRepository` but never calls `finalizeManifest`,
  so no run produces a manifest and `GET /api/runs/:id/manifest` 404s even after success.
  *Test:* after a run completes, its manifest exists and is retrievable.

- [x] **E1.28 — Remove dead dependencies and the stale lockfile**
  `@google/genai`, `jstat`, `motion`, `uuid`, `recharts`, `drizzle-kit`, `cors` and `dotenv` are
  declared but imported nowhere; `bun.lock` is a second unused lockfile beside
  `package-lock.json`.
  *Test:* `npm run test:all` stays green after removal.

- [x] **E1.29 — Remove dimension inference from the existing adapters**
  Closed by E1.3. `SourceRequest` carries `dimension` from the preset, the orchestrator builds
  the (entity x dimension) plan, `assertValidSourceRequest` rejects a missing dimension in both
  `fetch` and `normalize`, and the adapter-neutrality suite runs against every registered
  adapter — including the two-requests-identical-text case.

- [x] **E1.30 — D14 assertion mechanism in the schema (v12)**
  Migration 002: add `assertions`, `targets`, `market_labels`, `geographic_regions`; drop
  `substance_symptom_associations`, which D14 supersedes; add `tested_samples.claimed_label_id`.
  Schema only — E6 populates it.
  *Test:* every D14 table exists and is empty; the predicate vocabulary is constrained; a
  contradiction can be stored with both sides retained.

- [x] **E1.31 — D15 query-plan identity on `SourceRequest` (v12)**
  `language` and `queryExpansionMode` travel on `SourceRequest` alongside `dimension`, are never
  inferred by an adapter, and a mid-series change in either raises
  `QUERY_PLAN_DISCONTINUITY` / `ALIAS_SET_DISCONTINUITY`.
  *Test:* the adapter-neutrality suite extended to both fields; a missing `queryExpansionMode`
  fails validation rather than defaulting.

---

## D17 slice — a real instance the maintainer can test on

Pulled forward by the maintainer ahead of the rest of E2–E5; see D17 in
`00_STATE_AND_DECISIONS.md`. This is one vertical slice through three epics, not permission to
start any of them breadth-first. Tasks keep their home epic's number.

- [x] **E3.1 — Secret store**
  `SecretProvider` with environment and GCP Secret Manager backends. `secret_ref` resolves
  through it and nowhere else. Resolved values register with the redactor at load, so a key
  that reaches an error message is scrubbed by value as well as by key. Credential state is
  `present | absent | invalid` and the value never leaves the process.
  *Test:* a canary secret injected into configuration appears in no sink; a missing key yields
  `absent` rather than an empty string that reads as a configured credential; no API response
  or manifest contains a resolved value.

- [x] **E2.1 — OpenRouter as a real `text.generate` provider**
  HTTP behind an injectable transport so tests never reach the network. Provider status is
  *derived* from credential presence, not stored: no key means `blocked` with a reason, never
  `implemented`. Generated text enters as `PROPOSED` under the existing hash-bound gate.
  *Test:* with no credential the provider is unselectable and throws; with a stubbed transport
  a generation round-trips and lands as `PROPOSED`; a test asserts no LLM output can reach an
  `AnalysisResultValue`.

- [x] **E3.2 — SerpApi as a real `search.result_count` provider**
  HTTP behind the same injectable transport. Rate limiting, quota exhaustion and an
  unparseable count are each an explicit missing reason with its own code — never zero, never a
  silent retry that fabricates a number.
  *Test:* a 429 and a quota-exhausted body each produce a missing observation with a distinct
  reason; a malformed count produces `PARSE_FAILED`; no path returns 0 for an absent count.

- [x] **E3.3 — Provider stamping and discontinuity**
  Every observation records the provider that served it. A series whose provider changes
  mid-way raises `PROVIDER_DISCONTINUITY` into the manifest and onto the chart, per rule 4.
  *Test:* a two-provider series flags; a single-provider series does not; the flag survives
  into the manifest and the chart spec.

- [x] **E3.4 — Cloud-durable persistence (blob store done; Postgres deliberately not)**
  GCS behind `ObjectStore`, selected by `STORE_BACKEND`, with WORM decided on content exactly
  as locally and `ifGenerationMatch=0` making the cross-instance race safe. A startup gate
  refuses to boot a production instance whose data would not survive a restart.
  **PostgreSQL is registered `planned` and throws** — see Blocked. SQLite and the local blob
  directory remain the default for local work.
  *Test:* a blob round-trips through a stubbed GCS; identical bytes re-put succeed and
  differing bytes are refused, on both backends; the durability gate names what would be lost
  and how to fix it; `postgres` is unselectable and throws `NotImplementedError`.

- [x] **E4.1 — Google OIDC behind `IdentityProvider`**
  OIDC as one implementation of the seam E1 shipped. Role ladder
  `viewer < researcher < admin < dev` and the RBAC matrix. `local-user` rows migrate to a real
  principal rather than being orphaned.
  *Test:* the RBAC matrix tests pass; an unauthenticated request to a mutating route is
  refused; existing `local-user` rows resolve to the migrated owner after migration.

- [x] **E3.6 — The flow, end to end**
  `GET /api/providers/readiness` reporting derived status and a remediation for every provider
  and source; a live `serp_result_count` source resolved per run from credential state;
  `POST /api/runs/:id/narrative/generate` behind the approval gate; a Setup page that answers
  "why can't I run this yet?" with the exact fix.
  *Test:* readiness names the missing environment variable for each blocked provider; an
  uncredentialled live run fails and its failure names the variable; an unconfigured narrative
  provider returns 409 and never template prose.

- [x] **E3.5 — Container and Cloud Run**
  Dockerfile, deploy script, and a runbook written for someone who has not used GCP. Startup
  refuses to boot in production when storage is ephemeral and Postgres/GCS are unconfigured.
  *Test:* the startup check fails fast with a precise message under a production environment
  with no durable storage configured, and passes when it is configured.

## E2 — Compiler and validation

Decompose when E1 exits. Contents: the LLM method compiler with its known-answer test on
JH2016 prose; the reference score set loader; Pearson and Spearman against the reference;
ambiguity surfacing in the compiler UI.

## E3 — Live acquisition

Contents: a real `search.result_count` provider; provider stamping and
`PROVIDER_DISCONTINUITY` detection on live data; rate-limit and quota handling as an operating
condition; PostgreSQL and S3 migration; a real worker process.

## E4 — Identity

- [x] **E4.2 — Peer capability profiles.** One shared resolver, `/auth/me` union, UI navigation
  and route gates, additive role migration, full principal role sets. Matrix + real HTTP tests
  verify researcher/responder separation, combined profiles, restricted institutional access,
  admin/developer distinction and the legacy `dev` alias. Supersedes the old ladder below.

- [x] **E4.4 — Run/resource ownership.** Legacy run lists and all descendants enforce ownership;
  raw blobs require an owned fetch event. New runs/artifacts inherit the signed-in principal.
  Source-run reuse is owner-gated. Legacy approval is scoped to the shipped method, requires
  the displayed hash, derives the reviewer from the session and writes an audit event.
  HTTP tests include workbench-result bypass attempts and separate acquisition/analysis runs.

Contents: OIDC behind `IdentityProvider`; role ladder `viewer < researcher < admin < dev`
(recovered pre-MVP requirement, folded in here per the conflict resolution in
`00_STATE_AND_DECISIONS.md`); RBAC capability matrix; migration of `local-user` rows; access
requests and admin approval; per-source permissions; developer diagnostics surface gated to the
`dev` role.

## E5 — Workbench and replication engine

- [x] **E5.1 — Versioned source tables.** JSON/CSV import, original CSV retention, explicit
  column types/units/missing reasons/provider/comparison context, WORM hashes and separate
  retrieval/import events. Individual hash-bound approval, revocation and aggregate sharing.
  Real database/HTTP tests verify access isolation and missingness.
- [x] **E5.2 — First visual workbench.** 2D scatter, line, observation bars, orthographic 3D
  and Natural Earth geographic markers; filters, time frames, panels, color/size/alpha/labels,
  camera controls, inspect/select, shared visible/context palette, exact saved figures and
  favourites. SVG/CSV/JSON exports pin source and profile identity. Render tests cover missing
  values, log gaps, discontinuities, map units and 3D geometry. Browser workflow is a CI gate.
- [x] **E5.3 — Reviewed exploratory analysis.** Existing describe/Pearson/Spearman primitives
  behind individual MethodSpec approval; inputs/selections are hash-bound. Existing runs,
  analysis tables, artifacts and manifests persist deterministic results with replay inputs.
  Saved result references reject forged hashes, changed selections, other owners and revocation.
- [x] **E4.3 — Developer diagnostics UI.** Capability-gated mode control, recent request
  metadata, persisted traces/errors and redacted ZIP download. Mode changes are audited;
  concurrent spans retain unique ordered sequence numbers.
- [x] **E5.4 — Reproducible publication package.** WORM profile snapshots; automatic historical
  palette/style restoration and portable figure JSON import. Browser and server exports share
  one SVG renderer. Deterministic ZIP includes full data, figure, profile, source CSV, selected
  rows and optional method/inputs/result/manifest. Standalone verification checks checksums and
  linked identities. Real DB/HTTP tests cover configuration changes, tampering, revocation,
  private-result isolation and numerical replay. Chromium import/download/reload is a CI gate.
- [x] **E5.5 — Reviewed boundary maps.** Versioned Polygon/MultiPolygon import, exact source
  mapping and separate owner review/sharing/revocation. Choropleths preserve zero, missing,
  absent, ambiguous and unmatched observations; explicit mappings, class breaks, alpha,
  time/facets, labels, extent controls, region inspection and favourites persist. Research ZIPs
  retain geometry/source/approval and per-panel joins, independently checked by the verifier.
  Real DB/HTTP and render tests cover joins, hash pins, WORM, access and revocation. Production
  Chromium import → review → map → save/reload → SVG/ZIP verification is a CI gate.
- [ ] **E5 remainder.** Transform DAG, advanced reviewed methods, Python sidecar, uncertainty
  bands, graph layers, route-hypothesis workflow, and the full paper pipeline.
  Their presence in the following inventory is not an implementation claim.

Contents: dataset import and the transform DAG; the generic method registry beyond the seven
primitives, including the baseline statistical family (Pearson/Spearman/Kendall, regression,
partial and lagged correlation, confidence intervals, multiple-testing control) and the
time-series/causal family (rolling statistics, decomposition, stationarity, changepoint
detection, Granger-style tests, VAR) once each has an explicit scientific review — none of this
enters the approved primitive registry by just being listed here; the Python sidecar executor;
the replication engine per `08_REPLICATION_ENGINE.md`, including the later autonomous
replication-agent pipeline (`DISCOVERED → SCREENED → METHOD_EXTRACTED → ... → REPORT_DRAFTED`)
and the rule that a replication assessment never collapses method/data/population/analysis
fidelity into one score; the paper pipeline; the visualisation registry (line/bar/scatter,
uncertainty bands, region maps, provider-discontinuity markers, graph-neighbourhood views). 3D and further visual channels were explicitly brought forward by the owner; see D19 and
`13_VISUAL_WORKBENCH.md`. Orthographic 3D is implemented in E5.2.

This epic is explicitly domain-neutral (D13): everything here must work for an arbitrary
dataset, not only the drug vertical, and nothing in this list may be implemented by importing
a drug-specific concept into the generic method registry.

## E6 — Field and clinical interfaces

- [x] **E6.1 — Reviewed responder references.** Versioned sample/alert/assertion import into
  the existing graph, individual approval/revocation, regional pill/market/symptom lookup,
  fixed twelve-category reference cards and independent evidence/review/quality signals.
  Bundled real-source mappings remain PROPOSED until reviewed. See `docs/FIELD_REFERENCE.md`.
- [x] **E6.2 — Bounded offline reference access.** Hash-checked principal snapshots, TTL,
  static production shell, cached-source age and offline audit outbox with idempotent sync.
  Backend/render/client tests pass; production browser reload is an explicit CI gate.
- [ ] **E6 remainder.** Automated alert classification/queues, additional reviewed source
  coverage, public-health policy timelines and the public harm-reduction surface.

Contents: the substance-centric knowledge graph and assertion mechanism per
`12_DRUG_DOMAIN_ONTOLOGY_AND_ASSERTIONS.md` — populating `assertions`, `targets`,
`market_labels`, `geographic_regions` from real sources, and the market-label/misrepresentation
lookup that is this epic's flagship acceptance case (KG-1 in `09_TESTS.md`); symptom search
(checklist and free-text) per `11_FIELD_AND_CLINICAL_INTERFACES.md`; pill and sample
identification with the visual-match evidence ceiling; the responder card and its fixed
twelve-category layout; adulterant, look-alike and counterfeit alerting via
`batch_alert_rules`/`batch_alerts`, where "counterfeit" is always an evidence-backed
classification, never a visual-mismatch label; offline sync for field use; the government/
public-health and harm-reduction output surfaces (region×substance×metric views, alert queues,
legal/policy timelines, approved public alerts) as consumers of the same graph rather than
separate data models; sourcing work against the seed list in
`11_FIELD_AND_CLINICAL_INTERFACES.md` §Source seed list, starting with manual/versioned import
rather than live fetch. Schema already exists from E1 task E1.3 per D12/D14 — this epic does
not start with a migration.

Do not start E6 before E1 exits. The schema being present is not permission to build against it
early; it exists early specifically so E6 can start clean when its turn comes, per D12 —
the same relationship E1 has to the replication and dataset tables it also seeds without using.

### Internal sequencing within E6 — four vertical slices, not one block

E6 is written above as one epic because its consumers share one substrate (the assertion
graph), not because it should be built as one undifferentiated effort. It decomposes into four
sequential slices, each carried to a working MVP against real sources before the next starts —
the same discipline E1 applied to the research slice, applied again one level down:

1. **Research** (E1 — already sequenced ahead of E6, listed here only to keep the count of four
   explicit and correct).
2. **Responder** — symptom search, pill/sample identification, the responder card, the
   market-label/misrepresentation lookup. Highest-stakes, most fully specified already, and the
   only one of the three E6 consumers the maintainer's own April 2026 prioritisation explicitly
   confirmed ("confirmed, post-MVP") rather than merely listed as planned.
3. **Government / public-health** — region×substance×metric views, alert queues, legal/policy
   timeline, surveillance exports. Consumes the same graph the responder slice already proved
   out; largely a different projection and UI over data structures slice 2 will have already
   exercised.
4. **Harm-reduction** — approved public alerts, drug-checking/service information, evidence-
   strength labels for a public audience. Most constrained of the three (no patient-specific or
   generated clinical content at all), plausibly the cheapest once 2 and 3 exist, but not
   assumed cheap until it is actually scoped.

Each slice gets its own task decomposition when its turn comes, exactly as E1's did — this
ordering is recorded now so the next contributor does not default to building all three at once
just because the schema for all three already exists.

---

## Continued research vertical slices

- [x] **E5.8e — Source-linked selected paper operations.** Manual quote or saved assessment
  operation -> approved numeric columns and explicit origins/substitutions -> immutable
  method proposal -> human review -> real describe/Pearson/Spearman execution -> history
  and portable source-verified ZIP. All data rows, current approval/ownership, exact source
  anchors and unresolved scope are retained. See `docs/PAPER_ANALYSES.md` and
  `docs/ASTRA_PROGRESS.md`. This does not mark the general paper compiler complete.

## Blocked

### Continuation checkpoint (2026-09-08)

- [x] **E0.6 — Portable clean install and test entrypoints.** Repair missing optional-platform
  lock entries; use Node's tsx loader without a CLI IPC server. Lockfile consistency,
  production build and offline JH16 demo checked. Baseline 227/231 passed; four browser tests
  blocked by absent Chromium/download timeout, not by a reported application assertion.
  See `docs/ASTRA_PROGRESS.md` for exact environment limits.

*Nothing. E1.20's tolerance bands, the one item that was blocked, were proposed against the
primary source and then registered under authority the maintainer delegated explicitly. The
pre-registration property is preserved and checkable: the bands and their full rationale were
committed in `2e417c66514b3ac24aef6cc067d435168089f852` before any verdict existed anywhere in
this repository, and `config/replication/jh2016.json` names that commit. Widening a band after
seeing a verdict requires a new version of that file and is visible in git history.*

### PostgreSQL backend for `storage.relational`

**What is missing.** Everything except the database runs cloud-durably: GCS is implemented and
tested, and the durability gate enforces it. The database is still SQLite.

**Why it was not written.** A Postgres backend needs (a) a driver dependency — `pg` plus
`drizzle-orm/node-postgres` — and (b) a dialect port of the four migrations, which use SQLite
integer booleans, `PRAGMA table_info` introspection in the ownership-transfer path, and
`INSERT OR IGNORE`. None of that is hard, but **none of it can be verified from this
environment**: there is no Postgres server to run the repository suite against. Shipping an
adapter that has never executed a statement, registered as `implemented`, is the fabricated
implementation rule 1 forbids. It is registered `planned` and throws instead.

**Consequence for deploying now.** Cloud Run with `--max-instances=1` and the SQLite file on a
mounted volume is durable and correct for a single writer, which is what a solo researcher
testing the system actually has. It does not scale horizontally, and the gate will not let a
production instance run without the mount.

**Unblock in one line:** *"Provision Cloud SQL Postgres and add `pg` as a dependency"* — with a
`DATABASE_URL` reachable from a test run, this is roughly a day: port the migrations, add the
drizzle pg dialect behind the existing `db` export, and run the repository suite against both.

*Add entries here with enough detail that the maintainer can unblock in one action, then
continue with the next unblocked task rather than waiting.*
