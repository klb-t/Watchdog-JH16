import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { EVIDENCE_TIERS } from '../domain/evidence_tier';
const display = z.record(z.enum(EVIDENCE_TIERS), z.object({ label: z.string().min(1), bucket: z.string().min(1), icon: z.string().min(1), color: z.string().regex(/^#[a-f0-9]{6}$/i) }).strict());
export function loadEvidenceDisplay() { return display.parse(JSON.parse(readFileSync('config/evidence/tier-display.json', 'utf8'))); }
