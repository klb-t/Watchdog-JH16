# Historical blocker record

Snapshot from `31b813f`; not the current work queue. Original path: docs/spec/07_EPICS_AND_TASKS.md. Relative references retain their historical meaning.

## Blocked

### Historical E3.13 publication block — resolved 2026-09-30

The block below describes September 22 only. Published `c3508c1` passed both jobs
of Actions `35829482923` on September 23, including the Chromium suite and the
production container persistence check. It no longer blocks development. The owner
authorized autonomous continuation on September 30; current work uses a separate
integration branch, preserving PR #1 and its base.

The owner requested publication from `HANDOFF_2026-09-22.md`. The recovery checksums,
bundle ancestry and clean local `c473993` checkout were verified. GitHub PR #1 and its
branch still point at `1e583c1`; Actions `35614465513` failed, and the new container job
has not run. The GitHub connector returns HTTP 400 `Invalid MCP request metadata`.
Direct Git lacks credentials. Local typecheck/build and 356 tests pass; 17 browser
tests cannot launch without Chromium, whose download failed. No Docker is installed.

**Unblock:** restore an authenticated publication channel for the existing repository
and branch, then push without force and verify both `verify` and `container` on the
published head. A browser fallback requires user approval under `control-browser`.
Historical instruction: do not merge PR #1 or change its base; E4.5 had not started then.

### Continuation checkpoint (2026-09-08)

- [x] **E0.6 — Portable clean install and test entrypoints.** Repair missing optional-platform
  lock entries; use Node's tsx loader without a CLI IPC server. Lockfile consistency,
  production build and offline JH16 demo checked. Baseline 227/231 passed; four browser tests
  blocked by absent Chromium/download timeout, not by a reported application assertion.
  See `docs/ASTRA_PROGRESS.md` for exact environment limits.

*Nothing. E1.20's tolerance bands, the one item that was blocked, were proposed against the
primary source and then registered under authority the maintainer delegated explicitly. The
pre-registration property is preserved and checkable: the bands and their full rationale were
committed in `2e417c66514b3ac24aef6cc067d435168089f852` before any verdict existed anywhere in
this repository, and `config/replication/jh2016.json` names that commit. Widening a band after
seeing a verdict requires a new version of that file and is visible in git history.*

### PostgreSQL backend for `storage.relational`

**What is missing.** The database is still SQLite. GCS object storage is separately
implemented; the startup durability gate checks configured paths rather than filesystem
locking/transaction semantics. It does not establish that bucket-mounted SQLite is safe.

**Why it was not written.** A Postgres backend needs (a) a driver dependency — `pg` plus
`drizzle-orm/node-postgres` — and (b) a dialect port of the four migrations, which use SQLite
integer booleans, `PRAGMA table_info` introspection in the ownership-transfer path, and
`INSERT OR IGNORE`. None of that is hard, but **none of it can be verified from this
environment**: there is no Postgres server to run the repository suite against. Shipping an
adapter that has never executed a statement, registered as `implemented`, is the fabricated
implementation rule 1 forbids. It is registered `planned` and throws instead.

**Correction, 2026-09-30.** The former claim that a single Cloud Run instance with SQLite
on a mounted GCS bucket is durable and correct is withdrawn. Google documents missing
locking/patching and advises against database storage on Cloud Storage FUSE; see
[the corrected runbook](../DEPLOY_GCP.md). The old deploy recipe now fails before cloud
mutations. The private VM uses a disk bind mount and remains a separate path. No live
Cloud Run deployment or data-loss finding is claimed by this audit.

**Unblock:** implement and validate a supported database arrangement locally first, including
migrations, ownership/approval invariants, transactions and backup/restore. Production
provisioning and any paid resources remain a separate decision. The former one-day estimate
was not established by execution evidence.

*Add entries here with enough detail that the maintainer can unblock in one action, then
continue with the next unblocked task rather than waiting.*
