/** Append-only private catalog additions, access assessments and unsent request drafts. */
export const MIGRATION_019_SOURCE_ACCESS=`
CREATE TABLE source_candidates (
 id TEXT PRIMARY KEY,owner_principal_id TEXT NOT NULL REFERENCES principals(id),
 body_json TEXT NOT NULL,content_hash TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE source_access_revisions (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,
 owner_principal_id TEXT NOT NULL REFERENCES principals(id),source_id TEXT NOT NULL,
 previous_id TEXT REFERENCES source_access_revisions(id),body_json TEXT NOT NULL,content_hash TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX source_access_owner_source ON source_access_revisions(owner_principal_id,source_id,sequence);
CREATE TABLE source_access_drafts (
 id TEXT PRIMARY KEY,owner_principal_id TEXT NOT NULL REFERENCES principals(id),source_id TEXT NOT NULL,
 body_json TEXT NOT NULL,content_hash TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX source_drafts_owner_source ON source_access_drafts(owner_principal_id,source_id);
CREATE TRIGGER source_candidates_immutable BEFORE UPDATE OF id,body_json,content_hash,created_at ON source_candidates
 BEGIN SELECT RAISE(ABORT,'WORM source candidate'); END;
CREATE TRIGGER source_access_immutable BEFORE UPDATE OF sequence,id,source_id,previous_id,body_json,content_hash,created_at ON source_access_revisions
 BEGIN SELECT RAISE(ABORT,'WORM source access'); END;
CREATE TRIGGER source_drafts_immutable BEFORE UPDATE OF id,source_id,body_json,content_hash,created_at ON source_access_drafts
 BEGIN SELECT RAISE(ABORT,'WORM source draft'); END;
CREATE TRIGGER source_candidates_no_delete BEFORE DELETE ON source_candidates BEGIN SELECT RAISE(ABORT,'WORM source candidate'); END;
CREATE TRIGGER source_access_no_delete BEFORE DELETE ON source_access_revisions BEGIN SELECT RAISE(ABORT,'WORM source access'); END;
CREATE TRIGGER source_drafts_no_delete BEFORE DELETE ON source_access_drafts BEGIN SELECT RAISE(ABORT,'WORM source draft'); END;
`;
