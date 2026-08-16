# Community Reports, Forums and Semantic Evidence Pipeline

## Purpose
Forum posts, Reddit-like discussions, trip reports and other community narratives are a distinct evidence family. They are useful for discovering slang, emerging substances, dose/route patterns, symptom clusters, attitudes and rare early-warning signals, but they are not equivalent to verified clinical or peer-reviewed evidence.

The pipeline MUST preserve that epistemic distinction from ingestion through UI and paper drafting.

## Source seeds — examples to expand
The source registry should support lawful/authorized connectors or imports for:
- Erowid experience reports,
- Reddit-like community sources where API/terms permit,
- specialist drug/research-chemical forums,
- harm-reduction forums,
- manually supplied/exported forum corpora,
- other public community-report sources with explicit retention/licensing metadata.

Do not hard-code site names into analysis logic. Implement a `free_text_reports` / `community_reports` source capability and source-specific adapters.

## Raw capture
For every fetch/import preserve, as permitted:
- source and canonical URL/post/thread identifier,
- retrieval timestamp and original publication timestamp if available,
- thread/post structure,
- language,
- source-side metadata allowed by policy,
- exact retained raw text/HTML/JSON artifact hash,
- fetch/query/pagination parameters,
- provenance and retention policy.

Community data may contain personal/sensitive information. Raw access must be role/policy gated. Derived research tables should minimize or bucket identifying detail.

## Deterministic preprocessing
Before model-assisted semantic extraction:
1. parse source structure,
2. identify language,
3. normalize Unicode/whitespace without destroying the immutable raw artifact,
4. segment thread/post/report and temporal sections,
5. identify quotations/replies where possible,
6. deduplicate exact/near-exact reposts while retaining logical event history,
7. resolve obvious substance aliases against the canonical ontology when deterministic,
8. preserve unresolved terms as candidates rather than forcing a mapping.

## Model-assisted extraction — candidate evidence only
LLMs/NER/classifiers may extract **candidate structured facts** such as:
- substance names and unresolved aliases/slang,
- amount/dose and unit,
- dosage range statements,
- formulation/salt/product form,
- route of administration (oral, insufflated, inhaled/vaped, IM, IV, etc.),
- co-administered substances,
- relative timing (`T+...`, duration, onset, after-effects),
- acute subjective effects,
- adverse effects/symptoms,
- severity language,
- care sought/hospitalization where explicitly stated,
- user attitude/sentiment toward a substance,
- geographic statements where collection/use is lawful,
- novel-substance/name candidates.

Each extracted item MUST store:
```text
extraction_id
source_artifact_id/hash
source_span/offset or quote reference
extractor_id/model/version
prompt/template/version when applicable
candidate_type
candidate_value
normalized_candidate
confidence
verification_state
reviewer/verification provenance
```

The model may propose; it does not silently create canonical facts.

## Symptom and organ-system mapping
Historical WatchDog requirements explicitly proposed mapping natural-language overdose/adverse-effect reports to normalized symptoms and body systems.

Provide an extensible clinical terminology mapping layer, for example:
```text
"heart racing" -> tachycardia -> cardiovascular
"pulse 160"    -> tachycardia -> cardiovascular
"jaw clenching"-> bruxism/dystonic-like symptom candidate -> neurologic/musculoskeletal
"seizure"      -> seizure -> CNS/neurologic
"vomiting"     -> vomiting -> gastrointestinal
```

Mappings MUST carry ontology/version/provenance and uncertainty. Do not infer diagnosis from a phrase when the source does not support it.

Seed output dimensions:
- cardiovascular,
- neurologic/CNS,
- psychiatric/behavioral,
- respiratory,
- gastrointestinal,
- hepatic,
- renal/urinary,
- thermoregulatory,
- dermatologic,
- musculoskeletal,
- other/unmapped.

The implementation agent should replace this simple seed taxonomy with appropriate versioned terminology/ontology adapters where useful.

## Dose/time/route normalization
Represent the source value and normalized candidate separately. Never discard ambiguity such as `half a tab`, `a bump`, unknown purity, unknown salt form, or body-weight uncertainty.

Normalized dose features must include uncertainty/quality flags and must never be presented as medically verified safe dosing guidance merely because users reported them.

## Geographic handling
Historical design wanted low-resolution geographic signal for trend/early-warning research.

Model geography separately from identity. Candidate provenance should distinguish:
- explicit self-reported location in text,
- explicit source/profile field where lawful,
- source/community geographic scope,
- inferred location.

Inferred location must have lower evidence grade and confidence. UI/reporting should support aggregation/bucketing and minimum-count suppression policies. Raw sensitive geographic text can have stricter permissions than derived buckets.

## Derived analytical datasets
Examples — seed list, not exhaustive:
- slang/alias frequency over time,
- attitude/sentiment distribution over time,
- symptom frequency by substance,
- organ-system heatmaps,
- symptom co-occurrence networks,
- dose-range distributions with uncertainty,
- route-of-administration distributions,
- dose-response exploratory curves,
- time-to-onset/duration distributions when extractable,
- rare-but-severe signal candidates,
- emerging-substance/name frequency,
- geography/time incidence *within the collected corpus*.

Always label denominator correctly: e.g. `35% of qualifying collected reports`, not `35% of users`.

## Early-warning logic
Community signals may nominate candidates for review/alerts. A signal should link back to reports/extractions and expose:
- corpus/source scope,
- number of reports,
- dedup policy,
- observation window,
- baseline,
- anomaly method/version,
- severity weighting if used,
- uncertainty,
- evidence grade.

A model-generated anomaly explanation is downstream commentary, not the signal computation.

## Privacy / safety
- retain only data allowed by source terms and applicable policy,
- minimize identifiers in derived datasets,
- keep raw community artifacts permission-gated,
- provide configurable geo bucketing/min-count suppression,
- do not turn the system into individual-user tracking,
- preserve a deletion/tombstone trail when policy requires payload expiry.

## Tests
Fixtures must cover slang, misspellings, multiple substances, ambiguous dose units, unknown purity, time expressions, symptom synonyms, negation (`no chest pain`), quotation/repost handling, mixed languages, model uncertainty and failed identity resolution.

Golden tests must prove that candidate extraction cannot silently promote an unverified alias/symptom/dose into a canonical verified fact.
