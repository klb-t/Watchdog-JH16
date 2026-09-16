# Implementation Sequence

## Phase 0 — Inventory/rescue
Tree, KEEP/REFACTOR/REPLACE/MISSING/DEFER matrix, runnable commands, broken tests, secrets scan. No wholesale rewrite.

## Phase 1 — Contracts/config
Loader, schemas, canonicalization, versions, precedence, registries, preset loading/hash, tests. Exit: invalid config fails fast; equivalent effective config hashes identically.

## Phase 1A — Diagnostic spine / flight recorder
Implement `14_DEBUGGING_AND_TRACEABILITY.md` before feature-heavy work: diagnostics mode, correlation context, event schema, tracer/logger, redaction, persistent TRACE sink, full error envelope/cause chain, request middleware, worker propagation, basic Debug Console and diagnostic bundle. Exit: deliberately failing API->worker fixture is diagnosable from one stored trace without rerun; canary secrets absent.

## Phase 2 — Research memory / persistence spine
PostgreSQL/Alembic + MinIO/S3 + content-addressed raw blobs + artifact hashes + runs/manifests + fetch_events + Dataset/Series metadata + lineage edges. Exit: clean migration, raw artifact roundtrip, duplicate raw bytes dedupe physically while separate fetch events remain, WORM tests pass.

## Phase 3 — Source/plugin framework
SourceAdapter + capability registry + offline fixture adapter + SERP result-count adapter first. Add honest planned/fixture registry entries for Trends, PubChem, literature, community/forums, lab/drug-checking, institutional and manual datasets. Exit: offline acquisition stores fetch event -> raw -> parsed/normalized -> manifest.

## Phase 4 — JH16 faithful scientific vertical slice
Locked 16-substance FAITHFUL preset, exact queries, Pi/Hi, Nutt/reference loader, Pearson/Spearman, golden fixtures. Exit: `make demo-jh16` produces complete offline lineage and reproducible artifacts. This is the first scientific proof, not the final product shape.

## Phase 5 — API/worker/run engine
Typed endpoints, async queue/worker, cancellation/retry semantics, schedules, artifact/export endpoints, diagnostics correlation. Exit: API-triggered offline run completes asynchronously and can be inspected end-to-end.

## Phase 6 — Frontend operational core
Config navigation, Dashboard, Sources, Fetch Builder/Archive, Run Detail, manifests/artifacts, Debug Console. Exit: browser E2E source -> fetch -> run -> raw/normalized -> manifest/debug.

## Phase 7 — Generic data workbench
First-class Data Explorer, imports, transformation registry/DAG, derived datasets, Series Builder and lineage UI. Exit: arbitrary CSV/imported table can be transformed and materialized into a reproducible series without source-code changes.

## Phase 8 — Generic analysis + visualization workbench
Method registry, compatibility/assumption contracts, descriptive statistics, Pearson/Spearman/Kendall, cross/lag correlation, basic group tests/regression/time-series primitives, Visualization Builder, FigureSpec and AnalysisSpec. Exit: arbitrary compatible datasets can be analyzed, plotted, saved, cloned and rerun; Correlation Lab works end-to-end.

## Phase 9 — Auth/RBAC/settings
OIDC/test substitute, access request/admin approval, server enforcement, source secrets, role-dependent UI, raw community/sensitive access policies. Exit: RBAC/redaction matrix tests.

## Phase 10 — Scheduling / longitudinal research
Scheduled fetches and analyses use the same run/spec machinery; repeated observations become series; baseline vs research vs monitoring are purposes/policies, not separate code paths. Exit: scheduled fetch -> updated series -> scheduled AnalysisSpec with history and lineage.

## Phase 11 — Source-family expansion
Implement/validate selected adapters by value/access priority: Google Trends, PubChem/reference knowledge, literature metadata/import, forums/community import/API, institutional feeds, lab/drug-checking imports. Each adapter requires fixture/contract tests, retention/licensing notes and honest status.

## Phase 12 — Advanced statistical/time-series/semantic families
Expand method registry: robust/group/nonparametric tests, GLM/count/mixed models, decomposition/stationarity, Granger/VAR/intervention, changepoint/anomaly, robustness/sensitivity, evidence synthesis/meta-analysis, optional Bayesian and exploratory methods. Implement `20_COMMUNITY_REPORT_AND_SEMANTIC_PIPELINE.md` candidate extraction and provenance. Never treat the seed list as exhaustive.

## Phase 13 — Research Project / methodology / paper pipeline
Literature workspace, project objects, frozen evidence package, deterministic methodology and Results facts, claim-evidence graph, tables/figures, LLM drafting, validation, versioned exports. Exit: a project can collect/pin evidence and draft a paper whose every number/citation/method traces to evidence.

## Phase 14 — Enhanced/longitudinal JH and comparative studies
JH16 enhanced/update, geography/language/provider comparisons, robustness/ablation against FAITHFUL. Never modify FAITHFUL history.

## Phase 15 — Hardening/deployment
CI, security scan, production diagnostics defaults/retention/performance, backups/restores, API docs, clean-install/reproducibility/performance baselines.

## Phase 16 — Domain/operational extensions
Pills/sample visual lookup, alerts, medical/emergency views, pharmacology/receptor graph, public/institutional dashboards, richer geo/outbreak models. Each needs source/privacy/scientific validation contracts; reuse the research spine.

## Gate rule
Do not advance merely because UI exists. Every phase requires the tests and evidence in `09_TEST_AND_VALIDATION_PLAN.md` and `12_DEFINITION_OF_DONE.md`. Planned registry entries are not implementation.
