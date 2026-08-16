# Frontend Interface Specification

## Philosophy
An inspectable workbench, not a wizard and not work “modes”. Navigation:
Dashboard / Data / Schedules / Analysis / Research / Sources / Summary / Settings. Research may initially be feature-gated but its route/contracts must be planned from the start.

## Configuration renderer
Validated config selects trusted registered React components. Never eval code from config.
Example:
```json
{
  "component": "metric_card",
  "props": {"metric": "data_freshness", "label": "Data freshness"},
  "visibility": {"capabilities_any": ["runs.read"]}
}
```

## Dashboard
Panels: recent runs, running/failed jobs, schedules needing attention, recent results, source freshness, substance search, provenance warnings, reproducibility status.
Run cards: ID, preset/type, creator, times, status, sources, warning count, config hash, details link.

## Run detail
Overview / Inputs / Raw artifacts / Normalized data / Analysis / Exports / Manifest / Logs & Warnings / Debug / Related & superseding runs.
Manifest must be readable and downloadable as raw JSON.

## Data
1. choose source,
2. show capabilities/restrictions,
3. parameters,
4. validate,
5. preview effective config/query plan,
6. estimate requests/cost when knowable,
7. submit,
8. redirect to run.

For FAITHFUL, locked fields are visually obvious. Provider adapter may vary only if compatible; query/formula invariants stay locked.

## Schedules
Columns: name, preset/source, recurrence, enabled, last run/result, next run, failures, owner.
Actions: create/edit, enable/disable, trigger now, history, clone.

## Analysis
Inputs: completed runs/datasets + analysis preset/options.
Outputs: diagnostics, Pi/Hi, configured correlations/statistics, trend/scatter plots, ranking, provenance links, comparison/ablation.
Never silently fill missing values.

## Sources
Source ID/name, adapter/version, enabled/configured, capabilities, auth configured/not configured, retention, terms/license notes, last success/failure, data-quality notes. “Add/configure” routes to Settings.

## Summary
Select runs/template/audience/language/sections/provider. Persist/display run IDs, deterministic result hashes, template/prompt version, provider/model, timestamp. Generated prose visually distinct from measured/computed results.

## Settings
General / Sources & credentials / Analysis defaults / Exports / UI config status / Team & Roles / Feature flags / Diagnostics.
Secrets are write-only after save.

## Accessibility/responsiveness
Keyboard usable, semantic labels, mobile tables, no color-only meaning, explicit loading/error states, evidence grade has textual label.

## Acceptance
Prove config can reorder/relabel/alter role visibility without page-source edits; direct forbidden API call is still rejected; FAITHFUL fields cannot change; failed run never appears as successful; generated text is labeled.


## Debug Console
Developer/Admin diagnostic workbench backed by `14_DEBUGGING_AND_TRACEABILITY.md`, available globally from diagnostics settings/developer navigation and directly from each Run Detail.

Views: Live Trace, hierarchical Timeline, Errors with full stack/cause chain, State snapshots with before/after diff, Requests, Worker/queue, Persistence/artifact writes, Effective Config/environment/build, Raw Events JSON.

Filters: trace/request/run/job ID, component, operation, event type, level, sequence/time, error code. Actions: copy event/error JSON and correlation IDs, jump to surrounding events, open related run/manifest/artifact, download redacted diagnostic bundle, optionally force exhaustive tracing for one selected run when deployment policy permits.

A visible frontend failure must expose a safe correlation ID and link directly to its diagnostic trace. TRACE-mode snapshots are rendered as structured JSON. Never display redacted secrets.


## Data Explorer and Series Builder
Data is not only a fetch form. Provide a catalog/explorer for stored/imported datasets with schema preview, quality/missingness, lineage, filtering and multi-dataset selection.

A Series Builder lets the researcher choose index/time field, values, grouping dimensions, geography/language, resolution, aggregation, missing-value policy, normalization, rolling windows and lags. Show the transformation DAG before materializing the series.

## Generic Analysis Workbench
Implement `17_GENERIC_ANALYSIS_WORKBENCH.md`. Analysis accepts arbitrary compatible datasets/series, not only substance/JH16 tables. Method registry drives controls and compatibility. Provide a dedicated Correlation Lab and Visualization Builder. Successful work can be saved as reusable/schedulable AnalysisSpecs.

## Research / Paper workspace
Implement `18_RESEARCH_METHOD_AND_PAPER_PIPELINE.md`.
Panels: Overview, Sources & collection, Literature, Data & inclusion, Methods, Analyses, Tables & Figures, Evidence/claims, Draft, Review, Versions/exports.

The user can pin runs/datasets/analyses/figures to a project and create a frozen evidence package before drafting. Generated prose must remain visually distinct from measured/computed evidence.


## Fetch archive
Every historical fetch attempt is inspectable, including failures, zero results and repeated identical payloads. Show logical fetch metadata separately from content-addressed raw blob identity so deduplication is transparent.

## Time-series Lab and robustness comparison
Provide dedicated convenience surfaces for alignment/resampling, decomposition/stationarity, lag/cross-correlation, event/intervention analysis, anomalies/change points and side-by-side sensitivity/ablation runs where compatible.

## Full interaction contract
`21_INTUITIVE_RESEARCH_UI_AND_USER_FLOWS.md` is authoritative for guided/expert workflows, progressive disclosure, no-magic generated specs and traceability from figures/paper back to raw fetches.
