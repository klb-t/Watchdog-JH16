# Drug-domain ontology and the assertion model

## Why this file exists

Two things were caught by direct questions, not by planning ahead, and both pointed at the same
underlying gap.

First: asked whether substance-centric memory had graph elements. It did not — `substances` had
aliases and identifiers but no edges to anything else, and the two edge tables added afterward
(`substance_relations`, `substance_receptor_bindings`) were bespoke, naked foreign keys with no
provenance, no regional or temporal context, and no way to hold two sources that disagree.

Second: a concrete requirement — easily searching interactions for whatever is commonly sold or
represented as a given substance, amphetamine being the example given. That query needs to walk
*label a specimen was sold under* → *what it actually contained* → *what that actual substance
interacts with*, across region and time, surfacing every hop's evidence tier. Bespoke tables
with no shared shape cannot answer a query like that without a bespoke join for every new
relation type, forever.

A maintainer-directed search of conversation history, cross-checked against an independently
produced recovery package (a second AI's reconstruction of the same project history, supplied by
the maintainer specifically to catch what this side missed — see the provenance note at the end
of this file), converged on the same fix: **a single reified assertion record, not naked edges.**
This file specifies it once; `02_DATA_MODEL.md` carries the resulting tables.

## Generic core vs drug-vertical package — reframing, not new tables

`00_STATE_AND_DECISIONS.md`'s D13 states this precisely; the practical consequence for this file
is simpler: nothing below is core-generic. `Substance`, `Symptom`, `MarketLabel`, `Target`,
`PillType` and the predicate vocabulary are drug-vertical concepts. The `assertions` table's
*shape* (subject/predicate/object, context, provenance, evidence tier, approval state,
contradiction handling) is written generically enough that an unrelated future vertical could
reuse the mechanism, but that is a side benefit, not a requirement being built now.

## The assertion as the atomic fact

Prefer a reified assertion over a naked edge for every drug-domain relation that is
heterogeneous, low-volume-per-fact, or contradiction-prone. The shape, in prose before it is
schema:

- **subject** — a typed reference (`entity_type`, `entity_id`) into an existing node table
- **predicate** — one value from the controlled vocabulary below
- **object** — a typed reference, when the predicate relates two entities
- **value** — a typed scalar, when the predicate states a measured or asserted value rather than
  a relation between two entities
- **context** — geography, language, `observed_at`, `valid_from`/`valid_to`
- **provenance** — source, provider, artifact, citation, fetch event
- **evidence_tier**, **approval_state**, **quality_flags** — exactly as defined in
  `10_EVIDENCE_TIER_AND_TRUST_UI.md`, applied here rather than re-invented
- **contradicts / corroborates / supersedes** — references to other assertion IDs

Two sources disagreeing about the same fact is not an ingestion-time conflict to resolve. Both
assertions are stored; `contradicts` links them; the UI shows both with their tiers rather than
picking one. Nothing in this project averages, silently prefers the newer source, or lets an LLM
synthesise a single answer that hides the disagreement — this is the same principle as the
approval gate, applied to evidence instead of to method proposals.

## Deliberate exception: specimen composition stays typed

`pill_types` / `tested_samples` / `pill_type_composition` remain dedicated tables, not
assertions, for a stated reason: lab-confirmed composition is high-volume, has a stable shape
(a concentration value and unit), and is exactly the kind of fact a typed column serves better
than a generic `value` field. Treat this as the materialized, typed special case the assertion
model would otherwise represent as `CONTAINS` with a numeric value — not as an oversight.

`CONTAINS` and `ADULTERATED_WITH` still exist as assertion predicates for composition claims
that *don't* come from a formal, structured lab result — a forum report of "found X in my Y," at
`RAW_OBSERVATIONAL` tier, with no `tested_samples` row backing it. The boundary: a structured lab
result is a row in `pill_type_composition`; anything looser is an assertion.

## Node classes

Tables, in `02_DATA_MODEL.md`: `substances`, `symptoms`, `targets` (generalises the previous
`receptors` — a receptor, transporter, enzyme or pathway is mechanistically the same kind of
node: something a substance acts on), `pill_types`, `tested_samples`, `market_labels`,
`geographic_regions`.

Deliberately **not** given their own tables, because they are adequately represented as a
predicate plus context rather than a distinct entity: stereoisomers, salt forms, metabolites,
analogs and precursors (all assertions between two `substances` rows, distinguished only by
predicate); legal status (an assertion of `HAS_LEGAL_STATUS`, jurisdiction- and time-scoped via
`context`, never a column on `substances` — legal status is not a timeless property of a
molecule); toxicity syndromes and organ systems (a `symptoms` row with a category, not a
parallel table).

## Predicate vocabulary

```
Identity/structure:
  ALIAS_OF  IS_ISOMER_OF  SALT_OF  METABOLITE_OF  PRECURSOR_OF  ANALOG_OF
  STRUCTURALLY_SIMILAR_TO

Mechanism:
  BINDS_TO  AGONIST_AT  ANTAGONIST_AT  MODULATES  INHIBITS  INDUCES  METABOLIZED_BY

Effects and safety:
  ASSOCIATED_WITH_EFFECT  ASSOCIATED_WITH_SYMPTOM  ASSOCIATED_WITH_TOXICITY
  AFFECTS_ORGAN_SYSTEM  INTERACTS_WITH

Specimens and market:
  CLAIMED_AS  TESTED_AS  CONTAINS  ADULTERATED_WITH  VISUALLY_RESEMBLES

Context and status:
  OBSERVED_IN_REGION  HAS_LEGAL_STATUS  SUBJECT_TO_ALERT
```

`PRECURSOR_OF` is included as a labelled, sourced edge — e.g. "chemical X is a controlled
precursor associated with substance Y" as published in a regulatory or forensic schedule — the
same kind of fact as legal status: naming a published regulatory relationship, not a synthesis
route, ratio, or method. This project does not populate or expose precursor *chemistry*, only the
regulatory/forensic naming relationship, and that boundary holds regardless of what a source
document might otherwise contain.

`INTERACTS_WITH` and the specimen/market predicates are the ones that did not exist anywhere in
this project before today; everything else consolidates tables that already existed as bespoke
edges into the shared mechanism.

## Interaction facts specifically

An `INTERACTS_WITH` assertion is not just two substance IDs. Its `value` or an attached
structured payload carries: mechanism (pharmacodynamic, pharmacokinetic, other), severity
where a curated source states one, population qualifiers where relevant. No responder-facing
interaction fact exists without a citable curated source — this is not a new rule, it is
`11_FIELD_AND_CLINICAL_INTERFACES.md`'s existing "no clinical generation" rule applied to this
specific predicate.

## Market labels and the misrepresentation query

`market_labels` decouples *what something is sold or represented as* from *what it actually is*
— the entire reason this file exists. A label like "amphetamine" or a regional slang term is not
an alias of the substance `amphetamine`; it is its own row, because the empirical point is
exactly that the two can diverge.

```
market_labels(id, label_text, canonical_label_group, language, region_id, notes, created_at)
```

`canonical_label_group` clusters slang and cross-language variants that refer to the same market
claim (e.g. "amfetamina", "speed", "amfa" under one group) so a search resolves the cluster, not
one exact string — resolution mode is explicit and versioned per §Query expansion modes below,
never silent.

`tested_samples` gains `claimed_label_id`, nullable, referencing `market_labels` — what the
specimen was represented as when tested or reported, independent of `pill_type_composition`'s
lab-confirmed actual substance(s).

**The acceptance query this whole file exists to answer:**

> For region R and time window T, for products represented or sold under labels in the
> `amphetamine` market-label group, return the tested or otherwise evidenced actual
> compositions/adulterants, ranked by frequency in the sample set; for each actual substance
> found, return its known interactions; attach region/time context, evidence tier, provenance
> and any contradiction flag to every hop.

Mechanically: resolve the label group (§Query expansion modes) → join `tested_samples` on
`claimed_label_id` within R/T → join `pill_type_composition` for actual substance(s), each
already tiered per the visual-match ceiling in `11_FIELD_AND_CLINICAL_INTERFACES.md` → join
`assertions` where `predicate = INTERACTS_WITH` for each actual substance found. Every step is a
deterministic query over stored, cited rows. No step is an LLM narrating what it believes to be
true — this is the same "no LLM in the numerical or clinical path" rule this project has applied
everywhere else, walked across one more join.

`VISUALLY_RESEMBLES` and `ADULTERATED_WITH` back the "counterfeit" framing directly: a
counterfeit is an evidence-backed classification — a `TESTED_AS` or `CONTAINS` assertion that
disagrees with the specimen's `CLAIMED_AS`/`claimed_label_id` — never a label applied on the
strength of a visual mismatch alone.

## Query expansion modes

Four modes, explicit and versioned on every query plan, never silently mixed:

| Mode | Behaviour |
|---|---|
| `STRICT_CANONICAL` | canonical substance names only; default for longitudinal research |
| `SCIENTIFIC_SYNONYMS` | adds pharmacological/chemical synonyms |
| `LOCALIZED_SYNONYMS` | adds region/language-scoped names, including known market labels |
| `EXPERIMENTAL_SLANG_EXPANSION` | adds crowd-sourced slang; results carry a stronger caveat |

The amphetamine-interactions query above runs in `LOCALIZED_SYNONYMS` or wider by construction —
it is explicitly about market labels, not canonical names — and that mode is recorded on the
query plan, not inferred after the fact. A longitudinal research series, by contrast, defaults to
`STRICT_CANONICAL` so a later change in what counts as a synonym cannot silently splice two
different measurements into one series; changing mode on an existing series is a discontinuity,
flagged the same way a provider change is (`05_PROVIDERS_AND_CAPABILITIES.md`).

## Substance profile projection — canonical content order

Supersedes the shorter list in `10_EVIDENCE_TIER_AND_TRUST_UI.md`'s Axis 2, which is hereby
extended rather than contradicted:

1. Identity / names / aliases
2. Chemistry and structural relations (isomers, salts, metabolites, analogs)
3. Pharmacokinetics
4. Pharmacodynamics / mechanism
5. Acute toxicity / overdose signs
6. Chronic effects
7. Interactions
8. Preparations / pills / samples
9. Regional / time signal
10. Research citations
11. Legal status
12. Alerts

Evidence tier remains orthogonal to this order, exactly as before — a fact's position is fixed by
category, its colour by tier, independently.

## Provenance of this file

Recovered from two independent directions converging on the same design: the maintainer's own
2025-09 → 2026-04 conversation history (already the source of D12), and a separately
GPT-produced recovery package the maintainer supplied specifically to catch what the Claude-side
search had not surfaced. Where the two disagreed on framing (notably: whether RBAC belongs before
or alongside the current auth-deferral decision), the disagreement is recorded in
`00_STATE_AND_DECISIONS.md` rather than silently resolved in either direction.
