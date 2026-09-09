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
filters observations and never implies movement. Bars show individual observations without
aggregation. Line gaps preserve missing values and provider discontinuities. Numeric/date
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
Changing style leaves the mathematical method identity intact. A changed profile must be
restored before an old figure renders; no silent palette substitution is permitted. Exports
include the full profile to make that restoration possible.

SVG carries vector marks, metadata, source identity, missingness and fully opaque evidence-tier
and mapping-approval labels. It supports up to 12 panels; a larger preview is labelled and SVG
export is refused until filtered. JSON retains the complete figure, dataset, profile and
verified attached analysis. CSV exports the filtered/selected raw rows with missing reasons,
quality flags, tiers and provenance. Analysis downloads include method, typed inputs, results,
source context and a hash-checked manifest. Existing `runs`, `run_steps`, `analysis_runs`,
`analysis_results`, `artifacts` and `manifests` hold the execution trail; no parallel numerical
engine exists. Runs and manifests are immutable; reruns create new execution identities.

The canonical evidence palette lives in `config/evidence/tier-display.json`, shared with the
responder. Data color and alpha channels never replace evidence/review labels or combine them
into a confidence score. Clinical category order is a separate dimension of the responder UI.

## Debugging and boundaries

Developer diagnostics can switch OFF/ERRORS/NORMAL/TRACE, inspect request trace IDs, persisted
events/errors and download redacted ZIP bundles. Browser history keeps only 60 request metadata
entries; server view lists up to 200 traces from seven date directories. Request bodies, query
strings and credentials are not captured in browser metadata. Mode changes are audited;
the recorder mode applies to the current running process. Trace spans share an ordered counter
even when operations overlap. Interactive trace files over 4 MB require bundle inspection.

This slice does not implement a transform DAG, advanced/causal statistics, uncertainty bands,
choropleths, route graphs, a live Trends feed, sentiment inference or automated paper writing.
Those remain in the ledger. Tests use clearly fictional source records; the application does
not seed fake regional signals or approve the bundled clinical proposals.

## Source provenance

- [Google Trends data](https://support.google.com/trends/answer/4365533?hl=en)
- [Language and search terms](https://support.google.com/trends/answer/4359550?hl=en)
- [Official API access](https://developers.google.com/search/apis/trends)
- [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/)

The basemap file records its upstream URL, source hash and precision. Public-source checks and
the clinical source catalog are documented in the adjacent workbench and field specifications.
