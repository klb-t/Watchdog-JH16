# Watched sources and unread changes

In **Pamięć substancji**, select a substance and a source context in its history, then
choose **Obserwuj nowe zmiany**. The private **Obserwowane źródła — zmiany do przejrzenia**
panel lists watched contexts and their unread change counts. Select one to inspect the
new pairs of records, open **Pokaż dokładne różnice**, or download the existing verifiable
source-comparison JSON. The same renderer and export implementation serve both views.

Observation starts at the latest linked record when the subscription is saved. Existing
history remains available in the history view; it does not become a backlog of new alerts.
Repeated subscription is idempotent and preserves an existing reading cursor and pause.

## What a change means

The versioned rule `source-record-change-1` compares consecutive preserved content hashes
within one exact source context. Repeated identical content creates a recorded check but
no change entry. Returning to an earlier content version is a new change relative to the
preceding record. The context includes substance, provider, record kind, exact source URL,
adapter, source profile and optional collection purpose/acquisition hash. Changing any of
those requires a separate watch; a watch never silently follows a replacement source or plan.

The reading queue follows **journal insertion sequence**, which is permanent. A receipt
linked late is still new to the queue even if its retrieval date is older. Both receipt
dates and sequence IDs are displayed. This differs intentionally from the existing history
timeline's retrieval-date ordering: the queue tracks newly available records, not a claim
that the external source changed in that same temporal order. Each comparison names its
two actual preserved inputs, without inferring source publication time or source revision.

Only successful linked reference records participate. Failed fetches remain in job receipts;
they are not zero observations or a new successful check. No new changes in this panel does
not establish that an external source is unchanged, reachable or completely sampled.
The separate receptor-activity assertion collection and paper-discovery revisions do not
yet have this watching interface.

## Reading and concurrent acquisition

The first page contains the earliest unread changes, capped by the profile. It captures an
explicit upper sequence bound. **Oznacz tę partię jako przeczytaną** advances only through
that bound, including intervening identical checks. If the page has more changes, marking
it read loads the next batch. New arrivals after the displayed batch remain unread.

Reading state is private. All writes require the owning principal and a current revision;
a stale browser tab cannot overwrite another tab's update. A cursor cannot move backward
or into another source context. Reading does not approve scientific evidence, resolve a
source conflict or change a source record. GET requests leave reading state unchanged.

**Wstrzymaj obserwowanie** preserves the backlog and excludes that watch from the active
total. Resuming includes records added during the pause. State persists across restart and
the existing local-user ownership transfer; transfer retains separate saved reading states
if the destination already watches the same context. The initial profile permits 100 saved
watches per owner, including paused ones, and 20 changes per batch. These limits and all
new labels are validated profile data in `config/source-watch-ui.json`.

## Acquisition, access and diagnostics

A watch reads the existing public reference journal from the instance. It does not start
another collector or require a model/API key. To acquire new data repeatedly, configure the
existing [scheduler](AUTOMATION_AND_MEMORY.md) and keep its server/storage available.
Open or refresh the memory panel to read the newest saved changes. There are no email,
browser-push or external-message deliveries in this stage.

The existing memory capability gate applies: responder lookup or evidence review. A watch
does not expose another owner's watch or private reading history. The source records remain
the public reference material already readable through memory; a matching record may have
been collected by another authorized job. Cross-origin and malformed writes are rejected.

Migration 018 adds `source_watches`, without backfilling subscriptions or editing earlier
migrations. Context/rule identity is immutable and reading cursors are monotonic. Updates
enter the existing audit hash chain. The interface exposes the context, watch revision,
reading/batch bounds and display-profile hash. TRACE records bounded batch metadata under
`SOURCE_WATCH_CHANGE_BATCH`. The scientific comparison export contains preserved source
data and hashes; it does not export private reading preferences.

This is a source-record reading queue. Clinical/batch alerts, market anomaly detection,
cross-source interpretation and public alert publication remain separate work.

## Verification

Seven integration cases cover repeats/reversions, bounded pages and concurrent arrivals,
stale updates, pause/resume, context separation, late-linked receipts, restart, ownership
transfer, immutable source/watch identities, migration, access and real public-adapter
execution with fictional transport responses. The Chromium flow subscribes from history,
compares and exports records, preserves a concurrent arrival while marking a batch read,
resumes after reload, and checks the mobile layout. No test makes a live public or paid call.
See `ASTRA_PROGRESS.md` and the PR for the results observed on each published commit.
