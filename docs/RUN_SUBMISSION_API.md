# HTTP run submission boundary (A4-WD-001, 2026-10-09)

`POST /api/runs` accepts the existing `RunSubmissionSchema` envelope: required
`type` (`ACQUISITION`, `ANALYSIS` or `PIPELINE`) and required `config`. Both objects
now reject unknown fields with the existing HTTP 400 `VALIDATION_ERROR`. Validation
happens before source ownership resolution, `submitJob`, run creation, scheduling,
provider access or budget/ledger changes. Errors identify the unsupported keys;
the endpoint does not silently run a different configuration.

Known optional configuration fields remain unchanged:

- `source_id`, `source_params`, `method_id`, `method_params`, `source_run_id`;
- `language`, `query_expansion_mode`, `entities`, `query_templates`.

`source_params` and `method_params` remain open JSON parameter records. Nested
provider/analyzer options retain their values and their existing downstream
validation; this change does not recursively restrict them. `query_templates`
remains a dynamic string map. The existing UI requests in Sources, Analyzers and
Study use this declared contract. No new default, coercion or fallback is added.
For a known source run, the existing owner check still precedes enqueueing.

In particular, top-level configuration `method_spec_id`, `method_spec_hash`,
`personal_credentials` and `plan` are not implemented controls of this HTTP
endpoint. Previously the schema stripped them, which could turn a purported
hash-pinned method request into ordinary legacy analysis. The endpoint now fails
explicitly; it does not claim to implement those controls.

The reviewed research-plan workflow has a separate existing contract.
`ResearchPlanService.launch` calls the actual orchestrator directly after its
owner, expected plan hash and approved method hash checks. It legitimately passes
method pins, a generated acquisition plan, credential selection and research-plan
provenance. The HTTP schema is **not** imposed on `submitJob` or that workflow.
The existing wizard fixture still completes through the approved MethodSpec
executor. Direct unreviewed method pins remain rejected by the existing consumer.

## Migration and evidence

Supported HTTP requests keep their parsed values, serialized configuration bytes,
configuration hash and deterministic results. Existing run rows, source data,
results, manifests and approvals are not rewritten. Clients sending unsupported
fields now receive an error and must choose an implemented flow; no historical
run is assigned a claim that a previously dropped field was honored.

The decision is an explicit, reversible admission correction. Alternatives were
to implement all unsupported controls or to apply the HTTP schema globally;
neither is needed to repair silent stripping, and the latter would break the
reviewed-plan consumer. This does not change frozen JH16 science, default method
selection, credential/budget policy or the engine's internal configuration model.

Tests retain baseline schema bytes and canonical output from public synthetic
A-pass4 observations. The actual loopback router, queue, SQLite, analyzer and
ObjectStore prove error-before-write and successful unchanged analysis, including
close/reopen. Existing pipeline, ownership and reviewed research-plan tests remain
in the scoped gate. A4-WD-002 (source-run input provenance) and A4-WD-003 (duplicate
scientific inputs) remain separate open findings; this boundary fix closes neither.
