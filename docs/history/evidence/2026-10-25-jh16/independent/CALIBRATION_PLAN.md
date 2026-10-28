# Google Trends calibration of JH16 (exploratory) — recorded 2026-10-25 before fetching
Trends is relative search interest, NOT a result count; never substituted for Ni. Uses:
A1 Trends interest (mean of weeks/months in Jun 2014) vs published Pi (Table 1): Spearman.
A2 change May 2012 -> Jun 2014 in Trends vs change in published Pi (Table 2): Spearman of ratios.
A3 Trends interest (last 12 months to 2026-10) vs our 2026 Pi (R3 faithful): Spearman.
A4 Trends change 2014 -> 2026 vs Pi change 2014 -> 2026.
Robustness: geo world/US/GB/PL; one repeated request for sampling noise. No verdicts; no thresholds.
Hi cannot be calibrated by Trends (different construct; "X harm" volumes near zero).
Groups (anchor first): G1 cocaine,alcohol,heroin,cannabis,LSD; G2 cocaine,ecstasy,GHB,methadone,butane;
G3 cocaine,khat,amphetamine,methamphetamine,ketamine; G4 methadone,mephedrone,benzodiazepines,buprenorphine,khat.
Range 2012-01-01 2026-10-24 (monthly). Chaining: G4 rescaled via methadone (G2), G2/G3 via cocaine (G1).
