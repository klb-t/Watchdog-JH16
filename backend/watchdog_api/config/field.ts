import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateFieldProfile, validateReferenceDocument } from '../../../shared/field_validation';
import { loadEvidenceDisplay } from './evidence';
export function loadFieldProfile() {
  return validateFieldProfile({ ...JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config/field/responder.json'), 'utf8')),
    tiers: loadEvidenceDisplay() });
}
/** Versioned mappings for individual human review; none is approved or imported at boot. */
export function loadFieldCatalog() {
  return (JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config/field/proposals.json'), 'utf8')) as unknown[])
    .map(validateReferenceDocument);
}
