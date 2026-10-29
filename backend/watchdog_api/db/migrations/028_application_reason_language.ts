/**
 * An application written by the system for a guest (an invitation that could
 * not grant roles above viewer by itself) records the language the guest's
 * interface used and the values the text was made from, so an administrator
 * can read it in their own language next to the stored original.
 */
export const MIGRATION_028_APPLICATION_REASON_LANGUAGE = `
ALTER TABLE access_applications ADD COLUMN reason_language TEXT;
ALTER TABLE access_applications ADD COLUMN reason_params_json TEXT;
`;
