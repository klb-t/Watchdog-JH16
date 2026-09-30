import { createHash, randomUUID } from 'node:crypto';
import { canonicalHash, canonicalizeJson } from '../domain/canonical';
import type { ObjectStore } from '../storage/object_store';
import { loadResearchProjectsProfile } from '../config/research_projects';
import { ResearchProjectsRepository, ResearchProjectError, type ProjectStoredFile } from '../db/repositories/research_projects';
import { ProjectDraftSchema, type ProjectArchive, type ProjectFile, type ProjectLinkSnapshot, type ProjectRevision, type ProjectRevisionBody, type ProjectLinkStatus } from '../../../shared/research_projects';
import { createZip } from '../utils/zip';
import { PROJECT_ARCHIVE_VERIFIER } from '../research/project_verifier';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const publicFile = ({ uri: _uri, ...file }: ProjectStoredFile): ProjectFile => file;
const archiveMetadata = (body: ProjectRevisionBody, revisionHash: string, files: ProjectStoredFile[]) => {
  const revisionBytes = Buffer.from(canonicalizeJson(body)), verifierBytes = Buffer.from(PROJECT_ARCHIVE_VERIFIER);
  const descriptors = [...files.map(publicFile), { path: 'revision.json', sha256: sha(revisionBytes), byteSize: revisionBytes.length, mediaType: 'application/json' },
    { path: 'verify.mjs', sha256: sha(verifierBytes), byteSize: verifierBytes.length, mediaType: 'text/javascript' }].sort((a, b) => a.path.localeCompare(b.path));
  const manifest: ProjectArchive['manifest'] = { schemaVersion: 'research-project-archive-1', purpose: 'PRIVATE_WORKSPACE_ARCHIVE',
    projectId: body.projectId, revisionHash, revision: body.revision, files: descriptors,
    statement: 'Frozen private workspace backup. Workflow state and user-selected meaning confer no scientific approval, publication approval or replication verdict.',
    omissions: ['Future schedule occurrences and outputs are not included.', 'Unlinked dependencies are references only; they are not implicitly copied.', 'Identity records, credentials, private keys and sessions are not included.'] };
  const manifestBytes = Buffer.from(canonicalizeJson(manifest));
  // Exact length of the shared store-only ZIP writer, including UTF-8 names and its central directory.
  const zipFiles = [...descriptors, { path: 'project-manifest.json', byteSize: manifestBytes.length }];
  const archiveByteSize = zipFiles.reduce((n, f) => n + f.byteSize + 76 + 2 * Buffer.byteLength(f.path), 22);
  return { revisionBytes, verifierBytes, manifest, manifestBytes, archiveByteSize };
};
export class ResearchProjectsService {
  readonly profile = loadResearchProjectsProfile();
  constructor(readonly repo: ResearchProjectsRepository, private readonly store: ObjectStore) {}
  async save(owner: string, raw: unknown, projectId?: string, expectedHash: string | null = null): Promise<ProjectRevision> {
    const draft = ProjectDraftSchema.parse(raw), current = projectId ? this.repo.current(owner, projectId) : null;
    if (projectId && !current) throw new ResearchProjectError('Project not found', 404);
    if (current?.hash !== (expectedHash ?? undefined) && current) throw new ResearchProjectError('Project changed; reload before saving');
    const id = projectId ?? randomUUID(), files = new Map<string, ProjectStoredFile>(), links: ProjectLinkSnapshot[] = [];
    let totalBytes = 0;
    for (const link of [...draft.links].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))) {
      const resource = this.repo.resource(owner, link.kind, link.id);
      if (!resource) throw new ResearchProjectError('Owned resource not found or not finalized', 404);
      if (resource.summary.hash !== link.expectedHash) throw new ResearchProjectError('Linked resource hash changed; reload before selecting it');
      const descriptors: ProjectFile[] = [];
      for (const original of resource.files) {
        let archived = files.get(original.path);
        if (!archived) {
          if (original.byteSize > this.profile.maxArchiveBytes - totalBytes) throw new ResearchProjectError('Project exceeds the configured archive size limit', 413);
          const bytes = await this.store.get(original.uri);
          if (sha(bytes) !== original.sha256 || original.byteSize >= 0 && bytes.length !== original.byteSize)
            throw new ResearchProjectError('Linked source bytes do not match their recorded hash');
          totalBytes += bytes.length;
          if (totalBytes > this.profile.maxArchiveBytes) throw new ResearchProjectError('Project exceeds the configured archive size limit', 413);
          const uri = await this.store.put(`project-files/${original.sha256}`, bytes);
          archived = { ...original, byteSize: bytes.length, uri }; files.set(original.path, archived);
        }
        if (!descriptors.some(f => f.path === archived!.path)) descriptors.push(publicFile(archived));
      }
      links.push({ ...link, label: resource.summary.label, href: resource.summary.href,
        binding: link.kind === 'schedule' ? 'live_schedule_pointer' : 'pinned_artifact', snapshot: resource.snapshot,
        snapshotHash: canonicalHash(resource.snapshot), files: descriptors.sort((a, b) => a.path.localeCompare(b.path)) });
    }
    const body = { ...draft, schemaVersion: 'research-project-revision-1' as const, projectId: id,
      revision: (current?.body.revision ?? 0) + 1, previousRevisionHash: current?.hash ?? null, links };
    const frozenFiles = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
    if (archiveMetadata(body, canonicalHash(body), frozenFiles).archiveByteSize > this.profile.maxArchiveBytes)
      throw new ResearchProjectError('Project metadata and source files exceed the configured archive size limit', 413);
    return this.repo.save(owner, body, expectedHash, frozenFiles);
  }
  get(owner: string, id: string, revisionHash?: string) {
    const revision = revisionHash ? this.repo.revision(owner, id, revisionHash) : this.repo.current(owner, id);
    if (!revision) throw new ResearchProjectError('Project revision not found', 404);
    const statuses: ProjectLinkStatus[] = revision.body.links.map(link => {
      try {
        const live = this.repo.resource(owner, link.kind, link.id);
        return { kind: link.kind, id: link.id, status: !live ? 'UNAVAILABLE' : live.summary.hash === link.expectedHash && canonicalHash(live.snapshot) === link.snapshotHash ? 'CURRENT' : 'CHANGED', currentHash: live?.summary.hash ?? null };
      } catch (error) {
        if (!(error instanceof ResearchProjectError)) throw error;
        return { kind: link.kind, id: link.id, status: 'UNAVAILABLE', currentHash: null };
      }
    });
    return { revision, statuses };
  }
  async export(owner: string, projectId: string, revisionHash: string) {
    const revision = this.repo.revision(owner, projectId, revisionHash);
    if (!revision) throw new ResearchProjectError('Project revision not found', 404);
    const stored = this.repo.files(owner, revision), entries = new Map<string, Buffer>();
    const metadata = archiveMetadata(revision.body, revision.hash, stored);
    if (metadata.archiveByteSize > this.profile.maxArchiveBytes) throw new ResearchProjectError('Project archive exceeds the configured size limit', 413);
    for (const f of stored) {
      const bytes = await this.store.get(f.uri);
      if (sha(bytes) !== f.sha256 || bytes.length !== f.byteSize) throw new ResearchProjectError('Archived project bytes failed integrity verification');
      entries.set(f.path, bytes);
    }
    // Metadata snapshots are also content-addressed by the revision. No credentials, sessions or storage locators are selected.
    entries.set('revision.json', metadata.revisionBytes); entries.set('verify.mjs', metadata.verifierBytes);
    const manifestHash = canonicalHash(metadata.manifest); entries.set('project-manifest.json', metadata.manifestBytes);
    if (!this.repo.revision(owner, projectId, revisionHash)) throw new ResearchProjectError('Project ownership changed during export', 404);
    const bytes = createZip([...entries].map(([name, content]) => ({ name, content })));
    return { bytes, sha256: sha(bytes), manifestHash };
  }
}
