# Recovered Archive Decisions — Research Workbench Expansion

This file records concrete design ideas recovered from historical WatchDog conversations so they are not lost during implementation. They are reconciled with newer contracts; later current requirements win when they conflict.

## 2024-11 — original research tool lineage
Recovered requirements:
- replicate and improve Jankowski-Hoffmann methodology,
- automatically acquire data,
- use Google Trends for analysis over time as a separate signal,
- English synonym/query handling with ambiguity controls,
- compare/correlate against Nutt reference results,
- generate user-friendly reports/tables/charts,
- later compare geographies/language areas.

These are historical seeds, not permission to alter the locked FAITHFUL JH16 methodology.

## 2025-03 — proactive monitoring and memory
Recovered ideas:
- crawler/collector runs in the background and accumulates longitudinal data,
- geography hierarchy from local/municipal through province/region, country, Europe/global,
- language/dialect context matters,
- large number of substances and synonyms,
- distinguish researcher/scientific interest from user/public interest when feasible,
- balance private/user analysis storage with a shared proactive cache/monitoring layer,
- future scientific publication/Erowid knowledge collection and richer toxicology/pharmacokinetic/pharmacodynamic database.

Reconciled design: one storage/artifact interface with policy-based private/project/shared scopes; immutable fetch history and physical content deduplication.

## 2025-08-22 — substance-centric data architecture
Recovered concrete model:
1. canonical Substance anchor,
2. scientific hard data,
3. semi-stable reference knowledge such as Wikipedia/PubChem/DrugBank,
4. field/user reports,
5. trend signals such as Google Trends/SERP/forum sources,
6. pills/mixtures -> components -> canonical substances,
7. lab samples as evidence for composition,
8. alerts/reports/trends/publications all resolve to common substance IDs.

Original storage proposal:
- PostgreSQL + JSONB for index/relationships,
- TimescaleDB considered for time-series metadata/as-of queries,
- Parquet on S3/GCS-compatible object storage for series/snapshots,
- WORM manifests with SHA-256 + run params,
- DuckDB/Polars for local analytics.

Current reconciliation:
- PostgreSQL + object store + Parquet are baseline,
- DuckDB/Polars supported behind abstraction,
- TimescaleDB optional after benchmark,
- every fetch gets a durable event and retainable raw content; identical bytes may be physically deduplicated by hash.

## 2025-08-26 — universal research and early-warning system
Recovered product ideas:
- modular integration of Google/search, PubChem, Wikipedia, Erowid and later sources,
- public-health/service dashboard with local trends, anomaly alerts, maps and period comparisons,
- pill-test integration and detection of problematic series/batches,
- researcher layer is the core: source choice, fetch schedules, analysis methods and summary/output form are configurable,
- provenance/versioning/audit trail,
- correlation and time-series methods including Pearson, Spearman, seasonality/trend controls, lag/cross-correlation, Granger, VAR, intervention models,
- causal-design sketches including IV, DiD and synthetic control when justified.

## 2026-02 — automatic research narrative intent
Recovered explicit concept: WatchDog should aggregate information with epistemic metadata and, after selecting appropriate data sources, methods and literature, be able to assemble the original “homework”/research paper automatically.

Current requirement strengthens this: paper drafting is a supported target capability with its own Research Project, evidence package, claim matrix and versioned draft pipeline. It remains downstream of deterministic data/statistics.

## Seed lists are not closed lists
A repeated design intent is extensibility. Source, transform, analysis and visualization catalogs in this package are examples the implementation agent must organize and expand through registries. Expansion must remain inspectable, tested, provenance-preserving and must not silently turn planned integrations into fake implementations.


## Community-report semantic branch recovered
Additional historical conversations specified that forum/Reddit/trip-report data should be treated as a raw clinical/field signal pipeline rather than ordinary prose summaries. Recovered examples included:
- slang/rare alias extraction,
- dose and route-of-administration extraction,
- temporal course,
- symptom extraction,
- mapping symptoms to organ/body systems,
- frequency/heatmap/dose-response/rare-severe derived signals,
- coarse geographic bucketing when legally justified,
- evidence objects retaining source/provenance/confidence.

These are incorporated in `20_COMMUNITY_REPORT_AND_SEMANTIC_PIPELINE.md`. Old brainstormed ideas that would overstate uncertain quantities are not promoted to verified facts; model output remains candidate evidence until validated.
