/**
 * Requests from a pasted text (a researcher's message, a note). The text and the
 * analysis it produced are write-once; what happened afterwards (runs started,
 * proposals accepted, questions answered) is an append-only event list.
 */
export const MIGRATION_026_TEXT_REQUESTS = `
CREATE TABLE text_requests (
 id TEXT PRIMARY KEY,
 owner_principal_id TEXT NOT NULL,
 text_sha256 TEXT NOT NULL,
 body_json TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX text_requests_owner ON text_requests(owner_principal_id, created_at);
CREATE TRIGGER text_requests_immutable BEFORE UPDATE ON text_requests BEGIN SELECT RAISE(ABORT,'WORM text request'); END;
CREATE TRIGGER text_requests_retained BEFORE DELETE ON text_requests BEGIN SELECT RAISE(ABORT,'Retain text request'); END;
CREATE TABLE text_request_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 request_id TEXT NOT NULL REFERENCES text_requests(id),
 owner_principal_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('launched', 'deferred', 'accepted', 'answered', 'failed')),
 body_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX text_request_events_request ON text_request_events(request_id, sequence);
CREATE TRIGGER text_request_events_immutable BEFORE UPDATE ON text_request_events BEGIN SELECT RAISE(ABORT,'WORM text request event'); END;
CREATE TRIGGER text_request_events_retained BEFORE DELETE ON text_request_events BEGIN SELECT RAISE(ABORT,'Retain text request event'); END;
`;
