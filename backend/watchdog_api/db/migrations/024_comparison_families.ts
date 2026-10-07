/**
 * E5.7b.1: frozen comparison families. Additive; 001–023 are unchanged.
 * A family row is the frozen membership; family events record every attempt
 * or refusal made through the family. Both are write-once and retained.
 */
export const MIGRATION_024_COMPARISON_FAMILIES = `
CREATE TABLE paper_comparison_families (
 id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, document_id TEXT NOT NULL,
 content_hash TEXT NOT NULL, body_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX paper_comparison_families_owner ON paper_comparison_families(owner_principal_id,document_id);
CREATE TABLE paper_comparison_family_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 family_id TEXT NOT NULL REFERENCES paper_comparison_families(id),
 comparison_id TEXT NOT NULL REFERENCES paper_comparisons(id),
 kind TEXT NOT NULL CHECK(kind IN ('ATTEMPT','REFUSED')),
 attempt_id TEXT UNIQUE REFERENCES paper_comparison_attempts(id),
 data_json TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL, request_id TEXT NOT NULL,
 CHECK((kind='ATTEMPT' AND attempt_id IS NOT NULL) OR (kind='REFUSED' AND attempt_id IS NULL))
);
CREATE INDEX paper_comparison_family_events_family ON paper_comparison_family_events(family_id,sequence);
CREATE TRIGGER paper_comparison_families_immutable BEFORE UPDATE ON paper_comparison_families BEGIN SELECT RAISE(ABORT,'WORM comparison family'); END;
CREATE TRIGGER paper_comparison_families_retained BEFORE DELETE ON paper_comparison_families BEGIN SELECT RAISE(ABORT,'Retain comparison family'); END;
CREATE TRIGGER paper_comparison_family_events_immutable BEFORE UPDATE ON paper_comparison_family_events BEGIN SELECT RAISE(ABORT,'WORM comparison family event'); END;
CREATE TRIGGER paper_comparison_family_events_retained BEFORE DELETE ON paper_comparison_family_events BEGIN SELECT RAISE(ABORT,'Retain comparison family event'); END;
`;
