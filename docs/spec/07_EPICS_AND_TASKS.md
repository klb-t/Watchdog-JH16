# Task ledger

**This is the working document.** Tick a box only when its test passes. Commit the tick with
the work. If the repository contradicts a tick, the repository wins — untick it and say so.

Task IDs are stable. Do not renumber. Add new tasks with new numbers.

---

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

- [ ] **E1.8 — SourceAdapter protocol and fixture adapter**
  `FixtureSourceAdapter` reads frozen JSON from `fixtures/jh2016/`. No network in E1 at all.
  `dimension`, `language` and `queryExpansionMode` all travel on `SourceRequest` from the
  preset; the adapter never infers any of them from query text (`01_ARCHITECTURE.md`
  §SourceAdapter, D15).
  *Test:* fetch → raw blob → normalize → observations, with the rendered query stored exactly
  and a missing count arriving as missing rather than zero; the adapter-neutrality test in
  `09_TESTS.md`.

- [ ] **E1.9 — Fixtures**
  Frozen fixture set for all 32 JH2016 queries, plus deliberate edge cases: one missing count,
  one zero `Ni`, one unparseable count, one count formatted with grouping separators.
  *Test:* every fixture loads and the edge cases behave per `03_JH2016_CONTRACT.md`.

- [ ] **E1.10 — Registry skeleton**
  Capability, provider and credential registries per `05_PROVIDERS_AND_CAPABILITIES.md`, with
  the fixture provider as the only `implemented` entry and the seed list registered as
  `planned`.
  *Test:* a `planned` provider cannot be selected for a run; the UI does not render it as
  available.

### Group 4 — Method and approval

- [ ] **E1.11 — Primitive registry**
  The seven primitives in `04_METHOD_COMPILER_AND_APPROVAL.md`, each with a declared contract
  and explicit missing-value behaviour.
  *Test:* each primitive against hand-computed values, including its missing and failure cases.

- [ ] **E1.12 — MethodSpec validation and hashing**
  Full validation: unknown primitive, unresolved reference, cycle, unit mismatch, undeclared
  missing policy. Canonical hashing.
  *Test:* each invalid case is rejected with a precise message; equal specs hash equally.

- [ ] **E1.13 — Approval gate**
  Domain-layer enforcement, hash-bound, with audit events.
  *Test:* a `PROPOSED` spec reaching the executor throws `ApprovalRequiredError`; approving
  then editing reverts to `PROPOSED` with no explicit action; there is no code path that
  approves without a human action.

- [ ] **E1.14 — TypeScript executor**
  `MethodExecutor` implementation. Deterministic, ordered, no clock, no random.
  *Test:* two executions of the same spec on the same inputs produce byte-identical artifacts.

- [ ] **E1.15 — JH2016 FAITHFUL preset and analyzer**
  The locked preset as configuration; Pi and Hi expressed as a `MethodSpec` over the
  primitives, not as bespoke code.
  *Test:* the full golden-fixture suite in `03_JH2016_CONTRACT.md`.

### Group 5 — Output

- [ ] **E1.16 — Charts**
  Pi and Hi bar charts, and a scatter of Hi against the reference set. Missing values render
  as visibly missing, never as zero or as a gap that reads as zero. A series carrying
  `PROVIDER_DISCONTINUITY` shows it in the legend.
  *Test:* a chart spec with a missing value renders it as missing; snapshot test on the golden
  fixture.

- [ ] **E1.17 — Narrative service**
  Consumes a frozen payload and its hash. Cannot read the database. Output is `PROPOSED`,
  visually distinct, recorded with provider, model and generation parameters.
  *Test:* the service cannot alter any numeric value; unapproved narrative cannot reach an
  export.

- [ ] **E1.18 — Export**
  CSV and JSON at minimum. Exports consume stored results; they never recompute and never
  re-fetch. Generated prose is visually distinguishable in every format that supports it.
  *Test:* exported values equal stored values byte-for-byte; an export attempted with an
  unapproved artifact is refused.

- [ ] **E1.19 — Manifest**
  Every field in `02_DATA_MODEL.md` §manifest.
  *Test:* the manifest of a golden run contains every required field, every quality flag
  raised anywhere in the run, and an explicit list of missing observations.

- [ ] **E1.20 — Replication target #1**
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

- [ ] **E1.21 — Study page**
  Source selection, run trigger, run status with live trace link.
  *Test:* a browser E2E test drives a full fixture run from the UI.

- [ ] **E1.22 — Method review page**
  Prose input, proposed spec rendered step by step in red with its rationale, per-step
  approval, then green.
  *Test:* E2E — a proposal cannot be executed until approved; editing an approved spec turns
  it red again.

- [ ] **E1.23 — Results page**
  Charts, the results table, the manifest link, the export button, the narrative in its
  approval state.
  *Test:* E2E — results, approval states and export are all reachable and correct.

### E1 exit

- [ ] **E1.24 — `npm run demo:jh16`**
  From a clean clone, with no credentials and no network, this command produces a complete run
  directory: manifest, raw fixture copies, normalized observations, analysis output, charts,
  exports, replication verdicts and the trace.
  *Test:* run it twice; the two run directories are byte-identical apart from run id and
  timestamps. Verify on a clean clone, not on the working tree.

### E0.5 / v9 / v12 additions — found by the audit and by later spec merges

- [ ] **E1.25 — Wire `ConfigLoader` into the running server**
  `config/{loader,schemas,canonicalize}.ts` pass their tests in isolation, but nothing in
  `server.ts` or `api/routes.ts` calls `loadEffectiveConfig`. Every run today executes whatever
  the HTTP request body contains, unvalidated by this system.
  *Test:* a run whose config fails schema validation is rejected before the orchestrator runs,
  with the failing path and rule in the error response.

- [x] **E1.26 — Persist `source_adapter_version` on observations**
  Closed by E1.3: it is a real column, so a real version round-trips and `'unknown'` appears
  only when the value genuinely was never recorded.

- [ ] **E1.27 — Finalize a manifest at the end of a run**
  `run_orchestrator.ts` constructs an `ArtifactRepository` but never calls `finalizeManifest`,
  so no run produces a manifest and `GET /api/runs/:id/manifest` 404s even after success.
  *Test:* after a run completes, its manifest exists and is retrievable.

- [ ] **E1.28 — Remove dead dependencies and the stale lockfile**
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

## E2 — Compiler and validation

Decompose when E1 exits. Contents: the LLM method compiler with its known-answer test on
JH2016 prose; the reference score set loader; Pearson and Spearman against the reference;
ambiguity surfacing in the compiler UI.

## E3 — Live acquisition

Contents: a real `search.result_count` provider; provider stamping and
`PROVIDER_DISCONTINUITY` detection on live data; rate-limit and quota handling as an operating
condition; PostgreSQL and S3 migration; a real worker process.

## E4 — Identity

Contents: OIDC behind `IdentityProvider`; role ladder `viewer < researcher < admin < dev`
(recovered pre-MVP requirement, folded in here per the conflict resolution in
`00_STATE_AND_DECISIONS.md`); RBAC capability matrix; migration of `local-user` rows; access
requests and admin approval; per-source permissions; developer diagnostics surface gated to the
`dev` role.

## E5 — Workbench and replication engine

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
uncertainty bands, region maps, provider-discontinuity markers, graph-neighbourhood views). A
3D region×substance×metric cube is preserved as a candidate only — not a dependency of anything
above it, and not scheduled.

This epic is explicitly domain-neutral (D13): everything here must work for an arbitrary
dataset, not only the drug vertical, and nothing in this list may be implemented by importing
a drug-specific concept into the generic method registry.

## E6 — Field and clinical interfaces

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

## Blocked

- **E1.20 — tolerance bands PROPOSED against the primary source, awaiting approval.**
  Everything else in the ledger proceeds around this; only E1.20's own execution waits.
  Status `PROPOSED` per D7: no `replication_claims` rows registered, no attempt executed.

  **Source verified.** The maintainer supplied the paper's full JATS XML. Reference data
  extracted verbatim to `fixtures/jh2016/paper_reported.json`; the Nutt et al scores it
  reproduces are in `config/reference/nutt-2010.json`.

  **The statistic is Pearson, not Spearman — this corrects an earlier proposal of mine.**
  The prose reads "the correlation coefficient between the harm score *ranking* and the harm
  index was 81.6%", which reads as a rank correlation. Recomputing from the paper's own Tables
  1 and 3 (all sixteen `Hi` values reproduce exactly from `Ni_harm/Ni`, so the tables are
  internally consistent):

  | Statistic on the paper's own data | Value | Two-sided p |
  |---|---|---|
  | **Pearson r(Hi, Nutt harm score)** | **0.8162** | 0.00012 |
  | Spearman rho(Hi, Nutt harm score) | 0.5668 | 0.022 |

  Pearson reproduces the reported 81.6% and is consistent with the reported p = 0.000143;
  Spearman is nowhere near either. Had band 1 been registered as `rank_correlation_floor` at
  0.70 as first proposed, **the paper's own data would score 0.57 and be recorded as
  `deviates`** — a test that fails against the result it exists to check.

  **Band 1 — `harm_index_vs_reference_pearson`. Floor 0.70 on Pearson r**, expressed as
  `tolerance_kind: interval` over `[0.70, 1.0]` (the four kinds in `02_DATA_MODEL.md` are fixed,
  and `interval` expresses a floor without misusing `rank_correlation_floor` for a statistic
  that is not a rank correlation). A `statistic` column on `replication_claims` records
  "pearson" explicitly, per `03_JH2016_CONTRACT.md`'s requirement that the selected method be
  explicit. 0.70 is the conventional strong-correlation threshold, sits below the published
  0.816 with room for a decade of drift, and clears the ~0.62 needed for significance at n = 16
  under the authors' own alpha = 0.01. Spearman is computed and reported alongside per "report
  both", but is not a pass/fail claim, because the paper never claimed it.

  **Band 2 — `popularity_ranking_stability`. `rank_correlation_floor: 0.60`.** Anchored in the
  paper's own data: Table 2 gives `Pi` at six dates over 25 months, and the Spearman correlation
  of the ranking between first and last is **0.785** — how much the paper's own ranking moved
  against itself in two years. The 2014-to-2026 gap is roughly six times longer, so the floor
  must sit meaningfully below 0.785 to test "the ordering survived" rather than "nothing changed
  in twelve years".

  **Band 3 — recommend NOT registering it as a pass/fail claim.** This reverses my earlier
  ±50% proposal on the paper's own evidence. Table 2 drift across just 25 months: GHB +567%,
  mephedrone +400%, cannabis +141%, khat +108%. A ±50% band would record `deviates` for most
  substances *within the authors' own study window*; a band wide enough for +567% passes
  anything. By `08_REPLICATION_ENGINE.md`'s own standard — "a tolerance chosen after seeing the
  result is not a tolerance" — there is no defensible band here. Record the 32 published values
  as reference data and report each observed deviation as descriptive output with **no verdict**.
  The paper's durable claims are the correlation and the ranking; it says the point values
  "change practically every day". If a number is wanted anyway, `relative: 1.00` is the least
  indefensible and should be read as informational.

  **Recorded in advance:** `deviates` on band 2 is plausible and is a result, not a defect.
  Bands are versioned and must not be widened after a verdict is seen. E1.24 does not require
  `reproduced` to ship.

  **One line unblocks this:** "bands approved", a different number for 1 or 2, or "register
  band 3 anyway at X".
