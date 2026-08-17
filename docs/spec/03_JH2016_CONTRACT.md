# JH2016 scientific contract — LOCKED

Jankowski & Hoffmann, JMIR 2016, doi:10.2196/jmir.4033.

This file has the highest precedence in the package. Nothing may weaken it. Changing anything
here requires the maintainer's explicit approval and produces a new preset version — it never
edits the existing one.

The FAITHFUL preset is a benchmark: a known input with a known output, used to detect whether
the general pipeline still computes correctly. It is not the product.

## Substance set — exactly sixteen

`alcohol`, `amphetamine`, `benzodiazepines`, `buprenorphine`, `butane`, `cannabis`, `cocaine`,
`ecstasy`, `gamma-hydroxybutyric acid (GHB)`, `heroin`, `ketamine`, `khat`,
`lysergic acid diethylamide (LSD)`, `mephedrone`, `methadone`, `methamphetamine`.

Sixteen, no more, no fewer. The canonical substance identity in the database may differ from
the historical `query_label`; the query string sent to a provider is always the `query_label`
from the preset, never an alias, never a canonical name substituted for convenience.

## Query semantics

Popularity query:

```
"<query_label>"
```

Harm query:

```
"<query_label>" "harm" OR "harmful"
```

Rules, all binding:

- the drug string is exact and quoted
- `harm` and `harmful` are quoted
- **no** `dangerous`, `risk`, `death`, `side effects`, or any other harm word in FAITHFUL
- do not insert a provider-specific `AND` that changes the semantics of the `OR`
- alias expansion is off
- the original method used SafeSearch off; record the provider's actual setting and behaviour,
  and if it cannot be determined, flag `SAFESEARCH_UNKNOWN` rather than assuming
- store the exact rendered query on the fetch event

## Counts

`Ni` — result count for the popularity query.
`Ni_harm` — result count for the harm query.

Valid counts are integers ≥ 0. A count that could not be obtained or parsed is **missing**,
recorded with `is_missing = 1` and a reason. It is never zero, never interpolated, never
carried forward from a previous run.

Search engines report estimated counts that vary between requests. Flag
`PROVIDER_ESTIMATE` on every observation from a provider whose counts are estimates, which in
practice is all of them.

## Metrics

```
Pi = (Ni / max(Ni)) × 100
Hi = (Ni_harm / Ni) × 100
```

`max(Ni)` is taken over the valid comparison set within the run. If no valid positive `Ni`
exists, the analysis fails explicitly — it does not return zeros.

If `Ni ≤ 0`, `Hi` is undefined. Never divide by zero, never substitute a small epsilon, never
return zero.

A substance missing from the run yields a result labelled incomplete, with the missing
substances enumerated in the output and the manifest.

Do not clip `Hi` at 100 by default. Provider counts are noisy and a value above 100 is
information about the provider; preserve it and flag it.

## External validation

Compare `Hi` against a **versioned** reference harm-score set — Nutt et al. 2010 is the
intended first set. The scores live in `config/reference/nutt-2010.json` with set key,
version, citation metadata, per-substance scores and the substance mapping. They are never
hardcoded in analysis code.

Both Pearson and Spearman are supported. The selected method is explicit in the configuration
and recorded in the manifest. Report both when comparing to the published result, since the
published comparison is a rank relationship.

## Presets

**FAITHFUL** — locked. Sixteen substances, exact queries, no alias expansion, exact formulas.
Any methodological change makes a run non-faithful and it must not be labelled otherwise.

**ENHANCED** — derived, and never called a replication. May change substances, aliases,
queries, source fusion, geography or methods. Every single difference from FAITHFUL is
enumerated explicitly in the manifest.

**LONGITUDINAL** — repeated observation under a stable versioned definition. A methodology
change creates an explicit series boundary; it never silently continues an existing series.

## Reporting language

This matters as much as the arithmetic.

A run that completes is not a "successful replication". Use precise status language:

- `methodological reproduction completed`
- `data acquisition completed`
- `comparison with published results computed`
- `correlation estimated`

Equivalence to the 2016 findings is a hypothesis that the system tests, and the verdict
vocabulary in `08_REPLICATION_ENGINE.md` is what expresses the outcome. Code that ran is not
science that replicated.

## Required tests

| Test | Asserts |
|---|---|
| exact query golden | rendered strings for all 32 queries match byte-for-byte |
| formula unit | Pi and Hi on hand-computed inputs |
| frozen fixture end-to-end | full run from `fixtures/jh2016/` reproduces golden output |
| missing count | a missing `Ni` propagates as missing, never zero |
| zero `Ni` | `Hi` is undefined and the run does not crash |
| count parsing | provider count strings parse correctly, including grouped digits and "about" prefixes |
| deterministic ordering | two runs produce byte-identical artifacts |
| known correlation | Pearson and Spearman on a dataset with known coefficients |
| faithful immutability | an attempt to alter the locked preset is rejected |
| manifest completeness | manifest contains every field listed in `02_DATA_MODEL.md` |
