# Evidence tier and trust UI

## Provenance of this design

This is not a new invention. Across six conversations between 2025-09 and 2026-04, the
maintainer independently designed a colour-coded evidence classification for this exact
system, and refined it through his own correction. That correction is worth preserving close to
verbatim, because it is the reason this document has two axes instead of one:

> *"trzeba pomyśleć, bo było mówione, że farmakokinetyka i farmakodynamika zawsze w pierwszej,
> zielonej ramce. Ale jak to będzie apoksymowane, żeby cały czas było na górze, to wtedy po
> prostu porzucimy kolejność ramek, że od zielonej do pomarańczowej, tylko od farmakokinetyki,
> farmakodynamiki, efektów przedawkowania..."*

In English: pharmacokinetics and pharmacodynamics belong at the top of a substance card
regardless of which colour their specific data happens to carry, so the display order cannot
simply follow the trust-colour gradient — the two orderings have to be separated. That is
decision D12 in one sentence, and it is the maintainer's, not an inference from this package.

A simplified three-colour version of the same idea was designed separately, specifically for
the time-critical responder card. Both versions are formalised below; they are the same
underlying tier collapsed to different granularity for different audiences, not two competing
systems.

## Two independent axes

**Axis 1 — evidence tier.** How was this fact established. Six values, ordered:

| Tier | Colour | Meaning for a general substance fact | Meaning for a specimen identification |
|---|---|---|---|
| `PRIMARY_EMPIRICAL` | 🟩 dark green | Peer-reviewed measurement: a PK/PD study, a toxicology paper, a Ki/Kd binding assay | This specific specimen was lab-tested (FTIR, reagent, mass spec) |
| `CURATED_SECONDARY` | 🫒 olive | Vetted synthesis by an authoritative body, not itself primary research: an encyclopedic entry, an EMCDDA/UNODC bulletin, a systematic review | An official pill-imprint database match |
| `RAW_OBSERVATIONAL` | 🟨 yellow | A single unprocessed first-hand report, not independently verified: one trip report, one ER note | A single unconfirmed user submission |
| `MODELED_PREDICTED` | 🟧 orange | Computed or inferred rather than observed: QSAR, ADMET prediction, docking, an LLM-compiled synthesis | A visual pattern match (shape/colour/logo) against known types, however confident |
| `SPECULATIVE` | 🟥 red | Theory without empirical or model grounding | An unsubstantiated guess |
| `UNKNOWN` | ⬜ grey | Not yet classified, or genuinely missing | No match attempted or possible |

**Axis 2 — content category.** Where a fact sits in the narrative structure of a substance or
specimen profile, fixed regardless of which tier populates it:

1. Pharmacokinetics (absorption, distribution, metabolism, excretion)
2. Pharmacodynamics (mechanism, receptors, transporters, signalling)
3. Acute toxicity / overdose (clinical signs, specific syndromes, thresholds)
4. Chronic effects (organ systems, dependence)
5. Interactions (drugs, other substances)
6. Context (legal status, encyclopedic background)
7. Field signal (recent reports, geographic/temporal patterns)

A card renders top to bottom in this fixed order. Each section's *border* colour reflects the
tier of the specific fact shown, which may vary fact-by-fact within a section — a PK section can
show a green onset time next to an orange predicted half-life for a novel substance, and the
UI must be able to hold that mixed state rather than assigning one colour per section.

These two axes were designed together and neither replaces the other. Do not collapse them
into one ordering: tier answers "how much should I trust this," category answers "what kind of
fact is this," and a system that only had one axis would either bury pharmacokinetics under
unrelated high-trust content or promote an irrelevant fact just because it happened to be
well-sourced.

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

## UI collapse for the responder card

The full six-tier scale is for the researcher-facing analysis UI, where the distinction between
`RAW_OBSERVATIONAL` and `MODELED_PREDICTED` matters for methodology. Under field time pressure
it does not — the operationally relevant question collapses to whether a fact is independently
confirmed or not. `11_FIELD_AND_CLINICAL_INTERFACES.md` uses this three-bucket collapse:

| Responder-card bucket | Colour | Collapses |
|---|---|---|
| Confirmed | green | `PRIMARY_EMPIRICAL` |
| Reference | olive | `CURATED_SECONDARY` |
| Unconfirmed | orange | `RAW_OBSERVATIONAL`, `MODELED_PREDICTED`, `SPECULATIVE` |

This is a display-only collapse. The underlying `evidence_tier` value is never overwritten or
lost; the responder card simply renders fewer buckets than the researcher UI reads from the
same column.

## Fusion weights — recorded, not implemented

The maintainer's history contains a proposed numeric weighting for combining evidence across
tiers into a single fused confidence score:

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
values and computed ADMET predictions under one roof. Use the star rating, where available, as
a prior when a new source is registered; it does not replace tagging each fact on ingestion.

## Accessibility — non-negotiable given the context of use

A responder using this card may be working in poor light, under stress, or may be colourblind
(affecting roughly 8% of men). **Colour is never the only signal.** Every tier and every
approval state pairs with a distinct icon and a text label. This is not a nice-to-have for this
specific interface — a tool meant to be read correctly in a crisis that silently fails for a
colourblind user has failed at its one job for that user.

## Required tests

| Test | Asserts |
|---|---|
| tier orthogonality | changing `approval_state` on a row never changes its `evidence_tier`, and vice versa |
| pill-match ceiling | any composition row sourced only from visual matching has `evidence_tier` ≤ `MODELED_PREDICTED`, enforced in the domain layer, not just by UI convention |
| responder collapse | all six tiers map to exactly one of the three responder-card buckets, and the mapping is total |
| colourblind-safe rendering | a snapshot test with colour information stripped still allows every tier and approval state to be distinguished by icon and label alone |
| no silent fusion | no code path computes a combined confidence score from multiple `evidence_tier` values without going through an approved `MethodSpec` |
