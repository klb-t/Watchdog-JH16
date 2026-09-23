# WatchDog

Reproducible-research platform for monitoring psychoactive-substance signals, with explicit provenance, deterministic analysis and human-reviewed scientific interpretation.

The first benchmark is a replication pipeline for Jankowski & Hoffmann (2016), JMIR 18(2):e38.

**Status:** active development. Latest continuation context: [September 22 handoff](docs/HANDOFF_2026-09-22.md). `main` is the canonical consolidated branch. The current code includes an end-to-end offline JH16 fixture benchmark plus working research, acquisition, responder-reference and visualisation paths. Planned capabilities are kept separate from implemented behavior.

## Quick start

**Existing GCP virtual machine:** use the [Cloud Shell installer](docs/DEPLOY_GCP_VM.md).
It configures a private IAP tunnel, dependencies, persistent storage and restart/update handling.

```bash
npm install
npm run demo:jh16     # end-to-end JH16 fixture slice; no credentials required
npm run test:all      # typecheck, tests and production build
npm run dev           # local application
```

The offline benchmark does not require an API key, Google account or cloud project.

A demo run writes a reproducible artifact set under `runs/<run-id>/`, including the manifest, normalized observations, deterministic analysis, replication verdicts, chart specifications, exports, content-addressed raw responses and diagnostic trace.

## What is implemented

- JH16 fixture benchmark through a declarative `MethodSpec` and deterministic executor;
- immutable run manifests and content-addressed raw artifacts;
- explicit missingness and source/provider provenance;
- research-method review and hash-bound approval;
- publication-oriented charts, maps and exports;
- public acquisition and registered source adapters;
- substance/reference memory and responder lookup;
- personal provider profiles and bounded text-generation integrations;
- paper/extraction workshop paths that keep model-generated prose outside the numerical computation path;
- local SQLite/file persistence and deployment support for durable cloud storage;
- tests covering scientific invariants, import boundaries and live-provider integration paths.

## Scientific guardrails

The repository is built around a few rules that matter more than framework choice:

1. **No fabricated implementations.** Planned functionality must fail explicitly rather than return a plausible result.
2. **No LLM in the numerical path.** Models may propose methods or prose; deterministic code computes scientific values.
3. **No hardcoded science.** Queries, formulas, thresholds and reference values live in versioned configuration.
4. **No silent substitution.** Different source dimensions are represented as different data, not treated as interchangeable.
5. **Missing is not zero.** This is enforced from persistence through analysis, export and visualisation.
6. **Immutable provenance.** Finalised runs and their manifests are not silently rewritten.
7. **Human approval is content-bound.** Approval records the hash of what was approved.

The binding details live under `docs/spec/`.

## Repository layout

```text
backend/watchdog_api/
  domain/       types and invariants
  analysis/     primitives, method validation and deterministic execution
  sources/      source adapters and provider registries
  services/     orchestration, manifests, charts, narrative and export
  db/           schema, migrations and repositories
  api/          HTTP routes
  diag/         diagnostic bundle support

src/             React UI
config/          versioned scientific/configuration inputs
fixtures/jh2016/ frozen benchmark inputs
docs/spec/       binding specification and work ledger
tests/           unit, integration and scientific-invariant tests
```

## Where to look first

- `docs/spec/07_EPICS_AND_TASKS.md` — current implementation ledger.
- `docs/spec/00_STATE_AND_DECISIONS.md` — binding decisions and checkpoints.
- `docs/ASTRA_PROGRESS.md` — observed implementation/test evidence from the Astra continuation.
- `docs/spec/03_JH2016_CONTRACT.md` — locked JH16 scientific invariants.
- `docs/PAPER_ANALYSES.md` — source-linked paper-analysis workflow.
- `docs/PRODUCT_PRINCIPLES_AND_NEXT.md` — product constraints and next work.
- `docs/internal/LEGACY_AGENT_HANDOFF_2026-08-16.md` — historical development handoff retained for provenance, not current instructions.

## Live integrations

Live providers are optional. Depending on configuration, the project supports Google sign-in/capability grants, personal model providers, OpenRouter/OpenAI-compatible generation, SerpApi result counts, GCS object storage and Cloud Run deployment.

Provider support means the protocol path exists; it does not imply every vendor/account combination has been integration-tested.

## Not built yet

The project does not yet claim autonomous arbitrary-paper replication, general paper-to-executable-method compilation, advanced spatial/causal statistics, exhaustive live Trends integration, generated-adapter sandboxing or a complete evidence-backed drafting system. The current research workshop is deliberately narrower than those goals.

## Licensing

WatchDog is **source-available**, not OSI open-source. Noncommercial use is licensed under the PolyForm Noncommercial License 1.0.0; see `LICENSE`.

Commercial use requires a separate written license; see `COMMERCIAL_LICENSE.md`.
