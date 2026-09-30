# Source catalog and access assessments — E3.12

Open **Dostęp do danych** (`/source-access`). The profile seeds 34 named catalogs,
platforms and services, including ten forums/community services. It is extensible,
not an exhaustive inventory of the internet. Add a private candidate from the UI;
it cannot create an adapter, execute code or cause a network request.

This operational catalog is separate from the scientific measurement registry at
`/sources` (D5). Public adapter implementation is derived from `automation.json`:
PubChem, ChEMBL, Wikidata, Europe PMC and arXiv are implemented. Other catalog entries
remain candidates even when their API exists or a user records permission.
SERP/LLM providers remain in their existing provider/settings surfaces.

## Independent dimensions

- Proposed channels: API, RSS/Atom, file export, HTML or manual import. A channel is
  a candidate unless its linked technical evidence verifies it. Documentation evidence
  names the channel it supports: a JSON download does not prove an API exists.
- Runtime integration: existing public profile, explicitly permitted for its complete
  configured scope, held for the current owner, or not implemented.
- Terms evidence: linked documentation, check date and a scoped note. Unchecked links
  remain unchecked; neither a public page nor an API establishes project permission.
- Private access assessment: unreviewed, permission needed, request sent, permitted or
  denied, plus derived expired/stale states. Each assessment preserves its exact source
  and adapter snapshot, basis, reference, scope and optional expiry. This is a user's
  documented assessment, not a supplier-issued credential or a legal determination.
- Activity: HTTP attempts, successful responses with archived bytes, failures, last
  attempt/success and latest response error, from the current owner's public jobs.
  These do not measure parsed scientific records, coverage, approval, SERP acquisition,
  manual imports, or another owner's jobs. No attempt is different from a failed attempt.

Counts show all these dimensions separately. Filtering and JSON export retain exact
profiles and assessment hashes. The JSON overview is a status snapshot, not a scientific
manifest or a complete export of access history. A detail view shows the newest 100
assessments and drafts, with truncation explicitly indicated; older rows remain stored.

## Access holds on public collection

An installation upgrade creates no private assessment. Existing authorized public
adapters keep their current profile behavior, displayed as `profile_default`, not as a
newly verified grant. Once an owner records an assessment, their subsequent requests
are held unless the assessment is current, unexpired, `permitted` and explicitly covers
the **entire configured public adapter**. Narrower agreements stay `catalog_only` and
need a separately constrained adapter profile before automation can use them.

The gate runs before obtaining a source lease and again after pacing, immediately before
each network request. This covers one-off and scheduled jobs and retains existing
timeouts, URL boundaries, request budgets and rate limits. Already dispatched requests
may finish. A hold appears in job results/TRACE (`SOURCE_ACCESS_HELD`), without inventing
an HTTP receipt for a request that never happened. The next occurrence of a held recurring
schedule still checks policy; the schedule itself is not silently disabled.

The gate applies to this public acquisition pipeline only. It does not revoke existing
stored data, implement contractual deletion, prohibit manual imports, or claim that other
provider pipelines enforce these assessments. Changing source/profile contents invalidates
the assessment. Revocation belongs to the job owner and does not change other owners' access.

## Requests and persistence

An English request template copies the applicant's supplied purpose, requested data,
processing (including any proposed LLM use), retention and commercial context. No affiliation,
recipient address or permission is invented. Saved drafts remain **unsent**. Downloading a
draft does not mark a request sent; the owner records that status with a correspondence
reference after actual contact. There is no email sender or automatic external contact.

Migration 019 stores private candidates, append-only assessments and append-only drafts.
Writes use the existing audit chain. Assessment writes require the current source hash and
previous revision ID; stale tabs are rejected. Ownership transfer retains historical payloads
and hashes. An imported permission cannot activate an unimplemented forum connector.

The API requires `provider.view`; mutations additionally require `run.create`, JSON and
the existing same-origin check. All responses use `no-store`:

- `GET /api/source-access`: profile, rows and counts.
- `POST /api/source-access/candidates`: private candidate metadata only.
- `GET /api/source-access/:id/history`: own recent assessments/drafts.
- `POST /api/source-access/:id/assessments`: sourceHash, previousId and decision.
- `POST /api/source-access/:id/drafts`: sourceHash and request context.

## Checked source notes and remaining integrations

Technical and terms evidence was checked on 2026-09-20 against primary documentation.
The profile links directly to the evidence. For example, Reddit's terms require a separate
agreement for specified uses including commercial use and research beyond rate limits;
this is not a claim that every research use has the same requirement.
[Reddit Data API Terms](https://redditinc.com/policies/data-api-terms).

Mastodon access depends on the instance; the generic entry is not authorization for any
particular server. [Official timelines documentation](https://docs.joinmastodon.org/methods/timelines/).
TripSit's official repository contains JSON databases; rights and clinical assertions need
separate assessment. [TripSit data repository](https://github.com/TripSit/drugs).
Google's documented Trends API is an alpha with application-based access; no Watchdog
access or adapter is implied. [Official alpha information](https://developers.google.com/search/apis/trends).

The Erowid/Bluelight terms pages could not be verified in this environment. No blanket
scraping permission or definitive API-absence claim was imported from another model.
Forum connectors, generic HTML extraction, automated terms monitoring, outbound requests
and retention/deletion workflows remain open. Existing JSON/CSV parser trials still copy
values deterministically; an LLM may propose extraction structure, not transcribe observations.
