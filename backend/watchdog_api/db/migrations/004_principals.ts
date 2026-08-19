/**
 * E4.1: populates the identity tables E1 already created, and adds the two
 * columns a real sign-in needs.
 *
 * Written against what migration 001 actually built (`principals`, `roles`,
 * `principal_roles`) rather than introducing a parallel table. A second
 * `principals` shape would have been the "registry entry mistaken for an
 * implementation" mistake in reverse — an implementation ignoring the schema
 * that was already there.
 *
 * `last_seen_at` is added because 001 records only `created_at`, and an
 * access review needs to know who is still using the instance.
 */
export const MIGRATION_004_PRINCIPALS = `
ALTER TABLE principals ADD COLUMN last_seen_at TEXT;

-- The four rungs of the ladder, as rows, so principal_roles has referents.
INSERT OR IGNORE INTO roles (id, name, description) VALUES
  ('viewer',     'viewer',     'Read runs, results and exports.'),
  ('researcher', 'researcher', 'Start runs; propose and approve methods and narratives.'),
  ('admin',      'admin',      'Everything a researcher may do, plus approving providers and managing principals.'),
  ('dev',        'dev',        'Everything an admin may do, plus the diagnostics surface.');

-- The E1 owner. Every row written before authentication references it, so it
-- must exist and must never be deleted: an old run has to keep resolving to a
-- principal that explains what it was, rather than to a dangling id.
INSERT OR IGNORE INTO principals (id, email, display_name, identity_provenance, active, created_at, last_seen_at)
VALUES ('local-user', NULL, 'Local user (pre-authentication)', 'local-constant', 1,
        '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO principal_roles (principal_id, role_id) VALUES ('local-user', 'dev');

CREATE INDEX IF NOT EXISTS idx_principals_email ON principals(email);
`;
