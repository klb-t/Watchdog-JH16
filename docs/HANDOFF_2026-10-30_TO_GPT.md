# Handoff to GPT — 2026-10-30

Written by Claude when the owner's weekly limit ran out. Everything below is pushed; nothing exists only in a
conversation. Read `CLAUDE.md`, then `docs/spec/00_STATE_AND_DECISIONS.md`, then this file.

## State
- `main` = `baf50bb` (#31–#34 landed: access above viewer, every page in PL/EN bundles, goal cards PL/EN, test
  servers that drain their output).
- Open PRs, a linear stack (the owner merges in this order with `~/wt/owner_commands_2026-10-30/watchdog_merge_all.sh`
  and `stack_2026-10-30.txt` on the VM):
  1. **#35** `claude/dutch-language-20261030` → `main`. Dutch as a third language. CI green.
     **The Dutch text is a machine translation nobody has read**; the interface says so while Dutch is shown
     (`config/languages.json`, `review: machine`). Legal pages stay English for Dutch readers.
  2. **#36** `claude/narrative-paid-consent-20261030` → #35. `POST /runs/:id/narrative/generate` no longer
     defaults to the paid OpenRouter provider: it needs `{consent: true, provider}`, has the same-origin guard,
     and refuses any provider configured `billing: metered` (this route has no budget; the budgeted route is
     `/narrative/automatic`). New required key `billing` in `config/providers/text_generation.json`.
  - #11 (`astra/desktop-field-ready-20261007`) is older and not part of this stack.
- Test results: `npm run test:all` on #35 716/717. The one failure is `tests/integration/operations_update.test.ts`
  "health failure stops new runtime…": the update script hits that test's own 30 s `spawnSync` limit when the VM
  load average is ~18–19 (other sessions). Alone it passes 9/9. Not caused by these PRs. All tests use fixtures.

## Phone language (checked on the live site, read-only, 2026-10-30)
A Polish phone got Polish. A browser listing English first got English; a choice stored earlier in the browser
wins; a Dutch phone got Polish; `<html lang>` was always `pl`. #35 reads the whole browser language list and sets
`<html lang>`. The owner's report "Polish phone got English" was not reproduced.

## Next steps, in this order (agreed with the coordinating session)
Findings come from `docs/AUDIT_PHILOSOPHY_2026-10-30.md` (read-only AI review of commit `494e84a`; the three
high findings were confirmed in code by Claude, the rest are not verified by a person).

1. **Missing is not zero in the data layer** — `backend/watchdog_api/db/repositories/data.ts:120` reads
   `numeric_value ?? 0` for a row stored as present (`is_missing = 0`) without a value; line 119 invents
   `'NOT_FETCHED'` when no reason is stored. The schema CHECK (`001_initial_schema.ts:242`) allows such rows, and
   SQLite stores a `NaN` as `NULL`, so a non-finite count from an adapter would come back as 0. Fix both sides:
   reject a non-finite value for a present observation on write (`data.ts:65`), and never turn a stored `NULL`
   into 0 on read (fail loudly or map to an explicit missing reason that says the row is inconsistent).
   **Data check:** copies of the owner's data in `~/wt/jh16_audit_2026-10-25/inst_main`,
   `~/wt/replica_test_2026-10-26/restored`, `~/wt/request_2026-10-28/inst`, `~/wt/second_target_2026-10-26/inst`
   have 0 such rows. **The production DB (`/var/lib/watchdog`, owned by `ubuntu`) was not checked**: the agent's
   permission policy refused `sudo -u ubuntu`. The owner can run, read-only:
   `sudo -u ubuntu sqlite3 'file:/var/lib/watchdog/<file>.sqlite?mode=ro' "SELECT run_id, count(*) FROM observations WHERE is_missing=0 AND numeric_value IS NULL GROUP BY run_id;"`
   An empty result means no stored run (including the JH16 material for Prof. Hoffmann) was affected.
2. **Runs that can never end** — nothing sets `CANCELLED` and there is no cancel endpoint
   (`domain/run_state.ts`, `services/run_orchestrator.ts:428`); a run in flight when the process restarts stays
   `RUNNING` forever and `src/pages/Dashboard.tsx:44` counts it as active. Model the fix on `automation_jobs`
   (lease + `INTERRUPTED`): mark stale active runs on startup, add a cancel action.
3. **Deterministic ordering** — `localeCompare` without a fixed locale in hashed artifacts
   (`services/manifest.ts:176-196`, `services/export.ts:49,76,129,138`; 59 calls repo-wide, elsewhere pinned to
   `'en'`). Pin the locale (or compare code points) wherever the result reaches a hashed or exported artifact, and
   add a test that runs the export under two process locales and compares bytes.
4. The remaining medium/low audit items (server error texts in English only — `AutomationError`, one code, 186
   sites; replication manuscript generated only in Polish; JH16 preset keys nothing reads; others) — see the audit.
5. Not code: Dutch needs a native reader; the new Polish texts of formerly English-only pages (dashboard, run
   details, results, setup) and the English goal cards have not been read by the owner.

## Rules that bit this session
- Pages follow the browser language: a browser test must pin `locale` or call `chooseInterfaceLanguage`
  (`tests/helpers/browser.ts`); SSR tests wrap in `UiLanguageProvider`.
- Start test servers with `tests/helpers/server.ts` (`freePort`, `waitForServer`), never with an unread pipe.
- Do not `pkill -f "node dist/server.cjs"` on the VM: it also hits the production container.
