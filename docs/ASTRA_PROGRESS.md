# WatchDog continuation — 2026-09-08

Base: `claude/ai-studio-last-commit-gjqxy4` at
`8a5102e6ae72ea1ac9107b18987a5bbe51ad0a7c`, checked through GitHub and a real clone.
Work branch: `astra/watchdog-continuation-20260908`.

## Baseline and environment

- Read the operating contract, current spec, owner handoff and Programming Constitution.
- `npm ci` exposed missing optional-platform entries in the committed lockfile.
  `npm install` repaired those entries without changing the declared dependencies.
- This runtime has Node 24.19.0. SQLite compiled successfully against its official headers;
  the environment's tar ownership handling required extracting headers with `--no-same-owner`.
- Use `node --import tsx` rather than the tsx CLI: the latter's Unix IPC socket is unsupported
  here. TCP, SQLite and the application work. Test subprocesses use the same loader.
- Baseline: 231 tests attempted, **227 passed, 4 browser tests blocked** because no Chromium
  is installed. The browser download timed out. None were skipped or reclassified as passing.
- `demo:jh16`: 32 observations, 16 Pi/Hi results and both existing self-check verdicts reproduced.
  This remains a pipeline self-check, not independent replication.
- Lockfile consistency and production build verified after the installation repair.
- Docker executable/daemon and PostgreSQL server are absent. No live provider credentials used.

## Owner's sequencing correction

The owner explicitly prioritised the responder scenario during this session:
unknown pill description (e.g. green X) + region/time → matching tested samples → actual
composition → cited interactions. Complete this narrow vertical after its capability foundation;
do not delay it for the unrelated method compiler, worker or generic workbench.

Public alerts may lack specimen counts, laboratory methods, exact dates and local geography.
Missing values must stay missing. A national bulletin is not a city-level sample, and a visual
candidate never confirms the identity or composition of the pill in front of the responder.

## Checkpoints

Further verified changes and blockers are recorded with their task in the main ledger.

## 2026-09-08 — E6 responder/reference stage

Published baseline/roles in draft PR #1, based on the handoff branch. API publication retained
identical Git trees; remote commits are dcba295 (E0.6) and 4dfd8b0 (E4.2).

Implemented the reference import → individual hash-bound human review → responder lookup
path over the existing specimen/assertion graph. Repeated import events retain raw mapping
provenance; raw bytes deduplicate. No reference is approved at startup. The bundled Trimbos
and Jellinek mappings remain proposals, including explicit absent lab details and amounts.

Responder UI supports appearance (including reverse score line), market-group labels, source
symptom vocabulary, region/time filters, explicit broader context, specimen composition and
unknown components. Clinical source facts occupy twelve fixed categories with independent
source-tier, review and quality badges. Visual matches remain inferred even for lab references.
Conflicting sources remain visible. National alerts are not counted as sampled local prevalence.

Offline support uses a principal-bound, hash-checked snapshot with a maximum configured 8-hour
window, source retrieval ages, a static-only production service worker and an idempotent audit
outbox. Revocations cannot be checked offline; this is displayed. HTTP 401/403 erases cached
access. Logout clears this local cache/outbox; it is not a durable clinical record. No patient
identity fields are accepted. A full initial source review is still required before clinical use.

Validation so far: 238 unit/contract/scientific/integration tests passed, plus two subsequent
UI-render/offline-client tests. Type checking and production build passed. Browser-driven E2E
remains unverified locally: the cloud browser's localhost attempt was blocked and caused an
unwanted permission prompt on the maintainer's phone. That tab was closed; do not repeat the
localhost browser route. A GitHub Actions workflow now installs Chromium and runs the full
suite. Do not claim CI or browser success before reading its result.

Latest maintainer clarifications are recorded in spec/13_VISUAL_WORKBENCH.md: institutional
geographic/language/time/context/sentiment analysis, map and chart palettes/context menus,
favourites, publication figures, 3D/4+ channels, abstractions/data profiles and developer UI
diagnostics. These are accepted requirements; this stage does not claim they are implemented.

## 2026-09-09 — first visual workbench and developer diagnostics

The published E6 commit `d467c0d` passed GitHub Actions run `34268060616`, including the
full pre-workbench suite and JH16 demo. This verifies the previous browser tests; production
responder offline reload and the new workbench now have their own additional browser tests.

Implemented dataset import/review/sharing, the figure builder, 2D/3D/map renderers and channels,
source inspection, shared context/visible tools, favourite snapshots, approved exploratory
statistics, vector/data exports and developer diagnostics. `docs/WORKBENCH.md` documents actual
usage and limits; D19 records the owner's sequencing and profile/data architecture. Generic
workbench code imports no drug-specific configuration. A shared validated evidence palette
feeds both workflows. Profile and source identities are pinned; figures cannot silently switch
palettes/data or attach unrelated analysis results. Statistical runs now persist in the existing
analysis and manifest tables with complete replay inputs and checksums.

Local regression: 253 tests attempted; 252 passed and one repository-boundary assertion found
a driver type import in the diagnostic route. Replaced it with an AuditRepository dependency.
The subsequent focused suite passed all 31 tests, including that architecture gate, workbench
HTTP/storage/analysis contracts, SVG geometry and concurrent trace sequencing. Type checking
passed. GitHub CI will run the whole suite, production build and new Chromium flows, retaining
screenshots/vector exports as `browser-evidence`. Do not claim this CI run passed until observed.

Remaining scope is explicit in the ledger: live data connections/credentials, additional
reviewed regional source coverage, advanced statistics, uncertainty bands/choropleths/graphs,
route-hypothesis tools and the automated paper pipeline. The existing JH16 fixture check remains
a pipeline self-check, never independent replication. Bundled clinical sources remain proposals;
only clearly fictional records are approved in isolated tests.
