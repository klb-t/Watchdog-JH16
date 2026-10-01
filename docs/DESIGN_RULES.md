# Design rules and acceptance boundaries

Date: 2026-09-30. Scope: the authorized continuation of WatchDog, with the locked JH16
contract preserved. This document is normative about the rules below, not a claim that every
listed feature is implemented. Actual completion belongs in the task ledger and current state.

## Authority and evidence

Authority labels used below:

- **Owner**: an explicit requirement recovered in the supplied conversation audit. The raw
  archives were reviewed in that audit; this document does not claim a second archive search.
- **Contract**: an existing scientific, provenance or authorization contract inspected in this
  checkout. Links identify the document or code; a document is not proof of implementation.
- **Derived**: a necessary implementation constraint or a recommended operational default.
  These are not attributed to a historical owner decision.
- **Proposal**: an optional future capability, pending adoption and validation.

The current owner instruction permits autonomous routine implementation. Later explicit
requirements supersede earlier instructions only within their stated scope. An assistant's
summary, suggested weighting, clinical example or implementation shortcut cannot grant
scientific approval. Unresolved incompatibilities are recorded in
[the reconciliation](SPEC_RECONCILIATION_2026-09-30.md).

The smallest useful architecture keeps the existing typed services and repositories. Shared
mechanisms include ownership, immutable references, scheduling, validation, search and replay.
Scientific executors, provider measurement semantics and field-reference assertions retain
separate contracts. Seven navigation groups organize these capabilities; they do not require
seven separate backends or a universal graph engine.

The proposed reuse is grounded in two current paths and a boundary case:

| Case | Shared operation | Semantics that remain separate |
| --- | --- | --- |
| Current CSV/JSON workbench import | Owned artifact storage, hashes, schema validation and immutable dataset references. | Declared numeric types/units and review govern statistical eligibility. |
| Current paper-linked JSON/CSV extraction | The same ownership/provenance mechanisms and a later dataset reference. | Activated lexical copying preserves source spans; a paper assessment remains a proposal and does not approve the resulting science. |
| Hypothetical longitudinal clinical/device data | Timestamped provenance and permissions could be reused. | Patient boundaries, measurement clocks, clinical applicability and device validation require distinct contracts. A shared envelope would not establish diagnostic correctness. |

This supports small shared traceability and reference mechanisms. It does not establish that
all three cases should share a parser, executor, uncertainty score or storage policy.

Concrete implementation seams under integration review:

- [Search profile](../config/search.json), [typed result contract](../shared/search.ts),
  [repository](../backend/watchdog_api/db/repositories/search.ts) and
  [HTTP boundary](../backend/watchdog_api/api/search_routes.ts): metadata search, not publication
  full-text or data-cell search. People are not indexed. Pagination bounds response size;
  an exact total still requires scanning applicable metadata/reference records.
- [Shared field projection](../shared/field_lookup.ts) and
  [snapshot service](../backend/watchdog_api/field/service.ts): global context applies to
  appearance/market discovery; symptom lookup retains its regional and reviewed-clinical
  eligibility boundary. Six-kind presentation does not admit unsupported clinical assertions.
- [Access boundary](../backend/watchdog_api/api/auth_routes.ts) and
  [capability bundles](../shared/authorization.ts): operational admin has `principal.invite`;
  developer/dev has `principal.manage` for approval, role assignment and access revocation.
  Accepting an invitation submits an admission request, not a role grant. Operator bootstrap
  needs developer/dev to administer admission; an admin-only grant cannot approve requests.

These locators identify code to verify. They do not replace the acceptance checklist or establish
that integration/browser checks have passed.

## Rules

MUST means an explicit requirement or identified necessary constraint. SHOULD means a justified
recommendation. MAY denotes an option. Test descriptions are acceptance criteria, not passed
test claims.

| ID | Scope and requirement | Authority and reason | Verification | Exception or revisit condition |
| --- | --- | --- | --- | --- |
| WD-01 | Scientific outputs MUST come from deterministic code over stored inputs; LLM output MUST remain outside numerical computation. | Owner; [agent contract](../CLAUDE.md), [JH16](spec/03_JH2016_CONTRACT.md). Narrative is not measurement. | Recompute outputs without model/network access; inspect executor/input hashes and check missing values. | A new numerical method requires its own explicit reviewed contract; a model cannot fill missing empirical values. |
| WD-02 | Finalized runs, evidence packages and scientific input versions MUST be immutable; corrections MUST reference a superseded version. | Contract; provenance cannot silently change after review. | Change an input and verify a new hash/version; replay the earlier package unchanged. | Source-specific lawful retention can remove payloads with an explicit tombstone; it cannot pretend the payload remains replayable. |
| WD-03 | Providers, units, constructs, populations, observation times, geography and language MUST remain distinct. Substitution MUST be explicit. | Owner; [provider contract](spec/05_PROVIDERS_AND_CAPABILITIES.md), [lifecycle intent](specifications/16_DATA_LIFECYCLE_STORAGE_AND_MEMORY.md). | Reject incompatible inputs or record a declared variant; do not equate Trends interest with search counts or language with residence. | A validated conversion may connect representations while retaining its parameters and loss. |
| WD-04 | Every consequential transformation MUST declare preservation, loss, addition, applicability and provenance at an appropriate level of detail. | Derived necessity for replay and interpretation; contracts below. | Trace a figure, statistic or copied cell back to raw input and exact operations; verify explicitly unknown loss is visible. | Mechanical identity copies need a compact contract; no invented entropy or confidence score is required. |
| WD-05 | UI MUST organize primary work into seven coherent groups: dashboard, data/sources, manual analysis/figures, collection/schedules, research projects, paper methodology/replication and indexed knowledge. Existing deep links SHOULD remain reachable. | Owner; recovered later product organization. Group names are presentation, not scientific contracts. | Desktop/mobile navigation exposes the seven groups, respects capabilities and retains contextual access to settings, review and diagnostics. | A future owner revision may change grouping without changing stored scientific data. |
| WD-06 | Common search MUST query only authorized indexed objects, with typed result kinds, source links and stable ordering. Counts, snippets and filters MUST enforce the same ownership boundary as object reads. | Owner; Derived privacy constraint. Search is not permission to see another user's papers, jobs or keys. | Two-owner tests with matching titles show no inaccessible result, count or snippet; malformed queries fail safely. | An unsupported entity class remains absent or explicitly unavailable. Do not invent people or associations to populate the index. |
| WD-07 | Verified identity MUST remain separate from workspace admission. Anonymous users get the sign-in surface; authenticated unknown users get a private application path. | Owner, 2026-09-21 clarification in [conversation delta](CONVERSATION_DELTA_2026-09-20.md). | Test anonymous, verified-unadmitted and admitted sessions against both UI and API. No grant follows from entering an email or reason. | Explicit local development mode and operator bootstrap are retained; production must not silently fall back to local mode. |
| WD-08 | Invitations and grants MUST bind to the intended verified identity. Role changes and revocations MUST be checked server-side for existing sessions. Addressed invitations MUST reject a different verified address. Separately configured open links MAY admit any verified address under bounded uses/expiry and non-administrative capabilities (recovered D20; integration E4.7). | Owner; Derived access integrity; [capability bundles](../shared/authorization.ts). | Wrong-address redemption fails for addressed invitations; open-link use/expiry and no-privilege-escalation checks pass before enabling that variant; revoked sessions lose API access without a new login; restricted profiles cannot manage roles. | Sending an invitation is a separate outbound action. Preparing/copying a link or draft does not imply authorization to send messages. |
| WD-09 | A research project MUST persist a question and owned typed references to evidence/work. Frozen packages MUST pin available content hashes and unresolved requirements. | Owner; [project scope](specifications/21_INTUITIVE_RESEARCH_UI_AND_USER_FLOWS.md). | Reload preserves the project; foreign references fail; editing a project does not alter an earlier frozen package. | A schedule reference describes a mutable task configuration unless a specific immutable snapshot is pinned; it is not evidence of an unexecuted result. |
| WD-10 | Reusing the original published JH16 inputs MUST be labeled reanalysis/self-check, distinct from independent replication. Variants MUST preserve method/data differences. | Owner; [research workshop](RESEARCH_WORKSHOP.md), locked JH16 contract. | Package metadata distinguishes original-data reuse, new data, proxies and synthetic scenarios; no assessment alone marks a paper replicated. | Independent confirmation requires actual independently acquired evidence and the stated design. |
| WD-11 | Field appearance lookup MUST show global candidates separately from regional observations/counts. Visual similarity MUST NOT establish specimen identity or composition. | Owner, later global-context requirement; [field boundary](FIELD_REFERENCE.md). | A matching distant sample appears as global context, without entering local denominators; unknown composition remains unknown. | Access policy can restrict visible records. Lack of visible records is not evidence of absence. |
| WD-12 | Evidence kind, human approval, quality flags, objectivity, relevance and calibrated probability MUST NOT be collapsed into one trust value. Human approval MUST NOT promote an inferred match to an empirical measurement. | Owner correction plus existing independent evidence/approval fields; [tier specification](spec/10_EVIDENCE_TIER_AND_TRUST_UI.md) contains historical interpretation that requires the reconciliation. | Toggle approval without changing evidence kind; render text/icon labels; no automatic numeric fusion or treatment-confidence percentage. | A future reviewed model may output an explicitly named and calibrated quantity with applicability limits; it still cannot replace the original axes. |
| WD-13 | The six evidence kinds MUST survive presentation changes. Color/display collapse MAY be a versioned profile; the default SHOULD preserve all six distinctions. | Contract; Derived reversible default. The historical three-bucket approval claim is not established by the supplied audit. | Every underlying kind stays identifiable in labels/export and profile switching leaves the stored kind unchanged. | An owner-selected simpler display may collapse colors while retaining accessible detail; its adoption is recorded as a new presentation decision. |
| WD-14 | Category order MUST remain independent of evidence color. PK/PD importance MUST NOT imply green/confirmed evidence. | Owner correction recovered in [tier specification](spec/10_EVIDENCE_TIER_AND_TRUST_UI.md). | Predicted PK/PD remains in its configured category position and retains prediction labeling. | Different audiences may select different category-order profiles without changing the evidence. |
| WD-15 | A graph MAY provide research/professional inspection; it MUST NOT be forced as the default route for every task. | Owner; graph backbone and optional view are separate concepts. | Core upload, search, analysis, collection and project flows work without manipulating a graph. | An explicit future graph-first interface can reuse typed objects; it cannot remove other supported workflows merely because relations exist. |
| WD-16 | Every acquisition attempt MUST have a durable event. Retainable raw responses MUST be archived before normalization; identical bytes MAY be deduplicated physically without deleting logical fetch history. | Owner/Contract; [lifecycle intent](specifications/16_DATA_LIFECYCLE_STORAGE_AND_MEMORY.md). | Repeated identical acquisition leaves separate timestamps/events referring to one verified blob; failures remain inspectable. | Payload restrictions/expiry require recorded policy and tombstone. Full raw retention versus changed-only monitoring remains a separate profile decision, not a global purge permission. |
| WD-17 | Collection and source access MUST honor explicit acquisition scope, terms, budgets and unresolved coverage. Planned sources MUST NOT be presented as live adapters. | Owner's later transparent-access requirement; [source access](SOURCE_ACCESS.md). | Inspect effective request plan, adapter status, limits and acquisition receipt; cancelled work stops at checkpoints. | Missing credentials or permission yields an explicit unavailable/blocked state, not identity rotation or a substitute source represented as the original. |
| WD-18 | Semantic extraction MAY use task-selected LLM profiles; tested declarative parsers MUST execute deterministically. A fixture test MUST NOT be claimed to validate every future input. | Owner and [current extraction contract](RESEARCH_WORKSHOP.md). | Exact source-span checks and parser replay; changed candidate invalidates activation; account budgets remain owner-scoped. | Generated executable adapters are future work requiring a separate sandbox, permission and validation design. |
| WD-19 | Unsupported clinical reasoning, real patient/device data, arbitrary paper compilation, advanced time-series methods and live Trends collection MUST remain explicitly unimplemented. | Contract; implementation cannot be fabricated from ambition or a registry row. | UI/export clearly distinguishes proposed, fixture, blocked and operational paths; no fabricated live observation or clinical probability. | A capability becomes operational after its concrete source/method/security acceptance criteria pass. |
| WD-20 | Ecosystem collaboration SHOULD expose small permission-aware typed seams where useful; the brainstorm MUST NOT mandate a single ontology, database, graph or chat-only interface. | [ECOSYSTEM.md](../ECOSYSTEM.md), explicitly conceptual. | Existing standalone flows remain usable; a proposed integration documents actual payload semantics, ownership and action permissions. | Adoption of a specific integration requires its own concrete scope and acceptance tests. |

## Consequential transformation contracts

These contracts describe existing seams and new work, not a universal new runtime. Schema,
algorithm/profile version, input/output hashes and source locators belong in the corresponding
artifact. A downstream conversion cannot restore distinctions removed upstream.

| Conversion | Input / output and preconditions | Preserved / lost / added | Reliability, reversibility and operational behavior |
| --- | --- | --- | --- |
| Acquisition → archived receipt | An authorized provider request or manual import → raw bytes, event, status and hash. Retention and credentials must permit it. | Preserve actual retained bytes, request/provider identity and acquisition time. Provider omissions and restricted content remain unknown. Add event metadata, not inferred publication dates. | Exact byte replay is possible while the raw payload remains available. Failures, limits and identical responses are events. Fetch time does not establish observation time. |
| Raw text → methodology proposal | Supplied paper text with declared full/excerpt/abstract/identifier coverage → anchored statements and proposed operations. Requires owner profile/budget for an LLM call. | Preserve complete source and checked quote spans. Model input truncation loses context and is recorded. Add interpretations, hypotheses and missing-input proposals; no empirical values. | A span match validates the quotation, not the interpretation or whole-paper replicability. A model call can be stochastic/costly; record model/profile/version, attempt and excerpt. The original text is recoverable, model reasoning is not independently proven. |
| JSON/CSV → copied cells | Activated `copy-plan-1` plus exact raw input → lexical scalar strings/null with locations. Requires fixture activation for that exact candidate. | Preserve selected lexemes and cell provenance. Nonselected structure stays in raw input but is absent from the table. Add output field names; absent optional and explicit null stay distinct. | Exact replay via stored parser/version. Duplicate keys/headers, malformed width and nonscalar values fail. This is selection, not numeric inference or source reliability validation. |
| Copied cells → analytical dataset | Explicit field mappings, types, units and missingness → owned proposed dataset. Numeric conversion requires the accepted precision policy. | Preserve raw lexemes and mapping trace. Binary64 conversion can lose lexical formatting and has finite representation; rejected precision remains text/error. Add schema/type interpretation and explicit missingness reasons. | Replay verifies mapped cells. Approval does not improve evidence kind. Export includes full source, including unselected fields; ownership/sharing policy must apply to that payload. |
| Dataset → deterministic analysis → figure | Approved compatible inputs, reviewed method and effective parameters → result artifact and versioned rendering. | Preserve input/result references, units and parameters. Aggregation drops individual detail from the result; a chart can omit records through filters/axes. Add computed quantities, not independent observations. | Recompute using the executor. Rendering cannot improve validity. Missingness, sample size, provider breaks and applicable assumptions must stay visible; exact underlying values remain accessible. |
| Appearance query → candidates and composition counts | Reviewed reference records, appearance/market text, region/time and access scope → local results plus explicitly separated global context. | Preserve sample/place/time/citation and original evidence kind. Keyword/visual matching loses or ignores unmatched traits; add an inferred match only. Local distinct-sample denominators stay local. | No calibrated probability, trafficking route or chemical identity follows from similarity. Missing regional coverage and mixtures remain explicit. Query audit/snapshot scope is retained; presentation can be replayed from a pinned snapshot. |
| Mutable project → frozen evidence package | Owned project revision and validated typed links → immutable manifest of pinned evidence, configuration and unresolved inputs. | Preserve the cited revisions/hashes and question. Unpinned future schedule executions and unavailable payloads are not included as evidence. Add package membership and freeze time. | Freezing is not scientific approval or independent replication. Hash consistency checks integrity, not authenticity without a trusted external reference. A new freeze creates a new package; it never changes the earlier one. |

## Reversible defaults and decision triggers

| Choice | Working default / alternatives | Cost of deferral | Trigger and replacement route |
| --- | --- | --- | --- |
| Evidence display | Six kinds with text/icons; optional simpler audience profile. No score fusion. | More visible distinctions; bounded by one display profile rather than divergent data models. | Usability evidence or explicit owner choice can select a simpler profile; stored evidence is untouched. |
| Global versus regional appearance | Separate result sets; keep original regional arithmetic. | Two labeled panels and explicit unknown coverage. | A validated epidemiological design can define another denominator as a versioned method, never merge it silently. |
| Raw collection strategy | Existing retained raw evidence stays intact. Shared acquisition machinery can support full research archives and monitoring change/heartbeat profiles. | Storage may grow; a new retention policy is not inferred from collection purpose. | Source terms, measured storage cost or an explicit project policy establishes retention. Deletion needs a tombstone and disclosed replay loss. |
| Project organization | Persist typed references and immutable freezes; keep existing object services. | Some cross-object work remains manual. | A concrete repeated operation in at least two supported workflows can justify a common service; one hypothetical ecosystem link cannot. |
| Numerical/extraction extension | Existing deterministic primitives and activated declarative copying. Generated modules remain outside execution. | Unsupported formats and methods are explicit limits. | A real input/method not expressible in the registry triggers a separately tested adapter or sandbox design. |
| Ecosystem integration | Standalone WatchDog plus documented typed/permission seams. No live cross-project integration is claimed. | Context transfer may remain manual. | An adopted interface task with a real counterpart, payload, permissions and end-to-end test selects an integration. |

## Current slice acceptance checklist

The checklist defines the final integration gate; it is not a progress report. Actual pass/fail
results and counts are recorded in the final integration handoff, current
[state](spec/00_STATE_AND_DECISIONS.md) and [task ledger](spec/07_EPICS_AND_TASKS.md).
Feature-level review or a targeted test pass alone
does not establish that the complete integration gate passed.

- **A-NAV**: Seven primary groups work on desktop/mobile; contextual pages and existing deep
  links remain reachable; restricted roles see only capabilities they possess.
- **A-SEARCH**: Typed search returns real indexed records; ownership holds for objects,
  snippets and counts; ordering/filter/pagination behavior is repeatable.
- **A-ADMISSION**: Anonymous and unadmitted verified users cannot read workspace data;
  application history persists; exact-address invitations and existing-session revocation pass.
- **A-PROJECT**: Projects survive reload, reject foreign object links and preserve immutable
  frozen versions with unresolved requirements rather than fabricating completion.
- **A-FIELD**: Distant matches are visible as global context; local statistics are unchanged;
  all six evidence kinds and approval remain separately legible without color.
- **A-INTEGRATION**: The canonical test command and deterministic JH16 demo pass with the
  integration branch; paid calls, private deployment and source/device access are not assumed.
