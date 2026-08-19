# WatchDog

A reproducible-research platform for monitoring psychoactive-substance signals. Its first
scientific benchmark is a replication of Jankowski & Hoffmann 2016
([JMIR 18(2):e38](https://doi.org/10.2196/jmir.4033)).

**Status: Epic E1 complete.** The vertical slice runs end to end, offline, on frozen fixtures:

```
fixture source → observations → method (proposed → approved) → deterministic compute
              → charts → narrative (proposed → approved) → export → manifest → verdicts
```

## Quick start

```bash
npm install
npm run demo:jh16     # the whole slice, offline, no credentials
npm run test:all      # lint + 126 tests + production build
npm run dev           # http://localhost:3000
```

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

## What it currently does

Reproduces every `Pi` and `Hi` value the paper published, from the paper's own Tables 1 and 3,
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
- `docs/spec/00_STATE_AND_DECISIONS.md` — every binding decision (D1–D16) and why.
- `docs/spec/03_JH2016_CONTRACT.md` — the locked scientific invariants. Highest precedence.
- `docs/AUDIT.md` — the historical E0 audit of the inherited codebase.

## Not built yet

Epics E2–E6, deliberately: the LLM method compiler, live acquisition with provider-discontinuity
detection, identity and RBAC, the generic workbench and autonomous replication engine, and the
field/clinical interfaces. The schema for the later ones exists and is empty on purpose — cheap
to seed now, expensive to retrofit — but nothing is built against it. See the epic table in
`00_STATE_AND_DECISIONS.md`.
