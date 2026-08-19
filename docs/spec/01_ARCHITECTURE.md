# Architecture

## Stack

| Layer | E1 choice | Target (E3+) |
|---|---|---|
| Language | TypeScript, Node 20+, strict mode | unchanged |
| Backend | Fastify or the framework already present in the repo | unchanged |
| Frontend | React + Vite, or whatever the repo already uses | unchanged |
| Relational store | SQLite via `better-sqlite3` | PostgreSQL |
| Blob store | local content-addressed directory | S3-compatible object store |
| Columnar analytics | none needed | Parquet + DuckDB |
| Queue | in-process, sequential | real worker process |
| Method execution | in-process TypeScript executor | plus Python sidecar executor |
| Tests | Vitest | unchanged |

Do not introduce a dependency that is not needed by the current epic. Every dependency is a
thing that can break at 2am with no maintainer awake.

## Layers

Dependencies point downward only. A violation is a bug, not a style issue.

```
  ui/            React components, charts, forms. No computation. No fetch logic.
  api/           HTTP transport, validation, error mapping. No science.
  services/      Use-case orchestration, run lifecycle, manifests, exports.
  domain/        Pure types and invariants. No I/O. No imports from below.
  analysis/      MethodSpec, primitives, executors. Deterministic. No I/O.
  adapters/      Source and provider implementations. Vendor SDKs stop here.
  repo/          Persistence. All SQL. All filesystem. Nothing else touches storage.
  diag/          Tracing, redaction, diagnostic sinks. Callable from every layer.
```

`domain` and `analysis` must be importable in a test with no database, no network and no
filesystem. If they are not, the boundary has leaked.

## Core protocols

These are the seams that make later decisions cheap. Implement them at E1 even where only one
implementation exists.

### SourceAdapter

```ts
interface SourceAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  capability(): SourceCapability;
  validateParams(params: unknown): ValidatedParams;
  fetch(request: SourceRequest): Promise<RawFetchResult>;
  normalize(raw: RawFetchResult): Observation[];
  provenance(raw: RawFetchResult): ProvenanceMetadata;
}

interface SourceRequest {
  renderedQuery: string;
  dimension: string;          // e.g. "popularity" | "harm" — see note below
  language: string;           // e.g. "nl" | "pl" | "en" — explicit, never inferred
  queryExpansionMode: string; // STRICT_CANONICAL | SCIENTIFIC_SYNONYMS
                               // | LOCALIZED_SYNONYMS | EXPERIMENTAL_SLANG_EXPANSION
  presetId: string;
  presetVersion: string;
}
```

Provider SDK objects never escape the adapter boundary. `RawFetchResult` carries bytes and
metadata, not vendor response objects.

**An adapter is semantically neutral by construction.** `dimension` — whether a query is
measuring popularity, harm, or any other research axis a future preset defines — is decided
once, upstream, by the preset/MethodSpec/query plan that renders `renderedQuery`, and is passed
into the adapter as an explicit field on `SourceRequest`. The same holds for `language` and
`queryExpansionMode` (D15, full vocabulary in
`12_DRUG_DOMAIN_ONTOLOGY_AND_ASSERTIONS.md`): a query rendered in Dutch is a different
measurement plan from the same query in Polish, and expanding to slang or market labels is a
different plan from strict canonical naming — both decided upstream, carried explicitly, never
detected by inspecting the rendered string. `fetch` and `normalize` copy all three fields onto
the resulting `Observation`; none is re-derived by pattern-matching the query string (checking
whether it contains "harm", or guessing a language from character set, for instance). This
applies to every
implementation of this protocol, present and future — the E1 `FixtureSourceAdapter` as much as
any live SERP adapter added in E3 — because the failure mode is the same regardless of which
concrete adapter it happens in: an adapter that infers meaning from the text it is asked to
fetch has quietly taken over a decision that belongs to the preset, and two presets that
happen to render similar-looking query text would then risk being silently misclassified.

*Provenance: this constraint was flagged externally after the rest of this package was drafted
and is recorded here because the catch was correct, not because of where it came from — verify
independent suggestions on their merits and fold them into the durable spec, never only into a
one-off prompt, or the next session never sees them.*

E1 ships exactly one: `FixtureSourceAdapter`, reading frozen JSON from `fixtures/`. Its fixtures
carry `dimension` as stored fixture metadata, not as something the adapter guesses from the
fixture's query string, so the constraint is exercised even though E1 never calls a network.

### MethodExecutor

```ts
interface MethodExecutor {
  readonly executorId: string;
  readonly executorVersion: string;
  supports(spec: MethodSpec): boolean;
  execute(spec: MethodSpec, inputs: TypedSeries[]): Promise<AnalysisArtifact>;
}
```

The executor is pure with respect to its inputs: same spec, same series, same bytes out.
No clock reads, no random, no locale-dependent formatting, no unordered iteration.

### IdentityProvider

```ts
interface Principal { id: string; email: string | null; roles: string[]; identityProvenance: string; }
interface IdentityProvider { resolve(request: Request): Promise<Principal>; }
```

E1: `LocalUserIdentityProvider` returns
`{ id: "local-user", email: null, roles: ["owner"], identityProvenance: "local-constant" }`.

### Repository

One interface per aggregate: `StudyRepo`, `RunRepo`, `ArtifactRepo`, `SeriesRepo`,
`BlobStore`, `ManifestRepo`, `ReplicationRepo`. Each has a SQLite implementation at E1 and is
constructed at composition root. Nothing constructs a repository inline.

### ProviderRegistry

See `05_PROVIDERS_AND_CAPABILITIES.md`. E1 registers no live providers; the registry exists
with a fixture provider so the shape is exercised.

## Run lifecycle

```
CREATED → VALIDATING → QUEUED → RUNNING → NORMALIZING → ANALYZING → EXPORTING → COMPLETED
```

Any active stage may transition to `FAILED`. Cancellation goes to `CANCELLED`. Finalised runs
are immutable except for append-only audit metadata. A correction is a new run with
`supersedes_run_id` set — never an edit.

If normalisation fails after raw bytes are stored, the raw bytes are retained and the run is
marked failed. Evidence is never discarded because a later stage broke.

## Configuration

All configuration is JSON or YAML, schema-validated at load, canonicalised, then hashed. The
hash of the effective configuration is recorded in every run manifest. Two configurations that
are semantically equal hash equally — canonicalise key order and number formatting before
hashing.

Invalid configuration fails at startup, loudly, with the failing path and the schema rule.
Never fall back to a default when configuration is present but wrong.

Config lives under `config/`:

```
config/core/application.json        runtime, diagnostics mode, paths
config/presets/jh2016-faithful.json locked scientific preset
config/providers/providers.json     capability/provider/credential references
config/methods/registry.json        method primitives and their contracts
config/reference/nutt-2010.json     versioned reference harm scores
```

Secrets are never in config files. Environment or secret store only; `.env.example` carries
names, never values. A secret is never returned by an API after being saved, never written to
a manifest, never written to a log.

## Error taxonomy

Stable machine-readable codes, exposed to the client; provider detail stays in the diagnostic
stream.

`validation_error`, `authorization_error`, `approval_required`, `source_auth_error`,
`source_rate_limit`, `source_timeout`, `source_schema_change`, `normalization_error`,
`scientific_input_error`, `method_spec_invalid`, `analysis_error`, `storage_error`,
`export_error`, `cancellation`.

Every error carries the correlation identifiers from `06_DIAGNOSTICS.md` and its full cause
chain.

## Repository layout

Target shape. Adapt to what exists rather than forcing a move; note deviations in E0.1.

```
src/
  api/        routes, request validation, error mapping
  services/   run orchestration, manifest assembly, export
  domain/     types, invariants, state machines, errors
  analysis/   methodspec, primitives, executors, jh2016 analyzer
  adapters/   sources/, providers/
  repo/       sqlite/, blobstore/, migrations/
  diag/       tracer, redaction, sinks, bundle
  ui/         react app
config/
fixtures/     frozen source responses, golden outputs
docs/spec/    this specification
tests/
runs/         gitignored; run output directories
```
