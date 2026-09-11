/** Durable jobs and public acquisition receipts extend the existing substance graph. */
export const MIGRATION_010_AUTOMATION = `
CREATE TABLE automation_profiles (hash TEXT PRIMARY KEY, body_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TRIGGER automation_profiles_immutable BEFORE UPDATE ON automation_profiles BEGIN SELECT RAISE(ABORT, 'WORM profile'); END;
CREATE TABLE automation_schedules (
 id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, name TEXT NOT NULL, body_json TEXT NOT NULL,
 content_hash TEXT NOT NULL, profile_hash TEXT NOT NULL REFERENCES automation_profiles(hash),
 enabled INTEGER NOT NULL, next_due_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE automation_jobs (
 id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, schedule_id TEXT REFERENCES automation_schedules(id),
 due_at TEXT NOT NULL, status TEXT NOT NULL, request_json TEXT NOT NULL, request_hash TEXT NOT NULL,
 profile_hash TEXT NOT NULL REFERENCES automation_profiles(hash), created_at TEXT NOT NULL, started_at TEXT,
 finished_at TEXT, result_json TEXT, error_code TEXT, lease_token TEXT, lease_until TEXT,
 cancel_requested INTEGER NOT NULL DEFAULT 0,
 UNIQUE(schedule_id, due_at),
 CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','PARTIAL','FAILED','CANCELED','INTERRUPTED'))
);
CREATE INDEX idx_automation_jobs_status ON automation_jobs(status, created_at);
CREATE TABLE public_source_leases (provider TEXT PRIMARY KEY, token TEXT NOT NULL, lease_until INTEGER NOT NULL, next_request_at INTEGER NOT NULL);
CREATE TABLE public_fetch_receipts (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES automation_jobs(id), provider TEXT NOT NULL,
 url TEXT NOT NULL, fetched_at TEXT NOT NULL, raw_blob_id TEXT REFERENCES raw_blobs(id),
 http_status INTEGER NOT NULL, adapter_version TEXT NOT NULL, license TEXT NOT NULL, error_code TEXT
);
CREATE TABLE substance_reference_records (
 id TEXT PRIMARY KEY, substance_id TEXT NOT NULL REFERENCES substances(id), provider TEXT NOT NULL,
 kind TEXT NOT NULL, value_json TEXT NOT NULL, content_hash TEXT NOT NULL,
 receipt_id TEXT NOT NULL REFERENCES public_fetch_receipts(id), created_at TEXT NOT NULL
);
CREATE INDEX idx_substance_reference_subject ON substance_reference_records(substance_id);
CREATE TRIGGER substance_reference_immutable BEFORE UPDATE ON substance_reference_records BEGIN SELECT RAISE(ABORT, 'WORM reference'); END;
CREATE TABLE paper_discoveries (
 id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, provider TEXT NOT NULL, source_id TEXT NOT NULL,
 content_hash TEXT NOT NULL, body_json TEXT NOT NULL, receipt_id TEXT NOT NULL REFERENCES public_fetch_receipts(id),
 first_seen_at TEXT NOT NULL, UNIQUE(owner_principal_id,provider,source_id,content_hash)
);
-- ChEMBL reports target types such as SINGLE PROTEIN, not necessarily a receptor.
-- No table has an SQL foreign key to targets (assertion endpoints are polymorphic).
CREATE TABLE targets_extended (
 id TEXT PRIMARY KEY, canonical_name TEXT NOT NULL, target_type TEXT NOT NULL, organism TEXT,
 external_identifiers_json TEXT, created_at TEXT NOT NULL,
 CHECK(target_type IN ('receptor','transporter','enzyme','pathway','protein','complex','unknown'))
);
INSERT INTO targets_extended SELECT * FROM targets;
DROP TABLE targets;
ALTER TABLE targets_extended RENAME TO targets;
`;
