/** D18: peer role profiles; preserve existing dev assignments and sessions. */
export const MIGRATION_005_ROLE_PROFILES = `
INSERT OR IGNORE INTO roles (id, name, description) VALUES
  ('responder', 'responder', 'Look up approved regional reference evidence.'),
  ('institutional', 'institutional', 'Restricted reference and provider-readiness access.'),
  ('law_enforcement', 'law_enforcement', 'Restricted institutional reference access.'),
  ('developer', 'developer', 'Full capabilities including principal management and diagnostics.');
UPDATE roles SET description = 'Operational management; no developer diagnostics or principal grants.' WHERE id = 'admin';
`;
