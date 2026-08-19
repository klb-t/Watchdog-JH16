# WatchDog — agent operating contract

This file is loaded automatically at the start of every Claude Code session. Read it fully
before touching anything. Then read `docs/spec/00_STATE_AND_DECISIONS.md`.

WatchDog is a reproducible research platform for monitoring psychoactive-substance signals.
Its first scientific benchmark is a replication of Jankowski & Hoffmann 2016
(JMIR, doi:10.2196/jmir.4033). The maintainer is a solo researcher working mostly from a phone.
Optimise for **an agent that can be left alone for hours and still produce inspectable,
correct, non-fabricated work.**

---

## 0. First action of every session

Do not trust this specification as a description of the repository. It describes intent.
The repository is the only source of truth about what exists.

Run, in order:

```bash
git log --oneline -20
git status
ls -R src 2>/dev/null | head -100
cat package.json
npm run 2>&1 | head -40        # what scripts actually exist
npm run test:all 2>&1 | tail -40
```

Then open `docs/spec/07_EPICS_AND_TASKS.md`, find the first task whose checkbox is unticked,
and verify by inspection whether it is in fact undone. If the ledger and the repository
disagree, **the repository wins** — correct the ledger in the same commit as the work.

Report the delta before starting work: what the ledger claims, what the repo shows, what
you are about to do.

## 1. Hard rules

These are not style preferences. Violating any one of them makes the output worthless for
its purpose, because the purpose is scientific evidence.

1. **No fabricated implementations.** A function that returns plausible-looking numbers
   without doing the work is worse than a missing function. If something cannot be
   implemented now, register it with status `planned` or `blocked` and make it throw
   `NotImplementedError` when called. Never let a stub reach a code path that produces
   a number a human might read as a measurement.
2. **No LLM in the numerical path.** Language models may propose method specifications and
   write narrative prose. They may never compute, adjust, round, interpolate or "sanity-check"
   a scientific value. Every number in every output traces to deterministic code operating on
   stored bytes.
3. **No hardcoded science.** Substance lists, query templates, formulas, thresholds, time
   windows, reference score sets, source names, export defaults and UI labels live in
   versioned, validated, hashed configuration. Business logic reads configuration; it does
   not contain the values.
4. **No silent unit, provider or method substitution.** Google Trends interest is not a
   result count. SerpApi is not Serper. Spearman is not Pearson. If a substitution happens,
   it is recorded in the manifest and flagged in the output.
5. **Missing is not zero.** Represent missingness explicitly at every layer: type, storage,
   analysis, export, chart.
6. **Immutable provenance.** Every run produces a manifest with content hashes of its inputs
   and outputs. Finalised runs are never mutated; corrections create a superseding run that
   references the original.
7. **Deterministic ordering.** Any iteration that reaches output is explicitly sorted. Two
   runs on identical input produce byte-identical artifacts.
8. **Tests before the next task.** A task is done when its stated test passes, not when the
   code looks right.

## 2. Anti-patterns that have already cost this project time

Recognise and refuse these.

- **Infrastructure before flow.** A previous attempt stalled for weeks debugging OAuth before
  a single feature worked end to end. Authentication is deferred to Epic E4 by explicit
  decision. Do not add it earlier, do not add "just a little" of it, do not suggest it.
- **Breadth before depth.** The archive contains a large number of ambitious features. E1 is
  one narrow vertical slice that works completely. Do not widen it.
- **Registry entries mistaken for implementations.** A source in the registry with status
  `planned` is a plan. Do not report it as a capability, do not count it in a progress
  summary, do not let the UI render it as available.
- **Rewrites.** Existing code from prior agent passes is to be inventoried and refactored, not
  discarded. If you believe a file must be replaced, say so explicitly with reasons and wait.

## 3. Working rhythm

- Work in small commits with messages of the form `E1.4: <what changed>`.
- After each task: run the task's test, tick the box in `docs/spec/07_EPICS_AND_TASKS.md`,
  commit both together.
- If you are blocked, write the blocker into `docs/spec/07_EPICS_AND_TASKS.md` under
  `## Blocked` with enough detail that a human can unblock it in one action, then move to the
  next unblocked task rather than waiting.
- Keep `docs/spec/00_STATE_AND_DECISIONS.md` current. It is what the next session reads.

## 4. When to stop and ask

Ask the maintainer only for decisions that are genuinely his — not for permission to proceed.

Ask about: paid API credentials and spending; anything touching real personal or medical data;
a scientific-methodology change to a locked preset; a proposed rewrite of existing code;
a conflict between two specification files that you cannot resolve by precedence.

Do not ask about: naming, file layout, library choice within the declared stack, test
structure, refactors that preserve behaviour, or which task to do next — the ledger answers
that.

## 5. Requirement precedence

When specifications conflict, higher wins:

1. `docs/spec/03_JH2016_CONTRACT.md` — locked scientific invariants
2. Provenance, reproducibility and data-integrity contracts
3. `docs/spec/00_STATE_AND_DECISIONS.md` — current architectural decisions
4. Data and API contracts
5. UI and presentation
6. Implementation convenience

Never weaken a higher contract to make a lower one easier.

## 6. Map of the specification

| File | Contains |
|---|---|
| `docs/spec/00_STATE_AND_DECISIONS.md` | Where the project is; every binding decision and why |
| `docs/spec/01_ARCHITECTURE.md` | Stack, layers, module boundaries, protocols |
| `docs/spec/02_DATA_MODEL.md` | Entities, provenance, storage rules |
| `docs/spec/03_JH2016_CONTRACT.md` | Locked replication methodology |
| `docs/spec/04_METHOD_COMPILER_AND_APPROVAL.md` | Prose → MethodSpec, approval gate |
| `docs/spec/05_PROVIDERS_AND_CAPABILITIES.md` | Capability/Provider/Credential, discontinuity |
| `docs/spec/06_DIAGNOSTICS.md` | Flight recorder, TRACE mode, debug console |
| `docs/spec/07_EPICS_AND_TASKS.md` | **The ledger.** Current work, in order, with tests |
| `docs/spec/08_REPLICATION_ENGINE.md` | Replication as a first-class object |
| `docs/spec/09_TESTS.md` | Test taxonomy and required tests |
| `docs/spec/10_EVIDENCE_TIER_AND_TRUST_UI.md` | Colour-coded evidence tiers; two-axis design; UI convention |
| `docs/spec/11_FIELD_AND_CLINICAL_INTERFACES.md` | Epic E6: responder card, symptom search, pill ID |
| `docs/spec/12_DRUG_DOMAIN_ONTOLOGY_AND_ASSERTIONS.md` | Assertion model, predicate vocabulary, market-label/misrepresentation query |
