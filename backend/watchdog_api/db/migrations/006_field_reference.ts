/** Source import envelopes extend the existing D14 graph; no parallel graph. */
export const MIGRATION_006_FIELD_REFERENCE = `
ALTER TABLE tested_samples ADD COLUMN reference_key TEXT;
ALTER TABLE tested_samples ADD COLUMN name TEXT;
ALTER TABLE tested_samples ADD COLUMN origin TEXT;
ALTER TABLE tested_samples ADD COLUMN observed_on TEXT;
ALTER TABLE tested_samples ADD COLUMN time_basis TEXT;
ALTER TABLE tested_samples ADD COLUMN unknown_components_json TEXT;
ALTER TABLE tested_samples ADD COLUMN citation_json TEXT;
ALTER TABLE tested_samples ADD COLUMN quality_flags_json TEXT;
ALTER TABLE tested_samples ADD COLUMN content_hash TEXT;
ALTER TABLE tested_samples ADD COLUMN raw_sha256 TEXT;
ALTER TABLE tested_samples ADD COLUMN approved_hash TEXT;
ALTER TABLE tested_samples ADD COLUMN approved_by TEXT;
ALTER TABLE tested_samples ADD COLUMN approved_at TEXT;
ALTER TABLE pill_type_composition ADD COLUMN note TEXT;
ALTER TABLE assertions ADD COLUMN reference_key TEXT;
ALTER TABLE assertions ADD COLUMN content_hash TEXT;
ALTER TABLE assertions ADD COLUMN raw_sha256 TEXT;
CREATE INDEX IF NOT EXISTS idx_samples_reference_key ON tested_samples(reference_key);
CREATE INDEX IF NOT EXISTS idx_samples_region_time ON tested_samples(geography_id, observed_on);
CREATE INDEX IF NOT EXISTS idx_assertions_reference_key ON assertions(reference_key);
CREATE TABLE field_import_events (
  id TEXT PRIMARY KEY, reference_id TEXT NOT NULL, raw_blob_id TEXT NOT NULL REFERENCES raw_blobs(id),
  actor_id TEXT NOT NULL, imported_at TEXT NOT NULL, acquisition_method TEXT NOT NULL,
  source_url TEXT NOT NULL
);
CREATE TABLE field_offline_receipts (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, event_hash TEXT NOT NULL);
`;
