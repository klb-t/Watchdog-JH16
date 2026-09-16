# Test and Validation Plan

## Unit
Config canonicalization/schema/precedence, query renderer, JH formulas, stats, alias normalization, hashing, artifact paths, permissions.

## Property/invariant
- Pi range for nonnegative valid counts,
- max Pi = 100 when max Ni > 0,
- zero denominator explicit,
- canonical JSON/hash stable to key order,
- meaningful config change changes hash.

## Adapter contract
Every adapter: success, zero results, missing count, number parsing, provider error body, 401/403, 429, timeout, malformed JSON, schema drift, retry/backoff, raw retention policy. No paid API in CI.

## DB integration
Fresh Postgres migrations, constraints, immutable completed-run behavior, append-only snapshots, schedule edit not mutating run config.

## Object store
MinIO put/get/hash verification/immutable naming/missing object/manifest finalization.

## Worker
Queued->running->completed, failure, cancellation, retryable provider error, nonretryable scientific error, schedule-created run.

## API/RBAC
Capability matrix for anonymous/researcher/medical/admin/developer/feature-gated institutional. Test direct API calls.

## Frontend
TypeScript compile/lint, config renderer, form validation, polling, errors, redaction, locked faithful controls.

## E2E offline critical path
1. authenticate test/dev,
2. Data,
3. offline JH16 fixture source,
4. faithful run,
5. status progression,
6. run detail,
7. manifest,
8. Pi/Hi,
9. JSON/CSV export,
10. optional mock/local summary,
11. summary provenance.

## Scientific golden fixture
Frozen legally distributable/manually encoded table with label, Ni, Ni_harm, expected Pi, expected Hi, reference score where available. Do not change fixture merely to make code pass.

## Reproducibility
Same offline config twice -> identical deterministic analytical payload/hash after excluding explicitly nondeterministic envelope fields; IDs/timestamps may differ.

## WORM
Finalize -> mutation of raw hash/pointer rejected -> manifest mutation rejected -> superseding run accepted with lineage.

## Config-driven UI
Change test config only -> nav order/label/role visibility changes without frontend source edit.

## Failure transparency
Failure -> FAILED + error code + retained captured evidence + visible UI failure + no fake output.


## Development flight-recorder / diagnostics
Implement the full contract in `14_DEBUGGING_AND_TRACEABILITY.md`.

Core tests: diagnostics mode switches `OFF/ERRORS/NORMAL/TRACE` without source edits; TRACE emits ordered events with correlation IDs; before/after/failure snapshots persist; nested exception causes and stack traces survive wrapping; browser/API/service/queue/worker links survive; failed trace remains readable; Debug Console can retrieve/filter it; diagnostic bundle contains expected evidence; TRACE on/off produces identical deterministic scientific outputs excluding diagnostic/nondeterministic envelope fields; canary secrets never appear in any sink.

Failure injection MUST cover config, auth, DB, object store, queue, worker, provider 401/403/429/500, timeout/network fixture, malformed JSON/schema drift, normalization, scientific input, analyzer, exporter, summary, frontend request and frontend render boundary. For every injected failure assert that one occurrence records component + operation + immediate cause + nested cause chain + prior relevant events + safe failure state + correlation IDs.

## Quality gate
Formatter, type checks, unit tests, relevant integration tests, scientific golden test when analytics touched, secret scan, migration test when DB changed.


## Generic data/research workbench
- every successful fetch creates a distinct fetch_event,
- two identical raw payloads create two fetch events but may reference one content-addressed blob,
- raw bytes/hash survive normalization failure,
- transform DAG is deterministic and lineage-complete,
- derived dataset cannot mutate finalized input,
- table -> series materialization records time/value/group/resolution/missing policy,
- incompatible method/data combinations fail validation before execution,
- arbitrary compatible CSV/Parquet fixture can run descriptive analysis and a visualization without source-specific code,
- Pearson/Spearman/cross-correlation golden fixtures,
- lag alignment sample-size accounting,
- preprocessing changes produce distinct analysis spec/hash,
- figure stores exact input/result/render config,
- Research Project can freeze evidence package,
- Methods skeleton exactly reflects manifests/config/transforms,
- Results skeleton numbers exactly match deterministic analysis artifacts,
- generated draft cannot introduce nonexistent citation IDs in validation,
- generated Results number not in evidence is flagged,
- refreshing project inputs creates a new evidence/draft version rather than overwriting old one.


## Generic research workbench E2E
1. import arbitrary fixture CSV,
2. inspect schema/quality/lineage,
3. derive dataset with visual transform spec,
4. materialize time series,
5. correlate two columns/series with Spearman,
6. perform lagged correlation after explicit alignment,
7. render/save figure,
8. save AnalysisSpec,
9. rerun same spec and prove deterministic result hash,
10. pin outputs to Research Project,
11. freeze evidence package,
12. create deterministic Methods/Results skeleton,
13. mock/local LLM draft,
14. validate every number/citation/evidence link.

## Community semantic fixtures
Test slang/misspellings, ambiguous dose, route, timing, symptom synonyms and negation, co-use, mixed language, repost/quotation, geographic candidate, uncertainty and failed ontology resolution. A model candidate must never become verified canonical data without the configured verification path.
