# Responder reference slice

Start with `npm ci`, then `npm run dev`. In local mode, the development principal has full
capabilities. Production must use the existing OIDC and durable-storage configuration.

Open **Evidence review**. Import one versioned source-catalog mapping or one JSON document.
Read its cited original, normalized mapping, evidence tier, region, date basis, missing fields
and complete SHA-256. One explicit review action approves that content. Importing, retrieving,
editing or waiting never approves it. Changed graph content derives PROPOSED on the next read.

Open **Responder** for appearance, market-name or source-vocabulary symptom lookup. A green
measurement badge describes the reference specimen, while the separate orange match badge
always describes an inferred match. National bulletins appear only as broader context when
that option is requested for a subregion. Composition frequencies use distinct local laboratory
sample IDs; mixed specimens can contribute to several components. They are not prevalence.

The catalog currently contains national Netherlands bulletins and a proposed interaction
mapping. It has no live specimen-feed connector, local coverage guarantee or exhaustive clinical
corpus. Missing records and unknown amounts remain visible. Source updates require new imports
and individual reviews. A refreshed offline snapshot does not change a source's retrieval date.

**Offline:** synchronize while authenticated. Production caches only the application shell;
reference data lives in a separately verified snapshot tied to the principal. The configured
window is eight hours. Every offline lookup persists an outbox entry before showing its result.
Synchronize again to upload receipts; repeated delivery is idempotent and server audit marks
client-reported time/results as unverified. Expired/corrupt caches or full/unwritable audit
storage refuse offline lookup. Server authentication denial clears access. Signing out clears
cached references and pending local receipts. Offline revocation checking is inherently delayed
until reconnection or expiry; the UI discloses that limitation.

Emergency/poison-control contacts and evidence/category presentation are versioned data in
`config/field/responder.json`. These contacts are specific to the configured region. The safety
strip is rendered before data loading and remains visible for an error or missing capability.

Boundary traces and access checks are exercised by `tests/integration/field_reference.test.ts`;
rendered badge and client-cache behavior by `tests/unit/field_ui.test.ts`. All clinical fixtures
are explicitly fictional and isolated from the real proposal catalog.
