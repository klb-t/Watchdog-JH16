export const MIGRATION_009_GEOMETRY_LAYERS = `
CREATE TABLE geometry_layers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, content_hash TEXT NOT NULL,
  raw_blob_id TEXT NOT NULL REFERENCES raw_blobs(id), owner_principal_id TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private', approved_hash TEXT, approved_by TEXT, approved_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE geometry_import_events (
  id TEXT PRIMARY KEY, layer_id TEXT NOT NULL REFERENCES geometry_layers(id),
  raw_blob_id TEXT NOT NULL REFERENCES raw_blobs(id), actor_id TEXT NOT NULL, imported_at TEXT NOT NULL
);
CREATE TRIGGER geometry_layers_immutable_content BEFORE UPDATE OF content_hash,raw_blob_id ON geometry_layers
BEGIN SELECT RAISE(ABORT, 'WORM: create a new geometry layer for changed boundaries'); END;
`;
