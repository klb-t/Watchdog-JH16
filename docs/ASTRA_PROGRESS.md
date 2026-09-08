# WatchDog continuation — 2026-09-08

Base: `claude/ai-studio-last-commit-gjqxy4` at
`8a5102e6ae72ea1ac9107b18987a5bbe51ad0a7c`, checked through GitHub and a real clone.
Work branch: `astra/watchdog-continuation-20260908`.

## Baseline and environment

- Read the operating contract, current spec, owner handoff and Programming Constitution.
- `npm ci` exposed missing optional-platform entries in the committed lockfile.
  `npm install` repaired those entries without changing the declared dependencies.
- This runtime has Node 24.19.0. SQLite compiled successfully against its official headers;
  the environment's tar ownership handling required extracting headers with `--no-same-owner`.
- Use `node --import tsx` rather than the tsx CLI: the latter's Unix IPC socket is unsupported
  here. TCP, SQLite and the application work. Test subprocesses use the same loader.
- Baseline: 231 tests attempted, **227 passed, 4 browser tests blocked** because no Chromium
  is installed. The browser download timed out. None were skipped or reclassified as passing.
- `demo:jh16`: 32 observations, 16 Pi/Hi results and both existing self-check verdicts reproduced.
  This remains a pipeline self-check, not independent replication.
- Lockfile consistency and production build verified after the installation repair.
- Docker executable/daemon and PostgreSQL server are absent. No live provider credentials used.

## Owner's sequencing correction

The owner explicitly prioritised the responder scenario during this session:
unknown pill description (e.g. green X) + region/time → matching tested samples → actual
composition → cited interactions. Complete this narrow vertical after its capability foundation;
do not delay it for the unrelated method compiler, worker or generic workbench.

Public alerts may lack specimen counts, laboratory methods, exact dates and local geography.
Missing values must stay missing. A national bulletin is not a city-level sample, and a visual
candidate never confirms the identity or composition of the pill in front of the responder.

## Checkpoints

Further verified changes and blockers are recorded with their task in the main ledger.
