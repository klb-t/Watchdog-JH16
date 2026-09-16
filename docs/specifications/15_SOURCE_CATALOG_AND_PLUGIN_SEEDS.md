# Source Catalog and Plugin Seed Specification

## Purpose
The system must not be designed around one provider. Sources are plugins described by capability metadata and normalized outputs. The lists below are **seed examples to be expanded**, not a closed scope.

The implementation agent MUST:
1. organize source types by capability,
2. identify common source contracts,
3. add other standard sources that fit the same categories,
4. mark every source `implemented | fixture | planned | blocked-by-license/auth`,
5. never pretend a source is implemented merely because it appears in the catalog,
6. never violate API terms, robots rules, copyright, privacy, or retention constraints.

## Source families and seed examples

### A. Web search / result-count signals
Use cases: JH16-style popularity/harm indicators, longitudinal search-result snapshots, geography/language comparison.

Seeds:
- generic Google-compatible result-count provider,
- SerpApi/SERP-style provider adapter,
- other legally usable search-result APIs through the same normalized contract.

Normalized concepts include query text/role, locale, geography, result count, provider metadata, retrieval time and raw artifact reference.

JH16 FAITHFUL must remain provider-neutral and use the exact locked query semantics defined in the scientific contract.

### B. Search-interest time series
Use cases: interest over time, local trends, anomaly detection, lag analysis, comparisons before/after events.

Seeds:
- Google Trends through a provider/API adapter,
- provider-returned regional interest data,
- equivalent future trend providers.

Do not silently substitute normalized Trends interest for JH16 result counts. They are different metrics and different source capabilities.

### C. Scientific literature and reference papers
Literature is both a source of methodology/reference values and an evidence corpus for paper drafting.

Seeds:
- Jankowski & Hoffmann 2016 / JMIR e38 as a locked methodology/reference asset,
- Nutt et al. reference harm scores as versioned reference datasets with citation provenance,
- DOI/PDF/manual paper ingest,
- bibliographic metadata adapters such as Crossref, OpenAlex, PubMed/NCBI and Semantic Scholar where legally and technically available,
- manually curated tables extracted from papers with page/table provenance and verification state.

A paper is not automatically a numeric dataset. Numeric extraction must become a separate versioned artifact with explicit provenance and verification.

### D. Chemical / pharmacological reference knowledge
Seeds recovered from prior design:
- PubChem,
- DrugBank where licensing permits,
- scientific reviews/guidelines,
- future chemistry/pharmacology databases via adapters.

Potential normalized fields: identifiers, structure identifiers, molecular properties, pharmacokinetics, receptor/target data, toxicology claims, interaction facts, provenance and evidence grade.

Stable facts are versioned facts, not overwritten mutable columns when consensus/source changes.

### E. Encyclopedic / semi-stable knowledge
Seeds:
- Wikipedia,
- PsychonautWiki if included later,
- other encyclopedic sources with explicit evidence/source grade.

Store source snapshots and provenance. Do not label encyclopedic content as equivalent to peer-reviewed scientific evidence.

### F. Community / field reports
Seeds:
- Erowid / trip reports,
- Reddit-like sources where API/terms permit,
- specialist forums and harm-reduction forums where collection is lawful,
- manually supplied/exported forum or trip-report corpora.

Implement this family through `free_text_reports` / `community_reports` capabilities. See `20_COMMUNITY_REPORT_AND_SEMANTIC_PIPELINE.md` for candidate extraction, symptom mapping, geographic bucketing and evidence controls.

Treat as early-warning/anecdotal evidence. Preserve time/source/context. NLP extraction produces candidate features with confidence and provenance; it must not silently convert anecdotes into verified facts.

### G. Drug-checking / pill / sample / laboratory data
Source capability should support:
- pill/sample visual description: logo/stamp, color, shape, break line, mass,
- sample/test ID,
- components/substances,
- concentration/amount/percentage,
- contaminants/adulterants,
- analytical method,
- LOD/LOQ when available,
- uncertainty/quality flags,
- place/time,
- provider/lab/source provenance.

Examples include national/local drug-checking databases or lab imports, subject to access/licensing.

### H. Institutional / public-health / early-warning sources
Seeds:
- official warnings,
- early-warning systems,
- public-health reports,
- poison-center or emergency datasets where legally accessible,
- law-enforcement/public-safety feeds only when lawful and role-gated.

These should have an institutional evidence grade separate from peer-reviewed science and community reports.

### I. User/manual datasets
Researchers must be able to upload/import:
- CSV,
- TSV,
- JSON/JSONL,
- Parquet,
- Excel,
- optionally database/query results through controlled connectors.

Manual data becomes a first-class dataset with schema, checksum, provenance, owner, permissions and immutable import artifact.

## Capability model
Every source declares capabilities instead of relying on source-name conditionals. Examples:

```text
result_count
interest_over_time
interest_by_region
entity_reference
scientific_literature
numeric_reference_table
chemical_properties
pharmacology
lab_sample
alert_feed
free_text_reports
geospatial
manual_dataset
```

The UI is generated from the source parameter schema/capabilities: date range, geography, language, resolution, query, entity/substance set, pagination, retention limits, etc.

## Seed-list expansion rule
For every list in this document, the implementation agent must create a registry and may expand it with technically appropriate standard items. Expansion is not permission to silently build uncontrolled scrapers or to claim inaccessible APIs work. Every added item needs rationale, capability mapping, status and a contract test/fixture before `implemented` status.


### J. Governmental / regulatory / surveillance reference feeds
Seed candidates to evaluate and expand, subject to jurisdiction/access:
- WHO,
- EUDA/European drug monitoring publications and alerts,
- UNODC,
- national public-health/drug-monitoring agencies,
- FDA/other medicines safety sources where relevant,
- poison-center/emergency aggregate datasets where lawfully accessible.

Do not encode agency names in analytical formulas. Map them to institutional/report/alert capabilities and provenance grades.

### K. Search/discovery as a source-discovery mechanism
A generic web/SERP provider may also discover candidate sources, substance names and literature. Discovery outputs remain candidates until a source adapter/import process records and validates them. Search discovery must never silently convert arbitrary web text into verified knowledge.
