export const MIGRATION_021_RESEARCH_PROJECTS = `
CREATE TABLE research_projects (
 id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, created_at TEXT NOT NULL,
 current_revision_id TEXT NOT NULL, current_hash TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX research_projects_owner ON research_projects(owner_principal_id,updated_at,id);
CREATE TABLE research_project_revisions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES research_projects(id), owner_principal_id TEXT NOT NULL,
 revision INTEGER NOT NULL, content_hash TEXT NOT NULL, body_json TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(project_id,revision)
);
CREATE TRIGGER research_project_revision_no_update BEFORE UPDATE OF id,project_id,revision,content_hash,body_json,created_at ON research_project_revisions
 BEGIN SELECT RAISE(ABORT, 'WORM research project revision'); END;
CREATE TRIGGER research_project_revision_no_delete BEFORE DELETE ON research_project_revisions
 BEGIN SELECT RAISE(ABORT, 'WORM research project revision'); END;
CREATE TABLE research_project_files (
 revision_id TEXT NOT NULL REFERENCES research_project_revisions(id), owner_principal_id TEXT NOT NULL,
 path TEXT NOT NULL, sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL, media_type TEXT NOT NULL, object_uri TEXT NOT NULL,
 PRIMARY KEY(revision_id,path)
);
CREATE TRIGGER research_project_file_no_update BEFORE UPDATE OF revision_id,path,sha256,byte_size,media_type,object_uri ON research_project_files
 BEGIN SELECT RAISE(ABORT, 'WORM research project file'); END;
CREATE TRIGGER research_project_file_no_delete BEFORE DELETE ON research_project_files
 BEGIN SELECT RAISE(ABORT, 'WORM research project file'); END;
`;
