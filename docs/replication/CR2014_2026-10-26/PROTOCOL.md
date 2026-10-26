# CR2014: pre-registration (2026-10-26)

**Target.** Cavazos-Rehg PA et al. *Monitoring of non-cigarette tobacco use using Google Trends.* Tobacco Control 2014;23(5):445–447, doi:10.1136/tobaccocontrol-2013-051276 (author manuscript PMC4122644).

**Why this study.** It is the second replication target in WatchDog, chosen to test whether the replication machinery is general. It is short and published, its method is fully stated (search terms, period, region, statistic), and one of its main results can be checked against open data.

**What is replicated.** Pearson r between state 2011 Google Trends relative search volume for cigars and the 2011 YRBS prevalence of current cigar use among high-school students (36 states). The paper reports r = 0.39, R² = 0.154, p = .018.

**What is not replicated, and why.**
- **Adult endpoints** (NSDUH 2010–2011, r = 0.49 and 0.48): the state values came from the restricted-use R-DAS.
- **Youth smokeless endpoint** (r = 0.46): the open YRBSS dataset has this question only from 2017.

All three stay in the dossier as not replicated, with these reasons.

**Fixed before any Google Trends request for this target (this commit):**
- **Measurement.** Preset `config/presets/cr2014-faithful.json`:
  - the paper's 15 cigar terms joined with `+`;
  - geo US, region REGION, 2011-01-01…2011-12-31, low-volume regions included.
- **Reference.** `config/reference/yrbss-2011-hs-current-cigar.json`, built by `scripts/reference_from_yrbss.py` from the raw file `fixtures/cr2014/yrbss_2011_current_cigar_use.json`:
  - raw sha256 `edb4e6f9…`;
  - the reference was checked against the paper's reported extremes and n = 36, and agrees exactly.
- **Claim band** (`config/replication/cr2014.json`): r ∈ [0.07, 0.64]. This is the paper's 95% confidence interval for r at n = 36.
- **Reading rule** (`config/replication/cr2014-interpretation.json`), with n = 36 required:
  - *supports* if r > 0 and two-sided p < 0.05;
  - *contradicts* if r ≤ 0;
  - otherwise *undecided*.
- **Exploratory, no verdict:** the same correlation without UT and RI (published r = 0.26, p = .130).

**Not looked at before this commit:** any Google Trends value for these terms. The reference data were looked at; they are not the outcome.
