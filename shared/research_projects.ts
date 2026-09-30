import { z } from 'zod';

export const ProjectResourceKindSchema = z.enum(['paper', 'assessment', 'dataset', 'method', 'run', 'figure', 'job', 'schedule']);
export type ProjectResourceKind = z.infer<typeof ProjectResourceKindSchema>;
export const ProjectStateSchema = z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']);
export const ProjectMeaningSchema = z.enum(['unspecified', 'faithful', 'enhanced', 'reanalysis', 'proxy', 'simulation']);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const ProjectLinkSchema = z.object({
  kind: ProjectResourceKindSchema, id: z.string().min(1).max(250), expectedHash: Hash,
  role: z.string().trim().min(1).max(160), notes: z.string().trim().max(4000),
}).strict();
export type ProjectLinkInput = z.infer<typeof ProjectLinkSchema>;
export const ProjectDraftSchema = z.object({
  name: z.string().trim().min(1).max(160), question: z.string().trim().min(1).max(4000),
  purpose: z.string().trim().max(4000), state: ProjectStateSchema, meaning: ProjectMeaningSchema,
  links: z.array(ProjectLinkSchema).max(50),
}).strict().refine(v => new Set(v.links.map(l => `${l.kind}:${l.id}`)).size === v.links.length, 'Each resource can be linked once per revision');
export type ProjectDraft = z.infer<typeof ProjectDraftSchema>;
export interface ProjectResourceSummary { kind: ProjectResourceKind; id: string; hash: string; label: string; href: string; }
export interface ProjectFile { path: string; sha256: string; byteSize: number; mediaType: string; }
export interface ProjectLinkSnapshot extends ProjectLinkInput {
  label: string; href: string; binding: 'pinned_artifact' | 'live_schedule_pointer';
  snapshot: Record<string, unknown>; snapshotHash: string; files: ProjectFile[];
}
export interface ProjectRevisionBody extends Omit<ProjectDraft, 'links'> {
  schemaVersion: 'research-project-revision-1'; projectId: string; revision: number;
  previousRevisionHash: string | null; links: ProjectLinkSnapshot[];
}
export interface ProjectRevision { id: string; hash: string; createdAt: string; body: ProjectRevisionBody; }
export interface ProjectSummary { id: string; name: string; question: string; state: z.infer<typeof ProjectStateSchema>;
  meaning: z.infer<typeof ProjectMeaningSchema>; revision: number; hash: string; updatedAt: string; }
export interface ProjectLinkStatus { kind: ProjectResourceKind; id: string; status: 'CURRENT' | 'CHANGED' | 'UNAVAILABLE'; currentHash: string | null; }
export interface ResearchProjectsProfile {
  version: string; contentHash: string; maxArchiveBytes: number;
  title: string; introduction: string; stateLabels: Record<z.infer<typeof ProjectStateSchema>, string>;
  meaningLabels: Record<z.infer<typeof ProjectMeaningSchema>, string>;
  meaningDescriptions: Record<z.infer<typeof ProjectMeaningSchema>, string>;
  resourceLabels: Record<ProjectResourceKind, string>; defaultLinkRole: string;
}
export interface ProjectArchive {
  manifest: { schemaVersion: 'research-project-archive-1'; purpose: 'PRIVATE_WORKSPACE_ARCHIVE';
    projectId: string; revisionHash: string; revision: number; files: ProjectFile[];
    statement: string; omissions: string[]; };
  manifestHash: string; files: { path: string; encoding: 'base64'; content: string }[];
}
