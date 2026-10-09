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
