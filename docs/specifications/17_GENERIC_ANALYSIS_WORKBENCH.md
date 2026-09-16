# Generic Analysis, Series and Visualization Workbench

## Product requirement
The Analysis area must not be a hard-coded JH16 screen. It is a general research workbench where an authorized researcher can select arbitrary stored datasets/series, transform them, align them, run compatible analytical methods, compare outputs and build figures without writing code for every new study.

JH16 is a locked preset assembled from the same primitives plus scientific invariants.

## Core interaction model
Conceptual flow:

```text
DATASETS -> SELECT/COMBINE -> TRANSFORM -> SERIES/TABLE -> CHOOSE METHOD -> CONFIGURE -> VALIDATE ASSUMPTIONS -> RUN -> DIAGNOSTICS -> VISUALIZE -> SAVE/EXPORT -> ADD TO RESEARCH PROJECT/PAPER
```

The UI must be powerful but prevent invalid combinations by using typed capabilities, not by hiding complexity behind magic.

## Data Explorer
Provide:
- searchable catalog of datasets/runs/artifacts,
- filters by source, substance/entity, geography, language, date, project, owner, evidence grade,
- schema preview,
- row/sample preview with safe limits,
- quality/missingness summary,
- lineage graph,
- select multiple datasets and preview join/union compatibility,
- materialize a derived dataset.

## Series Builder
Allow a user to turn suitable tables into series interactively:
- choose time/index field,
- choose value field(s),
- choose entity/group dimensions,
- geography/language/query role,
- resolution and resampling,
- aggregation function,
- timezone/calendar,
- missing-value policy,
- normalization/scaling,
- rolling window,
- lag/lead,
- baseline/indexing,
- optional detrending/seasonality adjustment.

Preview the effective transformation DAG before running it.

## Method registry
Methods are plugins/capabilities with metadata:
```text
method_id/version
family
accepted input shapes/types
required roles: x/y/time/group/weight/etc.
parameter schema
assumptions/diagnostics
outputs
supported visualizations
scientific warnings
```

UI should suggest methods compatible with selected data but permit expert search/filter. Never claim a method is appropriate merely because it is executable.

### Seed families — expand, do not treat as exhaustive

#### Descriptive / data quality
- counts, unique counts, missingness,
- min/max/range,
- mean/median/mode,
- variance/SD/MAD/IQR,
- quantiles/percentiles,
- skewness/kurtosis,
- frequency tables/crosstabs,
- group summaries,
- confidence intervals where meaningful.

#### Association / correlation
Historical requirements explicitly include:
- Pearson,
- Spearman,
- cross-correlation / lagged correlation.

Expand registry with standard compatible methods such as:
- Kendall,
- partial correlation,
- correlation matrices,
- bootstrap/permutation uncertainty where useful.

Controls/configuration should include alignment window, pairwise/listwise missing policy, lag range, detrending/seasonality option, multiple-comparison correction where applicable.

#### Group comparison / hypothesis tests
Seed examples:
- one-/two-sample t tests including Welch where appropriate,
- paired tests,
- Mann-Whitney/Wilcoxon,
- ANOVA and non-parametric alternatives,
- chi-square/Fisher for categorical data,
- effect sizes and confidence intervals,
- multiple-testing correction.

The UI must expose assumptions and diagnostics rather than turning tests into one-click p-value machines.

#### Regression / modeling
Seed examples:
- linear regression,
- robust regression,
- logistic regression,
- count models when appropriate,
- multivariable models,
- regularization as a plugin family,
- model diagnostics/residuals/cross-validation where appropriate.

Do not automatically interpret association as causation.

#### Time-series
Historical design explicitly called for:
- trends over time,
- seasonality/trend control,
- lag/cross-correlation,
- Granger causality,
- VAR,
- intervention/structural time-series analysis,
- anomaly/change detection.

Seed registry additionally with standard primitives:
- resampling/rolling statistics,
- decomposition,
- ACF/PACF,
- stationarity diagnostics,
- differencing,
- forecasting models as separate optional plugins,
- change-point/anomaly methods.

Every time-series result must record resolution, alignment, timezone, preprocessing and missing-value policy.

#### Causal / quasi-experimental
Historical brainstorm included:
- intervention analysis,
- Difference-in-Differences,
- synthetic control,
- instrumental variables where justified.

These MUST be assumption-heavy expert tools. UI should require explicit treatment/intervention/time/group roles and display identification assumptions/limitations. Never auto-label causal results from observational data without the required design.

#### Robustness / sensitivity
- alternate preprocessing,
- alternate source/provider,
- alternate alias/query sets,
- geographic/language subsets,
- leave-one-out/subset analyses,
- bootstrap/permutation,
- parameter sweeps,
- ablation/comparison of presets.

Use this family to compare FAITHFUL JH16 with enhanced variants without contaminating the faithful result.

#### Multivariate / exploratory — extensible
Examples may include PCA/dimensionality reduction, clustering and other standard exploratory methods if dependencies and scientific use justify them. Keep them behind the same method contract and label exploratory outputs appropriately.


#### Evidence synthesis / meta-analysis
Seed examples recovered from historical design:
- fixed-effect meta-analysis,
- random-effects meta-analysis,
- heterogeneity diagnostics,
- forest/funnel diagnostics where appropriate,
- subgroup/sensitivity analysis.

Individual extracted study estimates must retain paper/table/row provenance and verification state.

#### Bayesian / rare-event models
Historical design proposed Bayesian treatment for sparse/rare events. Support this as an optional expert family with explicit priors, posterior diagnostics and sensitivity analysis. Never hide priors behind a generic "AI" button.

#### Community/text semantic analyses
For datasets produced by `20_COMMUNITY_REPORT_AND_SEMANTIC_PIPELINE.md` expose methods such as slang frequency, symptom/organ-system frequencies, symptom co-occurrence, attitude/sentiment distributions, dose/route distributions, rare severe signal detection and exploratory semantic/topic clustering. Model-extracted candidates retain confidence/verification provenance.

#### Geospatial
Where datasets have lawful geographic dimensions, support aggregation, rate/denominator-aware comparison, spatial visualization and later spatial statistics through the same method registry. Geography resolution/privacy thresholds are explicit analysis parameters.

## Correlation Lab
Provide a dedicated convenience interface because correlation is central to JH16 and later work:
- drag/select any two numeric variables or series,
- auto-show overlap/alignment,
- Pearson/Spearman/Kendall options,
- lag sweep,
- raw vs detrended/seasonally adjusted comparison,
- scatter + regression/smoother visualization,
- correlation-vs-lag plot,
- CI/p-value/multiple-test metadata,
- sample size at every lag,
- save as reusable analysis spec.

## Visualization registry
Charts are first-class reproducible artifacts. Seed types:
- line/time-series,
- multi-series overlay,
- scatter,
- bar/ranking,
- histogram/density,
- box/violin,
- correlation matrix/heatmap,
- lag-correlation plot,
- residual/diagnostic plots,
- missingness plot,
- event/intervention annotated timeline,
- geographic map/choropleth when data permits,
- table with conditional formatting.

Every figure stores dataset/analysis IDs, exact rendering config and code/version. A user can reopen/edit configuration and create a new figure version.

## UI requirements
Use intuitive builder patterns:
- left: dataset/variable browser,
- center: workspace/preview/result,
- right: method/transform parameters,
- bottom or side: lineage/diagnostics/log link.

Support searchable command palette and sensible presets for novices without removing expert controls.

Before execution show a human-readable plan: inputs -> transforms -> method -> outputs. After execution show exact parameters and lineage.

## Reusable analysis specifications
Any successful interactive analysis can be saved as a versioned `AnalysisSpec` and:
- rerun on new snapshots,
- scheduled,
- cloned/modified,
- used in a research project,
- used to generate a paper result/figure.

This is the mechanism by which a one-off exploration becomes longitudinal automated research.
