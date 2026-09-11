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


The first workbench CI run (`34321165187`, head `9e8b63f`) passed 259/262 tests; all three
new browser scenarios stopped on exact select-control labels. Browser artifacts showed the
pages loaded correctly and no JavaScript exceptions; nested option text polluted the labels.
Added explicit accessible names to the new selects. A separate large-trace regression exposed
an unusable ZIP fallback above the 4 MB preview cap; the preview now reads bounded complete
records, labels truncation and still permits the full ZIP. The dedicated >4 MB test passes.


The second CI run (`34321640546`, head `e2d9d8a`) passed 262/263 tests. The complete workbench
browser flow (including real numeric analysis, saved figure restoration, SVG export and mobile
layout) and diagnostics passed. The remaining responder assertion located the interaction
inside a correctly collapsed substance card; its test now opens that card before reading it.
Browser screenshots also prompted a visualization correction: map/3D discontinuities are
local outlined marks, not vertical geographic lines. Whole-dataset scale domains keep colors,
size, alpha and numeric axes stable during animation; explicit filtered rescaling remains a
saved option. A regression verifies that narrowing a time frame preserves a record's encoding.


## 2026-09-09 — publication package and ownership review

Previous workbench head `ddae00a` passed GitHub Actions run `34322096020`: 264 tests passed,
none failed or skipped, including Chromium production flows and JH16 demo.

E5.4 now archives visualization profiles, automatically restores historical settings, imports
portable figure JSON and exports a deterministic research ZIP. Shared React SVG rendering is
used in both the UI and server export. The package contains a file inventory and a dependency-free
verifier, and its analysis inputs reproduce the stored result through the existing executor.
Profile/configuration changes, file corruption, unsupported renderers, ownership and revoked
source approval have explicit regression coverage. No received receipt grants new access.

Publication review exposed a real bypass: legacy run and raw-blob endpoints checked capabilities
but not the owner, and the old method approval accepted a client-supplied reviewer. Those routes
now enforce ownership and exact-hash session-bound review. New legacy runs/artifacts inherit
the authenticated principal. Acquisition-only and analysis-only execution also had illegal
lifecycle skips; explicit no-op/reuse stages now preserve the existing state machine.

Validation before publication: TypeScript and production build passed; all 258 local
unit/contract/scientific/integration tests passed. New Chromium scenarios verify ZIP download,
standalone verification, historical-profile import, save and reload. Their CI result must be
checked after publication. The SVG is the portable figure snapshot; automatic paper writing,
advanced methods/layers and live-source expansion remain unfinished as recorded in the ledger.


## 2026-09-10 — reviewed regional boundaries

Published head `1ae7cce` passed Actions run `34358165042`: 268/268 tests, no failures or skips,
clean installation, typecheck, production build and JH16 demo. The browser evidence includes
standalone rendered SVG, package verification and historical-profile restoration.

E5.5 adds source-preserving GeoJSON/boundary imports, WORM versions and independent review,
sharing and revocation. Exact regional joins retain zero, missingness, absent observations,
ambiguous duplicates and unmatched IDs. The shared choropleth renderer, manual/equal-interval
classes, labels/alpha/time/panels, fit controls, inspector and favourite settings reach the UI.
Exports include pinned geometry and independently verified row-to-region reports.

The initial geographic regression caught a collapsed PRK island in the already-rounded bundled
world map; an explicit retain-and-flag policy preserves those original coordinates and warns
in source review and SVG. No geometry repair or scientific aggregation was introduced.

Local validation: all 265 unit/contract/scientific/integration tests passed. The new production
Chromium scenario covers GeoJSON field mapping, individual review, ambiguity, explicit joins,
time/panels, saved/favourite restoration, independently rendered SVG, ZIP verification, mobile
layout and revoked approval. Its final CI result is recorded on PR #1 after publication.

Geographic head `a3a275a` passed Actions run `34419687027`: 276/276 tests, clean installation,
typecheck/build, Chromium production flows and the JH16 demo. Its independently rendered
regional SVG retains both time panels, polygon holes, class/missingness legends and complete
source/hash footnotes; the 14-file regional ZIP passes standalone verification. Browser error
capture is empty. Mobile screenshots revealed that the application scrolls inside `main`, so
the final UI checks also inspect that container's width and scroll to the region controls and
inspector. Opaque evidence/source/boundary badges accompany the regional UI independently of
polygon alpha; exported SVG keeps the same evidence legend and provenance.

The stricter mobile gate on head `304e77b` caught horizontal overflow inside the scrolling
workbench (275/276 tests passed; run `34467235948`). The earlier whole-document width check
missed this. Fieldsets and controls now allow their intrinsic width to shrink into the mobile
column, with control widths bounded by the available space. The browser artifact records
container/element measurements as well as screenshots; the gate remains strict.

## E3.5 / E6.1 — durable public acquisition, schedules and substance memory

The maintainer explicitly requested cyclic acquisition, daily arXiv discovery, one-click
expansion beyond the drug domain, populated substance reference memory and automatic model
selection by budget. The first connected stage is implemented in Automation and Substance
memory: durable daily/interval schedules, bounded leased jobs, cancellation, current-owner
authorization checks, missed-slot coalescing, versioned source profiles, five working public
adapters and archived raw receipts. Public source leases coordinate rate and connection
limits across worker processes sharing SQLite. No browser or deployment is required to
remain open, but the server process and durable volume must remain available.

PubChem/ChEMBL/Wikidata/Europe PMC were exercised against live public APIs on 2026-09-11,
with real responses written to the development memory for caffeine and naloxone. ChEMBL
pages are deliberately bounded and coverage is explicit; this does not claim exhaustive
receptor information. Source-backed properties and activities extend the existing graph.
Assay type/measure, original values, inequality relations, units, target, organism, variants,
validity flags and attribution stay separate. Import does not imply clinical approval.

The discovery screener preserves actual paper versions and records method hints plus
explicit prerequisites for re-execution. Arbitrary paper-to-approved-method extraction,
autonomous hypothesis selection/refinement, advanced statistical safeguards, personal-key
setup and the configuration wizard remain the next connected stage. No arbitrary paper
code is executed, no replication verdict is inferred from metadata, and no live source is
silently substituted for JH16 result counts.

Validation: 274/274 local unit, contract, scientific and integration tests passed, including
nine new tests for schedules, restarts/leases, duplicate delivery, cancellation/authorization,
WORM integrity, source response limits, XML parsing, article versions and censored receptor
data. Chromium adds the daily schedule/scope/pause/mobile workflow in CI. Full behavior and
limits are documented in `docs/AUTOMATION_AND_MEMORY.md`.

The public-acquisition milestone is published at `35deca9cbac438a428ed5deddc8a70ed22b31d08`.
GitHub Actions run `34568553854` passed 286/286 tests, installation, typecheck/build,
Chromium and the JH16 demo. The artifact ZIP digest was verified and the automation
mobile screenshot inspected. Live development collection retained two compounds,
200 source activity assertions and 11 raw receipts when the execution was interrupted;
this is partial coverage, not an exhaustive chemical database.

## E3.6 / E5.6 — personal setup and research launch

Implemented an owner-scoped encrypted key vault, persistent settings, separate LLM/SERP
limits, public model catalog and automatic cost/context routing for three text tasks.
The three-step wizard separates language/geography and launches the actual approved
JH16 MethodSpec flow, selected public jobs and optional daily discovery. A keyless fixture
control produces 32 observations and source/method hash provenance; repeated launch
does not duplicate a run. Checked narratives can use the personal router too.

Eight integration tests cover isolation, vault integrity/redaction, budget reservations,
model routing, SERP counters, protected API writes and the complete fixture launch.
The added browser scenario tests saved modes, simple-only slider, mobile layout and launch.
See PERSONAL_SETUP.md for the implemented scope; PRODUCT_PRINCIPLES_AND_NEXT.md preserves
the maintainer's expanded multi-provider, evidence-based routing and universal intake goals.

The setup milestone was pushed as `b43f063`. CI `34593495931` reached the complete wizard
run and caught an incorrect test expectation: caffeine is not one of the locked JH16
entities. The test now checks every entity in the actual frozen preset. The mobile
screenshot and all 33 artifact files were retrieved with ZIP digest verification.

## E3.8 — personal provider and task profiles

Added 16 personal provider profiles, a native Anthropic Messages adapter alongside the
shared Chat Completions adapter, private catalog discovery, reviewed direct-provider price
ceilings and per-task provider assignments. Seven task profiles now include extraction,
trip reports, paper methodology and extension proposals. Automatic routing uses comparable
reviewed task benchmarks and observed operational history where they exist; unknown quality
is explicit. Direct-provider pricing still needs reviewed profiles. OpenRouter public
catalog refresh is available as a daily/interval scheduled task in the interface.

All 285 local unit/contract/scientific/integration tests passed; production build passed.
PERSONAL_PROVIDERS.md distinguishes protocol coverage from vendor-account acceptance and
records remaining direct price feeds, semantic benchmark execution and research intake work.

The provider milestone was published as `2cad3d4`. CI `34594827723` failed only the new
wizard interaction: the development server reloaded the page between changing its mode
and density. The browser harness now uses the production-built client, the wizard waits
for the resolved principal before loading settings, and select controls have explicit
accessible names. This checkpoint's CI must verify the repair; the earlier run is not green.

## E5.7a / E5.8a — paper intake, extraction workshop and goal navigation

The home page now starts from ten capability-filtered goals stored in a versioned profile.
The research workspace saves arbitrary submitted text/identifiers and owned discovered
abstracts with immutable hashes, original receipt lineage and separate language/geography.
Owned LLM assessments preserve exact unique source quotes, methodological proposals, input
requirements, missing detail, hypotheses and candidate substitutes. Input truncation and
source coverage remain explicit. Reused original data is reanalysis; synthetic expert
responses remain simulation. Assessment never approves or executes an arbitrary method.

Daily/interval paper reviews use the existing durable worker, at most one to five previously
unattempted eligible documents, current owner authority and personal task budgets. Failed and
interrupted attempts persist; lease recovery resolves stranded RUNNING assessments without
automatic rebilling. Explicit failed retries are one-off jobs. New abstract revisions at the
same URL are retained; unchanged imports and duplicate requests do not duplicate work.

The deterministic extraction workshop supports form-defined or LLM-proposed JSON/CSV copy
profiles. The model sees structure, not source cell values. Exact-output tests precede hash-
bound activation; later execution makes no model call. Large integer/decimal lexemes, null,
missing fields, blank CSV records and quoted newlines retain source provenance. Tests, failed
trials, raw input and output exports remain available after reload and ownership transfer.

Validation before publication: all 297 local unit/contract/scientific/integration tests pass,
including 12 new research tests; typecheck and production build pass. Chromium coverage adds
goal navigation, manual source intake, the keyless mapping form, test/activation/execution,
exact export, restored history and 390 px mobile width. Its CI outcome will be checked after
publication. The research/source fixtures are explicitly fictional; no paid LLM call was made.
RESEARCH_WORKSHOP.md and the split ledger distinguish this connected stage from arbitrary
replication execution, generated adapter sandboxing and the future statistical paper pipeline.

Published research head `865e478200cfa145f10f8674f28093fdae4ee38c` passed Actions
`34634885882`: **311/311 tests**, zero failures/skips, clean installation, typecheck/build,
Chromium and the 32-observation JH16 self-check. This also verifies the repaired personal
wizard. The 35-file browser artifact passed its published ZIP SHA-256 check, and the wizard
and research desktop/mobile screenshots were inspected.

Visual inspection prompted a focused follow-up: expected extraction values now have a
guided record form, and results render as a table with clickable source-cell provenance.
The raw debug record stays accessible in a disclosure. The browser flow exercises the
form and inspector and scrolls the actual application container to capture useful start
and result screenshots. This follow-up awaits its own CI confirmation after publication.
