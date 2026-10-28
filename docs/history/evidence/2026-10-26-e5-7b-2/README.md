# E5.7b-2 — evidence (2026-10-26)

Where the data come from:
- **Database:** a copy of the audit instance's database (`inst_main`). It holds the real JH16 runs from 25–26.10, including the confirmation run `c17d1147` and the protocol frozen at 17:23 under E5.7b-1. The owner's VM was not touched.
- **Code:** a local build of the uncommitted E5.7b-2 changes on top of `aba3eb9`. That is why the new run is stamped `aba3eb9…-dirty`.
- **Steps:**
  1. Through the UI, a protocol was frozen with H-harm in family 1, H-pop in family 2 and serial gating.
  2. A new faithful measurement, `51a9567b`, was run through the wizard against real SerpApi/Google: 32 queries from the paid plan, no synthetic data.
  3. The result was read in Replikacje → Protokół (`ui_probe_protocol_v2.cjs`).
- **Refresh:** after one more fix (no priority for single-family protocols), the manuscript, JSON and screenshots were refreshed from the same data with no new query.

Result:
- H-harm: Pearson p = 0.7106, not rejected.
- H-pop: raw p = 1.25e-4, but it is shown as "nietestowane: bramka zamknięta" (not tested: gate closed), which is correct under serial gating.
- The older single-family protocol on run `c17d1147` gives the same values as before: Holm 0.7464 / 1.04e-4.
- The phone layout (390 px) has no horizontal scroll.
