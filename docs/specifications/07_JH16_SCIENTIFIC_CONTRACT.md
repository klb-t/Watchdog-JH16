# JH16 Scientific Contract

## Purpose
Jankowski–Hoffmann 2016 is a **benchmark/sanity check** for WatchDog's general pipeline. It must run offline from frozen fixtures and online through compatible result-count adapters. Computation is provider-neutral after normalization.

## FAITHFUL substance set
Exactly 16:
1. alcohol
2. amphetamine
3. benzodiazepines
4. buprenorphine
5. butane
6. cannabis
7. cocaine
8. ecstasy
9. gamma-hydroxybutyric acid (GHB)
10. heroin
11. ketamine
12. khat
13. lysergic acid diethylamide (LSD)
14. mephedrone
15. methadone
16. methamphetamine

DB canonical identity may differ from historical `query_label`; never silently replace the faithful query string with aliases.

## Query semantics
Popularity:
```text
"<drug name>"
```
Harm:
```text
"<drug name>" "harm" OR "harmful"
```

Rules:
- exact quoted drug string,
- quoted `harm` and `harmful`,
- no added “dangerous”, “risk”, “death”, “side effects” in FAITHFUL,
- do not silently insert provider-specific `AND` that changes semantics,
- original method used SafeSearch off; record actual provider setting/behavior,
- record exact rendered query.

## Counts
`Ni` = popularity-query result count.
`Ni_harm` = harm-query result count.
Valid counts are integers >=0. Missing/unreliable is **not zero**; represent missingness explicitly.

## Popularity index
```text
Pi = (Ni / max(Ni)) * 100%
```
Max over valid comparison set. If no valid positive Ni -> explicit failure. Missing substances -> incomplete labeled result.

## Harm index
```text
Hi = (Ni_harm / Ni) * 100%
```
Ni<=0 -> undefined, never divide by zero. Missing stays missing. Do not clip Hi to 100 by default; noisy provider counts should be preserved and flagged.

## External validation
Compare against a **versioned** reference harm-score set (e.g. Nutt et al. 2010). Do not hardcode a score dictionary in analysis code.
Store reference-set ID/version/citation/scores/mapping/statistical method.
Support Pearson and Spearman; selected methods explicit in config/manifest.

## Presets
### FAITHFUL
Locked: 16 substances, exact queries, no alias expansion, exact formulas. Any methodological change is non-faithful.
### ENHANCED
Derived, not “replication”; may alter substances, aliases, queries, source fusion, geography, methods. Every difference explicit.
### LONGITUDINAL
Repeated observations under stable versioned definitions. Methodology changes create explicit series/version boundaries.

## Scientific tests
- exact query golden tests,
- formula unit tests,
- frozen fixture test,
- missing count,
- zero Ni,
- provider count parsing,
- deterministic ordering,
- known correlation dataset,
- faithful immutability,
- manifest methodology completeness.

## Reporting language
Do not call a run a “successful replication” just because code ran. Prefer precise statuses: methodological reproduction completed / data acquisition completed / comparison with historical results / correlation estimated. Equivalence to 2016 findings is tested, not assumed.
