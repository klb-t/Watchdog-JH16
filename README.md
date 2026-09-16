# WatchDog

A reproducible-research platform for monitoring psychoactive-substance signals. Its first
scientific benchmark is a replication of Jankowski & Hoffmann 2016
([JMIR 18(2):e38](https://doi.org/10.2196/jmir.4033)).

**Status: active continuation on `astra/watchdog-continuation-20260908`, draft PR #1.**
Implemented workflows include the JH16 fixture benchmark, responder reference lookup,
scientific figures and maps, durable public acquisition, substance memory, personal provider
profiles and the paper/extraction workshop. The benchmark runs end to end offline:

```
fixture source → observations → method (proposed → approved) → deterministic compute
              → charts → narrative (proposed → approved) → export → manifest → verdicts
```

## Quick start

```bash
npm install
npm run demo:jh16     # the whole slice, offline, no credentials
npm run test:all      # typecheck, production build and tests (Chromium required)
npm run dev           # http://localhost:3000 — then open /setup
```

Nothing above needs an API key, a Google account or a cloud project. Adding those switches on
more; it is never required to run what exists.

`demo:jh16` writes a complete run directory under `runs/<run-id>/`:

| Path | What it is |
|---|---|
| `manifest.json` | the scientific claim: config hash, every fetch, every flag, every missing value |
| `observations.json` | normalized observations with explicit missingness |
| `analysis.json` | Pi and Hi with the method-spec hash and executor version |
| `replication.json` | verdicts against the pre-registered tolerance bands |
| `charts/*.json` | chart specs; missing points carry `treatAsZero: false` |
| `exports/results.{csv,json}` | exports from stored results — never recomputed |
| `raw/<sha256>.json` | content-addressed copies of the raw fixture responses |
| `trace/events.jsonl` | the run's diagnostic record |

Run it twice: the two directories are byte-identical apart from the run id and timestamps.

The application home page asks what you want to do and links to available workflows:

| Workflow | Guide |
|---|---|
| Personal keys, simple/standard/expert/debug settings and JH16 wizard | [Personal setup](docs/PERSONAL_SETUP.md) |
| Sixteen text endpoints and seven separately routed tasks | [Provider profiles](docs/PERSONAL_PROVIDERS.md) |
| Daily/interval acquisition, literature and substance/receptor memory | [Automation and memory](docs/AUTOMATION_AND_MEMORY.md) |
| Figures, maps, saved settings and reproducible publication exports | [Visual workbench](docs/WORKBENCH.md) |
| Paper methodology, data variants, deterministic parser tests and source-to-statistics handoff | [Research workshop](docs/RESEARCH_WORKSHOP.md) |

Public-source collection and manual JSON/CSV extraction work without an LLM key. Personal
model calls require a valid key and price/budget coverage. A provider profile is protocol
support, not proof that every vendor feature or paid account has been integration-tested.

## What it currently does

The JH16 benchmark reproduces every `Pi` and `Hi` value the paper published, from the paper's own Tables 1 and 3,
through a declarative `MethodSpec` over seven registered primitives — not through bespoke
arithmetic.

**On the replication verdicts, read this before quoting them.** The fixture attempt is labelled
`pipeline_self_check`, and that label is doing real work. Its inputs *are* the paper's published
counts, so `reproduced` means "this pipeline computes what the paper computed from the same
numbers". It is **not** evidence that the finding holds against data collected today — only an
attempt over independently acquired counts (Epic E3) can speak to that, and the paper's own
Table 2 shows individual popularity indices drifting by up to +567% across 25 months.

## The rules the code is built to obey

From `CLAUDE.md` and `docs/spec/`. These are not style preferences; each has tests that fail if
it is violated.

1. **No fabricated implementations.** A planned capability throws `NotImplementedError`. It never
   returns a plausible number.
2. **No LLM in the numerical path.** Models may propose method specs and write prose. They never
   compute, adjust or round a scientific value.
3. **No hardcoded science.** Substance lists, query templates, formulas, thresholds and reference
   scores live in versioned, hashed configuration under `config/`.
4. **No silent substitution.** Google Trends interest is not a result count, and the registry says
   so in its data. Query `dimension`, `language` and expansion mode travel from the preset; an
   adapter may never infer them from query text.
5. **Missing is not zero.** Enforced at the type level, by SQL `CHECK` constraints, in analysis, in
   exports, and in charts — where a missing bar is drawn as a labelled placeholder, because an
   absent bar is indistinguishable from a zero-height one.
6. **Immutable provenance.** Every run writes a manifest; finalised runs are never mutated.
7. **Deterministic ordering.** Two runs on identical input produce byte-identical artifacts.
8. **Human approval is hash-bound.** Approval stores the hash it approved, so editing approved
   content reverts it to `PROPOSED` with no action taken — a comparison, not a flag someone must
   remember to clear.

## Layout

```
backend/watchdog_api/
  domain/       pure types and invariants — no I/O, enforced by a test on the import graph
  analysis/     primitives, MethodSpec validation, the deterministic executor
  sources/      SourceAdapter protocol, fixture source, capability/provider registries
  services/     orchestration, manifest, charts, narrative, export, replication
  db/           migrations, schema, repositories — the only place SQL lives
  utils/        tracer, redaction, error envelopes, zip
  api/          HTTP routes
  diag/         diagnostic bundle
src/            React UI (Study → Method review → Results)
config/         presets, methods, reference scores, replication targets
fixtures/jh2016/ the 32 frozen queries plus four deliberate edge cases
docs/spec/      the binding specification; 07_EPICS_AND_TASKS.md is the ledger
```

## Where to look first

- `docs/spec/07_EPICS_AND_TASKS.md` — the ledger: what is done, what is next.
- `docs/spec/00_STATE_AND_DECISIONS.md` — binding decisions and continuation checkpoints.
- `docs/ASTRA_PROGRESS.md` — observed test, CI and publication evidence by milestone.
- `docs/spec/03_JH2016_CONTRACT.md` — the locked scientific invariants. Highest precedence.
- `docs/DEPLOY_GCP.md` — deploying to Cloud Run, written for someone who has not used GCP.
- `docs/AUDIT.md` — the historical E0 audit of the inherited codebase.

## Source-linked paper analyses

The Research workshop can now bind a unique source quote (or a saved assessment operation)
to columns of an approved dataset, review the exact method, execute it without an LLM and
export a verifiable research package. This currently covers one descriptive, Pearson or
Spearman operation over all dataset rows. It preserves missingness, data substitutions and
unresolved paper requirements; it does not establish whole-paper replication.
See [the paper analysis guide](docs/PAPER_ANALYSES.md).

## Live providers, sign-in and deployment

Added under D17 because they are what the maintainer tests on first. Everything is derived from
credential state on every read, so removing a key takes a provider out of service with no
invalidation step, and the **Setup** page answers "why can't I run this yet?" with the exact
variable to set — never with the word "unavailable".

| | State | Switch on with |
|---|---|---|
| Google sign-in and capability bundles (including researcher/responder) | built | `GOOGLE_OAUTH_CLIENT_ID` + `WATCHDOG_GRANTS` + `SESSION_SIGNING_KEY` |
| Sixteen personal text provider profiles | built, bounded text protocols | Own key in Setup; direct providers also need reviewed price profiles |
| Operator OpenRouter / configured OpenAI-compatible generator | built | `OPENROUTER_API_KEY` and provider configuration |
| SerpApi live result counts | built | `SERPAPI_API_KEY` |
| GCS blob store | built | `STORE_BACKEND=gcs` + `GCS_BUCKET` |
| Cloud Run container and runbook | built | [`docs/DEPLOY_GCP.md`](docs/DEPLOY_GCP.md) |
| PostgreSQL | **not built, on purpose** | see `## Blocked` in the ledger |

Two startup checks refuse to boot rather than warn: a production instance with no
authentication, and one whose data would not survive a restart. Both have explicit waivers,
and neither state is reachable by forgetting a variable.

`tests/integration/live_path.test.ts` drives the credentialled path against stub providers over
real HTTP — real sockets, the real config loader, the adapters' own `fetch`. What separates it
from a live run is the value of two environment variables.

Two rules survive the arrival of live providers:

- **A model never computes.** Generated prose is checked against the deterministic summary and
  **rejected outright** if it contains a figure the frozen payload does not — including a
  rounded one, since `15.2` is a different number from `15.17`. A test on the import graph
  proves the analysis layer cannot reach a text generator at all.
- **A failure is never a zero.** A throttle, an exhausted quota, a rejected key and an
  unparseable body are four distinct `missing_reason` values, because they are four different
  things for an operator to do.

## Not built yet

General paper-to-executable-method compilation and autonomous arbitrary replication remain
open. The intake/workshop records proposals and exact extraction trials; it does not infer
replication success from a paper abstract. Further scope includes advanced spatial/causal
statistics, live Trends connectors, generated adapter sandboxing, direct-provider price feeds,
semantic benchmark execution and evidence-backed paper drafting. Public substance population
is bounded and partial; it is not an exhaustive receptor or regional clinical database.
See the current ledger and [product requirements](docs/PRODUCT_PRINCIPLES_AND_NEXT.md).
