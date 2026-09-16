export const MIGRATION_011_PERSONAL_SETTINGS = `
CREATE TABLE personal_settings_snapshots (hash TEXT PRIMARY KEY, body_json TEXT NOT NULL);
CREATE TRIGGER settings_snapshots_immutable BEFORE UPDATE ON personal_settings_snapshots BEGIN SELECT RAISE(ABORT, 'WORM settings snapshot'); END;
CREATE TABLE assistant_profiles (hash TEXT PRIMARY KEY, body_json TEXT NOT NULL);
CREATE TRIGGER assistant_profiles_immutable BEFORE UPDATE ON assistant_profiles BEGIN SELECT RAISE(ABORT, 'WORM assistant profile'); END;
CREATE TABLE personal_settings (owner_principal_id TEXT PRIMARY KEY, body_json TEXT NOT NULL, content_hash TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE user_secret_envelopes (id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, provider_key TEXT NOT NULL,
 envelope_json TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(owner_principal_id,provider_key));
CREATE TABLE assistant_catalogs (hash TEXT PRIMARY KEY, body_json TEXT NOT NULL, fetched_at TEXT NOT NULL, raw_blob_id TEXT NOT NULL REFERENCES raw_blobs(id));
CREATE TRIGGER assistant_catalogs_immutable BEFORE UPDATE ON assistant_catalogs BEGIN SELECT RAISE(ABORT, 'WORM catalog'); END;
CREATE TABLE assistant_reservations (id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, day_utc TEXT NOT NULL,
 reserved_micro_usd INTEGER NOT NULL, charged_micro_usd INTEGER NOT NULL, status TEXT NOT NULL, route_json TEXT NOT NULL,
 result_json TEXT, created_at TEXT NOT NULL, finished_at TEXT);
CREATE INDEX idx_assistant_owner_day ON assistant_reservations(owner_principal_id,day_utc);
CREATE TABLE personal_search_requests (id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, day_utc TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX idx_search_requests_day ON personal_search_requests(owner_principal_id,day_utc);
CREATE TABLE research_plans (id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, content_hash TEXT NOT NULL,
 body_json TEXT NOT NULL, created_at TEXT NOT NULL, launch_json TEXT);
CREATE TRIGGER research_plans_immutable BEFORE UPDATE OF body_json,content_hash ON research_plans BEGIN SELECT RAISE(ABORT, 'WORM research plan'); END;
`;
