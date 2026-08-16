# Backend Architecture

## Layers
### API
Transport, Pydantic validation, auth/capability, service call, typed response/error mapping. No scientific computation.
### Services
Use-case orchestration, transactions, run lifecycle, adapters/repos, manifests, exports.
### Domain
Pure types/invariants: run states, observations, substance identity, evidence grades, scientific errors.
### Adapters
Provider-specific acquisition.
### Repositories/storage
DB/object storage.

## Run state machine
```text
CREATED -> VALIDATING -> QUEUED -> RUNNING -> NORMALIZING -> ANALYZING -> EXPORTING -> COMPLETED
```
Any active stage may -> FAILED. Supported cancellation -> CANCELLED. Finalized runs are historical/immutable except append-only audit metadata.

## Acquisition transaction
1. create run/effective config,
2. validate source/params,
3. queue,
4. fetch,
5. persist permitted raw,
6. hash,
7. normalize,
8. persist observations,
9. update manifest step,
10. finalize acquisition stage.

If normalization fails after raw storage, retain raw evidence and mark failure.

## Analysis transaction
1. select immutable input IDs,
2. create analysis run,
3. verify input hashes,
4. deterministic analyzer,
5. persist analysis artifact,
6. persist typed queryable results,
7. exports,
8. finalize manifest.

## SourceAdapter protocol
```python
class SourceAdapter(Protocol):
    adapter_id: str
    adapter_version: str
    def capability(self) -> SourceCapability: ...
    def validate_params(self, params: dict) -> ValidatedParams: ...
    async def fetch(self, request: SourceRequest) -> RawFetchResult: ...
    def normalize(self, raw: RawFetchResult) -> list[Observation]: ...
    def provenance(self, raw: RawFetchResult) -> ProvenanceMetadata: ...
```
Provider SDK objects do not escape adapter boundary.

## Analyzer protocol
```python
class Analyzer(Protocol):
    analyzer_id: str
    analyzer_version: str
    def validate_inputs(self, inputs, config): ...
    def analyze(self, inputs, config) -> AnalysisArtifact: ...
```
JH16 is one analyzer/preset pair.

## Scheduler
Schedules persist in DB; worker creates ordinary runs. Scheduled/manual runs differ only by trigger metadata. No hidden schedule-only analysis logic.

## Exporters
CSV / JSON / Parquet / Excel / optional PDF / optional LaTeX. Exporters consume stored results; never re-fetch or recompute.

## Summary service
Consumes a frozen structured payload. Persist input IDs/hashes, template ID/version, model/provider/generation params, output hash. LLM service cannot mutate scientific results.

## Error taxonomy
`validation_error`, `authorization_error`, `source_auth_error`, `source_rate_limit`, `source_timeout`, `source_schema_change`, `normalization_error`, `scientific_input_error`, `analysis_error`, `storage_error`, `export_error`, `cancellation`.
Expose stable codes; keep safe provider details in logs/audit.

## Debugging / observability spine
`14_DEBUGGING_AND_TRACEABILITY.md` is authoritative. Do not reduce diagnostics to ordinary INFO/ERROR logs. Implement a common tracing API from the beginning.

Required correlation includes `trace_id`, `span_id`, `parent_span_id`, `sequence_no`, `request_id`, `run_id`, `job_id`, actor/service identity, component, operation, stage and build/git commit. Development TRACE mode records ordered micro-step events plus relevant structured state snapshots before/after/failure, including full stack trace and nested exception causes.

Context propagates `browser -> API -> service -> queue -> worker -> adapter/repository/analyzer/exporter`. TRACE events persist in an append-oriented diagnostic stream that remains readable after a failed/incomplete run. A central redaction layer runs before every sink.

Runtime/deployment mode is `OFF | ERRORS | NORMAL | TRACE`; changing mode requires configuration only, not source edits. The in-app Debug Console reads the same diagnostic record and provides timeline, raw events, errors/cause chains, state snapshots, requests, worker/persistence events, exact effective config and diagnostic bundle export.


## Dataset / transform / series services
Add first-class services for dataset catalog/import, transformation DAG execution, dataset materialization and series construction. Raw acquisition output is not passed ad hoc straight into every analyzer.

Recommended service boundaries:
- `dataset_service`: catalog/import/materialize/inspect,
- `transform_service`: registry, validation, deterministic DAG execution,
- `series_service`: table -> typed series materialization/alignment,
- `analysis_service`: method registry + execution,
- `visualization_service`: reproducible figure specs/rendering,
- `research_project_service`: project inputs/evidence freeze,
- `literature_service`: citation/reference assets,
- `paper_service`: deterministic evidence skeleton + downstream prose draft.

## Source catalog
Implement `15_SOURCE_CATALOG_AND_PLUGIN_SEEDS.md`. Source names are registry entries; business logic depends on capabilities/contracts. Seed lists must be expanded carefully and explicit status is mandatory.

## Storage/memory
Implement `16_DATA_LIFECYCLE_STORAGE_AND_MEMORY.md`. Every fetch has a durable fetch event. Retainable raw content is archived before normalization. Identical payload bytes may share a content-addressed blob; fetch events remain distinct.

## Generic analytics
Implement `17_GENERIC_ANALYSIS_WORKBENCH.md`. Method plugins declare accepted data shapes/types, parameters, assumptions/diagnostics, outputs and visualization compatibility.

## Research/paper pipeline
Implement `18_RESEARCH_METHOD_AND_PAPER_PIPELINE.md`. Paper generation consumes frozen evidence packages. Methods and Results facts are deterministically derived before any LLM prose step.
