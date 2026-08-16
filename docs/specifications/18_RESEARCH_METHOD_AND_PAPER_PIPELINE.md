# Research Project, Methodology and Paper Drafting Pipeline

## Goal
WatchDog should be capable of carrying a research question from source selection through reproducible data collection and analysis to a traceable paper draft.

The paper generator is not allowed to invent the scientific pipeline. It consumes structured frozen evidence produced by the pipeline.

## Research Project object
Create a versioned first-class object representing one study/project:

```text
project_id/title/version
research_question
hypotheses/objectives
population/scope
substance/entity set
geography/language/time scope
source specs
collection specs/schedules
literature set
transformation specs
analysis specs
figure/table specs
methodology notes
paper template
contributors/roles
status
```

Examples:
- faithful JH16 replication,
- JH16 update for later periods,
- country/language comparison,
- Trends-based longitudinal study,
- drug-checking contamination vs search/trend signals,
- arbitrary researcher-defined study.

## Methodology is generated from facts
A reproducible Methods section can be assembled from:
- source adapter and source version,
- exact queries and aliases,
- geography/language/date/resolution,
- acquisition timestamps/schedules,
- raw-retention policy,
- normalization/transformation DAG,
- dataset inclusion/exclusion criteria,
- statistical method IDs/versions/parameters,
- missing-data policy,
- software/git/dependency versions,
- reference datasets and citations.

Do not ask an LLM to remember these details from chat. Render deterministic methodology facts first; an LLM may convert them to prose without changing their meaning.

## Literature workspace
A project can contain papers/references imported by DOI/PDF/manual upload or bibliographic adapters.

For each reference persist:
- canonical citation metadata,
- DOI/identifier,
- source/location,
- immutable imported artifact/hash where lawful,
- notes/tags,
- relation to methodology/background/result,
- extracted numeric tables/claims as separate provenance-bearing artifacts,
- verification state.

Seed benchmark literature includes Jankowski-Hoffmann 2016 and Nutt et al. used by the replication/validation pathway.

## Evidence graph / claim matrix
Paper drafting must use an explicit graph:

```text
paper section/claim
   -> analysis result/table/figure OR literature citation
   -> dataset/series
   -> transform lineage
   -> raw fetch/import artifact
```

A generated factual claim should be classed as:
- direct computed result,
- methodological fact,
- literature-backed statement,
- interpretation/hypothesis,
- limitation/speculation.

The UI should make unsupported generated claims detectable. Results statements should link to computed artifacts; literature statements should link to citations.

## Paper workspace UI
Tabs/panels:
- Overview / Research question,
- Sources & collection,
- Literature,
- Data & inclusion,
- Methods,
- Analyses,
- Tables & Figures,
- Evidence/claim matrix,
- Draft,
- Review/validation,
- Versions/exports.

The researcher should be able to pin runs/datasets/results/figures into a project and mark which are included in the current draft.

## Drafting stages

### 1. Deterministic evidence package
Freeze all selected input IDs/hashes, analysis specs/results, figures, citations and methodology facts.

### 2. Deterministic Methods/Results skeleton
Produce structured tables and factual bullets from stored evidence.

### 3. LLM-assisted prose draft
LLM may draft:
- abstract,
- introduction/background from selected literature,
- methods prose from deterministic methodology facts,
- results prose from frozen results,
- discussion,
- limitations,
- conclusion.

The model MUST NOT modify numeric results or manufacture citations. Every generated section records provider/model, prompt/template version, input evidence-package hash and output hash.

### 4. Claim validation
Automated checks:
- every number mentioned in Results maps to an analytical result/table,
- every citation exists in project literature,
- no citation identifier is invented,
- Methods matches actual run manifests/config,
- figure/table references exist,
- unbacked factual claims are flagged,
- interpretations are labeled as interpretations.

### 5. Human review and versioning
Draft changes create versions. Refreshing data or rerunning analysis creates a new evidence package/draft lineage, never silently updates a submitted/frozen draft.

## Autoreplication / recurring papers
Historical project intent: selecting sources + schedules + analytical methods + summary/paper options can turn a study into a recurring pipeline.

Support:
```text
ResearchProject -> Collection schedules -> AnalysisSpecs -> FigureSpecs -> EvidencePackage -> Draft version
```

When new data arrives, create a proposed update and show diffs in data/results/methodology/draft. Never overwrite prior paper versions.

## Export
Seed exports:
- Markdown,
- DOCX when available,
- LaTeX,
- PDF through explicit rendering pipeline,
- citation bibliography formats,
- data/code/provenance supplement bundle.

## Guardrail
Paper drafting is downstream of deterministic evidence. The LLM is an editor/narrator, not the source of measurements, statistics, citations or provenance.
