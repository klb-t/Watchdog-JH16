# Visual workbench

Open `/workbench` as a researcher, or use an institutional profile after a researcher explicitly
shares a reviewed aggregate dataset. `/diagnostics` requires the developer capability bundle.
Production build and browser tests run through `npm run test:all`.

## Import and review

The JSON contract is `shared/workbench.ts`. The CSV wizard preserves source bytes, quoting,
delimiter and header-record choice. Types are suggestions; fill the source citation, units,
measure, language semantics, normalization and comparison scope. A suppressed value such as
`<1` remains null with its original text and reason. Unsafe integers are rejected rather than
silently rounded. JSON editing supports source-specific mappings without guessing locale or
geocoding a place name. All imports are PROPOSED; approving a mapping is a separate action.

Repeated imports retain separate events while identical raw documents share one blob. Identical
documents imported by two owners have distinct approval contexts. Only the owner can publish
or revoke an aggregate dataset. Institutional profiles cannot import, curate or expose private
research. A revoked or unavailable dataset cannot be used for a new save/export/analysis.

`config/workbench/default.json` defines implemented renderers, palettes, methods and provider
profiles. Google Trends website exports preserve their within-export 0–100 normalization and
comparison scope. They are relative interest, not counts, sentiment, consumption or routes.
No live API credential is configured. Context and sentiment require a separately sourced,
annotated corpus; model estimates retain their own evidence tier. Arbitrary table imports do
not certify the truth or representativeness of the source.

## Figures and analysis

Choose X/Y and optional Z, color, marker size, alpha, label, series, panel, time and region
columns. Geographic markers require explicit longitude/latitude in degrees; the bundled
Natural Earth basemap is public domain at 1:110m. Center and zoom affect only the viewport.
3D is an orthographic projection with camera controls and labelled axes/ranges; time animation
filters observations and never implies movement. The Scale domain control preserves whole-dataset
domains through time by default; explicit filtered-frame rescaling is also available. Bars show individual observations without
aggregation. Line gaps preserve missing values and provider discontinuities. On maps/3D, a local outlined
mark signals a discontinuity; no geographic boundary is invented. Numeric/date
axes, log exclusions, missing-channel outlines and visible omission counts are explicit.

Hover/focus inspects the raw record. Click/Enter selects it; right-click, Shift+F10 and the
visible Tools button expose the same palette. Statistics use selected rows, or all filtered
rows when none is selected. Each proposed method states its exact data/selection, numeric
units, missing policy and limitations. Review and approve that hash, then execute. Descriptive
statistics and Pearson/Spearman use the existing TypeScript primitive executor. Correlation
does not establish causality, consumption or distribution routes.

Saved figures are immutable owned snapshots. Favourites can restore an exact figure or reuse
its presentation with explicitly chosen current data channels. Settings pin the dataset and
visual-profile hashes, renderer version, filters/selection, camera, labels, palette, scales,
alpha, time and result reference. Changing statistical inputs clears the attached result.
Changing style leaves the mathematical method identity intact. Profile snapshots are archived
by hash in an append-only table. Saved figures and favourite styles automatically load their
historical profile after configuration changes, including evidence labels and colors. Missing
or unavailable renderer implementations fail explicitly; there is no silent substitution.
Restore an exported figure JSON or the package's `workspace.json` through the file control.
Restoration checks the exact dataset's current access and approval, and ownership of an attached
analysis. It restores settings; it never imports or approves a dataset using an old receipt.

Browser figures and server-generated SVG exports use the same shared renderer. SVG carries vector marks, metadata, source identity, missingness and fully opaque evidence-tier
and mapping-approval labels. It supports up to 12 panels; a larger preview is labelled and SVG
export is refused until filtered. JSON retains the complete figure, dataset, profile and
verified attached analysis. CSV exports the filtered/selected raw rows with missing reasons,
quality flags, tiers and provenance. Analysis downloads include method, typed inputs, results,
source context and a hash-checked manifest. Existing `runs`, `run_steps`, `analysis_runs`,
`analysis_results`, `artifacts` and `manifests` hold the execution trail; no parallel numerical
engine exists. Runs and manifests are immutable; reruns create new execution identities.

**Export research package (ZIP)** collects the standalone SVG, full figure and profile,
workspace restoration snapshot, source dataset and approval receipt, selected CSV and original
CSV when supplied. An attached result includes the method, typed inputs, result and immutable
execution manifest. Maps include the attributed basemap snapshot. A manifest inventories every
file with its byte length and SHA-256; identical export snapshots produce identical ZIP bytes.
The export records both ZIP and manifest hashes in the audit trail and exposes the manifest
hash in the UI so it can be kept independently.

After extraction, `node verify.mjs . <manifest-sha256>` verifies the inventory and linked
figure/data/profile/result identities with no network, database or external packages. Without
an independently recorded hash it verifies internal consistency, not authorship. The script
does not recompute statistics; integration tests separately rerun the recorded executor on
archived inputs and require an identical artifact. The SVG is the portable rendered snapshot;
future renderer-code changes require version-aware support to regenerate historical geometry.
The package is downloaded, not automatically deposited in a publication repository. It is not
a written scientific paper. Raw `source.csv` can contain source formulas; `selected.csv` escapes
spreadsheet formula prefixes in text while preserving signed numeric measurements.

The canonical evidence palette lives in `config/evidence/tier-display.json`, shared with the
responder. Data color and alpha channels never replace evidence/review labels or combine them
into a confidence score. Clinical category order is a separate dimension of the responder UI.

## Reviewed regional boundary maps

Choose **Regions · choropleth** to color polygons from a numeric source column. In **Boundary
layers**, import mapped JSON or an RFC 7946 GeoJSON FeatureCollection, explicitly select the
identifier/label properties, and supply source, license and retrieval metadata. The source text
and mapping are retained. Review and approve the exact boundary hash separately from the data;
only the owner can change sharing or revoke approval. The bundled world map is offered for
explicit import, never inserted or approved at startup.

This implementation accepts the [RFC 7946](https://www.rfc-editor.org/rfc/rfc7946) 2D subset:
closed Polygon/MultiPolygon rings in WGS84 longitude/latitude, with holes and separate islands.
It rejects legacy CRS overrides, altitude coordinates, unclosed rings, duplicate identifiers
and uncut antimeridian crossings (a closing edge along a pole is allowed). It does not reproject,
repair topology or certify disputed boundaries. Limits are 2,000 features, 100,000 positions,
1 MB source text and the existing 2 MB JSON request limit. Prepare and document a lower-resolution
source if needed. Self-intersections and hole containment still require source review or a GIS
validator; successful import is not a topology certificate.

The bundled Natural Earth snapshot has 177 distinct feature IDs. Five upstream `-99` identifiers
use explicit `NE:name` values rather than invented ISO codes; inspect the identifier table.
Earlier 0.001-degree rounding collapsed one small PRK polygon. An explicit `retain_and_flag`
policy retains its coordinates, with a warning in source review and the vector footer. A layer
without that policy rejects collapsed rings; a feature without any drawable outer ring always
fails. No geometry is silently deleted or repaired.

Select the approved **Boundary layer**, a **REGION** identifier column and numeric **COLOR**.
The exact string representation joins to the feature ID; optional explicit mappings handle
other source codes and are saved with the figure. One row per region and panel yields a fill.
Zero is a reported value. Missing source values have diagonal hatching; absent observations
are neutral; multiple rows have crosshatching and remain ambiguous, even if their values agree.
Unmatched identifiers have a separate report. No mean, sum or inferred route is calculated.
Time frames and facets can distinguish repeated observations; statistical selection never
hides conflicting rows from the regional map.

Equal-interval or explicit manual classes, palette, alpha, labels, time, facets and camera are
saved. Manual thresholds must be strictly increasing with one fewer boundary than palette
colors; a value equal to a threshold enters the upper class. Whole-dataset domains remain
stable across frames by default; filtered rescaling is explicitly selectable. Alpha is a
separate visual channel, never a confidence score. X/Y remain statistical inputs; Z, size and
series are unavailable for polygon fills. **Fit boundary layer** and **Fit regions with
observations** set a reproducible extent; regional zoom supports small local layers. Labels use
an interior display anchor excluding holes, not an inferred geographic measurement.

Hover/focus/click opens region/source inspection. Multiple matching rows can be inspected or
selected individually for existing reviewed statistics. Right-click, Shift+F10 and the visible
Tools control reach the same palette. Diagnostics expose exact source/target IDs, missingness,
ambiguity and current access errors. Import, approval, revocation, save and export are audited;
request spans connect them to the developer console.

Favourite snapshots and portable workspaces pin the boundary ID/hash and explicit mappings.
Restoration and every server export recheck current access and approval; a historical receipt
cannot approve a revoked layer. Research ZIPs add `rendering/geometry.json`, its approval
receipt, exact original `source.geojson` when supplied, and a complete per-panel `region-join.json`.
The standalone verifier checks geometry identities and independently rebuilds the row-to-region
join, in addition to the package inventory. SVG/ZIP export uses the same renderer as the UI.

## Debugging and boundaries

Developer diagnostics can switch OFF/ERRORS/NORMAL/TRACE, inspect request trace IDs, persisted
events/errors and download redacted ZIP bundles. Browser history keeps only 60 request metadata
entries; server view lists up to 200 traces from seven date directories. Request bodies, query
strings and credentials are not captured in browser metadata. Mode changes are audited;
the recorder mode applies to the current running process. Trace spans share an ordered counter
even when operations overlap. Trace previews over 4 MB are explicitly truncated at complete records; the full ZIP remains available.

Private runs are owner-scoped on every legacy results/export/narrative route as well as the
workbench routes. Raw blobs require a fetch event belonging to that owner; deduplication never
grants access by itself. New runs and artifacts inherit the authenticated owner. Legacy method
review is limited to the shipped JH2016 method, pins the displayed hash, identifies the reviewer
from the session and audits the approval. Workbench methods retain their dataset-aware gate.

This slice does not implement a transform DAG, advanced/causal statistics, uncertainty bands,
route graphs, a live Trends feed, sentiment inference or automated paper writing.
Those remain in the ledger. Tests use clearly fictional source records; the application does
not seed fake regional signals or approve the bundled clinical proposals.

## Source provenance

- [Google Trends data](https://support.google.com/trends/answer/4365533?hl=en)
- [Language and search terms](https://support.google.com/trends/answer/4359550?hl=en)
- [Official API access](https://developers.google.com/search/apis/trends)
- [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/)

The basemap file records its upstream URL, source hash and precision. Public-source checks and
the clinical source catalog are documented in the adjacent workbench and field specifications.
