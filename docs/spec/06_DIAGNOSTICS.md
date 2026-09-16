# Diagnostics — development flight recorder

## Purpose

An engineer or an agent debugging this system must be able to read what actually happened,
not infer probabilistically from a final exception.

The target acceptance criterion: **a single occurrence of a failure leaves enough forensic
state to identify the direct cause without re-running.** Not always physically achievable —
a hard host crash defeats it — but the architecture is optimised for that case rather than for
attractive logs.

This is an investment in unsupervised agent work. Implement it early, as E1 task group 2,
before feature-heavy work.

## Operating modes

`OFF` | `ERRORS` | `NORMAL` | `TRACE`

Set by configuration or environment: `WATCHDOG_DIAGNOSTICS_MODE=TRACE`. Changing mode requires
no source edit, no rebuild, no removal of instrumentation. Production runs `NORMAL` or
`ERRORS`; development runs `TRACE`.

A single run may be forced into `TRACE` while the deployment stays at `NORMAL`.

`TRACE` is deliberately expensive. That is acceptable; it is a development mode.

## Instrumentation model

Not ad-hoc `console.log`. A central diagnostics API, callable from every layer:

```ts
await trace.step(
  "acquisition.fetch_provider",
  { runId, component: "fixture_adapter", state: { query: safeQueryMetadata } },
  async (step) => {
    step.event("request_prepared", { ... });
    const result = await doWork();
    step.stateAfter({ ... });
    return result;
  }
);
```

Every event automatically receives correlation context. Required identifiers:

`trace_id`, `span_id`, `parent_span_id`, monotonic `sequence_no`, `request_id`, `run_id`,
`job_id`, actor or service identity, `session_id` where applicable, component, operation,
stage, build version and git commit, UTC timestamp with high resolution.

## Event vocabulary

Each meaningful micro-step emits, in order:

```
STEP_ENTER → STATE_BEFORE → INPUT → VALIDATION → DECISION → TRANSFORM/CALL → RESULT
           → STATE_AFTER → STEP_EXIT
```

On failure:

```
EXCEPTION → full stack → cause chain → STATE_AT_FAILURE
```

`DECISION` events record which branch was taken **and the value that determined it**. This is
the single highest-value event type for debugging and the one most often omitted.

The goal is that a reader can say:

```
event 417: parser received X
event 418: took branch B because Y
event 419: state moved from A to C
event 420: repository received C
event 421: constraint Z raised
```

rather than "possibly the database, possibly the parser".

## State snapshots

In `TRACE`, capture relevant structured state before, after, and at failure for: run
orchestration, source adapters, normalisation, analysis, persistence, and the frontend-backend
boundary.

Snapshots are structured data, not string dumps. Large payloads are stored by hash with a
size-bounded preview.

## Errors and cause chains

Never swallow, never re-throw bare. Every error carries: stable code from the taxonomy, full
stack, the complete `cause` chain to the root, the correlation context, and the state at
failure. An error crossing a layer boundary is wrapped, preserving the cause.

## Persistence

`TRACE` events go to an append-oriented diagnostic stream that remains readable after a failed
or incomplete run. A run that dies mid-way must leave its trace behind — this is the primary
scenario, not an edge case.

Context propagates: browser → API → service → queue → worker → adapter, repository, analyser,
exporter.

## Redaction

A central redaction layer runs before every sink, without exception. It knows credential-shaped
keys, authorization headers, and configured secret names.

Tested with a canary: a known secret value is injected into configuration and asserted absent
from every sink — trace stream, logs, manifest, diagnostic bundle, error envelope. This test
runs in CI.

## Debug console

An in-app view reading the same diagnostic record. Tabs: Live Trace, Timeline, State (with
before/after diff), Errors (with full cause chains), Requests, Worker, Persistence, effective
Config, Raw Events.

## Diagnostic bundle

One click produces a ZIP containing: the run's trace stream, the effective configuration, the
manifest if one exists, artifact hashes, environment and dependency fingerprint, and the error
envelope. Redacted, and safe to hand to an agent or attach to an issue.

This is how a maintainer working from a phone hands a failure to Claude Code with no further
explanation.

## Failure-injection tests

Required. Each asserts the failure is diagnosable from one stored trace, without re-running:

| Injected failure | Must be identifiable from trace |
|---|---|
| adapter returns malformed payload | which field failed which validation rule |
| provider times out | which provider, at which stage, after how long |
| analysis divides by a zero count | which substance, which step, which input value |
| repository constraint violation | which row, which constraint, which prior state |
| worker dies mid-run | how far the run got and which step was in flight |
| approval gate rejects | which artifact, which hash mismatch |

## Definition of done

A deliberately failing fixture run, crossing API → service → worker → adapter → repository, is
fully diagnosable from a single stored trace with no re-run, and the canary secret appears
nowhere.
