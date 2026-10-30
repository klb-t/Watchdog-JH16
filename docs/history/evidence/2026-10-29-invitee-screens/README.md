# Invitee screens audit, 2026-10-29

This audit covers every screen a guest or invited researcher meets. It was run on a copy of the owner's data, in the production image, with an English and a Polish browser, at phone width (390×844) and desktop width (1280×1000).

## Data and environment

- **Data.** This is a copy of the owner's backup, the same extract used by `../2026-10-29-access/`. It holds 7 runs (JH16 faithful fetch, JH16 recomputation, Google Trends calibration, one failed analysis), raw provider responses and the vault key file.
  - The copy was made into a scratch directory; the original was never modified.
  - The earlier access test had left rows on the extract: invitations, shares, a bearer guest, a stranger, sign-in challenges and 12 audit rows, all from 2026-10-29 12:45–12:56 UTC. It had also claimed `local-user` with the owner's real address. `scripts/reset.cjs` removed those rows from the copy only, returning it to its pre-accounts state.
  - `local-user` was then claimed for `owner@lab.example` with `watchdog-admin claim-local-user`.
  - No real email address appears in any screenshot or log here.
- **Synthetic data.** All of these were created during the walk and are not part of the owner's data:
  - every address: `owner@lab.example`, `invitee-*@example.org`, `open-*@example.org`, `stranger-*@example.org`, and the guests' generated `bearer-…@bearer.invalid`;
  - the invitations and the share links;
  - the note "Audit invitation".
  - Every number on the screens comes from the owner's stored runs.
- **Image.** Production-style container `wd-invitee-test`: `--user 1001:1002`, read-only root, `cap-drop ALL`, the data copy bind-mounted at `/mnt/watchdog`, published on 127.0.0.1:8195, `WATCHDOG_AUTH=accounts`, no mail, no Google. Two builds were used:
  - `watchdog-invitee-test:9a80305` is the base, PR #26; it produced the `before/` screenshots;
  - `watchdog-invitee-test:wip1` is this branch's working tree; it produced the `after/` screenshots, and its image build passed 683/683 tests.
  - **User id.** The uid differs from production's 1000:1000 because the scratch copy belongs to uid 1001 in a 0700 directory.
- **Sign-in.** No sign-in method is configured on this installation, so everyone signed in with one-time operator links (`watchdog-admin signin-link`, run inside the container). Bearer guests used their link alone.
- **First host run.** A first run on the host (`node dist/server.cjs`) could not open Replications: the copy's object URIs are absolute `/mnt/watchdog/...` paths. That is an environment limitation, so the audit moved to the image.
  - The same host run surfaced a real defect. The 500 response quoted the server path, `ENOENT … /mnt/watchdog/object_store/evaluations/<run>.json`. That defect is fixed below.

## What was checked

`scripts/probe.cjs` ran four passes: en phone, en desktop, pl phone and pl desktop. The pl desktop pass timed out once and was rerun with fresh addresses; `probe_log.txt` holds both parts.

Each pass covered these screens:

- **Public pages:** `/login`, `/privacy` (including a language switch), `/terms`, `/share` without signing in, and `/join` with a bad token.
- **Email invitation:** the preview, then signing in with the invited address and accepting automatically.
- **Open link (sign-in needed):** the preview, then signing in with another address. That address gets viewer at once, plus the pending-approval banner.
- **Bearer link (`signs_in`):** the preview, entering, the home page and its banner.
- **Shared runs:** redeeming `/share#t=…`.
- **Replications as a shared viewer:** the list, then every tab of JH16 and CR2014.
- **Runs:** the list, run detail with the Data & Results and Provenance tabs, and Results.
- **Raw artifact:** fetching a shared run's raw artifact gave `200`, 155,467 bytes, `application/octet-stream`.
- **Other screens:** `/setup`, a forbidden view (`/study`), and `/apply` for a stranger.

On every page the probe recorded:

- horizontal overflow, plus any element sticking out outside a scroll container;
- page errors and console errors;
- HTTP status ≥ 400;
- visible buttons and whether they were disabled;
- the full page text, read for leaks between the two languages.

Results:

- 175 page states.
- Horizontal overflow was 0 everywhere.
- No page errors. The only console or HTTP errors were the expected `401 /api/auth/me` for anonymous visitors.

## Findings fixed (before → after)

| # | Defect | Evidence | Fix | Test |
|---|---|---|---|---|
| 1 | **The language selector on the access screens changed only the tagline.** The heading and body stayed in the old language, because the selector and the page held separate state. | `before/before_en_phone_privacy_after_switch_to_pl.png` | One shared choice, broadcast to every screen part (`chooseLanguage`, `watchdog-language-changed`). | e2e `invitee_screens` 1 |
| 2 | **The workspace kept its own language, Polish by default, whatever the browser or the access screens said.** An English guest entered a Polish menu. | `before/before_en_phone_home_banner.png` | When no workspace choice is saved, the workspace follows the reader's access-screen choice, then the browser. Either selector now moves both. | e2e `invitee_screens` 3; `workspace_navigation` now states `pl-PL` |
| 3 | **`/share` was hardcoded Polish** ("Udostępnione przebiegi", "Masz dostęp do odczytu 7 przebiegów", "Zaloguj się"), in an English UI too. | `before/before_en_phone_share.png` | Labels in `config/access/ui.json` in both languages. The count wording avoids the Polish plural trap. | e2e 3 |
| 4 | **The invitation named the inviter "Local user (pre-authentication)"** after the owner claimed `local-user`. The email draft did the same. | `before/before_en_phone_join_bearer.png` | The preview returns `inviter: null` for the operator and for the unnamed `local-user`, and the screen says "The operator of this installation" in the reader's language. The owner's sign-in address is not exposed to link holders. A name the owner sets is still used. The email draft falls back to the inviter's address. | integration `invitee_screens` 1; e2e 3 |
| 5 | **The banner and the join texts used the raw role id "viewer"** where every other label says "results viewer", and the banner had broken grammar ("The roles researcher are waiting"). | `before/before_en_phone_home_banner.png` | The role label is used, and the sentences are rephrased in both languages. | e2e 3 |
| 6 | **The Replications list said "0 przebiegów w tej instalacji" to a guest with 7 shared runs**, while the target page listed them. The list ignored shares. | `before/before_en_phone_replications_list.png` | `/api/replications` counts with the same shared set as the target page. | integration `invitee_screens` 2 |
| 7 | **A read-only guest got the "Zamroź nowy protokół" form, the "Nowy pomiar" approve-and-launch controls and the manuscript-edit button.** The form and controls became enabled after typing or ticking, and the server would then refuse them. | `before/before_en_phone_protocol_tab.png` | Without `method.approve`, `run.create` or `narrative.approve` respectively, the controls are replaced by a note saying which role is needed. The measurement description stays visible. | e2e 3 |
| 8 | **A 500 from a Node system error quoted server paths** (`ENOENT … /mnt/watchdog/object_store/…`). | First host run | `STORAGE_ERROR`: "Stored data could not be read on the server. Reference for the operator: <trace id>". The full error goes to the server log under the same id. | integration `invitee_screens` 3 |
| 9 | **Server refusals reached guests in English in the Polish UI.** Examples: "This invitation has already been used." and "This share link is not valid…". | Code review of Join, ShareLink, Login, SignInPanel and Apply | Refusals with a known code are shown from `ui.json`; other refusals show the server's text. | e2e 3 (share error) |
| 10 | **Hardcoded English on access screens.** "Checking access…", "Access unavailable / Your current profiles do not grant access", the local-mode join text, and the bare `HTTP 500` and `…` on the legal pages. | `after/*_45_forbidden_view.png` | Labels from `ui.json`. | e2e 3 (forbidden view) |

## Found and not fixed

- **The research pages each have a fixed language, so they mix languages for every reader.** This needs a translation pass of its own. It is not a defect of the access work.
  - Replications, Results captions and the goal dashboard are Polish-only (hardcoded in `Replications.tsx` and `config/goal-navigation.json`).
  - Runs, Run detail and parts of Setup are English-only.
  - The goal dashboard and its favourites come from the base PR (#26). Translating them needs a bilingual goal-configuration schema and belongs there.
- **The CR2014 measurement tab shows an English server message, "Add your personal serpapi key in Settings → wizard, step 1."** It only appears for people who can run measurements, and the server texts are untranslated.
- **A bearer guest is named `okaziciel <id>` (Polish) and sees the address `bearer-…@bearer.invalid` on Setup.** The name is an owner decision tested in `accounts_admission.test.ts`, and it is mainly what administrators see. Showing the guest something friendlier is a product choice.
- **Setup offers a viewer the API-key vault and settings.** These are per account, and the server allows them. Whether a guest should store keys is the owner's decision.
- **Every anonymous page logs one console error for the expected `401` from `/api/auth/me`.** It is harmless and not visible to the person.
- **The login and join pages tell the visitor to have the operator run `sudo watchdogctl signin-link`.** This is true on this installation, which has no mail or Google, and `scripts/watchdogctl.sh` provides it. Once mail or Google is configured, the hint disappears.
- **Raw artifacts on the host.** On the host the copy's absolute `/mnt/watchdog/...` URIs cannot be read. In the image they open (200).

## Gate

`npm run test:all` was run on the host on the final tree: lint, build and 683/683 tests passed. It includes the new `tests/integration/invitee_screens.test.ts` and `tests/e2e/invitee_screens.test.ts`.

## Files

- `before/`: the base image, English phone guest (`before.cjs`).
- `after/`: this branch, English and Polish phone, plus a few desktop screens (`probe.cjs`).
- `probe_log.txt`: one line per page state checked: path, overflow, issues.
- `scripts/`:
  - `probe.cjs`, the four-pass walk;
  - `before.cjs`, the base screenshots;
  - `reset.cjs`, which removes the earlier access test's rows from the scratch copy;
  - `langswitch.cjs`, which found finding 1.
