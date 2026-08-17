# Method compiler and approval gate

## The problem being solved

A researcher describes a method in prose, the way it appears in a paper. The system must turn
that into something executable without ever putting a language model in the numerical path,
and without letting an unreviewed machine proposal reach a result a human might read as
measured.

Two mechanisms answer this: the compiler emits a declarative specification rather than code,
and an approval gate enforced in the domain layer separates proposal from execution.

## MethodSpec

A `MethodSpec` is a validated, hashable, declarative structure over a registry of
deterministic primitives. It is data. It is never `eval`'d, never templated into source, never
written to disk as executable anything.

```ts
interface MethodSpec {
  specVersion: string;
  name: string;
  inputs: InputBinding[];      // named series with declared unit and semantic type
  steps: MethodStep[];         // ordered; each references a registered primitive
  outputs: OutputBinding[];    // named results with unit and semantic type
  assumptions: string[];       // declared, checked where checkable
}

interface MethodStep {
  id: string;
  primitive: string;           // must exist in the primitive registry
  params: Record<string, JsonValue>;
  inputs: Record<string, string>;   // references to input or prior step ids
}
```

Validation, all of which must pass before a spec can be stored:

- every `primitive` exists in the registry and its version is recorded
- every parameter satisfies the primitive's declared parameter schema
- every input reference resolves, and the graph is acyclic
- declared units are compatible along every edge — a count may not flow into a primitive
  expecting a proportion
- missing-value policy is declared explicitly at every step that can encounter one
- every output is produced by some step

An invalid spec is rejected with the failing path. It is never partially stored.

## Primitive registry

Primitives are small, total, deterministic functions with declared contracts. E1 needs only
these; add more as methods require them, never speculatively.

| Primitive | Contract |
|---|---|
| `max` | numeric series with missing policy → scalar; fails explicitly if no valid value |
| `ratio` | numerator, denominator → series; denominator ≤ 0 yields undefined, not zero |
| `scale` | series, factor → series |
| `pearson` | two aligned series → coefficient, n, p |
| `spearman` | two aligned series → coefficient, n, p |
| `align` | two series, join key, missing policy → aligned pair with an alignment report |
| `describe` | series → count, valid count, missing count, min, max, mean, median, sd |

Each primitive declares: parameter schema, accepted input shapes and units, output unit,
missing-value behaviour, and whether it can fail and how.

JH2016 expressed in these: `Pi = scale(ratio(Ni, max(Ni)), 100)` and
`Hi = scale(ratio(Ni_harm, Ni), 100)`.

## Compiler

Input: prose describing a method, plus the shape of the available series.
Output: a `MethodSpec` in state `PROPOSED`, together with the prose it came from, the provider
and model that produced it, and a per-step rationale referencing the sentence it derived from.

The compiler is provider-neutral — it uses whatever language provider is configured, per
`05_PROVIDERS_AND_CAPABILITIES.md`.

Hard constraints:

- the compiler may emit only registered primitives; a spec referencing an unknown primitive is
  rejected rather than causing a primitive to be invented
- the compiler never proposes a numeric constant that did not appear in the prose; if it needs
  one, it emits a required parameter for the human to fill
- ambiguity is surfaced, not resolved. Where the prose admits more than one reading, the
  compiler emits the alternatives and marks the step `ambiguous`, and an ambiguous step blocks
  approval until a human chooses.

### Known-answer test

The compiler's acceptance test, and the reason to believe it works at all: feed it the prose
methodology section of JH2016 and assert that the emitted spec computes exactly
`Pi = Ni / max(Ni) × 100` and `Hi = Ni_harm / Ni × 100`, with the correct missing-value
policy on the `ratio` steps.

A compiler that cannot recover a known method from the paper that describes it does not work,
regardless of how well it performs on anything else. This test is not optional and does not
get marked as expected-to-fail.

## Approval gate

Two states only: `PROPOSED` and `APPROVED`.

Everything a model produces starts `PROPOSED`: method specs, narrative text, discovered
providers, extraction candidates, suggested reference mappings.

### Enforcement

In the domain layer, not the UI:

```ts
function requireApproved(artifact: Approvable): void {
  if (currentHash(artifact) !== artifact.approvedHash) {
    throw new ApprovalRequiredError(artifact.kind, artifact.id);
  }
}
```

Called at the entry of: method execution, export, manifest finalisation, narrative inclusion,
and any live provider call.

**Approval binds to the content hash.** Approval stores the hash that was approved. Any edit
changes the hash, and the artifact is `PROPOSED` again with no further action — because the
check is a comparison, not a stored boolean. Do not implement this as a flag that an update
must remember to clear; that is the version that eventually fails.

### Rules

- one human action approves one artifact. There is no bulk approve, no approve-all, no
  auto-approve-on-timeout, no configuration flag that disables the gate
- approval records who, when, and which hash, into `audit_events`
- revocation is possible at any time and cascades: a run whose method spec was revoked is
  marked and its exports flagged
- a `PROPOSED` artifact never reaches a chart, an export, a manifest, or a page that presents
  results as findings

### Presentation

`PROPOSED` renders red and is labelled as a proposal awaiting review. `APPROVED` renders
green. Deterministic content — anything computed by code from stored bytes — is visually
distinct from both, because it was never a proposal.

This colour convention is deliberate and carries into exports: a PDF or DOCX export must make
generated prose visually distinguishable from computed results. A reader who did not run the
analysis must be able to tell, from the artifact alone, which parts a machine wrote.
