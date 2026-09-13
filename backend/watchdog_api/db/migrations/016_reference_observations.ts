/** Record versions already exist. This journal preserves each exact record/receipt association. */
export const MIGRATION_016_REFERENCE_OBSERVATIONS = `
CREATE TABLE substance_reference_observations (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 record_id TEXT NOT NULL REFERENCES substance_reference_records(id),
 receipt_id TEXT NOT NULL REFERENCES public_fetch_receipts(id),
 source_profile_hash TEXT NOT NULL REFERENCES automation_profiles(hash),
 origin TEXT NOT NULL CHECK(origin IN ('recorded','legacy_first_receipt')),
 UNIQUE(record_id,receipt_id)
);
CREATE INDEX reference_observations_receipt ON substance_reference_observations(receipt_id);
INSERT INTO substance_reference_observations(record_id,receipt_id,source_profile_hash,origin)
 SELECT r.id,r.receipt_id,j.profile_hash,'legacy_first_receipt' FROM substance_reference_records r
 JOIN public_fetch_receipts f ON f.id=r.receipt_id JOIN automation_jobs j ON j.id=f.job_id ORDER BY f.fetched_at,r.id;
CREATE TRIGGER reference_observations_immutable BEFORE UPDATE ON substance_reference_observations
 BEGIN SELECT RAISE(ABORT, 'WORM reference observation'); END;
CREATE TRIGGER reference_observations_no_delete BEFORE DELETE ON substance_reference_observations
 BEGIN SELECT RAISE(ABORT, 'WORM reference observation'); END;
CREATE TRIGGER observed_reference_no_delete BEFORE DELETE ON substance_reference_records
 WHEN EXISTS(SELECT 1 FROM substance_reference_observations WHERE record_id=OLD.id)
 BEGIN SELECT RAISE(ABORT, 'WORM observed reference'); END;
CREATE TRIGGER observed_receipt_immutable BEFORE UPDATE ON public_fetch_receipts
 WHEN EXISTS(SELECT 1 FROM substance_reference_observations WHERE receipt_id=OLD.id)
 BEGIN SELECT RAISE(ABORT, 'WORM observed receipt'); END;
CREATE TRIGGER observed_receipt_no_delete BEFORE DELETE ON public_fetch_receipts
 WHEN EXISTS(SELECT 1 FROM substance_reference_observations WHERE receipt_id=OLD.id)
 BEGIN SELECT RAISE(ABORT, 'WORM observed receipt'); END;
`;
