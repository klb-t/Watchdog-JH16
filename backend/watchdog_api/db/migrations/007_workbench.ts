export const MIGRATION_007_WORKBENCH = `
ALTER TABLE datasets ADD COLUMN raw_blob_id TEXT REFERENCES raw_blobs(id);
ALTER TABLE datasets ADD COLUMN approved_hash TEXT;
ALTER TABLE datasets ADD COLUMN approved_by TEXT;
ALTER TABLE datasets ADD COLUMN approved_at TEXT;
CREATE TABLE dataset_import_events (id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL REFERENCES datasets(id),
  raw_blob_id TEXT NOT NULL REFERENCES raw_blobs(id), actor_id TEXT NOT NULL, imported_at TEXT NOT NULL);
CREATE TABLE figures (id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, dataset_id TEXT NOT NULL REFERENCES datasets(id),
  spec_json TEXT NOT NULL, content_hash TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, saved_at TEXT NOT NULL);
CREATE TABLE workbench_method_inputs (method_id TEXT PRIMARY KEY REFERENCES method_specs(id), dataset_id TEXT NOT NULL REFERENCES datasets(id),
  selection_json TEXT NOT NULL);
`;
