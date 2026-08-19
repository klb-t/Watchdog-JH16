# Capabilities, providers and credentials

## The distinction

Three orthogonal concepts that are commonly and damagingly conflated.

**Source** — an epistemic entity. What is being measured. "Estimated result count for a quoted
query on a general web search index" is a source. Sources appear on the Sources page because a
researcher chooses them as a matter of study design.

**Capability** — an abstract service contract. `search.result_count` is a capability;
`text.generate` is another. A capability declares its input and output contracts, and nothing
about who provides it.

**Provider** — a commercial or technical instance that serves a capability. SerpApi, Serper
and DataForSEO all serve `search.result_count`. Anthropic, OpenAI, Google, xAI, Mistral,
OpenRouter and Together all serve `text.generate`, as does a manually configured
OpenAI-compatible endpoint.

**Providers are configured in stack settings. They never appear on the Sources page.** Which
vendor is billed is an operational concern, not a study-design concern.

## Why this matters scientifically

Because the abstraction is only safe if identity travels with the data.

Two providers scraping the same search engine return different numbers: different geography,
different personalisation, different result-count parsing, different caching. If the provider
is invisible in the data layer, swapping vendors halfway through a longitudinal study becomes
an undocumented confounder — exactly the class of error this entire system exists to detect.

So:

- `provider_id` and `provider_version` are stamped on every fetch event and every observation
- both appear in the manifest
- any series whose observations span more than one provider carries `PROVIDER_DISCONTINUITY`
- that flag appears in analysis output, in every export, and in every chart legend of a series
  that carries it
- an analysis that crosses a discontinuity without the flag being present in its output is a
  defect, not a cosmetic issue

`PROVIDER_DISCONTINUITY` does not block the analysis. It is not an error. It is a disclosure.

## Registry model

```
capabilities: capability_key, display_name, input_contract, output_contract
providers:    provider_key, capability_id, adapter_id, adapter_version, status,
              discovery_provenance, approved_by, approved_at
credentials:  provider_id, secret_ref, status
```

`status`: `implemented`, `fixture`, `planned`, `blocked`. Only `implemented` and `fixture` may
be selected for a run, and `fixture` is offline-only.

## Seeds

Seed lists, to be organised into the registry with honest status. Not a closed list, and not
permission to implement all of them.

**`search.result_count`** — SerpApi, Serper, DataForSEO, Google Custom Search, plus the
fixture provider that E1 uses exclusively.

**`text.generate`** — Anthropic, OpenAI, Google Gemini, xAI, Mistral, OpenRouter, Together,
plus a first-class manually configured OpenAI-compatible endpoint. The manual endpoint is not
an afterthought: it is how a self-hosted or newly released model gets used without a code
change.

**`trends.interest`** — Google Trends. Note explicitly in the registry entry: normalised
relative interest is **not** a result count and must never be substituted for one in a JH2016
run.

**`reference.chemical`** — PubChem, DrugBank, Wikipedia. All `planned` at E1.

## Provider discovery

A provider may be discovered at runtime — a model list endpoint, a new vendor in a catalogue.
Discovery is permitted; automatic use is not.

A discovered provider enters the registry with status `proposed`, its `discovery_provenance`
recorded, and it cannot be selected for a run until a human approves it. This runs through the
same approval gate as everything else in `04_METHOD_COMPILER_AND_APPROVAL.md`.

The reason for the gate: a system that can silently start using a newly discovered vendor is a
system that can silently change its own measurement instrument.

## Routing

A capability may have a routing policy: preferred provider, fallback order, per-provider rate
limits and budget caps.

Fallback is permitted **only** within a single fetch attempt that has not yet produced a
stored observation. Once an observation exists from provider A, a retry that would use
provider B creates a new observation, not a replacement — and the series acquires
`PROVIDER_DISCONTINUITY`.

There is no configuration in which a fallback silently rewrites a stored measurement.

## Source policy contract

Recovered addition: each registered source declares, alongside its capability and status,
`acquisition_method`, `auth_requirements`, `license_terms`, `raw_retention_allowed`,
`retention_duration`, `allowed_derived_outputs`, `attribution_requirements`, `pii_handling`,
and `geographic_language_coverage`. Extends the existing `sources` table
(`02_DATA_MODEL.md`) rather than adding a new one — these are columns, not a parallel registry.

Deletion or retention-expiry must never destroy scientific lineage silently: where a raw
payload must be deleted for licence or legal reasons, its hash and manifest entry remain even
though the payload does not — a tombstone, not an amnesia.

## Credentials

Secret store or environment only. Never in configuration files, never in git, never returned
by an API after saving, never written to a manifest or a log.

`.env.example` contains names and no values. The diagnostic redaction layer in
`06_DIAGNOSTICS.md` must know every credential-shaped key and must be tested with a canary
secret that is asserted absent from every diagnostic sink.

Rate limit and quota exhaustion is an expected operating condition, not a crash. The error
taxonomy has `source_rate_limit` for it; the run pauses and records rather than failing the
whole study, and the diagnostic stream records which limit was hit if the provider discloses
it.
