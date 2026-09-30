export const MIGRATION_022_PAPER_COMPARISONS = `
CREATE TABLE paper_comparisons (
 id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL,
 operation_id TEXT NOT NULL REFERENCES paper_operations(id),
 content_hash TEXT NOT NULL, body_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX paper_comparisons_owner ON paper_comparisons(owner_principal_id,operation_id);
CREATE TABLE paper_comparison_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 comparison_id TEXT NOT NULL REFERENCES paper_comparisons(id),
 comparison_hash TEXT NOT NULL, actor_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('APPROVE','REVOKE','FREEZE','ATTEMPT')),
 data_json TEXT NOT NULL, created_at TEXT NOT NULL, request_id TEXT NOT NULL
);
CREATE INDEX paper_comparison_events_revision ON paper_comparison_events(comparison_id,sequence);
CREATE TABLE paper_comparison_attempts (
 id TEXT PRIMARY KEY REFERENCES paper_comparison_events(id),
 comparison_id TEXT NOT NULL REFERENCES paper_comparisons(id),
 freeze_id TEXT NOT NULL UNIQUE REFERENCES paper_comparison_events(id),
 run_id TEXT NOT NULL UNIQUE REFERENCES runs(id)
);
CREATE TRIGGER paper_comparisons_immutable BEFORE UPDATE OF id,operation_id,content_hash,body_json,created_at ON paper_comparisons BEGIN SELECT RAISE(ABORT,'WORM comparison'); END;
CREATE TRIGGER paper_comparisons_retained BEFORE DELETE ON paper_comparisons BEGIN SELECT RAISE(ABORT,'Retain comparison'); END;
CREATE TRIGGER paper_comparison_events_immutable BEFORE UPDATE ON paper_comparison_events BEGIN SELECT RAISE(ABORT,'WORM comparison receipt'); END;
CREATE TRIGGER paper_comparison_events_retained BEFORE DELETE ON paper_comparison_events BEGIN SELECT RAISE(ABORT,'Retain comparison receipt'); END;
CREATE TRIGGER paper_comparison_attempts_immutable BEFORE UPDATE ON paper_comparison_attempts BEGIN SELECT RAISE(ABORT,'WORM comparison attempt'); END;
CREATE TRIGGER paper_comparison_attempts_retained BEFORE DELETE ON paper_comparison_attempts BEGIN SELECT RAISE(ABORT,'Retain comparison attempt'); END;
`;
