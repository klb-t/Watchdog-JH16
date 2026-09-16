/**
 * The domain layer: pure types and invariants. No I/O.
 *
 * `01_ARCHITECTURE.md` §Layers: "`domain` and `analysis` must be importable in
 * a test with no database, no network and no filesystem. If they are not, the
 * boundary has leaked." `tests/unit/domain.test.ts` enforces that by inspecting
 * this module's import graph, not merely by convention.
 */
export * from './canonical';
export * from './run_state';
export * from './observation';
export * from './approval';
export * from './error_taxonomy';
export * from './principal';
export * from './evidence_tier';
export * from './method_spec';
