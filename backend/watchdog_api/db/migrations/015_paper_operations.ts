export const MIGRATION_015_PAPER_OPERATIONS = `
CREATE TABLE paper_operations (
 id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL,
 document_id TEXT NOT NULL REFERENCES research_documents(id),
 dataset_id TEXT NOT NULL REFERENCES datasets(id),
 method_id TEXT NOT NULL UNIQUE REFERENCES method_specs(id),
 content_hash TEXT NOT NULL, body_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX paper_operations_owner ON paper_operations(owner_principal_id,created_at);
CREATE TRIGGER paper_operations_immutable BEFORE UPDATE OF id,document_id,dataset_id,method_id,content_hash,body_json,created_at
 ON paper_operations BEGIN SELECT RAISE(ABORT, 'WORM paper operation'); END;
`;
