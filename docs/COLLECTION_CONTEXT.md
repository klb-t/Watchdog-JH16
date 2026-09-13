# Collection purpose and acquisition context

In **Automatyzacja → Plan zbierania**, public substance refreshes and paper scans offer
**Cel zbierania danych**: **Baza odniesienia**, **Badanie**, **Monitoring**, or **Cel nieokreślony**.
The selection is preserved when a schedule is saved, paused, resumed or copied, and when
it dispatches a job. Running once uses the same metadata and acquisition machinery.
The job's **Wyniki i pochodzenie** includes the captured context and every HTTP receipt.

Purpose is declared intent. It does not select a scientific method, increase sampling
resolution, change retention, grant access or start an alert. Actual acquisition depends
on the source profile and request parameters; recurrence depends on the saved schedule.
The worker still requires a running server and persistent storage.

## Identity and preservation

Public requests optionally carry `collection: {version: "collection-purpose-1", purpose}`.
The queue validates the request and freezes a `collection-context-1` object containing
the purpose and an `acquisitionHash`. The hash is SHA-256 of the canonical JSON object
`{version: "collection-acquisition-1", request}`, excluding only the collection intent.
Consequently:

- Changing purpose preserves the acquisition hash but changes the collection context.
- Changing query names, provider order, scope, request/page limits or lookback changes
  the acquisition hash. Order matters because a bounded job may stop before its last query.
- Source-profile hash and adapter version remain separate source-context dimensions.
- Job IDs, owners, recurrence and execution dates are not acquisition parameters. Matching
  request hashes do not establish equal sampling cadence, completeness or population coverage.

Each receipt copies the frozen context from its job before asynchronous raw storage,
including unsuccessful HTTP and transport responses. The context fields cannot be updated.
A rewritten queued request cannot execute if its computed collection context differs from
the original snapshot, even if the request checksum was also rewritten.

The existing queue retains the owner's actual request. Shared reference history exposes
its hash, rather than adding the owner's other query names to a public reference record.
This is an identity mechanism, not a claim of anonymization or scientific comparability.

## History and export

In **Pamięć substancji → Historia źródeł i porównanie wersji**, each source-context choice
shows its purpose. Counts, versions, transitions and comparison inputs belong to that
specific context. Different purposes or acquisition hashes cannot silently merge into
the same timeline or pairwise comparison. The same preserved content may still deduplicate
across contexts: its receipt associations retain where each check came from.

Expand the context or a receipt to inspect the full hash. A downloaded source-comparison
JSON includes the context on both receipts and in its top-level source context. The existing
CLI verifier checks those identities as well as the saved values and recomputed differences.
See [SOURCE_HISTORY](SOURCE_HISTORY.md) for the command and separate expected-hash requirement.
The display labels/descriptions are validated, hashed data in `config/collection-ui.json`.

## Compatibility

Migration 017 adds nullable context columns to jobs and receipts, without editing published
migrations. Historical rows stay unclassified; no intention or request plan is guessed.
An omitted purpose remains an omitted JSON property, preserving old request hashes,
source-context hashes, default source-profile identity and comparison exports. Choosing
**Cel nieokreślony** removes the optional field. Existing wizard/default plans retain their
previous behavior. Non-acquisition tasks do not accept collection intent.

The three purposes use one pipeline as required by the lifecycle specification. Named
project collections, resolution/retention policies, geographic acquisition filters,
materialized series and operational alerts remain further work. Language and geography
remain separate concepts; this addition invents neither geographic coverage nor observations.

## Validation

Integration coverage checks scheduled dispatch and pause, immutable success/error receipts,
changed-plan separation despite content deduplication, offline export tamper detection,
request-snapshot corruption and upgrade from a database created before migration 017.
Browser coverage saves a baseline schedule, preserves its purpose while pausing, selects
separate baseline/research histories, exports and verifies the baseline comparison, and
checks mobile layout. Tests use fictional source records and make no paid or public calls.
