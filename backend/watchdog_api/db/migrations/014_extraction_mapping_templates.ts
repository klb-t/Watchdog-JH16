export const MIGRATION_014_EXTRACTION_MAPPING_TEMPLATES = `
CREATE TABLE extraction_mapping_templates (
 id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL,
 candidate_id TEXT NOT NULL REFERENCES extraction_candidates(id),
 source_dataset_id TEXT NOT NULL REFERENCES datasets(id),
 content_hash TEXT NOT NULL, body_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX extraction_mapping_templates_owner ON extraction_mapping_templates(owner_principal_id,candidate_id,created_at);
CREATE TRIGGER extraction_mapping_templates_immutable BEFORE UPDATE OF id,candidate_id,source_dataset_id,content_hash,body_json,created_at
 ON extraction_mapping_templates BEGIN SELECT RAISE(ABORT, 'WORM extraction mapping template'); END;
`;
