# Responder reference slice

Start with `npm ci`, then `npm run dev`. In local mode, the development principal has full
capabilities. Production must use the existing OIDC and durable-storage configuration.

Open **Evidence review**. Import one versioned source-catalog mapping or one JSON document.
Read its cited original, normalized mapping, evidence tier, region, date basis, missing fields
and complete SHA-256. One explicit review action approves that content. Importing, retrieving,
editing or waiting never approves it. Changed graph content derives PROPOSED on the next read.

Open **Responder** for appearance, market-name or source-vocabulary symptom lookup. A green
measurement badge describes the reference specimen, while the separate orange match badge
always describes an inferred match. The regional result keeps the selected region and optionally its broader regional bulletins.
A separate **Global archive context** shows other approved matching records, including broader
bulletins omitted from that regional result. “Global” means available archived records, not
complete worldwide coverage. Local laboratory denominators stay local; the archive denominator
is separately deduplicated by publisher/source specimen ID. Mixed specimens can contribute to
several components, and multiple source versions never become independent specimens. Neither
count is prevalence. Source dates, missing components and provenance stay with each record.

Market-label resolution is performed separately for the selected regional context and the
whole archive, retaining the chosen language. A label from another region may reveal alternative
market groups; it does not establish local label use or turn a market group into a chemical
synonym. Substance facts for an additional sample use that sample's reference-region context,
not the selected region. Global discovery currently applies to appearance and market names;
symptom associations retain the existing region and clinical-evidence eligibility boundary.

Full six-kind evidence display is the default. The optional compact responder profile groups
colors while retaining every original kind label and icon. Colors describe how evidence was
established; they do not measure confidence, objectivity, clinical probability or universal trust.
Approval and category order remain independent, and the profile never edits evidence data.
The six-kind legend does not widen eligibility for clinical content.

Search links prefill descriptors without executing a lookup. An exact approved sample, target
or interaction mapping can be inspected separately from the verified synchronized snapshot,
with citation, content hash, approval and snapshot dates. Nonprimary/noncurated clinical
statement text remains withheld. Exact inspection rechecks principal and snapshot expiry at
render/navigation and hides automatically on expiry; synchronize to check current revocations.

The catalog currently contains national Netherlands bulletins and a proposed interaction
mapping. It has no live specimen-feed connector, local coverage guarantee or exhaustive clinical
corpus. Missing records and unknown amounts remain visible. Source updates require new imports
and individual reviews. A refreshed offline snapshot does not change a source's retrieval date.

**Offline:** synchronize while authenticated. Production caches only the application shell;
reference data lives in a separately verified snapshot tied to the principal. The configured
window is eight hours. Every offline lookup persists an outbox entry before showing its result, including the global
result IDs. Exact offline reference inspection verifies the cached mapping and persists its own
`reference_inspection` receipt before exposing it; it does not pretend to execute a query.
Synchronize again to upload receipts in bounded requests without truncating result IDs. Repeated
delivery is idempotent, and server audit marks client-reported time/results as unverified. Expired/corrupt caches or full/unwritable audit
storage refuse offline lookup. Server authentication denial clears access. Signing out clears
cached references and pending local receipts. Offline revocation checking is inherently delayed
until reconnection or expiry; the UI discloses that limitation.

Emergency/poison-control contacts and evidence/category presentation are versioned data in
`config/field/responder.json`. These contacts are specific to the configured region. The safety
strip is rendered before data loading and remains visible for an error or missing capability.

Boundary traces and access checks are exercised by `tests/integration/field_reference.test.ts`;
rendered profiles, distinct denominators, exact-reference inspection, expiry and audit persistence
by `tests/unit/field_ui.test.ts`. Browser tests cover global alternatives, profile switching,
exact search links and offline/expired inspection in `tests/e2e/workbench_field.test.ts`. All clinical fixtures
are explicitly fictional and isolated from the real proposal catalog.

The production shell generator writes the worker atomically and reads it back against the actual
`dist/index.html`: the cache version must match its bytes and all currently referenced client
modules/styles must be cached and present. `tests/integration/field_shell.test.ts` checks the
actual build and rejects stale HTML versions or omitted current modules. A mismatched worker can
otherwise reload an empty app offline even when the reference snapshot itself is valid.
