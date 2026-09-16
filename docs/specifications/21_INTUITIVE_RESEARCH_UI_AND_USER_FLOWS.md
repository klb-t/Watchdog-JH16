# Intuitive Research UI and User Flow Contract

## Goal
Power must come from composable primitives, not from forcing researchers to write code or manually edit JSON. The same system should support a simple JH16 replication and a new arbitrary analysis without creating a new bespoke frontend.

The UI MUST offer both:
- guided/common paths with sensible presets,
- expert controls exposing exact parameters, assumptions and lineage.

## Global interaction principles
- searchable command palette,
- object browser for Sources / Fetches / Datasets / Series / Analyses / Figures / Projects,
- drag/select variables where appropriate,
- schema-aware controls generated from registries,
- live compatibility validation,
- preview before expensive operations,
- human-readable execution plan before Run,
- exact machine-readable spec after Run,
- clone/version instead of mutating historical objects,
- every result links to inputs, methodology and Debug trace.

## Data workspace
### Source browser
Cards/table show source family, capabilities, implementation status, auth/config state, retention/license notes, last successful fetch and freshness.

### Fetch builder
Choose source -> entity/query/geography/language/date/resolution -> preview effective request/query plan -> cost/rate estimate when possible -> fetch now or schedule.

### Fetch archive
Search every historical fetch, including failures/zero/identical responses. Show request metadata, status, raw blob hash/ref, parser/normalizer output and lineage.

### Dataset explorer
Schema, semantic types, quality, missingness, row preview, provenance, source composition and lineage graph. Select multiple datasets and preview join/union compatibility.

### Transform builder
Visual ordered/DAG pipeline with searchable transform registry. Show before/after schema and sample preview. Save as `TransformSpec`.

### Series builder
Turn any compatible table into ordered series: index/time, values, groups, geography, language, aggregation, resolution, timezone, missing policy, normalization, rolling windows, lag/lead, baseline, detrending/seasonal adjustment.

## Analysis workspace
### Method picker
Filter by family or search; recommend only methods whose typed contract matches current data. Show why a method is or is not compatible.

Each method panel exposes:
- required variable roles,
- parameters/defaults,
- assumptions,
- diagnostics,
- expected outputs,
- warnings against invalid interpretation.

### Correlation Lab
Dedicated fast surface: choose any two variables/series; inspect overlap/alignment; Pearson/Spearman/Kendall/partial; lag sweep/cross-correlation; raw vs detrended/seasonally adjusted; scatter/fit and correlation-vs-lag; CI/p/sample size/multiple-testing metadata.

### Time-series Lab
Align/resample -> inspect gaps -> decomposition/ACF/PACF/stationarity -> transform/difference -> trend/forecast/intervention/change-point/Granger/VAR where compatible -> diagnostics -> figures -> save spec.

### Compare/robustness
Run selected analysis under alternate preprocessing, source/provider, aliases, subsets, geographic/language scopes, parameter grid, bootstrap/permutation or leave-one-out; present side-by-side outputs and diffs.

## Visualization Builder
Choose data/result -> chart family -> roles/axes/facets -> aggregation -> uncertainty layer -> annotations/events -> preview -> save versioned `FigureSpec`.

Allow combinations where meaningful: points+fit+CI, time-series+events, distributions+group facets, maps+time filters. Preserve exact renderer/version/config.

## Research project workspace
A project is a persistent study cockpit:
Overview / Question & hypotheses / Sources & schedules / Literature / Data & inclusion / Methods / Analyses / Tables & figures / Evidence graph / Draft / Review / Versions & exports.

Any run/dataset/series/analysis/figure/reference can be pinned into the project. The project can freeze an evidence package and generate a deterministic Methods/Results skeleton before LLM drafting.

## Progressive disclosure
Do not make novices configure everything manually. Default views can expose the common parameters and an `Advanced` drawer reveals the full registry-defined contract. The saved spec always contains the complete effective parameters regardless of what the UI hid initially.

## No magic
Every convenience action must map to an inspectable spec. Examples:
- `Compare these two series` -> generated `AnalysisSpec` visible before run,
- `Make monthly` -> explicit resample transform,
- `Normalize` -> explicit transform and parameters,
- `Draft Results` -> frozen evidence package + template/model metadata.

Users can inspect/copy/export the generated specs.

## Acceptance examples
1. A user imports an arbitrary CSV, creates a monthly series, correlates two columns with Spearman and draws a scatter plot without touching source code.
2. A user joins Google Trends series with a drug-checking series, aligns weekly observations, runs lagged cross-correlation and saves it for scheduled reruns.
3. A JH16 faithful run uses the same generic objects but locked preset invariants prevent semantic drift.
4. A researcher can start from a failed chart/analysis and jump to lineage + Debug trace.
5. Every point in a paper figure can be traced back through FigureSpec -> AnalysisSpec -> Series/Dataset -> Transform DAG -> fetch/import artifacts.
