/** Profiles are immutable configuration snapshots addressed by their content. */
export const MIGRATION_008_WORKBENCH_PROFILES = `
CREATE TABLE workbench_profiles (
  content_hash TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL,
  archived_at TEXT NOT NULL
);
CREATE TRIGGER workbench_profiles_no_update BEFORE UPDATE ON workbench_profiles
BEGIN SELECT RAISE(ABORT, 'WORM: visualization profiles are immutable'); END;
CREATE TRIGGER workbench_profiles_no_delete BEFORE DELETE ON workbench_profiles
BEGIN SELECT RAISE(ABORT, 'WORM: visualization profiles are immutable'); END;
`;
