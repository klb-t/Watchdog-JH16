# Definition of Done

## Repository
- [ ] clean clone documented
- [ ] no committed secrets
- [ ] no core fake/TODO success path
- [ ] format/type checks clean

## Config
- [ ] versioned schemas
- [ ] fail-fast validation
- [ ] deterministic canonical hash
- [ ] precedence tested
- [ ] UI navigation/layout config-driven
- [ ] faithful preset locked

## Data/reproducibility
- [ ] raw before normalize
- [ ] content hashes
- [ ] immutable finalized manifest
- [ ] append-only snapshots
- [ ] supersession lineage

## Scientific
- [ ] exact 16-substance faithful config
- [ ] exact query templates
- [ ] Pi tested
- [ ] Hi tested
- [ ] missing/zero tested
- [ ] reference scores versioned
- [ ] correlation methods explicit
- [ ] golden offline run passes
- [ ] no LLM numerical path

## Backend
- [ ] thin routes
- [ ] adapter abstraction
- [ ] analyzer abstraction
- [ ] asynchronous run lifecycle
- [ ] schedule -> ordinary run
- [ ] OpenAPI

## Frontend
- [ ] Dashboard
- [ ] Data
- [ ] Schedules
- [ ] Analysis
- [ ] Sources
- [ ] Summary
- [ ] Settings
- [ ] Run detail/manifest
- [ ] role visibility
- [ ] explicit errors
- [ ] mobile usable


## Debuggability / development flight recorder
- [ ] deployment config switches OFF / ERRORS / NORMAL / TRACE
- [ ] enabling/disabling TRACE requires no source edit
- [ ] common structured trace API used by every major backend layer
- [ ] frontend/API/service/queue/worker correlation tested
- [ ] ordered micro-step event sequence persisted
- [ ] relevant input/state-before/state-after/failure snapshots available
- [ ] full stack trace and nested exception cause chain preserved
- [ ] failed/incomplete trace remains readable
- [ ] central redaction occurs before every sink
- [ ] canary-secret test proves no leakage
- [ ] Run Detail has direct Debug view
- [ ] global Developer Debug Console available when enabled
- [ ] timeline/raw/errors/state/config/requests views function
- [ ] one-click redacted diagnostic bundle works
- [ ] failure-injection suite covers all major boundaries
- [ ] first failure occurrence exposes component + operation + immediate cause + context
- [ ] TRACE on/off yields identical deterministic scientific results
- [ ] diagnostic retention/cleanup policy documented and tested

## Auth/security
- [ ] OIDC or documented test/dev substitute
- [ ] server RBAC
- [ ] secrets write-only
- [ ] logs redact
- [ ] privileged actions audited

## Tests
- [ ] unit
- [ ] property/invariant
- [ ] adapter contract
- [ ] DB
- [ ] object storage
- [ ] worker
- [ ] API/RBAC
- [ ] scientific golden
- [ ] frontend
- [ ] browser E2E
- [ ] WORM
- [ ] reproducibility

## Required demo
```bash
docker compose up --build -d
make migrate
make test
make demo-jh16
```
Then browser: Dashboard -> demo run -> manifest -> JH metrics -> export -> provenance.

## Final agent report
Table: requirement / PASS-PARTIAL-DEFERRED-FAIL / implementation files / tests / notes. Anything not demonstrated is not assumed complete.


## Generic data/analysis/research
- [ ] source catalog is capability-driven and examples are non-exhaustive
- [ ] every fetch attempt creates a durable fetch event
- [ ] retainable raw response archived before normalization
- [ ] identical raw payloads can dedupe physically by SHA-256 without losing fetch history
- [ ] first-class Dataset object and schema metadata
- [ ] deterministic transformation DAG with lineage
- [ ] first-class Series Builder with explicit index/value/group/resolution/missing policy
- [ ] method registry with typed input contracts and assumptions
- [ ] arbitrary compatible dataset can run non-JH16 analysis
- [ ] Pearson/Spearman/cross-correlation implemented/tested
- [ ] broader method families represented in registry with honest implementation status
- [ ] reproducible visualization specs and figures
- [ ] reusable AnalysisSpecs can be cloned/rerun/scheduled
- [ ] Research Project object exists
- [ ] literature items/citations have provenance and immutable imported artifacts when permitted
- [ ] frozen evidence package exists
- [ ] deterministic Methods/Results skeleton exists
- [ ] claim-evidence validation flags unsupported numbers/citations
- [ ] paper draft versions never overwrite frozen prior versions
- [ ] LLM drafting cannot mutate scientific results


## Expanded source/method/UI requirements
- [ ] community/forum source family exists as capability-based adapter/import contract
- [ ] PubChem, Trends, literature and institutional families represented with honest status
- [ ] fetch archive UI shows every logical fetch and raw blob linkage
- [ ] content-addressed dedupe never erases fetch-event history
- [ ] transform registry can be expanded without page/source branching
- [ ] method registry includes descriptive, association, comparison, regression, time-series, causal, robustness, evidence-synthesis and extensible semantic families
- [ ] advanced/planned methods are not displayed as implemented
- [ ] forum/trip-report extraction stores source span + model/version + confidence + verification state
- [ ] symptom/organ mapping is versioned and provenance-bearing
- [ ] arbitrary imported compatible data can reach Dataset -> Series -> Analysis -> Figure without custom code
- [ ] intuitive guided flow and expert controls save the same explicit underlying specs
- [ ] Fetch/Data/Series/Analysis/Figure/Project objects all expose lineage links
- [ ] Research Project can freeze evidence and generate deterministic methodology facts
- [ ] paper drafting validates numeric/citation/evidence links
