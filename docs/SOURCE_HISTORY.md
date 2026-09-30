# Source history and version comparison

In **Pamięć substancji**, select a substance, then a source context in **Historia źródeł
i porównanie wersji**. The page shows the number of linked successful checks and distinct
record versions, the first recorded check and the latest linked successful check.
Select two checks and choose **Porównaj zapisane dane**. Identical content remains visible
as a repeated check; a return to an earlier content version is a change from the previous
check. The collapsible timeline retains receipt identifiers, raw-response links and the
first/last check and occurrence count of each content version.

**Obserwuj nowe zmiany** adds this exact context to your private
[watched-source reading queue](SOURCE_WATCHES.md). Its new-record comparisons use the same
export and verifier. Reading state does not alter source evidence or the history timeline.

## Meaning and boundaries

- Comparison requires the same substance, provider, record kind, exact source URL, adapter
  version, archived source-profile hash and optional collection context (purpose and actual
  acquisition hash). Different contexts are separate choices. URL
  parameters are preserved; no semantic URL equivalence or method substitution is inferred.
- Source records and HTTP response bytes are different objects. Two raw responses can have
  different byte hashes but yield identical preserved record content. Both receipts remain.
- The comparison is structural JSON: object-key order is irrelevant; arrays are positional.
  Absent fields, `null`, zero, strings and numbers stay distinct. Decimal text remains exact.
  The tool neither averages measurements nor infers biological, clinical or market changes.
- Source publication dates, revisions and other source metadata remain fields of the record.
  Their timestamps are not replaced with retrieval time or guessed from it.
- This history covers linked successful reference records. Failed fetches and other responses
  remain in Automation's job receipts. A failed later request does not advance the last
  successful check. The separate activity-assertion collection is not yet a per-assay change
  browser, and the page does not claim to capture every historical source change.
- Existing raw reference views, evidence classifications, approval and access rules remain
  available. This addition does not approve source content or send it into clinical projections.

## Persistence and migration

Migration 016 adds `substance_reference_observations`, an append-only record/receipt journal
over the existing content-addressed `substance_reference_records`. A replay of the same
record/receipt pair is idempotent. A fresh successful receipt creates a new association even
when its content already exists. The source-profile hash is captured in the journal and
does not follow later edits of a job row. Content insertion and association are one transaction;
forged, failed, mismatched or contradictory receipts cannot leave a partial content record.

Published migrations are unchanged. Migration 016 backfills only each old record's explicitly
stored first receipt, marked `legacy_first_receipt`. Other old receipts are not reverse-mapped
by URL or content guesses. The UI explains this historical coverage limit. Observed references,
receipts and journal entries are protected against updates/deletion; existing WORM content
rules remain in force. First/last observation times and transitions are calculated over the
whole selected context before pagination. Same-timestamp observations use journal sequence
as a stable tie-breaker.

Migration 017 adds optional frozen [collection context](COLLECTION_CONTEXT.md) to jobs and
receipts. Historical unclassified contexts keep their original hashes. Tagged histories
separate different purposes or request parameters without duplicating identical source content.

## Reusable mechanism and interface profile

`shared/source_history.ts` provides a domain-independent JSON Pointer comparator. It does
not import a source provider, scientific formula, model or database. The memory repository
adds source identity and acquisition context. `config/source-history-ui.json` holds validated
labels, status colors/icons and page/comparison/preview limits. Full context and profile hashes
remain inspectable; a TRACE event `MEMORY_SOURCE_COMPARISON` records the selected observations,
comparison hash, equality and truncation without dumping source values into the event.

An explicit limit flag distinguishes a partial difference list. Full selected record snapshots
remain in the export. Pagination bounds the number of source groups and timeline entries in
one response. Requests that finish after switching the substance or source cannot replace
the current history; changing either comparison input clears the previous displayed result.

## Export and verification

**Pobierz porównanie JSON** downloads both exact preserved record snapshots, their receipts,
source context, comparison profile and limits, structural differences and a content hash.
Original HTTP response bodies are separately available through the receipt links; they are
not embedded in this JSON. The exporter does not require a model, API key or a new source fetch.

From this repository, use the hash displayed with the comparison as a separate expected value:

```sh
node --import tsx scripts/verify_source_comparison.ts comparison.json EXPECTED_SHA256
```

The verifier checks the expected hash, profile/context identities, each record hash and receipt
context, then recalculates the differences from the exported snapshots. A changed checksum
alone does not establish authenticity. This verifies a saved-record comparison, not the truth
of the source or a scientific/clinical conclusion. The verifier uses the repository's installed
dependencies; the JSON itself is portable data.

## Validation

Unit/integration cases cover exact values, JSON Pointer escaping and unusual keys, positional
arrays, explicit traversal limits, repeated checks, reversions, pagination, restart, legacy
backfill, source-context separation, WORM/atomicity, capability gates, a real public-adapter
pipeline against fictional transport responses, and offline verification including rehashed
edits. An additional Chromium flow covers UI comparison, unchanged content, reload, input
invalidation, mobile layout and a downloaded JSON verified through the CLI.

All fixture compounds and records are explicitly fictional; tests do not call external sources.
See `ASTRA_PROGRESS.md` and the PR for observed validation results on each published commit.
