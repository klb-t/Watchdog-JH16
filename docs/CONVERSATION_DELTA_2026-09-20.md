# Product delta from the two supplied conversations

Reviewed against repository head `c9afd37367898e1580150aadce975613d8fe88f2` and the
in-progress E3.12 catalog. Only Watchdog requirements are reconciled here. The source MHT
conversations remain private; unrelated personal, application and keyboard material is
not copied into the repository. Model summaries are proposals, not higher-priority instructions.

## Requirements and concrete acceptance boundaries

| Owner requirement | Current implementation | Next acceptance criterion |
| --- | --- | --- |
| One engine; institutions, tools, source access and output policies are profiles | Capability profiles, reviewed evidence, shared deterministic execution and UI profiles exist | Explicit output classes distinguish unknown, hypothesis, supported mechanism, contradiction and information request; changing profile never changes measured values or grants a role |
| Legal and transparent source acquisition, including negotiated forum access | E3.12 supplies candidate channels, evidence links, own assessments, expiry, public collection holds and unsent request drafts | A forum connector must pin actual access scope, endpoint/export, request limits, retention and attribution; no inference of permission from API/public visibility |
| Task-driven collection: map an index, then collect bounded relevant content over time | Public queue, schedules, immutable receipts and tested JSON/CSV copying exist | An authorized forum plan preserves discovered index/page identity, resume cursors, request/deadline budgets and explicit incomplete coverage; scheduling never changes geographic observation metadata |
| Search appearance globally; location is context, not chemical identity | Current `lookupField` searches the chosen region and optionally its ancestors; a sibling city or other country is excluded | Preserve regional counts and denominators, add separately labelled global appearance candidates with observation time/place and no inferred route or specimen identity |
| Differential support when identity/composition is uncertain | Reviewed sample matching and separate symptom reference lookup exist | A case hypothesis set retains substances/classes, possible mixtures and non-toxicological alternatives; unknown composition is explicit |
| Case model: known/possible exposures, medications, comorbidities, symptoms, vitals and laboratory observations over time | No longitudinal patient/case model or device connector exists | Each observation has event/measurement time, unit, source, reported/measured status and explicit missingness; contradictions and superseded measurements remain inspectable |
| PK, PD and rare documented interactions, including known and unrecognized comorbidity | Reference assertion categories and ChEMBL assay measurements exist; no general clinical constraint interpreter | Versioned typed assertions retain human-reviewed citations, species, assay/clinical setting, direction and conditions. A missing edge is unknown, not proof that an interaction is absent |
| Deterministic narrowing when the necessary evidence is present | No case constraint executor exists | A rule can evaluate only when its required inputs, units, timing and applicability are satisfied. Show supported/contradicted/undetermined with an exact rule/input trace; consistency does not prove a molecule |
| Suggest useful missing measurements or investigations | Not implemented | Proposals come from the institution's available-test profile and reviewed rule dependencies, carry a reason and source, preserve mixtures and alternatives, and remain distinct from treatment |
| Later device integration and monitoring of unexpected patterns | Not implemented | A replaceable, tested measurement adapter archives provenance and handles clock/unit mismatch, stale data and dropouts. No device or fabricated live telemetry is advertised |

The older local-scope lookup is an actual behavior difference, not an already solved feature.
The owner asked to discuss changes to existing decisions before applying them. A compatible
proposal is a separately labelled global-context result set while preserving the existing
regional calculation. Changing the default search behavior requires that discussion; this
catalog stage does not silently change the responder or its offline query/export semantics.

## Model claims that are not implementation authority

- The owner's explicit requirement for legal access governs the Watchdog ingestion plan.
  The earlier human-simulation thought experiment does not authorize circumventing a
  source's access decision. The model summary mixes those contexts; its proposed stealth
  personas and retry-by-identity-rotation are not imported as Watchdog requirements.
- General statements about scraping law, API availability or anonymization in those
  conversations are not treated as source-specific permission. Hashing a nickname is not
  recorded as a verified anonymization result. Source documentation and project scope must
  be assessed separately. E3.12 preserves checked links and explicitly unknown status.
- Illustrative clinical examples, automatic percentage estimates and definitive exclusions
  in the model replies have no reviewed supporting dataset/rule here. They do not become
  medical facts, dosage advice or deployed diagnostic rules.
- An entropy/information-gain number requires an explicit validated probability model.
  Without one, a future deterministic measurement selector may report the partition of
  currently represented hypotheses under stated rules, not a fabricated clinical probability.
  Missing coverage must remain visible; fewer hypotheses is not automatically better care.
- An undocumented mechanism, absent source association or missing observation cannot
  establish safety or exclusion. Supported interaction mechanism and observed patient outcome
  remain different claim types.
- Real patient identifiers, storage/retention and medical-device operation are not silently
  added. Initial modeling/tests can use fictional, non-identifying cases; the existing Q5
  data boundary and per-content review remain in force.

Branding suggestions are recorded as design context, not an instruction to replace the
existing icon with an unprovided final asset. No keyboard repository or medical protocol was
modified by this intake. The detailed clinical layers above are still planned, not counted
as delivered by the source-catalog implementation.

## Additional owner clarification — access to this installation (2026-09-21)

The owner requires a sign-in-only unauthenticated surface. An authenticated but unknown
email should have an application form explaining why access is requested, with no scientific
workspace access. The owner also needs to prepare invitations to exact email addresses and
assign role profiles. Existing OIDC verification and environment grants are implemented;
the applicant workflow, sign-in UI and invitation administration are not yet complete.

Planned acceptance: verified identity is separate from workspace admission; applications have
private status/history; an administrator can approve, deny, invite, expire or revoke explicit
roles; email invitations bind to the verified intended address and cannot act as transferable
bearer grants. Show/draft the invitation before sending. Immediate revocation must be checked
server-side on existing sessions, not only at the next login. Preserve the explicit local
development mode and existing operator bootstrap grants behind the identity abstraction.
