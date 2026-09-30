/** Private reading state; source records and scientific review remain in their existing stores. */
export const MIGRATION_018_SOURCE_WATCHES = `
CREATE TABLE source_watches (
 id TEXT PRIMARY KEY,
 owner_principal_id TEXT NOT NULL REFERENCES principals(id),
 context_anchor INTEGER NOT NULL REFERENCES substance_reference_observations(sequence),
 context_hash TEXT NOT NULL,
 rule TEXT NOT NULL CHECK(rule='source-record-change-1'),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 reviewed_through INTEGER NOT NULL REFERENCES substance_reference_observations(sequence),
 revision INTEGER NOT NULL CHECK(revision>=1),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX source_watches_owner_context ON source_watches(owner_principal_id,context_hash);
CREATE TRIGGER source_watch_identity_immutable BEFORE UPDATE OF context_anchor,context_hash,rule,created_at ON source_watches
 BEGIN SELECT RAISE(ABORT,'WORM source watch identity'); END;
CREATE TRIGGER source_watch_cursor_monotonic BEFORE UPDATE OF reviewed_through ON source_watches
 WHEN NEW.reviewed_through<OLD.reviewed_through
 BEGIN SELECT RAISE(ABORT,'Source watch cursor cannot move backward'); END;
`;
