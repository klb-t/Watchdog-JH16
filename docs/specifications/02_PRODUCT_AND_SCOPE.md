# Product and Scope Specification

## Product identity
**WatchDog** is a general, configuration-driven pipeline for collecting, preserving, analyzing and contextualizing signals about psychoactive substances.

It is not merely a JH16 script, trends dashboard, pill database or LLM report generator. JH16 is the smallest rigorous benchmark proving the chain:
`acquisition -> provenance -> analysis -> reproducibility`.

## Conceptual lineage
1. Nutt et al. — structured/static expert harm scoring.
2. Jankowski & Hoffmann 2016 — dynamic internet-derived indicators based on search result counts.
3. WatchDog — multi-source, longitudinal, provenance-preserving decision-support infrastructure.

## Core goals
### G1 Reproducible research
Configure -> fetch/load -> preserve -> analyze -> inspect deviations -> export.
### G2 Longitudinal monitoring
Repeated observations form versioned series without overwriting history.
### G3 Evidence transparency
Every result retains source, transformation, time, configuration and evidence quality.
### G4 Extensibility
New source/analyzer/exporter/UI composition does not require invasive core changes.
### G5 Decision-support foundation
Data model can later support emergency/medical lookup and alerts without redesigning the research spine.

## MVP
- auth foundation,
- source registry,
- SERP-style result-count adapter,
- raw/provenance storage,
- substance registry + aliases,
- run engine,
- JH16 faithful preset,
- enhanced/longitudinal scaffolding,
- schedules,
- analysis dashboard,
- deterministic stats,
- exports,
- Auto-Summary over stored results,
- first-class Dataset + Series objects,
- generic transform/analysis/visualization registries,
- interactive Data Explorer / Series Builder / Analysis Workbench,
- Research Project + literature/evidence scaffolding,
- paper-drafting pipeline architecture with deterministic Methods/Results evidence skeleton,
- audit log,
- Docker local deployment,
- tests,
- offline scientific demo.

## Feature-gated / post-MVP
- pill/sample/lab integration,
- emergency responder interface,
- alerts,
- receptor/pharmacology knowledge graph,
- trip-report NLP,
- geography/outbreak models,
- Granger/changepoint modules,
- clinical integrations,
- police/policy-specific interfaces,
- public portal,
- fully automated publication submission/workflow.

Paper drafting itself is a target capability and must be architected now; advanced prose automation can mature after the core evidence pipeline.

## Non-goals of first implementation
- autonomous diagnosis/treatment,
- scraping contrary to source terms,
- identifiable patient/user data,
- treating search counts as epidemiological prevalence,
- hiding methodology changes under a “replication” label,
- UI polish before complete provenance.

## Roles
- `developer`: development/debug/config.
- `admin`: users/roles/sources/schedules/settings.
- `researcher`: acquisitions/runs/analysis/provenance/export.
- `doctor` / `medical`: vetted evidence and future emergency surfaces; no admin secrets.
- `policeman` / `institutional`: reserved/feature-gated; not an MVP dependency.

Authorization is server-side; hidden UI is not authorization.

## Epistemic layer
Do not flatten observation, transformation, statistic, external reference and generated interpretation into one “fact”.
Suggested semantic grades:
- `experimental_peer_reviewed`
- `institutional`
- `raw_empirical`
- `computational_prediction`
- `speculative`

Colors belong to UI config, not the semantic model.


## Seed catalogs are expansion points
The source, transformation, statistical-method and visualization lists are deliberately non-exhaustive. AI Studio must implement them as registries/capabilities and expand them with standard compatible items, marking implementation status explicitly rather than hardcoding the examples as the whole product. See `15_SOURCE_CATALOG_AND_PLUGIN_SEEDS.md` through `18_RESEARCH_METHOD_AND_PAPER_PIPELINE.md`.
