import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { canonicalHash } from '../domain/canonical';
import { ProjectStateSchema, ProjectMeaningSchema, ProjectResourceKindSchema, type ResearchProjectsProfile } from '../../../shared/research_projects';

const Labels = (keys: readonly string[]) => z.record(z.string(), z.string().min(1)).refine(v => keys.every(k => typeof v[k] === 'string') && Object.keys(v).every(k => keys.includes(k)), 'Every profile option needs exactly one label');
const ProfileSchema = z.object({ version: z.string().min(1), maxArchiveBytes: z.number().int().min(1024).max(134217728),
  title: z.string().min(1), introduction: z.string().min(1), stateLabels: Labels(ProjectStateSchema.options),
  meaningLabels: Labels(ProjectMeaningSchema.options), meaningDescriptions: Labels(ProjectMeaningSchema.options),
  resourceLabels: Labels(ProjectResourceKindSchema.options), defaultLinkRole: z.string().min(1),
}).strict();
export function loadResearchProjectsProfile(): ResearchProjectsProfile {
  const body = ProfileSchema.parse(JSON.parse(readFileSync(path.resolve('config/research_projects/mvp.json'), 'utf8')));
  return { ...body, contentHash: canonicalHash(body) } as ResearchProjectsProfile;
}
