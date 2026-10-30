/**
 * Bearer invitations and run sharing (owner's requirement of 2026-10-29).
 *
 * - An open link may now sign in by itself (`invitations.signs_in`): the holder
 *   becomes a guest principal with its own `bearer` identity. SQLite cannot
 *   change a CHECK in place, so `principal_identities` is rebuilt with the same
 *   rows and the extra provider.
 * - Access above viewer from a bearer link, or from an email invitation used by
 *   a different verified address, is an application an administrator decides
 *   (`access_applications.origin`, `.invitation_id`).
 * - `run_shares`: an owner lets an account, an address or a link holder read a
 *   run. One link may cover several runs (same token hash on each row); a
 *   signed-in holder redeems it into principal shares that name the link. Shares are never deleted or edited; revocation is the only change.
 */
export const MIGRATION_027_BEARER_AND_RUN_SHARES = `
CREATE TABLE principal_identities_027 (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'email', 'operator', 'bearer')),
  subject TEXT NOT NULL,
  principal_id TEXT NOT NULL REFERENCES principals(id),
  email TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);
INSERT INTO principal_identities_027 (provider, subject, principal_id, email, first_seen_at, last_seen_at)
  SELECT provider, subject, principal_id, email, first_seen_at, last_seen_at FROM principal_identities;
DROP TABLE principal_identities;
ALTER TABLE principal_identities_027 RENAME TO principal_identities;
CREATE INDEX idx_principal_identities_principal ON principal_identities(principal_id);

ALTER TABLE invitations ADD COLUMN signs_in INTEGER NOT NULL DEFAULT 0 CHECK (signs_in IN (0, 1));
CREATE TRIGGER invitations_signs_in_open_link BEFORE INSERT ON invitations
  WHEN NEW.signs_in = 1 AND NEW.kind <> 'open_link'
  BEGIN SELECT RAISE(ABORT, 'Only an open link can sign in by itself'); END;

ALTER TABLE access_applications ADD COLUMN origin TEXT CHECK (origin IS NULL OR origin IN ('bearer_link', 'address_mismatch', 'open_link'));
ALTER TABLE access_applications ADD COLUMN invitation_id TEXT REFERENCES invitations(id);

CREATE TABLE run_shares (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  owner_principal_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('principal', 'email', 'link')),
  target TEXT,
  token_hash TEXT,
  via_share_id TEXT REFERENCES run_shares(id),
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  CHECK ((target_kind = 'link') = (token_hash IS NOT NULL)),
  CHECK (target_kind = 'link' OR target IS NOT NULL),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE INDEX idx_run_shares_run ON run_shares(run_id);
CREATE INDEX idx_run_shares_target ON run_shares(target_kind, target);
CREATE INDEX idx_run_shares_token ON run_shares(token_hash);
CREATE TRIGGER run_shares_identity_immutable BEFORE UPDATE OF id, run_id, owner_principal_id, target_kind, target, token_hash, via_share_id, note, created_by, created_at, expires_at ON run_shares
  BEGIN SELECT RAISE(ABORT, 'WORM run share: only revocation may change'); END;
CREATE TRIGGER run_shares_revoked_once BEFORE UPDATE OF revoked_at, revoked_by ON run_shares
  WHEN OLD.revoked_at IS NOT NULL
  BEGIN SELECT RAISE(ABORT, 'WORM run share: already revoked'); END;
CREATE TRIGGER run_shares_retained BEFORE DELETE ON run_shares
  BEGIN SELECT RAISE(ABORT, 'Retain run share'); END;
`;
