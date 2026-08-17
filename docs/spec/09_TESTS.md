# Tests

## Principle

Tests here are not a quality ritual. They are the mechanism by which an unsupervised agent's
output can be trusted. Every task in the ledger names its test; the task is done when that
test passes and not before.

CI must never require credentials or network. Every test in E1 runs offline.

## Layers

**Unit** — primitives, formulas, validators, state machines, hashing. Fast, pure, no I/O.

**Contract** — every implementation of a protocol runs against a shared conformance suite. When
the second `SourceAdapter` or the Python `MethodExecutor` arrives, the suite already exists and
the new implementation either passes or is not shipped.

**Golden** — frozen input, frozen expected output, byte-compared. The JH2016 fixture run is the
principal golden test.

**Property** — for invariants that must hold across inputs: missing never becomes zero,
outputs are ordered deterministically, hashing is stable under key reordering.

**Failure injection** — per `06_DIAGNOSTICS.md`. Each asserts the failure is diagnosable from
one stored trace without a re-run.

**E2E** — browser-driven, against fixtures.

## Required tests, by contract

### Scientific — `03_JH2016_CONTRACT.md`

All ten listed there. The exact-query golden test compares all 32 rendered query strings
byte-for-byte; a change to a query string must break the build.

### Provenance — `02_DATA_MODEL.md`

- a manifest contains every required field
- identical payloads share one blob row while fetch events stay distinct
- a finalised run cannot be mutated; a correction creates a superseding run
- every quality flag raised anywhere in a run appears in that run's manifest
- missing observations are enumerated in the manifest with reasons

### Approval — `04_METHOD_COMPILER_AND_APPROVAL.md`

- a `PROPOSED` artifact reaching the executor throws `ApprovalRequiredError`
- approving, then editing, reverts to `PROPOSED` with no explicit action taken
- no code path approves without a human action — assert by searching for callers of the
  approval function and asserting the set is exactly the API handler
- an unapproved narrative cannot reach an export

### Provider — `05_PROVIDERS_AND_CAPABILITIES.md`

- a series spanning two providers carries `PROVIDER_DISCONTINUITY`
- that flag reaches analysis output, exports and the manifest
- a `planned` provider cannot be selected for a run
- a discovered provider is unusable until approved
- fallback after a stored observation creates a new observation rather than replacing one

### Diagnostics — `06_DIAGNOSTICS.md`

- the canary secret appears in no sink
- the full failure-injection table
- a deliberately failed fixture run produces a bundle from which the direct cause is
  identifiable without re-running

### Determinism

- two runs of `demo:jh16` produce byte-identical artifacts apart from run id and timestamps
- semantically equal configurations hash identically
- every iteration reaching output is explicitly sorted

## Anti-fabrication test

Specific to this project and required from E0.2.

Assert that every registered capability with status `planned` or `blocked` throws
`NotImplementedError` when invoked, and that no function in `src/analysis` returns a numeric
value without reading from its inputs.

The failure mode this catches — a stub that returns a plausible number so a demo looks
complete — is the single most dangerous defect this codebase can have, because it produces
output that looks like evidence and is not.

## What not to test

Do not write tests that assert an implementation detail no contract mentions. They break on
every refactor and they train the agent to change tests rather than fix code.

Do not mock what can run for real. The fixtures exist so that the real code path runs offline.
A mocked adapter tests the mock.
