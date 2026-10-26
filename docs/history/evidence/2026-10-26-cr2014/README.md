# CR2014: evidence (2026-10-26)

**Where the data come from.** All data are real; nothing here is synthetic.
- **Google Trends:** one by-region request, made through the product via SerpApi with the personal key on a copy of the audit instance (port 8194), not on the owner's VM. The raw response is `trends_raw_fcf2ed4a.json`, as stored by the app; the key is not in it.
- **CDC YRBSS:** `fixtures/cr2014/yrbss_2011_current_cigar_use.json`, fetched from data.cdc.gov (svam-8dhg).
- **Paper values:** typed from PMC4122644 into `fixtures/cr2014/paper_reported.json`.

**Files.**
- `plus_check/`: two Trends requests on neutral terms (`tennis+squash` and `tennis + squash`), made with the coordinator's SerpApi key before any cigar request, to check the `+` joiner. The key is not in these files.
- `independent_check.jsonl`: output of `scripts/verify_cr2014_run.py`, which recomputes r and p from the two raw files without WatchDog code.
- `ui/`:
  - the browser probes: `probe.cjs` performs protocol → measurement; `probe_read.cjs` reads only;
  - their logs;
  - the run export, the replication API state and the manuscript;
  - screenshots: overview, scatter and measurement panel.

**Runs.**
- **`7aa42db5`** (code `cb8c9fd`): refused by SerpApi because the query exceeded 100 characters. It is recorded as missing and not computable.
- **`fcf2ed4a`** (code `7cec448`): r = 0.358, p = 0.032, n = 36.
  - Verdict: reproduced. Reading: supports.
  - It counts as confirmation data for the protocol frozen at 19:28 UTC.
- The manuscript and screenshots were regenerated after the post-data dossier entries, from the same runs, with no new request.

**SerpApi cost:** 3 searches in total (the refused one is not charged by SerpApi; the 2 neutral checks; 1 measurement).
