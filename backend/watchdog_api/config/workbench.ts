import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { WorkbenchInputError } from '../../../shared/workbench';
import type { WorkbenchProfile, DatasetDocument } from '../../../shared/workbench';
import { canonicalHash } from '../domain/canonical';
import { loadEvidenceDisplay } from './evidence';
export { checkFigureProfile } from '../../../shared/workbench';
const text = z.string().min(1).max(1000);
const profileSchema = z.object({ version: text,
  renderers: z.array(z.object({ id: text, label: text, dimensions: z.number().int().min(2).max(3), description: text }).strict()),
  palettes: z.array(z.object({ id: text, label: text, colors: z.array(z.string().regex(/^#[a-f0-9]{6}$/i)).min(2) }).strict()),
  methods: z.array(z.object({ id: text, label: text, description: text }).strict()),
  providerProfiles: z.array(z.object({ id: text, label: text, measure: text, normalizations: z.array(text), languageMeanings: z.array(text), notices: z.array(text) }).strict()),
}).strict();
export function loadWorkbenchProfile(): WorkbenchProfile {
  const base = profileSchema.parse(JSON.parse(readFileSync('config/workbench/default.json', 'utf8')));
  const profile = { ...base, evidenceDisplay: loadEvidenceDisplay() };
  return { ...profile, contentHash: canonicalHash(profile) };
}
export function checkProviderProfile(document: DatasetDocument, profile: WorkbenchProfile) {
  const provider = profile.providerProfiles.find(p => p.id === document.providerProfileId);
  if (!provider || !provider.normalizations.includes(document.normalization) || !provider.languageMeanings.includes(document.languageMeaning))
    throw new WorkbenchInputError('Dataset semantics do not satisfy the selected provider profile.');
}
