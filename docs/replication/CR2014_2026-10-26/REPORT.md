# CR2014: the second replication target, report (2026-10-26)

**Paper.** Cavazos-Rehg PA et al. *Monitoring of non-cigarette tobacco use using Google Trends.* Tobacco Control 2014;23:445–447, doi:10.1136/tobaccocontrol-2013-051276.

**Purpose.** Check that WatchDog's replication path is not JH16-specific.

## Result

| | Paper | WatchDog, run `fcf2ed4a` (2026-10-26, code `7cec448`) |
|---|---|---|
| Pearson RSV cigars 2011 vs YRBS 2011 youth cigar use | r = 0.39, p = .018, n = 36 | r = 0.358, p = 0.032, n = 36 |
| Same without UT and RI (paper's influence check) | r = 0.26, p = .130, n = 34 | r = 0.194, p = 0.272, n = 34 (exploratory) |
| Verdict against the pre-registered band [0.07; 0.64] | — | **reproduced** |
| Reading of H-cigar-youth (r > 0 and p < 0.05) | — | **supports** |
| Confirmation data per frozen protocol (Holm, α 0.05) | — | yes; p 0.0321 < 0.05 |

**Data fidelity.**
- **Reference values.** The YRBS values agree exactly with the values the paper reports: the eight extreme states and n = 36.
- **Google Trends map for 2011, fetched today.** It is close to the authors' map. For the nine RSV values the paper reports, the differences are 0–8 points:

  | State | Paper | WatchDog |
  |---|---|---|
  | FL | 100 | 100 |
  | RI | 98 | 99 |
  | PA | 91 | 94 |
  | NY | 90 | 82 |
  | DC | 90 | 95 |
  | UT | 34 | 33 |
  | ID | 41 | 44 |
  | IA | 49 | 47 |
  | ND | 51 | 52 |

**Independent check.** `scripts/verify_cr2014_run.py` uses no WatchDog code. Starting from the stored raw Trends response and the raw CDC file, it gives the same r (0.357983708652) and p (0.03205593).

**Not replicated (no open reference data).**
- Adult cigar and adult smokeless results: NSDUH R-DAS, restricted.
- Youth smokeless result: the open YRBSS dataset starts this question in 2017.

## Path in the product

Every step ran in the UI on a copy of the audit data, not on the owner's VM (`docs/history/evidence/2026-10-26-cr2014/ui/`).

1. **Pre-registration.** Commit `aa7e2ea`, made before any Trends request. It contains the target, the band (the paper's 95% CI), the reading rule, the locked preset and the reference built from the raw CDC file.
2. **Replications → CR2014 → Protokół.** A protocol was frozen (Holm, α 0.05).
3. **Nowy pomiar.** The panel shows:
   - the terms and the provider parameters;
   - the cost, 1 SerpApi request;
   - the daily limit;
   - the preset hash.

   The preset was approved, the protocol chosen as the data role, and the run launched.
4. **First run `7aa42db5` was refused by SerpApi.** The query was longer than 100 characters. The product recorded the run as missing and not computable, with no number. This led to:
   - **preset v2**: the 8 terms that cover the same searches, joined with `+` (equivalence of the joiner checked on neutral terms);
   - a provider limit `max_query_chars` that refuses such a request before it is sent.

   Both changes are in commit `7cec448`, made before any cigar value existed.
5. **Second run `fcf2ed4a`.** Results are in Przegląd and Przebiegi, including a scatter plot with a per-state drill-down to the query and raw response. They also appear in Protokół, Rozbieżności and Projekt pracy (manuscript, every block with its source).
6. **Phone width (390 px).** No horizontal scrolling on any tab.

## What had to change in the code

The answer is not "nothing". JH16's evaluation, manuscript and screens were written for that one study. The general path below now carries any target that declares `evaluation_kind: "reference_correlation"`. The next target of this kind needs only configuration: target, interpretation, dossier, preset and reference.

| Change | Why |
|---|---|
| `trends_interest_by_region` source (GEO_MAP_0) | Trends had only time series. The by-region adapter has its own identity, so the time-series adapter and its history are unchanged. |
| `reference_correlation` analyzer | A measurement against a per-entity reference table. A missing pair is never a zero. Only the declared statistic is computed. |
| `replication_evaluation` artifact and orchestrator hook | Verdicts and readings from the target's pre-registered configuration, stored as an immutable artifact like JH16's. |
| Launching a measurement from Replications | The JH16 wizard is JH16-specific. The new panel works from the locked preset, the approved hash, and the key and limit checks before sending. |
| Dossier, protocol p-values, general UI and manuscript | They read the general evaluation. JH16 keeps its own path; the shared sections were factored out without changing its text. |
| `max_query_chars` | A real provider limit found by the first run. |

## Limits

- One Trends download. Variability between downloads is not measured.
- Equivalence of the 8-term query with the paper's 15 terms rests on Trends' matching rules. The extreme values agree, but this has not been shown separately from Trends resampling.
- The population-weighted analysis was not repeated.
- One of the paper's four main results was checked.
