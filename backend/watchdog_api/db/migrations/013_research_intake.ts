export const MIGRATION_013_RESEARCH_INTAKE = `
CREATE TABLE research_documents (id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, content_hash TEXT NOT NULL,
 body_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(owner_principal_id,content_hash));
CREATE TRIGGER research_documents_immutable BEFORE UPDATE OF id,content_hash,body_json,created_at ON research_documents BEGIN SELECT RAISE(ABORT, 'WORM research document'); END;
CREATE TABLE research_document_origins (id TEXT PRIMARY KEY,owner_principal_id TEXT NOT NULL,document_id TEXT NOT NULL REFERENCES research_documents(id),
 content_hash TEXT NOT NULL,body_json TEXT NOT NULL);
CREATE TRIGGER research_origins_immutable BEFORE UPDATE OF id,document_id,content_hash,body_json ON research_document_origins BEGIN SELECT RAISE(ABORT, 'WORM research origin'); END;
CREATE TABLE paper_assessment_attempts (id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, document_id TEXT NOT NULL REFERENCES research_documents(id),
 profile_hash TEXT NOT NULL, status TEXT NOT NULL, body_json TEXT, content_hash TEXT, created_at TEXT NOT NULL, finished_at TEXT,
 job_id TEXT REFERENCES automation_jobs(id),
 UNIQUE(owner_principal_id,document_id,profile_hash));
CREATE TRIGGER paper_assessments_immutable BEFORE UPDATE OF id,document_id,profile_hash,status,body_json,content_hash,created_at,finished_at,job_id ON paper_assessment_attempts WHEN OLD.body_json IS NOT NULL BEGIN SELECT RAISE(ABORT, 'WORM assessment outcome'); END;
CREATE TABLE research_substitutions (id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, content_hash TEXT NOT NULL, body_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TRIGGER research_substitutions_immutable BEFORE UPDATE OF id,content_hash,body_json,created_at ON research_substitutions BEGIN SELECT RAISE(ABORT, 'WORM substitution'); END;
CREATE TABLE extraction_candidates (id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, content_hash TEXT NOT NULL,
 body_json TEXT NOT NULL, created_at TEXT NOT NULL, approved_hash TEXT, approved_at TEXT);
CREATE TRIGGER extraction_candidates_immutable BEFORE UPDATE OF id,body_json,content_hash,created_at ON extraction_candidates BEGIN SELECT RAISE(ABORT, 'WORM extraction candidate'); END;
CREATE TABLE extraction_trials (id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, candidate_id TEXT NOT NULL REFERENCES extraction_candidates(id),
 body_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TRIGGER extraction_trials_immutable BEFORE UPDATE OF id,candidate_id,body_json,content_hash,created_at ON extraction_trials BEGIN SELECT RAISE(ABORT, 'WORM extraction trial'); END;
CREATE INDEX research_documents_owner ON research_documents(owner_principal_id,created_at);
CREATE INDEX extraction_trials_owner ON extraction_trials(owner_principal_id,candidate_id,created_at);
`;
