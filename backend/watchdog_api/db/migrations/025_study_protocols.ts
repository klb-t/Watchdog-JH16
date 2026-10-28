/**
 * E5.7b: frozen study protocols. A protocol fixes, before confirmation data
 * exist, the hypotheses, primary endpoints, the complete comparison family, the
 * multiplicity procedure and alpha. It is write-once; a confirmatory run cites
 * its id and content hash in its own (hashed) configuration.
 */
export const MIGRATION_025_STUDY_PROTOCOLS = `
CREATE TABLE study_protocols (
 id TEXT PRIMARY KEY,
 owner_principal_id TEXT NOT NULL,
 target_id TEXT NOT NULL,
 body_json TEXT NOT NULL,
 content_hash TEXT NOT NULL UNIQUE,
 frozen_at TEXT NOT NULL
);
CREATE INDEX study_protocols_owner_target ON study_protocols(owner_principal_id, target_id, frozen_at);
CREATE TRIGGER study_protocols_immutable BEFORE UPDATE ON study_protocols BEGIN SELECT RAISE(ABORT,'WORM study protocol'); END;
CREATE TRIGGER study_protocols_retained BEFORE DELETE ON study_protocols BEGIN SELECT RAISE(ABORT,'Retain study protocol'); END;
`;
