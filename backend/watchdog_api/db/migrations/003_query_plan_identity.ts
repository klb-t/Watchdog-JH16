/**
 * D15 / E3.3: the query plan's identity becomes part of the observation row.
 *
 * `series` already carries a language, but a series row is created once and
 * describes what the series is *meant* to be. The check that matters —
 * "did the plan change part-way through the data?" — can only be made against
 * what each individual fetch actually used. Storing it per observation is what
 * makes `QUERY_PLAN_DISCONTINUITY` a measurement rather than an assumption.
 *
 * Nullable, because rows written before this migration genuinely do not know.
 * The detector treats unknown as unknown; it does not assume continuity.
 */
export const MIGRATION_003_QUERY_PLAN_IDENTITY = `
ALTER TABLE observations ADD COLUMN language TEXT;
ALTER TABLE observations ADD COLUMN query_expansion_mode TEXT;
`;
