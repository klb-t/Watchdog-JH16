# Development Flight Recorder / Debugging and Traceability Contract

## 1. Purpose

WatchDog MUST be designed so that during development an AI engineer or human engineer does not have to infer what probably happened from a final exception.

The development system must preserve an explicit, ordered, machine-readable execution trace detailed enough to reconstruct the actual path taken through the application and inspect the relevant state at each boundary and important internal step.

This is a first-class architectural requirement, not late-stage observability polish.

Primary acceptance target:

> After a failure occurs once, the stored diagnostic evidence should normally be sufficient to identify the failing component, exact operation, immediate cause, causal chain, relevant inputs/configuration, and last known valid state without rerunning the failure or guessing.

This target is best-effort rather than absolute: catastrophic process/host failure can prevent the final event from being persisted. The architecture MUST nevertheless maximize the forensic state retained from a single occurrence.

## 2. Operating modes

Diagnostics MUST be controlled by one deployment-level setting and may additionally be changed at runtime by an authorized developer when policy allows.

Required modes:

```text
OFF
ERRORS
NORMAL
TRACE
```

- `OFF`: no diagnostic trace persistence beyond mandatory security/audit records and minimal fatal startup logging.
- `ERRORS`: errors, causal chain, request/run correlation, and bounded preceding flight-recorder context.
- `NORMAL`: ordinary structured operational logs/spans without exhaustive state snapshots.
- `TRACE`: exhaustive development flight-recorder mode. Every instrumented micro-step and allowed state snapshot is captured.

Example deployment switch:

```text
WATCHDOG_DIAGNOSTICS_MODE=TRACE
```

Production deployment must be able to disable exhaustive tracing with one config/environment change, not by removing instrumentation.

The UI may expose a Developer/Admin switch only when permitted by deployment policy. Server-side configuration remains authoritative.

## 3. Instrumentation model

Do NOT implement this as ad-hoc `print()` statements.

Provide a central diagnostics API used from API routes, services, adapters, workers, analyzers, repositories, exporters and frontend/backend boundaries.

Prefer explicit helpers such as a context manager/decorator:

```python
with trace_step(
    "acquisition.fetch_provider",
    run_id=run.id,
    component="serp_adapter",
    state={"query": safe_query_metadata},
) as step:
    step.state_before(...)
    step.event("validation_result", ...)
    step.event("request_prepared", ...)
    result = await provider_call()
    step.event("call_result", ...)
    step.state_after(...)
```

Every event receives common correlation context automatically.

Required identifiers:
- `trace_id`
- `span_id`
- `parent_span_id`
- monotonic `sequence_no` within a trace/run where practical
- `request_id`
- `run_id`
- `job_id`
- `actor_id` or service identity where applicable
- browser/dev `session_id` where applicable
- UTC timestamp with sufficient resolution
- process/worker instance
- thread/task identifier where useful
- application build/git commit
- component
- operation
- stage

Correlation MUST propagate:

```text
browser -> API -> service -> queue -> worker -> adapter/repository/analyzer/exporter
```

Async boundaries must preserve or explicitly link the parent trace.

## 4. Required event vocabulary

TRACE mode must make the execution path explicit. At minimum support:

```text
TRACE_START
SPAN_START
STEP_ENTER
INPUT_SNAPSHOT
STATE_BEFORE
VALIDATION_RESULT
DECISION
TRANSFORM_START
TRANSFORM_RESULT
CALL_PREPARED
CALL_START
CALL_RESULT
CALL_RETRY
DB_OPERATION
ARTIFACT_WRITTEN
STATE_AFTER
WARNING
EXCEPTION
STATE_AT_FAILURE
STEP_EXIT
SPAN_END
TRACE_END
```

Not every step needs every event, but meaningful state transitions, validations, decisions, transformations, external calls, retries and persistence operations MUST be represented.

Ideal deterministic step:

```text
STEP_ENTER
STATE_BEFORE
INPUT_SNAPSHOT
VALIDATION_RESULT
DECISION(s)
TRANSFORM/CALL/DB operation
RESULT
STATE_AFTER
STEP_EXIT
```

On failure:

```text
EXCEPTION
STATE_AT_FAILURE
STEP_EXIT(status=failed)
```

## 5. Granularity: log the actual micro-steps

The requirement is deliberately more detailed than ordinary tracing.

In TRACE mode, instrument the smallest meaningful operations that can change control flow or state, including:
- validation branches,
- parsing branches,
- normalization decisions,
- alias resolution,
- fallback selection,
- retries/backoff decisions,
- state-machine transitions,
- transaction begin/commit/rollback,
- artifact path generation and writes,
- cache hit/miss where behavior can differ,
- configuration resolution/precedence,
- query rendering,
- provider-response interpretation,
- each deterministic analytical stage,
- exporter stage boundaries,
- frontend state transitions relevant to an action/failure.

Do not merely emit `function started` / `function failed` when the function contains several diagnostic decisions.

The intended debugging workflow is that an agent can inspect consecutive events, e.g. sequence 417 -> 418 -> 419, and determine exactly what changed between the last valid state and the failure.

## 6. State snapshots

The critical requirement is not merely logging that a function was called. In TRACE mode preserve the relevant state needed to explain why it behaved as it did.

State snapshots MUST be:
- structured JSON-compatible data, not prose,
- schema-aware where possible,
- bounded and explicit,
- redacted before persistence,
- attributable to component/operation/version,
- marked as `before`, `after`, `input`, `output`, or `failure`,
- optionally content-hashed.

Examples:

### Run orchestration
- current run status,
- expected next state,
- effective config hash and relevant resolved config values,
- run step index,
- selected source/analyzer/exporter,
- pending artifact IDs.

### Source adapter
- normalized safe request parameters,
- rendered query,
- provider endpoint identity,
- method,
- non-secret headers/metadata,
- timeout/retry settings,
- HTTP status,
- bounded/redacted response metadata/body when retention permits,
- parser result,
- schema/version detected.

### Normalization
- input artifact ID/hash,
- parser version,
- extracted fields,
- rejected/missing fields,
- output observation count,
- warnings.

### Analysis
- immutable input IDs/hashes,
- analyzer/preset/version,
- relevant numeric inputs,
- intermediate deterministic values where scientifically useful,
- output artifact/result hashes.

### Persistence
- repository operation,
- entity/table/object identity,
- transaction boundary,
- expected rows/objects,
- result/count,
- constraint/error information.

Do not dump unrelated database contents.

### Frontend
- route,
- user action identifier,
- component/error boundary,
- outgoing request ID,
- safe request payload,
- status/result,
- state transition relevant to the failing view.

## 7. Full errors and causal chains

Every captured exception MUST produce a structured error envelope.

Required fields:

```text
error_id
trace_id
span_id
request_id
run_id
job_id
timestamp
component
operation
stage
error_code
exception_type
message
stack_trace
cause_chain[]
retryable
handled
state_snapshot_ref
input_snapshot_ref
related_artifact_ids[]
build/git_commit
```

`cause_chain[]` must preserve wrapped/nested causes (`__cause__`, `__context__`, equivalent in other runtimes) instead of flattening everything into one generic error.

Provider/network failures should preserve safe diagnostics such as status code, provider request/correlation ID, retry-after, bounded response body and attempt number.

Never replace an original error with a less informative generic exception unless the original is linked as its cause.

## 8. Flight-recorder persistence

TRACE mode can generate too much data for ordinary application tables. Use a dedicated append-oriented diagnostic stream.

Recommended local/development representation:

```text
diagnostics/
  YYYY-MM-DD/
    <trace_id>/
      events.jsonl
      errors.jsonl
      snapshots/
      diagnostic-manifest.json
```

Object-store equivalent is acceptable.

Database stores searchable metadata/indexes, not necessarily every large snapshot.

Requirements:
- append-only event order,
- each JSONL record independently parseable,
- monotonically ordered sequence number where possible,
- trace readable even if execution never finalized,
- periodic flush in TRACE mode,
- immediate flush on ERROR/FATAL,
- startup/shutdown/crash handlers flush best-effort buffered events,
- bounded in-memory ring buffer may supplement persistence but must not be the only TRACE record,
- retention configurable,
- cleanup must never delete scientific/audit provenance accidentally.

For a run, diagnostics are linked from Run Detail but are not part of immutable scientific output hashes unless explicitly specified. Debug logs may contain nondeterministic timestamps and are not used to calculate scientific results.

## 9. Redaction and safety

"Full logging" means full execution evidence, NOT secrets.

Redaction occurs BEFORE data reaches persistent logs, UI, diagnostic bundles or external telemetry.

Never persist:
- access/refresh tokens,
- passwords,
- API keys,
- OAuth authorization codes,
- secret cookies,
- raw credential headers,
- encryption keys.

Implement a central redaction layer with:
- known secret-field registry,
- header redaction,
- credential serializers that cannot reveal secret values,
- payload size limits,
- configurable field allow/deny rules,
- tests containing canary secrets proving no sink receives them.

Where sensitive payload content is required for debugging, prefer redacted structured subset, hash, length/type/schema, or explicitly permitted local snapshot storage with warning and retention policy.

Do not solve confidentiality by disabling useful non-secret diagnostic context.

## 10. Debug Console in the application

Developer/Admin UI MUST include an operational Debug Console.

Global entry:
`Settings -> Diagnostics` or a dedicated Developer/Debug navigation item when enabled.

Run-specific entry:
`Run Detail -> Debug`.

Required views:

### Live Trace
Ordered event stream with auto-scroll/pause and filtering.

### Timeline
Hierarchical trace/span/step timeline showing durations, parent-child relationships, retries and failures.

### State
Before/after/input/output/failure snapshots for selected step, with structured JSON viewer and diff where both before/after exist.

### Errors
Error envelopes, stack traces and expandable cause chain. Clicking an error navigates to the exact event/span and surrounding context.

### Requests
Safe frontend/API/provider calls: request IDs, method/endpoint identity, parameters, timing, status, retries and safe response diagnostics.

### Worker
Queue/job lifecycle, enqueue/dequeue/attempt/retry/worker identity/heartbeat where available.

### Persistence
Relevant DB/object-store operations and artifact writes.

### Config
Exact effective configuration, config hash, preset, adapter/analyzer versions, feature flags, build/git commit and environment fingerprint.

### Raw Events
Machine-readable JSONL/JSON view with filtering by trace/request/run/job ID, component, operation, level, event type, time, sequence and error code.

Developer UI must provide:
- copy event/error JSON,
- copy correlation IDs,
- download diagnostic bundle,
- open linked manifest/artifact,
- jump to previous/next event,
- show surrounding N events.

Do not hide important failure details behind a generic toast.

## 11. Diagnostic bundle

One action must produce a self-contained redacted bundle suitable for giving to an AI coding agent.

Example:

```text
diagnostic-bundle-<trace_id>.zip
  diagnostic-summary.json
  events.jsonl
  errors.jsonl
  effective-config.json
  run-manifest.json
  environment.json
  versions.json
  snapshots/
  safe-request-response/
  artifact-index.json
```

`diagnostic-summary.json` should point directly to:
- first observed failure,
- final observed failure,
- failing component/operation based on factual event location,
- error/cause IDs,
- last successful step,
- last state snapshot,
- relevant correlation IDs.

The summary may organize facts but MUST NOT invent a root cause not supported by recorded evidence.

## 12. Frontend-to-backend correlation

The browser must generate or receive a correlation identifier and propagate it on API calls.

Backend response/errors must return safe correlation IDs so the UI can link the failure directly to Debug Console records.

Frontend Error Boundaries and global unhandled-rejection/error handlers should emit diagnostic events in TRACE mode.

If an API request triggers a run/job:
- frontend request trace links to API trace,
- API trace links to run/job,
- worker trace links back to the enqueue parent.

A developer must be able to start from a visible failed button/action and follow the chain through backend and worker.

## 13. Performance behavior

TRACE mode is intentionally expensive and optimized for diagnosis, not throughput.

Rules:
- make overhead explicit,
- allow payload/snapshot size caps,
- allow component-level filters,
- allow sampling only in NORMAL mode; do not silently sample an explicitly traced run in TRACE mode,
- allow `trace_this_run=true` to force exhaustive tracing for a selected run even if global mode is NORMAL, subject to policy,
- production default should normally be NORMAL or ERRORS, not TRACE.

Turning TRACE off must not change scientific/application behavior other than diagnostic side effects/performance.

Add a test proving results are identical with TRACE on and off for deterministic offline runs.

## 14. Implementation order

The diagnostic spine must exist BEFORE most feature implementation.

Minimum order:
1. config enum/mode and validation,
2. correlation context,
3. structured event schema,
4. central logger/tracer API,
5. redaction layer,
6. JSONL/dev diagnostic sink,
7. exception/error envelope capture,
8. instrumentation helpers/decorators,
9. backend request middleware,
10. worker context propagation,
11. frontend request/error correlation,
12. Debug Console basic event/error viewer,
13. diagnostic bundle export,
14. only then expand feature modules while instrumenting every boundary.

Every later module must add trace instrumentation and corresponding failure tests as part of its Definition of Done.

## 15. Required failure-injection tests

Create deterministic tests that intentionally fail every important boundary.

At minimum inject:
- invalid config,
- validation error,
- unauthorized/forbidden request,
- DB unavailable,
- DB constraint failure,
- object store unavailable,
- missing object,
- queue unavailable,
- worker exception,
- worker cancellation,
- provider 401,
- provider 403,
- provider 429,
- provider 500,
- timeout,
- DNS/network-style failure fixture,
- malformed JSON,
- provider schema drift,
- normalization exception,
- missing scientific input,
- analyzer exception,
- export failure,
- summary provider failure,
- frontend API failure,
- frontend render/error-boundary failure.

For EACH injected failure assert:
1. user-facing operation does not appear successful,
2. stable error code exists,
3. trace/error is persisted,
4. component and operation are known,
5. immediate exception/cause is preserved,
6. prior relevant events are available,
7. failure state snapshot exists when safe/possible,
8. correlation IDs link UI/API/run/job/worker as applicable,
9. Debug Console can locate it,
10. diagnostic bundle contains the evidence,
11. canary secrets do not appear in any diagnostic sink.

## 16. Definition of Done for debuggability

- [ ] one deployment setting switches `OFF/ERRORS/NORMAL/TRACE`
- [ ] TRACE requires no source-code edits to enable/disable
- [ ] every major layer uses common trace API
- [ ] browser/API/service/worker correlation works
- [ ] ordered micro-step events are persisted
- [ ] relevant before/after/failure state snapshots exist
- [ ] full stack trace and nested cause chain are retained
- [ ] provider/repository boundaries expose safe diagnostics
- [ ] debug record remains readable after failed/incomplete run
- [ ] Debug Console shows live/raw/timeline/errors/state/config
- [ ] run detail links directly to its trace
- [ ] one-click redacted diagnostic bundle works
- [ ] TRACE on/off does not alter deterministic scientific results
- [ ] failure injection suite proves first-occurrence forensic evidence
- [ ] canary-secret tests prove redaction before every sink
- [ ] retention/cleanup behavior is documented and tested
