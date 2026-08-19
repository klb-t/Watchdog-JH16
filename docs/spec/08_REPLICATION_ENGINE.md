# Replication as a first-class object

## The idea

A system that can replicate JH2016 from its published description is, structurally, a system
that can attempt replication of other published work. The replication crisis is a real target,
and this platform has an unusual claim on it: every number it produces already carries
provenance, every method is already a declarative specification, and every model proposal
already passes a human gate.

The move made now is deliberately cheap: the schema and the vocabulary exist from E1, and
JH2016 becomes replication target number one. The autonomous parts wait for E5. This costs
almost nothing today and turns the later capability into a feature rather than a redesign.

## Model

A **replication target** is a published work with an identifier, a citation, and its prose
methodology.

A **claim** is one falsifiable numeric or ordinal assertion the paper makes, with a tolerance
band the researcher sets in advance. Setting tolerance before the attempt is the entire
methodological point — a tolerance chosen after seeing the result is not a tolerance.

An **attempt** is one run of a compiled method against acquired data, targeting a specific
target.

A **verdict** is the comparison of one observed value to one claim.

## Verdict vocabulary

Four values, and the choice of words is load-bearing:

| Verdict | Meaning |
|---|---|
| `reproduced` | observed value falls within the pre-registered tolerance |
| `deviates` | observed value falls outside tolerance; the magnitude and direction are recorded |
| `not_computable` | data insufficient — missing observations, provider failure, undefined metric |
| `method_unclear` | the paper's description does not determine a unique method; the ambiguity is recorded |

There is deliberately no `failed`. A replication that does not match is a result. A vocabulary
that pushes toward one conclusion produces literature that leans, and the whole purpose here is
the opposite.

`method_unclear` deserves particular emphasis: it is often the most informative outcome, and
most replication tooling has no way to express it. When the compiler in
`04_METHOD_COMPILER_AND_APPROVAL.md` marks a step ambiguous and no human disambiguation is
available, that ambiguity becomes this verdict rather than being resolved by a guess.

## Tolerance kinds

| Kind | Use |
|---|---|
| `absolute` | observed within ± value of claimed |
| `relative` | observed within ± value proportion of claimed |
| `rank_correlation_floor` | a rank correlation at or above a floor — the right kind for JH2016 |
| `interval` | claimed value falls inside an observed interval, or the reverse |

## JH2016 as target #1

Registered at E1 task E1.20. Claims to encode, with the maintainer setting the tolerance bands:

- the reported correlation between the harm index and the reference harm scores, as
  `rank_correlation_floor`
- the ordinal ranking of substances by `Pi`, compared by rank correlation rather than by exact
  position
- specific reported `Pi` and `Hi` values where the paper states them, as `relative`

An important honesty constraint on this target: search-engine result counts in 2026 are not the
counts of 2016. A `deviates` verdict here is expected and is itself the finding. The system
must not be tuned until it produces `reproduced`, and any temptation to widen a tolerance after
seeing a result is the exact failure mode this whole apparatus exists to prevent. Tolerance
changes are versioned and visible.

## Deferred to E5

- automated discovery of candidate papers from literature APIs, filtered by whether their
  method is expressible in the primitive registry — which is a sharp and honest filter
- automated extraction of claimed values from paper text, entering as `PROPOSED` extraction
  candidates requiring approval like everything else a model produces
- scheduled re-attempts producing a longitudinal record of whether a finding holds over time,
  which is a genuinely novel artifact
- a public replication register
- the full autonomous pipeline (`DISCOVERED → SCREENED → METHOD_EXTRACTED →
  FEASIBILITY_ASSESSED → REPLICATION_PLANNED → DATA_ACQUIRED → REPLICATED →
  INDEPENDENTLY_CHECKED → META_ANALYZED → REPORT_DRAFTED`); a candidate-prioritisation formula
  (`replication_value × feasibility × data_availability × methodological_clarity ÷ cost`) is
  recorded as a design seed, not an approved scoring method — same non-implementation status as
  the evidence-fusion weights in `10_EVIDENCE_TIER_AND_TRUST_UI.md`, and for the same reason

When this is eventually built, a replication assessment records method fidelity, data
fidelity, population/context fidelity, analysis fidelity, effect direction, effect magnitude,
uncertainty, deviations and limitations as separate fields. It never collapses them into one
"replicated / not replicated" score — the four-value verdict vocabulary above exists precisely
so no later feature quietly reintroduces that collapse through a back door.

None of this is built now. The schema is.

## Constraints

- a replication attempt uses an `APPROVED` method spec, with no exception for automation
- tolerance bands are set before the attempt, versioned, and never edited silently
- a verdict references the attempt, the manifest, and the input hashes, so it is auditable end
  to end
- the system never announces a replication in prose that its verdicts do not support — the
  reporting-language rule in `03_JH2016_CONTRACT.md` applies to every target
