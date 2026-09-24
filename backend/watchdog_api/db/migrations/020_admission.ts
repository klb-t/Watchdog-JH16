/**
 * E4.5: admission to the installation, separated from identity.
 *
 * Identity answers "who is this?" — a verified email address, proven by Google
 * or by a one-time code sent to that address. Admission answers "may they use
 * this installation, and as what?". Keeping them in different tables is what
 * lets a verified stranger sign in, see only the application form, and hold no
 * capability at all until someone with `access.admit` says otherwise.
 *
 * Grants bind to the exact verified address, not to a principal row, because
 * the address is what an administrator knows and types. A person who later
 * signs in by a different method with the same verified address lands on the
 * same grants.
 *
 * Nothing here is deleted. Revocation, expiry and replacement are recorded as
 * new facts on the row or as new rows, so "who could do what, when" stays
 * answerable after the fact. Every decision is also appended to the
 * hash-chained `audit_events`.
 */
export const MIGRATION_020_ADMISSION = `
-- Every sign-in method maps to one principal. A Google subject and a verified
-- email address for the same person link to the same row.
CREATE TABLE principal_identities (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'email', 'operator')),
  subject TEXT NOT NULL,
  principal_id TEXT NOT NULL REFERENCES principals(id),
  email TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX idx_principal_identities_principal ON principal_identities(principal_id);

-- Bumped on sign-out-everywhere and deactivation. A cookie carrying an older
-- version is refused on the next request, not at its expiry.
ALTER TABLE principals ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE admission_grants (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  roles_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('invitation', 'open_link', 'application', 'admin')),
  source_id TEXT,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  note TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  revoke_reason TEXT,
  CHECK (email = lower(email)),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE INDEX idx_admission_grants_email ON admission_grants(email);

-- The token itself is never stored, only its SHA-256. A database copy therefore
-- does not contain usable invitation links.
CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email', 'open_link')),
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT,
  roles_json TEXT NOT NULL,
  note TEXT,
  max_uses INTEGER NOT NULL CHECK (max_uses >= 1),
  uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses),
  expires_at TEXT NOT NULL,
  access_expires_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (delivery_status IN ('draft', 'link_shared', 'sent', 'send_failed')),
  delivery_detail TEXT,
  last_delivery_at TEXT,
  -- An email invitation is single-use and addressed; an open link has no address.
  CHECK ((kind = 'email' AND email IS NOT NULL AND email = lower(email) AND max_uses = 1)
      OR (kind = 'open_link' AND email IS NULL))
);

CREATE TABLE invitation_redemptions (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES invitations(id),
  principal_id TEXT NOT NULL REFERENCES principals(id),
  email TEXT NOT NULL,
  grant_id TEXT NOT NULL REFERENCES admission_grants(id),
  redeemed_at TEXT NOT NULL,
  UNIQUE (invitation_id, principal_id)
);

CREATE TABLE access_applications (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals(id),
  email TEXT NOT NULL,
  display_name TEXT,
  affiliation TEXT,
  reason TEXT NOT NULL,
  requested_roles_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'withdrawn')),
  submitted_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  decision_note TEXT,
  grant_id TEXT REFERENCES admission_grants(id)
);
CREATE INDEX idx_access_applications_status ON access_applications(status, submitted_at);
-- At most one open application per person: a second submission edits nothing
-- and is refused, so an administrator never approves a stale duplicate.
CREATE UNIQUE INDEX idx_access_applications_one_pending
  ON access_applications(principal_id) WHERE status = 'pending';

-- One-time codes for email sign-in and operator break-glass links. Hashed, like
-- invitation tokens; attempts are counted so a code cannot be brute-forced.
CREATE TABLE sign_in_challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email_code', 'operator_link')),
  email TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sent', 'send_failed', 'printed')),
  CHECK (email = lower(email))
);
CREATE INDEX idx_sign_in_challenges_email ON sign_in_challenges(email, created_at);

-- Pre-existing Google principals keep working: their identity row is derived
-- from the principal id they were created with in E4.1.
INSERT OR IGNORE INTO principal_identities (provider, subject, principal_id, email, first_seen_at, last_seen_at)
  SELECT 'google', substr(id, 8), id, lower(email), created_at, COALESCE(last_seen_at, created_at)
  FROM principals WHERE id LIKE 'google:%' AND email IS NOT NULL;
`;
