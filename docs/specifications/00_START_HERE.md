# WatchDog — AI Studio Build Package

## Purpose
This package is the authoritative implementation brief for rebuilding/continuing **WatchDog** as a reproducible, configuration-driven psychoactive-substance monitoring and decision-support platform.

The master prompt tells the coding agent **how to work**; the remaining files define **what to build**. Read all of them before editing code.

## Read order
1. `01_MASTER_PROMPT.md`
2. `02_PRODUCT_AND_SCOPE.md`
3. `03_REPOSITORY_AND_COMPONENT_TREE.md`
4. `04_FRONTEND_INTERFACE_SPEC.md`
5. `05_BACKEND_ARCHITECTURE.md`
6. `06_DATA_MODEL_AND_PROVENANCE.md`
7. `07_JH16_SCIENTIFIC_CONTRACT.md`
8. `08_API_AND_JOB_CONTRACTS.md`
9. `09_TEST_AND_VALIDATION_PLAN.md`
10. `10_SECURITY_PRIVACY_RBAC.md`
11. `11_IMPLEMENTATION_SEQUENCE.md`
12. `12_DEFINITION_OF_DONE.md`
13. `13_RECOVERED_DECISIONS.md`
14. machine-readable files under `config/`, `schemas/`, and `contracts/`

## Requirement precedence
When requirements conflict:
1. Scientific invariants in `07_JH16_SCIENTIFIC_CONTRACT.md`
2. Data integrity / reproducibility / security contracts
3. Product scope
4. API/data contracts
5. UI configuration/presentation
6. Implementation convenience

Never weaken a higher-priority contract to make implementation easier.

## Stable decisions
- WatchDog is a **general pipeline**. JH16 replication is one locked preset/benchmark, not a separate application.
- No workflow “modes” in the main UI. Use ordinary pages/tabs and parameterized runs.
- No hardcoded scientific lists, source parameters, UI styles/layouts, time windows, query languages, source names or export defaults in business code.
- Configuration is versioned, validated and hashed.
- Every run produces immutable provenance/manifests and content hashes.
- External sources are adapters behind stable interfaces.
- Deterministic code is the numerical source of truth. LLMs may summarize/contextualize only.
- MVP emphasizes research reproducibility and the foundations for medical/emergency decision support.
- Policy/police/public-facing expansions are feature-gated extensions, not MVP architecture assumptions.
- Pill/sample integration is later unless an approved source/API is available.
- Build the analytical spine before narrative/article-generation features.

## Expected developer experience
Eventually a fresh clone should support:

```bash
cp .env.example .env
docker compose up --build
make test
make demo-jh16
```

`make demo-jh16` MUST work offline using frozen fixtures and produce a complete run directory with manifest, raw fixture copy, normalized data, analysis outputs and exports. Real external collection may require credentials; CI/tests must not.


## Debuggability-first requirement
`14_DEBUGGING_AND_TRACEABILITY.md` is a first-class architectural contract. Implement its diagnostic spine before feature-heavy work. Generic mentions of logging or observability elsewhere do not weaken its exhaustive TRACE-mode requirements.


## Research-workbench expansion
The following are first-class contracts, not optional brainstorming:
- `15_SOURCE_CATALOG_AND_PLUGIN_SEEDS.md`
- `16_DATA_LIFECYCLE_STORAGE_AND_MEMORY.md`
- `17_GENERIC_ANALYSIS_WORKBENCH.md`
- `18_RESEARCH_METHOD_AND_PAPER_PIPELINE.md`
- `19_RECOVERED_ARCHIVE_DECISIONS_V3.md`

Their enumerated sources/transforms/methods/charts are seed lists that AI Studio MUST organize into registries and thoughtfully expand. They are not closed feature lists and not proof of implementation.

- `20_COMMUNITY_REPORT_AND_SEMANTIC_PIPELINE.md`

- `21_INTUITIVE_RESEARCH_UI_AND_USER_FLOWS.md`


## V3 complete-workbench clarification
WatchDog has a psychoactive-substance research lineage, but the data/transform/series/analysis/visualization substrate must accept arbitrary compatible datasets. Substance-specific ontologies and JH16 are domain modules/presets, not constraints on the generic analytical engine.

All enumerations of sources, transforms, statistics, models and visualizations are seed examples to be organized and expanded through typed registries. Do not interpret "expand" as "implement everything immediately": registry status and tests must distinguish implemented, fixture, planned and blocked capabilities.
