# Visual workbench and institutional analysis

## Authority and current implementation boundary

Maintainer clarification in the active Astra session, 2026-09-08: the green-pill responder
case was an example, not the entire product. Institutional/law-enforcement users need regional
analysis of popularity, context and sentiment across geography, languages and time. Google
Trends may support explicitly speculative distribution-route hypotheses. They are not verified
routes, consumption estimates or person-level evidence.

The maintainer explicitly requires an interactive workbench: tool palettes, pointer inspection,
selection, right-click operations and equivalent discoverable keyboard/touch controls for both
charts and maps; labels, colours and alpha; saved favourite chart types/settings; highly
parameterized publication figures, including 3D and 4+ dimensions. This supersedes E5's earlier
classification of a 3D cube as an unscheduled candidate. The earlier conversations recovered
here confirm the broad workbench and Trends direction; they do NOT establish an exact old
alpha mapping or a complete menu inventory. Do not claim these details were recovered.

## Conflict resolution and debugging

Maintainer clarification 2026-09-08: defer unnecessary choices; when implementations can coexist,
use an abstraction and data profiles. Thought/model providers are profiles, not branches baked
into application code; UI configuration is data. Preserve later conflicting material and its
provenance, implementing compatible alternatives through profiles. Every boundary must expose
redacted debugging information, including a developer-only UI for operation traces, validation,
errors and diagnostic export. This is not permission to expose secrets or another user's private
records to a broader profile.

## Contracts

- Generic visualisation registry and figure specification, independent of drug vocabulary.
  Renderers declare supported dimensions/channels rather than silently ignoring settings.
- Charts: line, bar, scatter, uncertainty bands, missingness, provider discontinuities;
  map layers and graph neighbourhoods. 3D scatter and further dimensions through time,
  panels, colour, marker size and alpha. Never imply a 2D projection is an extra measurement.
- A visible palette and context menu invoke the same operations; keyboard and touch do not
  depend on a right mouse button. Hover/focus reveals values, units, missingness and provenance.
- Figure appearance is separate from data transforms and inference. Presentation changes do
  not mutate observations. Colour encodings have a named legend. Alpha may be a user-selected
  data channel or a display opacity, never an undeclared reliability score. Trust badges remain
  fully opaque and labelled regardless of visual styling.
- A saved figure pins dataset hash/version, filters, dimensions, method spec/approval and
  renderer version, as well as camera/view, palette, labels, scales and styling. Favourite
  templates are owned by the current principal; templates do not silently change saved figures.
- Export supports a reproducible specification, tabular source values and vector output;
  missing values, tier/approval/quality flags and source citations survive export. Statistical
  outputs require an approved MethodSpec and run through the existing deterministic primitive
  registry. Listing advanced methods does not implement or approve them.
- Institutional access is to explicitly shared aggregate/reference data, not all private
  research runs, subject identities, field lookup history or curation powers.
- Google Trends website data is relative interest normalized within a comparison context.
  Keep query text/topic, language semantics, geography, time window, provider, retrieval event,
  normalization/comparison scope and missing/low-volume values. Do not merge independently
  scaled downloads or turn interface language into a language-of-searchers measurement.
- Context/sentiment requires its own sourced corpus and method/annotation provenance; Trends
  has no sentiment measurement. Keep raw observation, model estimate and route hypothesis as
  separate layers and evidence tiers. No model-made clinical or causal facts.

## Sources checked 2026-09-08

- [Google Trends data FAQ](https://support.google.com/trends/answer/4365533?hl=en)
- [Search terms across languages](https://support.google.com/trends/answer/4359550?hl=en)
- [Official Trends API access](https://developers.google.com/search/apis/trends): alpha access
  is limited; importing a versioned export must work without claiming live API availability.

## Implementation ledger

This document records accepted requirements, not a completion claim. Update the ledger with
actual renderer, interaction, persistence, export and regression checks as each slice lands.
