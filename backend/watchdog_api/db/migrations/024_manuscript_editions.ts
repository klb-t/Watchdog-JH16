/**
 * Language editing of a replication manuscript. An edition records the exact
 * manuscript input, the model, every unit's original and edited text with its
 * verification result, token usage and estimated cost. Editions are evidence of
 * what a model changed, so they are write-once and retained.
 */
export const MIGRATION_024_MANUSCRIPT_EDITIONS = `
CREATE TABLE manuscript_editions (
 id TEXT PRIMARY KEY,
 owner_principal_id TEXT NOT NULL,
 target_id TEXT NOT NULL,
 manuscript_input_hash TEXT NOT NULL,
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 settings_hash TEXT NOT NULL,
 body_json TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 estimated_cost_usd REAL NOT NULL,
 day_utc TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX manuscript_editions_owner_day ON manuscript_editions(owner_principal_id, day_utc);
CREATE TRIGGER manuscript_editions_immutable BEFORE UPDATE ON manuscript_editions BEGIN SELECT RAISE(ABORT,'WORM manuscript edition'); END;
CREATE TRIGGER manuscript_editions_retained BEFORE DELETE ON manuscript_editions BEGIN SELECT RAISE(ABORT,'Retain manuscript edition'); END;
`;
