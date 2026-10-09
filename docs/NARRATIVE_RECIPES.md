# Narrative recipes and immutable proposals (WD-001, 2026-10-09)

`config/narratives.json` is the validated `watchdog.narrative_catalog/1` source for
narrative selection. Both deterministic summaries and provider rewrites resolve
an exact template ID/version through this catalog. Missing files, malformed data,
unknown versions, duplicate identities and unsupported bindings fail explicitly;
there is no embedded fallback or second configuration engine.

The default `jh2016-summary@1.0` preserves the previous English content, content
hash, top-three ranking, and provider system/prompt bytes. `summary-pl@1.0` is a
second implemented presentation recipe with Polish text and all ranked entries.
It is not a new scientific method, model recommendation or quality measurement.
Frozen JH16 configuration and numerical primitives are unchanged.

A recipe holds its locale, metric keys, ordering and tie policy, `topK`, text,
separators, and provider prompts. `topK=null` keeps all entries; zero suppresses
the ranking line; any nonnegative integer is accepted. `input_order` preserves
historical tie behavior; `entity_id` is the explicit alternative. Null values
remain missing. Locale describes the supplied text; it does not invoke hidden
translation. Templates support only validated named bindings and one-pass inert
substitution. A source value containing braces cannot introduce another binding.
The catalog is read on each request, so a data change needs no application rebuild.

## Runtime and API

All run routes retain their existing ownership/capability gate and no-store
response policy. Selection fields are `templateId` and `templateVersion`, supplied
together; absence of both selects `defaultTemplate` from the catalog.

- `GET /api/runs/:id/narrative?templateId=summary-pl&templateVersion=1.0` previews
  the selected deterministic recipe. GET does not archive or call a provider.
- `POST /api/runs/:id/narrative` with `{}` or the selection fields explicitly
  generates and archives a deterministic **PROPOSED** narrative. It requires
  `narrative.approve`, same-origin JSON, and does not itself approve anything.
- Existing `POST .../narrative/generate` additionally accepts the selection fields
  alongside its existing provider/model choices. Existing
  `POST .../narrative/automatic` accepts them alongside required `consent:true`.
  Unknown fields or invalid selections fail before provider discovery, reservation,
  or dispatch. Neither route silently substitutes deterministic prose on failure.
- `GET /api/runs/:id/narratives/:artifactId` reads an archived proposal, verifies
  its stored byte hash, and rechecks ownership after storage I/O. It does not
  regenerate the proposal from the current catalog.

The three successful POST paths return `{narrative, artifact:{artifactId,sha256}}`.
They use the existing ObjectStore and ArtifactRepository, with content-addressed
JSON bytes and the existing owning run. They never overwrite a finalised manifest.
A storage failure is an error, not a fabricated archived result. Ownership is
checked before and after asynchronous archive I/O; loss of ownership prevents
registering/returning the proposal. A store write that precedes a later DB or
ownership failure may leave an unregistered immutable blob, following the existing
store's behavior; this does not grant access to it or imply a completed artifact.

## Provenance, migration and limitations

New narratives add `producedBy` (`watchdog.narrative_execution/1`): the exact
recipe snapshot/hash, catalog hash, input payload hash, mechanism, prompt/system
hashes when used, and available adapter generation evidence. The latter retains
WD-003's effective parameters, request-body hash and credential **reference**.
Successful provider output remains nondeterministic and PROPOSED. Failed provider
calls retain the existing held budget reservation and do not produce a narrative
artifact. No payer, ledger, retry or adoption policy was added.

Approved JSON exports carry the new binding. Existing CSV behavior is unchanged;
the full receipt remains in the narrative JSON artifact. Legacy narrative objects
without `producedBy` remain exportable through their existing approval gate and
are never assigned invented provenance. Archived objects/old hashes are not
rewritten. New generation requests that previously supplied arbitrary/fictitious
template IDs must select a real catalog entry; pretending those IDs represented
working implementations was the repaired bug. Test fixtures now name the actual
historical recipe without relaxing their assertions.

Implementation decision: add a catalog and archive through existing typed
services/storage, preserving the shipped recipe exactly. Alternatives considered
were rejecting all non-default IDs while keeping literals, or constructing a new
workflow registry; neither would complete the existing declared selection path.
This is a reversible implementation choice, not a new owner requirement. Catalog
ID/version plus content hash identifies the actual recipe; publish a new version
for reviewed recipe changes. Prior archived snapshots remain intact even if the
current file is replaced.

This slice does not add a UI template picker, scientific approval, general R40
settings resolution, a new graph registry, or LLM quality evaluation. A4-WD-001/002/003
(method selection, source-run manifest input, duplicate-entity resolution), WD-011's
existing signed-number guard issue, and other audit findings remain independent.
The existing numeric fabrication guard and human approval mechanisms were retained.
All acceptance inputs and transport responses are public synthetic fixtures.

## Signed numeric admission (WD-011, 2026-10-09)

Provider rewrites still pass through the existing `assertNoNovelNumbers` before
return or narrative archival. Numeric identities now preserve a nonzero ASCII
minus or U+2212 minus, the entire signed exponent, and every decimal digit without
binary `Number` conversion. `9007199254740992` and `9007199254740993` are distinct,
as are arbitrarily small unequal decimal fractions. No rounding tolerance, new
budget, retry policy or scientific computation is introduced.

The existing formatting allowances remain: valid thousands grouping using commas,
spaces or NBSP, leading integer zeros and trailing fractional zeros. ASCII plus is
positive; signed decimal zero remains zero as before. Scientific notation has its
own identity: `1e3` does not authorise `1000` or `10e2`. Mantissa formatting, e/E
case and exponent leading zeros/positive sign may differ without changing that
identity. A nonzero exponent sign change is rejected.

Within the lexical coverage, malformed signs/grouping, decimal comma, leading-dot
fractions, repeated/malformed exponents and radix-looking tokens are opaque: they
can match only their unchanged source spelling. They never authorise their digit
fragments or gain an inferred locale/notation conversion. Prose punctuation and
the shipped `jh2016-faithful` identifier remain usable. This is not a proof of
entity/value association, units, arithmetic expressions, spelled-out numbers or
all Unicode/mathematical notations. Those semantic checks remain outside this
lexical guard; no claim of universal numeric verification is made.

A sign-changing output now produces the existing `validation_error`, with no
returned/archived narrative and no automatic retry. The successful provider
transport is still a successful transport: its existing usage estimate, effective
parameters, response and ledger evidence remain recorded even when the content
fails this later guard. A rejected proposal does not become approved. Actual
transport failures retain their prior held-reservation behavior.

This is a reversible parser correction, not a new owner policy. An ASCII-only
sign patch was insufficient because exponent splitting and binary rounding would
still admit changed quantities; a general numeric evaluator would add unsupported
cross-notation equivalences. Existing artifacts, hashes, human approvals and
finalised manifests are preserved. Historical proposals are not revalidated or
assigned stronger evidence retrospectively; new generation uses the corrected
guard. Deterministic default content and provider prompt bytes are unchanged.
