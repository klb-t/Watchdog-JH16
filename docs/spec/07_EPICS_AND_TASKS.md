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

- [ ] **E1.3 — Persistence**
  SQLite schema per `02_DATA_MODEL.md`, including the empty datasets, transforms and
  replication tables, and the `evidence_tier` enum plus the empty E6 field-reference tables
  (symptoms, pill_types, tested_samples, pill_type_composition, substance_symptom_associations,
  batch_alert_rules, batch_alerts) per D12. Migrations. Repository interfaces with SQLite
  implementations. Local content-addressed blob store.
  *Test:* migration runs clean on an empty file; a blob round-trips by hash; two identical
  payloads share one blob row while two fetch-event rows survive; no SQL exists outside
  `src/repo`; every E6 table exists and is empty.

### Group 2 — Diagnostics spine

Before feature work. See `06_DIAGNOSTICS.md`.

- [ ] **E1.4 — Tracer**
  Central diagnostics API, correlation context, event vocabulary, four modes, context
  propagation across the service and worker boundary.
  *Test:* a traced call chain produces ordered events with consistent `trace_id` and
  monotonic `sequence_no`.

- [ ] **E1.5 — Redaction**
  Central layer before every sink.
  *Test:* the canary secret is absent from trace stream, logs, manifest, bundle and error
  envelope.

- [ ] **E1.6 — Error envelopes and cause chains**
  Wrap at every boundary, preserve `cause` to the root.
  *Test:* an error raised four layers down arrives with its full chain and the state at
  failure.

- [ ] **E1.7 — Diagnostic bundle**
  One command or one click produces the redacted ZIP.
  *Test:* a deliberately failed fixture run yields a bundle from which the direct cause is
  identifiable without re-running. This is the E1 diagnostics acceptance test.

### Group 3 — Acquisition

- [ ] **E1.8 — SourceAdapter protocol and fixture adapter**
  `FixtureSourceAdapter` reads frozen JSON from `fixtures/jh2016/`. No network in E1 at all.
  `dimension` travels on `SourceRequest` from the preset; the adapter never infers it from
  query text (`01_ARCHITECTURE.md` §SourceAdapter).
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
Dashboard, Sources, Runs, Analyzers) from the AI-Studio passes. Per `CLAUDE.md` §0 ("if the
ledger and the repository disagree, the repository wins") and the same reasoning as D1 in
`00_STATE_AND_DECISIONS.md` (existing working code beats a spec assumption written before the
code existed), E1.21-23 add the required pages/flows *into* that shell rather than removing it.
"No dashboard" is read as "the vertical slice does not depend on one existing", not as
permission to delete working, tested navigation. See D11.

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

### E0.5 additions — found by the audit, not in the original ledger

- [ ] **E1.25 — Wire `ConfigLoader` into the running server**
  `backend/watchdog_api/config/{loader,schemas,canonicalize}.ts` pass all three tests in
  `tests/unit/config.test.ts` in isolation, but nothing in `server.ts` or `api/routes.ts`
  constructs a `ConfigLoader` or calls `loadEffectiveConfig`. Every run today executes whatever
  the HTTP request body contains, unvalidated by this system.
  *Test:* submitting a run whose config fails schema validation is rejected before the
  orchestrator runs, with the failing path and rule in the error response.

- [ ] **E1.26 — Persist `source_adapter_version` on observations**
  `db/repositories/data.ts`'s `ObservationRepository.getByRunId` hardcodes
  `source_adapter_version: 'unknown'` on read because the `observations` table has no such
  column, even though adapters already stamp it on the `Observation` object at write time.
  *Test:* an observation's real adapter version survives a write/read round-trip; `'unknown'`
  only appears when the value was genuinely never recorded.

- [ ] **E1.27 — Finalize a manifest at the end of a run**
  `services/run_orchestrator.ts` constructs an `ArtifactRepository` but never calls
  `finalizeManifest`. No run — including a fully successful one — currently produces a
  manifest; `GET /api/runs/:id/manifest` 404s even after `SUCCESS`.
  *Test:* after a run reaches `SUCCESS`, its manifest exists and is retrievable; a second
  attempt to finalize the same run's manifest is rejected (already covered by the existing WORM
  test in `persistence.test.ts` — this task is about actually calling it from the orchestrator).

- [ ] **E1.28 — Remove dead dependencies and the stale lockfile**
  `@google/genai`, `jstat`, `motion`, `uuid`, `recharts`, `drizzle-kit`, `cors` and `dotenv` are
  declared in `package.json` but imported nowhere (`docs/AUDIT.md` "Unused declared
  dependencies"). `bun.lock` is a second, unused lockfile alongside the real
  `package-lock.json`.
  *Test:* `npm run test:all` stays green after removal; `npm install` still reproduces
  `package-lock.json` unchanged.

### v9 addition — existing code contradicts the tightened adapter contract

- [ ] **E1.29 — Remove dimension inference from the three existing adapters**
  v9 made adapter semantic neutrality binding (`01_ARCHITECTURE.md` §SourceAdapter): `dimension`
  arrives on `SourceRequest` from the preset and is never re-derived from query text. All three
  adapters in the repository today violate this — `sources/serp.ts` and
  `sources/offline_fixture.ts` both compute `isHarm` by checking whether the query string
  contains `"harm"`, and `sources/google_trends.ts` did until it was changed to a fixed
  `interest_index`. Worse, `tests/contract/sources.test.ts` currently *asserts* the violating
  behaviour ("should detect 'harm' in query"), so the anti-pattern is pinned in place by a
  passing test.
  Note on provenance, since it matters for trusting this entry: that inference was restored
  deliberately in an earlier session, to make the then-existing contract test pass after an
  AI-Studio commit had broken it. It was the right call against the spec as it stood then and
  is the wrong behaviour against v9 — recorded here rather than quietly reverted so the reversal
  is inspectable.
  *Test:* the adapter-neutrality tests in `09_TESTS.md` §Adapter neutrality, run against every
  registered adapter via the shared contract suite; the "detect harm in query" assertion is
  deleted, not weakened.

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

Contents: OIDC behind `IdentityProvider`; RBAC capability matrix; migration of `local-user`
rows; access requests and admin approval; per-source permissions.

## E5 — Workbench and replication engine

Contents: dataset import and the transform DAG; the generic method registry beyond the seven
primitives; the Python sidecar executor; the replication engine per
`08_REPLICATION_ENGINE.md`; the paper pipeline.

## E6 — Field and clinical interfaces

Contents: symptom search (checklist and free-text) per `11_FIELD_AND_CLINICAL_INTERFACES.md`;
pill and sample identification with the visual-match evidence ceiling; the responder card and
its fixed content-category layout; adulterant and look-alike alerting via
`batch_alert_rules`/`batch_alerts`; offline sync for field use; sourcing work against the seed
list in `11_FIELD_AND_CLINICAL_INTERFACES.md` §Source seed list, starting with manual/versioned
import rather than live fetch. Schema already exists from E1 task E1.3 per D12 — this epic does
not start with a migration.

Do not start E6 before E1 exits. The schema being present is not permission to build against it
early; it exists early specifically so E6 can start clean when its turn comes, per D12 —
the same relationship E1 has to the replication and dataset tables it also seeds without using.

---

## Blocked

- **E1.20 — tolerance bands PROPOSED, awaiting approval. Everything else proceeds around it.**

  Status: `PROPOSED` per the approval gate (D7). These numbers are **not** registered as
  `replication_claims` rows and no replication attempt has been executed against them. One
  maintainer line approves them, amends a number, or rejects them; on approval, E1.20 is
  implemented as written and the claims enter the schema as `APPROVED`.

  **Source-access limitation, stated plainly because it changes how much these are worth.**
  Every scholarly domain is blocked by this environment's egress proxy — `jmir.org`,
  `pmc.ncbi.nlm.nih.gov`, `pubmed`, Europe PMC, Crossref and Semantic Scholar all refused.
  The reference values below therefore come from **two independent web-search summaries of the
  paper, not from the paper's own text**, which I could not open. They agree with each other,
  which is weak corroboration, not verification. Before any of these becomes an `APPROVED`
  claim, the values must be read off the primary text by someone who can open it.

  Reported by those summaries: correlation coefficient **81.6%** between "the harm score ranking
  and the harm index", **p = 0.000143**, the authors' own significance level **α = 0.01**,
  n = 16 substances.

  Two ambiguities in that summary that are themselves findings, not obstacles to route around:
  1. **Is 81.6% `r` or `R²`?** If `R² = 0.816` then `r ≈ 0.903`, a materially different claim.
  2. **Pearson or Spearman?** The phrase "harm score *ranking*" points to a rank correlation,
     which is what `tolerance_kind: rank_correlation_floor` assumes, but the paper may report
     Pearson. `03_JH2016_CONTRACT.md` already requires reporting both; if the primary text turns
     out not to determine which was used, that claim's verdict is `method_unclear` — the
     vocabulary exists precisely for this and it is the honest outcome, not a failure.

  **Proposed band 1 — harm index vs reference harm scores. `rank_correlation_floor: 0.70`.**
  The paper's claim is qualitative — a crude Google-hit index "correlates very well" with Nutt's
  MCDA — so the floor should test whether that relationship survives, not whether the coefficient
  is reproduced to three digits. 0.70 is the conventional threshold for a *strong* correlation;
  it sits well below the reported 0.816, leaving room for a decade of index drift, and well
  above the ~0.64 needed for significance at n = 16 under the authors' own α = 0.01, so anything
  clearing it is both strong and significant. A floor set at 0.816 would test numeric identity
  rather than replication; a floor at 0.5 would let a substantially weaker relationship pass.

  **Proposed band 2 — `Pi` ordinal ranking. `rank_correlation_floor: 0.60`.**
  Deliberately looser than band 1, for a reason internal to the paper: the authors observed that
  relative popularity indices *shifted over the months of their own study*. Popularity is the
  less stable quantity, and it is compared against the paper's own snapshot rather than against a
  fixed external reference the way harm is against Nutt. Demanding equal stability from the more
  volatile measure would be a stricter test disguised as a consistent one.
  Caveat: this band presupposes the paper publishes a per-substance `Pi` table to rank against.
  I could not confirm one exists. If it does not, this claim is `not_computable` and should be
  dropped rather than approximated from a figure.

  **Proposed band 3 — specific stated `Pi`/`Hi` values. `relative: 0.50` (±50%).**
  Search-engine hit counts are estimates that vary between requests, data centres and days —
  `03_JH2016_CONTRACT.md` already mandates a `PROVIDER_ESTIMATE` flag on every one of them.
  `Pi` and `Hi` are ratios, so multiplicative inflation partially cancels, which is much of the
  point of using indices; but it cancels only partially, because numerator and denominator come
  from different queries. ±50% admits that ratio-level drift while still failing a substance that
  has moved by an order of magnitude. A ±10% band would fail universally and tell us nothing;
  ±100% would pass almost anything.

  **Expected outcome, recorded in advance so it cannot be rationalised afterwards:** `deviates`
  on bands 2 and 3 is likely, and is a result, not a defect. Per `08_REPLICATION_ENGINE.md`,
  these bands are versioned and must not be widened after seeing a verdict. E1.24 does not
  require `reproduced` to ship.

- **Original blocker text, retained for context:** E1.20 needs tolerance bands from the
  maintainer before it can be implemented.
  `08_REPLICATION_ENGINE.md`: "Setting tolerance before the attempt is the entire methodological
  point — a tolerance chosen after seeing the result is not a tolerance." This is explicitly the
  maintainer's call, not an agent default (unlike the Q1-Q6 defaults in
  `00_STATE_AND_DECISIONS.md` §4, which are safe to proceed on). Needed, concretely:
  1. The `rank_correlation_floor` for the harm-index-vs-reference-scores correlation claim.
  2. Whether to also register the ordinal-ranking-by-`Pi` claim and specific reported `Pi`/`Hi`
     values from the paper as `relative`-tolerance claims, or defer those to a later pass.
  3. Confirmation that a `deviates` verdict (expected, per the paper's own honesty constraint —
     2026 search-engine counts are not 2016 counts) is an acceptable E1 exit outcome, i.e. E1.24
     does not require `reproduced` to ship.
  One action to unblock: answer 1-3 (or say "use your judgement" for 2-3, since only 1 is
  irreversible/scientific). Until answered, E1.20 stays undone and every other E1 task proceeds
  around it — it does not block E1.24 in aggregate since a `not_computable`/`deviates` verdict
  is itself a valid, honest outcome once *some* tolerance is on record.
