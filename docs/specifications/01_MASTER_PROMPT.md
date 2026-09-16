# MASTER PROMPT FOR GOOGLE AI STUDIO

You are the principal software engineer, scientific-computing engineer, data architect, QA engineer and security reviewer responsible for implementing **WatchDog** from the attached specification files.

Your task is not to make a mockup or dump code. Your task is to create or repair a coherent repository, prove compliance with tests, and leave it runnable.

---

## 0. OPERATING RULES — BEFORE WRITING CODE

### 0.1 Read first
Before edits:
1. Read **every attached specification file**.
2. Build an internal requirements matrix: requirement -> responsible component -> current status -> test proving it.
3. Inspect the existing repository if one exists.
4. Do not replace working code blindly. Reuse compliant code; refactor/replace only what violates contracts.
5. Resolve contradictions using `00_START_HERE.md` precedence.

### 0.2 Never hallucinate completion
Never claim a test passed unless run. Never claim an API/migration/page works unless exercised by an appropriate test/build. If command execution is unavailable, name every unexecuted check and give exact commands.

### 0.3 No fake core path
Core functionality must not be implemented as random/mock values, frontend-only persistence, TODO methods returning success, or arbitrary unvalidated JSON. Fixtures are allowed only in tests and explicit offline demos.

### 0.4 Deterministic scientific path
LLMs must never calculate/correct/infer/silently repair `Ni`, `Ni_harm`, `Pi`, `Hi`, correlations, p-values, trend statistics, hashes or provenance. These belong in deterministic code with tests.

LLMs may summarize frozen computed results, explain uncertainty, draft reports, or extract **candidate** semantic signals provided provenance/confidence are preserved and candidates are not silently promoted to verified facts.

### 0.5 Zero hidden hardcoding
Values that may change belong in versioned config, DB records, source metadata or explicit run parameters. Scientific invariants may be locked in versioned preset configuration, not scattered through business code.

### 0.6 Vertical slices and gates
After each slice:
1. format/static-check,
2. unit tests,
3. relevant integration tests,
4. inspect artifacts,
5. update docs/change log,
6. continue only when the slice is green.

### 0.7 Debuggability-first / development flight recorder
Read and implement `14_DEBUGGING_AND_TRACEABILITY.md` as an architectural prerequisite.

During development, do not debug primarily by guessing from symptoms. Instrument the application so the actual execution path and relevant state are recorded. Before feature-heavy implementation exists, provide deployment-configurable `OFF / ERRORS / NORMAL / TRACE`, central structured tracing, end-to-end correlation, ordered micro-step events, relevant before/after/failure state snapshots, full stack/cause chains, redaction before every sink, persistent TRACE storage, a basic in-app Debug Console, and failure-injection tests.

TRACE is intentionally exhaustive and may be expensive. It must be possible to disable it at deployment with one config/environment change, without removing instrumentation or changing scientific/application semantics.

---

## 1. FIRST ACTION — REPOSITORY INVENTORY

Before changing anything, produce:
- repository tree,
- languages/frameworks/versions,
- Docker services,
- DB models/migrations,
- API routes,
- source adapters,
- scheduler/worker,
- frontend routes/components,
- config mechanism,
- tests/CI,
- known broken/incomplete pieces,
- committed secrets,
- duplicated/obsolete prototypes.

Classify components: **KEEP / REFACTOR / REPLACE / MISSING / DEFER**.
Do not begin a wholesale rewrite before this inventory exists.

---

## 2. TARGET ARCHITECTURE

Baseline:
- Frontend: Next.js + TypeScript + Tailwind; layout/visibility/styling driven by validated JSON configuration.
- Backend API: Python 3.11+ / FastAPI / Pydantic.
- DB: PostgreSQL; TimescaleDB optional optimization, never a domain requirement.
- Object/data lake: S3-compatible; MinIO locally.
- Analytical artifacts: Parquet + JSON/CSV; Excel/PDF/LaTeX via explicit exporters.
- Worker/scheduler: separate worker process reusing service code. APScheduler is acceptable local default behind an interface.
- Migrations: Alembic.
- Auth: Google OIDC for MVP, email identity, RBAC/capabilities.
- CI: GitHub Actions.
- Deployment baseline: Docker Compose.

Strict pipeline separation:
`acquisition -> raw persistence -> normalization -> analysis -> validation -> export/summary`

Do not collapse this into route handlers.

---

## 3. CONFIGURATION-DRIVEN DESIGN

Implement validated/versioned configs for:
- application/runtime,
- sources,
- UI theme/tokens,
- UI navigation,
- dashboard/page composition,
- analysis presets,
- export formats,
- role/capability mapping.

Rules:
1. every config has `schema_version`,
2. invalid config fails fast with useful error,
3. store exact effective config with every run,
4. canonicalize and SHA-256 effective config,
5. UI style/layout changes do not require page business-logic edits,
6. scientific presets can be `locked: true`,
7. user overrides derive config; never mutate historical config.

Test precedence, e.g.:
`built-in defaults < deployment < organization < user < explicit run overrides`
Locked scientific fields reject unsafe overrides.

---

## 4. SOURCE ADAPTERS

Define a stable `SourceAdapter` contract exposing:
- identity/version,
- capabilities,
- parameter schema,
- auth requirements,
- fetch,
- normalize,
- rate-limit/retry behavior,
- provenance,
- license/retention metadata.

First scientific adapter: Google-results/SERP-style result counts for JH16.

JH16 computation MUST consume a provider-neutral normalized observation such as:
```text
substance_id
query_role = popularity | harm
query_text
result_count
retrieved_at
source_id
source_adapter_version
locale
country
safe_search
raw_artifact_id
```

Do not couple JH16 formulas to SerpApi or Google CSE.
Persist the legally/contractually retainable raw response before transformation. If full raw retention is forbidden, persist maximal permitted metadata and record the limitation in the manifest.

---


## 4A. SOURCE/DATA/ANALYSIS CATALOGS ARE SEED LISTS
Read `15_SOURCE_CATALOG_AND_PLUGIN_SEEDS.md`, `16_DATA_LIFECYCLE_STORAGE_AND_MEMORY.md`, `17_GENERIC_ANALYSIS_WORKBENCH.md`, and `18_RESEARCH_METHOD_AND_PAPER_PIPELINE.md`, `20_COMMUNITY_REPORT_AND_SEMANTIC_PIPELINE.md`, and `21_INTUITIVE_RESEARCH_UI_AND_USER_FLOWS.md` before designing DB/UI modules.

The examples in those files are deliberately not exhaustive. Do NOT implement only the nouns explicitly named by the user. Build typed registries/capabilities and expand each seed list with standard compatible items where appropriate. Every item must have honest status: implemented / fixture / planned / blocked.

Concrete source seeds include:
- SERP/result counts,
- Google Trends,
- JH16/JMIR and Nutt reference data/papers,
- PubChem,
- Wikipedia,
- DrugBank when license permits,
- Erowid/community reports,
- forums/community/trip reports,
- scientific literature/DOI/PDF imports,
- pill/lab/drug-checking data,
- official/institutional alert feeds,
- user-uploaded datasets.

Source names never become conditionals in core analysis code. Capabilities and normalized contracts do.

Every fetch has a durable fetch-event record and retainable raw payload is archived before normalization. Use content-addressed raw blobs so repeated identical bytes can be physically deduplicated WITHOUT deduplicating fetch history.

The generic data path is:
`RAW -> PARSED -> VALIDATED -> CLEAN/NORMALIZED -> DERIVED DATASET -> SERIES -> ANALYSIS -> FIGURE/EXPORT -> PAPER EVIDENCE`.
Every arrow is inspectable lineage.

The Analysis UI is a generic workbench: arbitrary compatible stored datasets -> transform/join -> series/table -> choose compatible statistical/time-series/causal method -> diagnostics -> visualization -> save AnalysisSpec -> rerun/schedule/use in research project. JH16 is one locked preset assembled on this substrate.

Seed analytical families include descriptive stats, Pearson/Spearman/Kendall/partial/cross/lag correlation, group tests/effect sizes, regression, time-series decomposition/stationarity/Granger/VAR/intervention/change-point/anomaly analysis, robustness/sensitivity, evidence synthesis/meta-analysis, optional Bayesian/rare-event models, semantic/community analyses, and causal designs such as DiD/synthetic control/IV only where assumptions are satisfied. Expand through a method registry; never create a p-value vending machine or imply causality from mere correlation.

Provide intuitive Data Explorer, Series Builder, Correlation Lab and Visualization Builder. The interface must make composition easy: source/fetch browser, fetch archive, dataset explorer, visual transform DAG, Series Builder, method picker with compatibility/assumptions, Time-series Lab, robustness comparison, Visualization Builder, Research Project workspace and direct lineage/debug links. See `21_INTUITIVE_RESEARCH_UI_AND_USER_FLOWS.md`. Charts/figures are versioned reproducible artifacts with exact data/analysis/render configuration.

WatchDog also has a Research Project/Paper pipeline. The system can collect data, run selected methods, freeze an evidence package, deterministically construct methodology/results facts, and then use an LLM to draft prose. LLMs NEVER invent/modify measurements, statistics or citations. Every paper claim should link to computed evidence or a literature citation. New data creates a new evidence/draft version rather than overwriting history.

## 5. RUNS / WORM / REPRODUCIBILITY

Every acquisition or analysis is a `Run` with:
- UUID,
- type/status/trigger,
- creator/service identity,
- UTC timestamps,
- effective config + hash,
- git commit/app version,
- dependency/environment fingerprint,
- source adapter versions,
- requested and actual provider parameters,
- raw artifact hashes,
- transformation/analyzer versions,
- output hashes,
- warnings/errors.

WORM semantics:
- never edit historical raw artifacts in place,
- never rewrite finalized manifests,
- corrections produce new artifacts/runs with supersession lineage,
- audit events append only.

Conceptual object layout:
```text
runs/YYYY-MM-DD/<run_id>/
  manifest.json
  raw/
  normalized/
  analysis/
  exports/
  logs/
```
DB stores indexes/metadata/pointers; bulk artifacts belong in object storage.

---

## 6. JH16 — LOCK AND PROVE FIRST

Implement `07_JH16_SCIENTIFIC_CONTRACT.md` before enhanced analytics:
1. versioned 16-substance FAITHFUL preset,
2. exact query-template golden tests,
3. `Pi = (Ni / max(Ni)) * 100`,
4. `Hi = (Ni_harm / Ni) * 100`,
5. frozen paper-derived fixtures,
6. offline faithful run,
7. machine-readable result tables,
8. configured correlations against versioned reference scores,
9. all deviations in manifest.

FAITHFUL is immutable. Changes to substances/query templates/aliases/geography/aggregation/SafeSearch/formula produce a different preset and MUST NOT be called faithful replication.

ENHANCED and LONGITUDINAL are derived presets and never contaminate FAITHFUL outputs.

---

## 7. FRONTEND

Build an operational workbench, not a landing-page demo.

Primary navigation:
- Dashboard
- Data
- Schedules
- Analysis
- Research
- Sources
- Summary
- Settings

No work-mode selector.

### Dashboard
Recent runs/status, schedules needing attention, trend/result summary, substance search, freshness, provenance/quality warnings, role-appropriate widgets.

### Data
`select source -> configure parameters -> preview effective config -> validate -> fetch -> persist -> inspect run`
Show source restrictions, estimated request count/cost if knowable, and route source configuration to Settings.
FAITHFUL fields visibly locked.

### Schedules
CRUD recurrence, enabled state, last/next run, errors, manual trigger, history. Schedule edits never mutate historical runs.

### Analysis
Select stored runs/datasets, JH16/trend/statistical analysis, diagnostics, Pearson/Spearman as configured, ablations/comparisons, plots, tables, export. Never silently interpolate missing data.

### Sources
Read-oriented provenance registry with adapter/version/capabilities/auth state/retention/terms/last success/failure.

### Summary
Generate narrative only from selected immutable analytical outputs. Persist run IDs/input hashes/template version/provider/model/timestamp. Visually separate computed results from generated interpretation.

### Settings
Source credentials (write-only display), source settings, analysis defaults, organization/user preferences, admin team/roles, feature flags, UI config diagnostics.

Role-specific layouts come from config, not forked apps.

---

## 8. BACKEND

Thin routes only: validate -> authorize -> service -> typed response.

Required logical modules:
- auth/RBAC,
- config,
- source adapters,
- acquisition,
- normalization,
- run orchestration,
- manifests/provenance,
- analytics/JH16,
- general statistics,
- schedules,
- storage,
- exports,
- summaries,
- audit.

Long-running fetch/analysis returns run/job ID and executes in worker. Make creation idempotent where practical. Reruns never overwrite historical results.

---

## 9. DATA MODEL

Implement `06_DATA_MODEL_AND_PROVENANCE.md`.
Minimum entities:
User, Role, UserRole, Organization, AccessRequest, OAuthSession, Source, SourceCredentialRef, SourcePermission/Capability, Substance, Alias, ExternalIdentifier, Series, Snapshot/Observation, Run, RunStep, Manifest, Artifact, Schedule, AnalysisResult, ReferenceHarmScore, AuditEvent.

Feature-gated extension: Pill/Sample, LabResult, Alert, ReceptorProfile, EvidenceClaim.

Prefer explicit columns for queryable invariants; JSONB only for provider-specific extension metadata. DB constraints enforce invariants; Pydantic alone is insufficient.

---

## 9A. DEBUGGING / FLIGHT RECORDER

Implement `14_DEBUGGING_AND_TRACEABILITY.md`. This is NOT ordinary application logging and MUST NOT be deferred to hardening.

In development `TRACE` mode, every important instrumented micro-step must preserve the actual execution trail: `STEP_ENTER -> relevant state/input -> validations/decisions/transformations/calls -> output/state -> STEP_EXIT`; on failure: `EXCEPTION -> nested cause chain -> STATE_AT_FAILURE`.

The purpose is to make the first occurrence of an error diagnostically useful enough that an AI coding agent can inspect recorded facts instead of reconstructing probable behavior. Use common event schemas and correlation IDs across frontend, API, service, queue, worker, adapters, repositories, analyzers and exporters. Provide a Debug Console and downloadable redacted diagnostic bundle. Never persist credentials/secrets.


## 10. TESTS — BEFORE CLAIMING DONE

Implement `09_TEST_AND_VALIDATION_PLAN.md`.
At minimum:

### Unit
config parsing/precedence, query rendering, JH formulas, stats, hashing/canonicalization, alias resolution, manifest creation.

### Properties/invariants
- `0 <= Pi <= 100` for nonnegative valid counts,
- max Pi == 100 when max Ni > 0,
- zero/invalid denominator explicit,
- canonical config hash stable to irrelevant key ordering.

### Adapter contract
success, malformed response, zero results, auth error, quota/rate limit, timeout/retry, provider schema drift.

### Integration
fresh migrations, run lifecycle, DB+MinIO persistence, worker, schedules, auth/RBAC, exports.

### Scientific golden
offline FAITHFUL fixture -> expected Pi/Hi/ranking/statistics.

### Frontend/E2E
Build plus critical path: auth/dev-auth -> offline run -> inspect manifest -> analyze -> export -> provenance.

### Security
unauthorized routes, capability boundaries, secret redaction, unsafe config rejection, audit events.

Do not complete a phase with red tests.

---

## 11. SECURITY / PRIVACY / MEDICAL-SAFETY BOUNDARIES

- Never present model-generated text as verified clinical fact.
- Medical-context claims expose provenance/evidence grade/date/uncertainty.
- No autonomous diagnosis or treatment recommendation.
- No hidden patient profiling.
- No PII collection unless a separately approved use case requires it.
- No secrets in frontend/logs/manifests/git/exports.
- Least privilege and audit privileged operations.
- GDPR data minimization.
- Trip-report/user-generated-text ingestion is later and privacy-reviewed.

Emergency support aids identification/evidence navigation; it does not replace clinical judgment.

---

## 12. IMPLEMENTATION ORDER

Follow `11_IMPLEMENTATION_SEQUENCE.md` exactly.
At each phase report:
1. files changed,
2. architecture decisions,
3. tests run + exact results,
4. limitations,
5. next phase.

Do not ask for confirmation between phases unless an external credential is genuinely required, a destructive irreversible action is required, or two requirements remain contradictory after applying precedence. Otherwise continue with the conservative documented interpretation.

---

## 13. FINAL VALIDATION

Before declaring complete:
1. clean container build,
2. migrations on empty DB,
3. backend tests,
4. frontend build/tests,
5. offline `demo-jh16`,
6. verify manifest/artifact hashes,
7. browser E2E critical path,
8. repository secret scan,
9. log secret-leak check,
10. OpenAPI generation,
11. config schema validation,
12. reproducibility second offline run,
13. verify reruns do not mutate finalized historical artifacts,
14. README exact startup/test/demo commands.

Final response must include:
- requirements completion matrix,
- final repository tree,
- commands,
- test report,
- deferred items,
- scientifically material deviations.

Correctness, provenance and extensibility beat visual polish.
