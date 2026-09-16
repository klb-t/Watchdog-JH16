export const MIGRATION_012_ASSISTANT_PROFILES = `
CREATE TABLE personal_model_catalogs (owner_principal_id TEXT NOT NULL, provider_key TEXT NOT NULL, hash TEXT NOT NULL,
 body_json TEXT NOT NULL, fetched_at TEXT NOT NULL, raw_blob_id TEXT NOT NULL REFERENCES raw_blobs(id),
 PRIMARY KEY(owner_principal_id,provider_key,hash));
CREATE TRIGGER personal_catalogs_immutable BEFORE UPDATE ON personal_model_catalogs BEGIN SELECT RAISE(ABORT, 'WORM personal catalog'); END;
CREATE TABLE personal_model_ceilings (owner_principal_id TEXT NOT NULL, provider_key TEXT NOT NULL, model_id TEXT NOT NULL,
 hash TEXT NOT NULL, body_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_principal_id,hash));
CREATE TRIGGER model_ceilings_immutable BEFORE UPDATE ON personal_model_ceilings BEGIN SELECT RAISE(ABORT, 'WORM model ceiling'); END;
CREATE TABLE assistant_benchmarks (id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, provider_key TEXT NOT NULL,
 model_id TEXT NOT NULL, task TEXT NOT NULL, suite_hash TEXT NOT NULL, passed INTEGER NOT NULL, total INTEGER NOT NULL,
 source_url TEXT NOT NULL, observed_at TEXT NOT NULL, reviewed_at TEXT NOT NULL, content_hash TEXT NOT NULL,
 UNIQUE(owner_principal_id,content_hash));
CREATE TRIGGER assistant_benchmarks_immutable BEFORE UPDATE ON assistant_benchmarks BEGIN SELECT RAISE(ABORT, 'WORM benchmark'); END;
`;
