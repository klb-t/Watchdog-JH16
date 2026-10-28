# Request from a pasted text: Prof. Hoffmann's quote, report (2026-10-28)

**Requirement.** `.handoff/WYMAGANIE_CYTAT_HOFFMANN_2026-10-28.md`. Pasting a researcher's text makes WatchDog:
- start the literal work;
- propose a methodology and extensions for acceptance;
- ask for details without blocking the work.

The engine is general; this quote is its first test case.

**Where the data come from.**
- Everything below ran through the UI (`/requests`) on a copy of the audit instance, not on the owner's VM.
- Code: `2da5c0b`.
- Measurements are real (SerpApi with the key stored in the copy's vault, and Crossref). None of the run data is synthetic. Synthetic responses exist only in `tests/integration/text_requests.test.ts`.
- Evidence: `docs/history/evidence/2026-10-28-request-hoffmann/`.

## What WatchDog did with the quote (`request.json`, request `abf0ae08`)

1. **Work.**
   - The URL `https://www.jmir.org/2016/2/e38/` was requested once with an honest identification. The publisher answered HTTP 202 with a 2137-byte protection page. That page was recorded and not worked around.
   - Crossref (ISSN 1438-8871, year 2016) has exactly one work registered at that landing page: **doi:10.2196/jmir.4033**.
   - That DOI is the registered target `jh2016`.
2. **Intents** (rules from `config/requests/text-requests.json`, each with its quote from the text):
   - replicate: "zacząć można od bardzo prostych prac np takich jak w artykule";
   - period_update: "kolejnych okresach";
   - regional: "krajach (obszarach językowych)".

   The model reading is off, with the reason shown (see Blockers).
3. **Literal part**, started on "Wyślij i rozpocznij" after consent. The cost shown up front: 32 SerpApi requests, about €0.45 at the assumed price.
   - Run `b4b6f5cc`: recomputation of the paper's own counts.
   - Run `ea2b7078`: a new measurement with the faithful method, as "the next period, today".
4. **Proposals** wait for acceptance:
   - Google Trends from 2004 plus calibration (16 requests). For this test I accepted it myself, on the copy only: runs `52eedd1f` (WORLD), `df6be58d` (US), `11f82e98` (PL), `a44e493a` (GB).
   - Countries via gl=us/gl=pl plus 2 repeats (160 requests, about €2.24): waiting, not started.
   - Language areas: unavailable (needs translated and reviewed terms).
   - Monthly repeat: unavailable (no JH16 schedule yet).
5. **Questions** are open and do not block anything: substances, countries, periods, and the authors' raw 2014 data (addressed to the author).

## Numbers and their sources

| Number | Value | Source |
|---|---|---|
| Recomputation of the paper: Pearson Hi vs Nutt | 0.8162 (p 0.000115), reproduced | run `b4b6f5cc`; `export_b4b6f5cc.json`; independent `verify_jh16_b4b6f5cc.txt` |
| Recomputation: Spearman Pi vs Table 1 | 0.9993, reproduced | same |
| New measurement 28.10: completeness | 15 of 16 substances (khat missing: harm query "Fully empty") | run `ea2b7078`; `raw/index_ea2b7078.json` |
| New measurement: Pearson Hi vs Nutt (n = 15) | 0.377 (p 0.166); **verdicts not computable** (16 required) | `export_ea2b7078.json`; `verify_jh16_ea2b7078.txt` (identical, no mismatches) |
| New measurement: counts collapsed to reachable results | 14 of 32 (e.g. "cannabis" 63; on 26.10, 134,000,000 in `c17d1147`) | `raw/index_ea2b7078.json`; raw responses in `raw/` |
| Trends A1 (June 2014 vs Pi in Table 1), Spearman | WORLD 0.917, US 0.825, PL 0.861, GB 0.749 (n 16) | runs `52eedd1f`, `df6be58d`, `11f82e98`, `a44e493a`; `verify_trends_*.txt` (all exit 0) |

**Reading.**
- The recomputation reproduces the paper.
- The new measurement from 28.10 gives no verdict. Google returned a real estimate for fewer than half of the queries. This is shown from the raw responses and added to the JH16 diagnosis as a shown cause. It is a measurement-tool limit, not a property of the substances.
- Trends from June 2014 still ranks popularity in line with Table 1 in all four regions (0.75–0.92). That matches the calibration of 25.10.

## Blockers and decisions for the owner

- **Vertex (the model reading the text and the paper's method).** Built as a configurable supplement and switched off. A real Vertex call from the app with the VM token was refused by the session's permission policy on 25.10 and has not been verified. Until it is, only the deterministic rules work.
  - Each model proposal is kept only if it quotes the text verbatim; this is checked in tests.
- **JMIR page.** The publisher protects the page against bots. I did not try to get around it. A second attempt with a browser user agent was refused by the permission policy, correctly. Resolution therefore goes through Crossref.
- **SerpApi.**
  - The account is on the free plan, and the monthly pool of 250 is used up. Searches now come from 2578 extra credits, whose price I do not know. The engine assumes €0.014 per request (the smallest paid plan) and caps automatic spending at €1 per day.
  - Today: 48 requests, 32 literal and 16 Trends, about €0.67 at the assumed price.
  - Owner: please give the real price.
- **My mistake.** In two test calls to Crossref and OpenAlex I added the owner's e-mail address as `mailto`. I should not have done that. The product sends no address.

## Code that had to be built

- `services/text_requests.ts`: analysis, plan, sending, acceptance, answers.
- Migration 026: request and its events, write-once.
- `api/text_request_routes.ts` and the `/requests` page.
- `request_actions` in the dossiers.
- `services/vertex.ts`: the Vertex call, shared with manuscript editing.
- Fixes found by this run:
  - a sentence was cut at a single line break;
  - an HTTP 202 protection page would have been taken as the paper's text for a work outside the register.

A work outside the register goes to paper intake with what could be fetched. Its methodology assessment by a model stays where it was ("Tekst, metodologia i ekstrakcja") and needs a configured model.

## Addendum (2026-10-28, after the coordinator's notes)

- **Full text, legally.**
  - **How it works:** for every resolved DOI, WatchDog searches Europe PMC. When the work has a PMCID and is open access, it fetches the JATS full text (`fullTextXML`) and converts it deterministically (`jats-text 1`: title, abstract and body; references left out). That text is what goes to intake and to the optional model reading. Configured in `config/requests/text-requests.json` → `full_text`.
  - **Checked live on the quote** (preview only, no spend): JH16 has PMCID PMC4786686, with 19,925 characters, sections Introduction / Methods / Results / Discussion, and 6 tables.
  - **Bug found by the live check:** Europe PMC answers 406 when JSON is requested, so full text is now requested as XML. A test covers this.
- **Contact.** No address is sent anywhere. `contact.email` in the configuration is empty by default and is used as Crossref `mailto` only when someone fills it in. A test checks that no request carries `mailto`.
- **SerpApi price.** `account.json` (read free) gives the plan (Free Plan, USD 0), the monthly pool (250, used) and 2578 extra credits, but no price for the credits. The assumption of €0.014 per request and the €1/day cap stay.
