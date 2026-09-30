# Evidence classification and display profiles

## Provenance of this design

The historical specification reconstructed this model from conversations about evidence
colors, responder information and category order. The maintainer did distinguish the kind of
evidence from where PK/PD and other information belongs on a card. The following excerpt is
preserved from the earlier specification, including its transcript wording; the six enum values
and the compact mapping below are repository representations, not a claim that every detail
was independently and finally approved by the maintainer:

> *"trzeba pomyśleć, bo było mówione, że farmakokinetyka i farmakodynamika zawsze w pierwszej,
> zielonej ramce. Ale jak to będzie apoksymowane, żeby cały czas było na górze, to wtedy po
> prostu porzucimy kolejność ramek, że od zielonej do pomarańczowej, tylko od farmakokinetyki,
> farmakodynamiki, efektów przedawkowania..."*

In English: pharmacokinetics and pharmacodynamics belong at the top of a substance card
regardless of which colour their specific data happens to carry, so the display order cannot
simply follow the color order. That supports D12's independent category/evidence axes; it
does not establish a numerical trust scale or a universal rank of source objectivity.

The [2026-09-30 reconciliation](../SPEC_RECONCILIATION_2026-09-30.md) corrects the earlier
assertion that a separate three-color responder system had been approved. The recovered
history includes changes to the trip-report/prediction colors and an explicit objection to
reducing them to three. Preserve that uncertainty rather than attributing the repository's
collapse to a settled user decision. Full six-kind display is now the reversible default;
compact responder buckets are an optional presentation profile. The names, colors and grouping
remain versioned configuration; choosing a profile never changes a stored evidence value.

## Two independent axes

**Axis 1 — evidence kind.** How was this fact established. Six stored values with configured display colors:

| Tier | Colour | Meaning for a general substance fact | Meaning for a specimen identification |
|---|---|---|---|
| `PRIMARY_EMPIRICAL` | 🟩 dark green | Peer-reviewed measurement: a PK/PD study, a toxicology paper, a Ki/Kd binding assay | This specific specimen was lab-tested (FTIR, reagent, mass spec) |
| `CURATED_SECONDARY` | 🫒 olive | Vetted synthesis by an authoritative body, not itself primary research: an encyclopedic entry, an EMCDDA/UNODC bulletin, a systematic review | An official pill-imprint database match |
| `RAW_OBSERVATIONAL` | 🟨 yellow | A single unprocessed first-hand report, not independently verified: one trip report, one ER note | A single unconfirmed user submission |
| `MODELED_PREDICTED` | 🟧 orange | Computed or inferred rather than observed: QSAR, ADMET prediction, docking, an LLM-compiled synthesis | A visual pattern match (shape/colour/logo) against known types, however confident |
| `SPECULATIVE` | 🟥 red | Theory without empirical or model grounding | An unsubstantiated guess |
| `UNKNOWN` | ⬜ grey | Not yet classified, or genuinely missing | No match attempted or possible |

**Axis 2 — content category.** Where a fact sits in the narrative structure of a substance or
specimen profile, fixed regardless of which tier populates it. Extended, not contradicted, by
`12_DRUG_DOMAIN_ONTOLOGY_AND_ASSERTIONS.md`'s fuller ontology — this list was seven items on
first draft and missed legal status and preparations/samples as their own categories entirely,
which the ontology work caught by naming them as first-class node classes with nowhere else to
sit:

1. Identity / names / aliases
2. Chemistry and structural relations (isomers, salts, metabolites, analogs)
3. Pharmacokinetics (absorption, distribution, metabolism, excretion)
4. Pharmacodynamics (mechanism, receptors, transporters, signalling)
5. Acute toxicity / overdose (clinical signs, specific syndromes, thresholds)
6. Chronic effects (organ systems, dependence)
7. Interactions (drugs, other substances)
8. Preparations / pills / samples
9. Regional / time signal (recent reports, geographic/temporal patterns)
10. Research citations
11. Legal status
12. Alerts

A card renders top to bottom in this fixed order. Each fact's border reflects its evidence
kind under the selected display profile. A category does not get one inherited evidence color.
PK/PD stays in its category position independently of the kind or approval of an individual
reference. Display must preserve this distinction when multiple eligible kinds occur together.

Evidence kind answers how a fact was established; category answers what the fact concerns.
Neither is calibrated confidence, clinical probability, objectivity or a universal source trust
score. Domain ceiling comparisons in existing validation are explicit eligibility rules, not
measured confidence. Source relevance and limitations remain inspectable alongside the facts.

The current responder clinical eligibility boundary still excludes nonprimary/noncurated
clinical statements. A six-kind legend or a different color profile does not widen that boundary.
Exact reference inspection retains provenance for excluded mappings while withholding their
clinical statement text. Broader clinical rendering remains a separate feature to design and
validate.

## Relationship to approval_state and quality_flags_json

Three independent axes exist on evidence-bearing rows in this system, and conflating any two of
them defeats the purpose of the third:

- **`evidence_tier`** — epistemic. How the fact was established. Does not change when a human
  looks at it.
- **`approval_state`** — governance, from `04_METHOD_COMPILER_AND_APPROVAL.md`. Whether a human
  has signed off on this specific artifact reaching a display or computation. A human approving
  a `MODELED_PREDICTED` pill match does **not** upgrade its tier to `PRIMARY_EMPIRICAL` — it
  means a human reviewed and accepted a prediction, which remains a prediction. Displaying
  tier and approval state together, distinctly, is what lets a viewer tell "reviewed guess"
  apart from "independent lab result" at a glance.
- **`quality_flags_json`**, from `02_DATA_MODEL.md` — situational. What is unusual about this
  specific observation: `PROVIDER_DISCONTINUITY`, `COUNT_PARSE_UNCERTAIN`, and so on. A flag
  does not change a fact's tier either.

All three render together as a small badge cluster wherever evidence-bearing content appears.
None substitutes for another.

## Reversible responder display profiles

`config/field/responder.json` defines the default display mode and compact bucket colors;
`config/evidence/tier-display.json` defines the six kinds, labels, icons and full colors.
Responder offers these profiles without changing the reference, its hash or its approval:

- **Full:** the default. Show the configured color, distinct icon and exact label of each kind.
- **Compact:** an optional presentation. Group colors into the historical repository buckets,
  while retaining the exact six-kind label and icon on every badge.

| Compact bucket | Colour | Stored kinds |
|---|---|---|
| Confirmed | green | `PRIMARY_EMPIRICAL` |
| Reference | olive | `CURATED_SECONDARY` |
| Unconfirmed | orange | `RAW_OBSERVATIONAL`, `MODELED_PREDICTED`, `SPECULATIVE`, `UNKNOWN` |

The legacy bucket name “Confirmed” identifies a primary reference measurement; it does not
identify the current specimen or certify a diagnosis. Compact presentation loses visual color
granularity, explicitly, but keeps the evidence kind as text and an icon. Switching back restores
the full colors. Category order, approval, source context and quality flags remain unchanged.

## Fusion weights — recorded, not implemented

The earlier specification recorded the following candidate weighting for evidence fusion.
The reconciliation does not establish approval of these numbers as a scientific method:

| Tier | Proposed weight |
|---|---|
| `PRIMARY_EMPIRICAL` | 1.00 |
| `CURATED_SECONDARY` | 0.75 |
| `RAW_OBSERVATIONAL` | 0.50 |
| `MODELED_PREDICTED` | 0.25 |
| `SPECULATIVE` | 0.10 |

along with a sketch of fusion rules — agreement between two tiers raises confidence, a single
low-tier source alone produces a low-confidence warning rather than a claim.

This is preserved here as a candidate for a future evidence-fusion feature. **It is not
approved for implementation now, in E1 or in E6.** An algorithm that silently collapses
heterogeneous evidence into one number is precisely the pattern the approval gate in
`04_METHOD_COMPILER_AND_APPROVAL.md` exists to prevent, and predating that rule is not an
exemption from it. Any future fusion score is itself a `MethodExecutor` output like any other
analysis result — proposed, approved once as a method, never silently invented per-case. Until
then, the system shows tiers distinctly, side by side, and lets the human synthesise.

## Source-level ratings vs fact-level tier

The maintainer's source catalogue research separately rated sources with a static star scheme
(for example BindingDB and IUPHAR at four stars, PubChem BioAssay at two). This is a coarser,
source-level signal and is not the same thing as `evidence_tier`, which is assigned per fact.
A single source can contain facts at multiple tiers — PubChem holds both curated experimental
values and computed ADMET predictions under one roof. Keep a historical star annotation with its provenance where available. It is not a calibrated
prior, a universal source-objectivity ranking or a substitute for classifying individual facts.

## Accessibility — non-negotiable given the context of use

A responder using this card may be working in poor light, under stress, or may be colourblind. **Colour is never the only signal.** Every tier and every
approval state pairs with a distinct icon and a text label. This is not a nice-to-have for this
specific interface — a tool meant to be read correctly in a crisis that silently fails for a
colourblind user has failed at its one job for that user.

## Required tests

| Test | Asserts |
|---|---|
| tier orthogonality | changing `approval_state` on a row never changes its `evidence_tier`, and vice versa |
| pill-match ceiling | any composition row sourced only from visual matching has `evidence_tier` ≤ `MODELED_PREDICTED`, enforced in the domain layer, not just by UI convention |
| display profiles | full six-kind display is the default; optional compact colors preserve every evidence label/icon and do not change approval or category order |
| colourblind-safe rendering | a snapshot test with colour information stripped still allows every tier and approval state to be distinguished by icon and label alone |
| no silent fusion | no code path computes a combined confidence score from multiple `evidence_tier` values without going through an approved `MethodSpec` |
