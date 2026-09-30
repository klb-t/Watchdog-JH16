/** Installation access is mutable and audited; scientific ownership is never deleted. */
export const MIGRATION_020_ADMISSION = `
CREATE TABLE installation_grants (
 email TEXT PRIMARY KEY, roles_json TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)),
 actor_principal_id TEXT NOT NULL REFERENCES principals(id), updated_at TEXT NOT NULL
);
CREATE TABLE admission_requests (
 principal_id TEXT PRIMARY KEY REFERENCES principals(id), email TEXT NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE admission_invitations (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, email TEXT NOT NULL, message TEXT NOT NULL,
 actor_principal_id TEXT NOT NULL REFERENCES principals(id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 revoked_at TEXT, accepted_at TEXT, accepted_principal_id TEXT REFERENCES principals(id)
);
CREATE TABLE admission_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, actor_principal_id TEXT NOT NULL REFERENCES principals(id),
 action TEXT NOT NULL, target_email TEXT NOT NULL, detail_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER admission_events_immutable BEFORE UPDATE ON admission_events BEGIN SELECT RAISE(ABORT,'immutable admission event'); END;
CREATE TRIGGER admission_events_no_delete BEFORE DELETE ON admission_events BEGIN SELECT RAISE(ABORT,'immutable admission event'); END;
CREATE INDEX admission_invitation_email ON admission_invitations(email,created_at);
`;
