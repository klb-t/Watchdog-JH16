/** Historical rows remain unclassified. New context is captured before acquisition and copied into every receipt. */
export const MIGRATION_017_COLLECTION_CONTEXT = `
ALTER TABLE automation_jobs ADD COLUMN collection_context_json TEXT CHECK(collection_context_json IS NULL OR json_valid(collection_context_json));
ALTER TABLE public_fetch_receipts ADD COLUMN collection_context_json TEXT CHECK(collection_context_json IS NULL OR json_valid(collection_context_json));
CREATE TRIGGER job_collection_immutable BEFORE UPDATE OF collection_context_json ON automation_jobs
 BEGIN SELECT RAISE(ABORT, 'WORM job collection context'); END;
CREATE TRIGGER receipt_collection_immutable BEFORE UPDATE OF collection_context_json ON public_fetch_receipts
 BEGIN SELECT RAISE(ABORT, 'WORM receipt collection context'); END;
`;
