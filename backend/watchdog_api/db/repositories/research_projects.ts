import type { Database } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { canonicalHash, canonicalizeJson } from '../../domain/canonical';
import { AuditRepository } from './audit';
import { ResearchRepository } from './research';
import type { ProjectDraft, ProjectResourceKind, ProjectResourceSummary, ProjectRevision, ProjectRevisionBody, ProjectSummary, ProjectFile } from '../../../../shared/research_projects';

export class ResearchProjectError extends Error {
  readonly code = 'research_project_error';
  constructor(message: string, readonly status = 409) { super(message); }
}
export interface ProjectStoredFile extends ProjectFile { uri: string; }
export interface ProjectResource { summary: ProjectResourceSummary; snapshot: Record<string, unknown>;
  files: ProjectStoredFile[]; }
const parse = (value: string | null) => value ? JSON.parse(value) : null;
const file = (sha256: string, uri: string, byteSize: number, mediaType: string): ProjectStoredFile => ({
  path: `objects/${sha256}`, sha256, uri, byteSize, mediaType,
});

/** SQL stays here. Every resource is scoped to its owner, including raw receipts reached through jobs. */
export class ResearchProjectsRepository {
  constructor(private readonly db: Database) {}
  private decode(row: any): ProjectRevision {
    const body = parse(row.body_json) as ProjectRevisionBody;
    if (canonicalHash(body) !== row.content_hash) throw new ResearchProjectError('Project revision integrity mismatch');
    return { id: row.id, hash: row.content_hash, createdAt: row.created_at, body };
  }
  current(owner: string, id: string): ProjectRevision | null {
    const row = this.db.prepare(`SELECT r.* FROM research_projects p JOIN research_project_revisions r ON r.id=p.current_revision_id
      WHERE p.id=? AND p.owner_principal_id=? AND r.owner_principal_id=?`).get(id, owner, owner);
    return row ? this.decode(row) : null;
  }
  revision(owner: string, projectId: string, hash: string): ProjectRevision | null {
    const row = this.db.prepare(`SELECT r.* FROM research_project_revisions r JOIN research_projects p ON p.id=r.project_id
      WHERE p.id=? AND p.owner_principal_id=? AND r.owner_principal_id=? AND r.content_hash=?`).get(projectId, owner, owner, hash);
    return row ? this.decode(row) : null;
  }
  history(owner: string, projectId: string): ProjectRevision[] {
    if (!this.current(owner, projectId)) throw new ResearchProjectError('Project not found', 404);
    return (this.db.prepare(`SELECT r.* FROM research_project_revisions r JOIN research_projects p ON p.id=r.project_id
      WHERE p.id=? AND p.owner_principal_id=? AND r.owner_principal_id=? ORDER BY r.revision DESC`).all(projectId, owner, owner) as any[]).map(r => this.decode(r));
  }
  list(owner: string, limit = 50, offset = 0): { projects: ProjectSummary[]; total: number } {
    const total = (this.db.prepare('SELECT COUNT(*) n FROM research_projects WHERE owner_principal_id=?').get(owner) as any).n;
    const rows = this.db.prepare(`SELECT r.*,p.updated_at FROM research_projects p JOIN research_project_revisions r ON r.id=p.current_revision_id
      WHERE p.owner_principal_id=? AND r.owner_principal_id=? ORDER BY p.updated_at DESC,p.id LIMIT ? OFFSET ?`).all(owner, owner, limit, offset) as any[];
    return { total, projects: rows.map(row => { const r = this.decode(row); return { id: r.body.projectId, name: r.body.name,
      question: r.body.question, state: r.body.state, meaning: r.body.meaning, revision: r.body.revision, hash: r.hash, updatedAt: row.updated_at }; }) };
  }
  save(owner: string, body: ProjectRevisionBody, expectedHash: string | null, files: ProjectStoredFile[]): ProjectRevision {
    return this.db.transaction(() => {
      const current = this.current(owner, body.projectId);
      if (expectedHash === null ? !!current : !current || current.hash !== expectedHash)
        throw new ResearchProjectError('Project changed; reload before saving');
      if (body.revision !== (current?.body.revision ?? 0) + 1 || body.previousRevisionHash !== (current?.hash ?? null))
        throw new ResearchProjectError('Project revision lineage mismatch');
      // Recheck every item inside the same write transaction: a revocation during blob I/O wins.
      for (const link of body.links) {
        const live = this.resource(owner, link.kind, link.id);
        if (!live || live.summary.hash !== link.expectedHash || canonicalHash(live.snapshot) !== link.snapshotHash)
          throw new ResearchProjectError('A linked resource changed; reload before saving');
      }
      const now = new Date().toISOString(), hash = canonicalHash(body), id = randomUUID();
      if (!current) this.db.prepare('INSERT INTO research_projects VALUES (?,?,?,?,?,?)').run(body.projectId, owner, now, id, hash, now);
      this.db.prepare('INSERT INTO research_project_revisions VALUES (?,?,?,?,?,?,?)')
        .run(id, body.projectId, owner, body.revision, hash, canonicalizeJson(body), now);
      for (const f of files) this.db.prepare('INSERT INTO research_project_files VALUES (?,?,?,?,?,?,?)')
        .run(id, owner, f.path, f.sha256, f.byteSize, f.mediaType, f.uri);
      this.db.prepare('UPDATE research_projects SET current_revision_id=?,current_hash=?,updated_at=? WHERE id=? AND owner_principal_id=?')
        .run(id, hash, now, body.projectId, owner);
      new AuditRepository(this.db).append(owner, 'research.project.revise', 'research_project', body.projectId, id,
        { hash, previousRevisionHash: body.previousRevisionHash, revision: body.revision, state: body.state, meaning: body.meaning });
      return this.current(owner, body.projectId)!;
    }).immediate();
  }
  files(owner: string, revision: ProjectRevision): ProjectStoredFile[] {
    if (!this.revision(owner, revision.body.projectId, revision.hash)) throw new ResearchProjectError('Project revision not found', 404);
    return (this.db.prepare('SELECT * FROM research_project_files WHERE revision_id=? AND owner_principal_id=? ORDER BY path').all(revision.id, owner) as any[])
      .map(r => ({ path: r.path, sha256: r.sha256, byteSize: r.byte_size, mediaType: r.media_type, uri: r.object_uri }));
  }
  resource(owner: string, kind: ProjectResourceKind, id: string): ProjectResource | null {
    const research = new ResearchRepository(this.db);
    let snapshot: Record<string, unknown>, hash: string, label: string, href: string, files: ProjectStoredFile[] = [];
    if (kind === 'paper') {
      const r = research.document(owner, id); if (!r) return null;
      hash = r.hash; label = r.body.title; href = `/research?document=${encodeURIComponent(id)}`;
      snapshot = { documentHash: hash, body: r.body, origins: r.origins ?? [] };
    } else if (kind === 'assessment') {
      const r = research.assessment(owner, id); if (!r?.body || !r.hash) return null;
      const paper = research.document(owner, r.documentId); if (!paper) return null;
      hash = r.hash; label = `${paper.body.title} · ${r.status}`; href = `/research?document=${encodeURIComponent(r.documentId)}`;
      snapshot = { assessmentHash: hash, documentId: r.documentId, documentHash: paper.hash, status: r.status, body: r.body };
    } else if (kind === 'dataset') {
      const r = this.db.prepare(`SELECT d.*,b.object_uri,b.byte_size,b.media_type FROM datasets d JOIN raw_blobs b ON b.id=d.raw_blob_id
        WHERE d.id=? AND d.owner_principal_id=?`).get(id, owner) as any; if (!r) return null;
      hash = r.sha256; label = r.name; href = `/workbench?dataset=${encodeURIComponent(id)}`;
      snapshot = { datasetHash: hash, name: r.name, version: r.version, columns: parse(r.schema_json), rowCount: r.row_count,
        approvalState: r.approved_hash === hash ? 'APPROVED' : 'PROPOSED', approvedHash: r.approved_hash, approvedAt: r.approved_at };
      files = [file(hash, r.object_uri, r.byte_size, r.media_type ?? 'application/json')];
    } else if (kind === 'method') {
      const r = this.db.prepare('SELECT * FROM method_specs WHERE id=? AND owner_principal_id=?').get(id, owner) as any; if (!r) return null;
      const spec = parse(r.spec_json); if (canonicalHash(spec) !== r.spec_hash) throw new ResearchProjectError('Method integrity mismatch');
      hash = r.spec_hash; label = r.name; href = `/method?method=${encodeURIComponent(id)}`;
      const input = this.db.prepare('SELECT dataset_id,selection_json FROM workbench_method_inputs WHERE method_id=?').get(id) as any;
      href = input ? `/workbench?dataset=${encodeURIComponent(input.dataset_id)}&method=${encodeURIComponent(id)}`
        : `/projects?resourceKind=method&resourceId=${encodeURIComponent(id)}&expectedHash=${hash}`;
      snapshot = { methodHash: hash, spec, approvalState: r.approved_hash === hash ? 'APPROVED' : 'PROPOSED',
        approvedHash: r.approved_hash, approvedAt: r.approved_at, input: input ? { datasetId: input.dataset_id, selection: parse(input.selection_json) } : null };
    } else if (kind === 'figure') {
      const r = this.db.prepare('SELECT * FROM figures WHERE id=? AND owner_principal_id=?').get(id, owner) as any; if (!r) return null;
      const spec = parse(r.spec_json); if (canonicalHash(spec) !== r.content_hash) throw new ResearchProjectError('Figure integrity mismatch');
      hash = r.content_hash; label = spec.name || id; href = `/workbench?figure=${encodeURIComponent(id)}`;
      snapshot = { figureHash: hash, spec, savedAt: r.saved_at };
    } else if (kind === 'run') {
      const r = this.db.prepare(`SELECT r.*,m.sha256 manifest_hash,m.object_uri manifest_uri FROM runs r JOIN manifests m ON m.run_id=r.id
        WHERE r.id=? AND r.owner_principal_id=? AND r.status='COMPLETED'`).get(id, owner) as any; if (!r) return null;
      const artifacts = this.db.prepare('SELECT * FROM artifacts WHERE run_id=? ORDER BY sha256,kind,id').all(id) as any[];
      if (artifacts.some(a => a.owner_principal_id !== owner)) throw new ResearchProjectError('Run artifact ownership mismatch');
      const analysis = this.db.prepare('SELECT method_spec_id FROM analysis_runs WHERE run_id=? ORDER BY id').all(id) as any[];
      // Method IDs are references. The owned immutable manifest already carries the executed method's provenance.
      // Do not copy a shared benchmark/private dependency by dereferencing it here.
      hash = r.manifest_hash; label = `${r.preset_id ?? r.run_type} · ${id}`; href = `/runs/${encodeURIComponent(id)}`;
      snapshot = { runType: r.run_type, presetId: r.preset_id, presetVersion: r.preset_version, status: r.status,
        configHash: r.effective_config_hash, manifestHash: hash, methods: analysis.map(a => a.method_spec_id),
        artifacts: artifacts.map(a => ({ kind: a.kind, hash: a.sha256, mediaType: a.media_type, byteSize: a.byte_size })) };
      files = [file(hash, r.manifest_uri, -1, 'application/json'), ...artifacts.map(a => file(a.sha256, a.object_uri, a.byte_size ?? -1, a.media_type ?? 'application/octet-stream'))];
    } else if (kind === 'schedule') {
      const r = this.db.prepare('SELECT * FROM automation_schedules WHERE id=? AND owner_principal_id=?').get(id, owner) as any; if (!r) return null;
      const body = parse(r.body_json); if (canonicalHash({ ...body, profileHash: r.profile_hash }) !== r.content_hash) throw new ResearchProjectError('Schedule integrity mismatch');
      hash = r.content_hash; label = r.name; href = '/automation';
      snapshot = { definition: body, definitionHash: hash, profileHash: r.profile_hash, enabledAtCapture: !!r.enabled,
        semantics: 'LIVE_POINTER_SETTINGS_PINNED_FUTURE_OUTPUTS_NOT_INCLUDED' };
    } else {
      const r = this.db.prepare(`SELECT * FROM automation_jobs WHERE id=? AND owner_principal_id=? AND finished_at IS NOT NULL
        AND status NOT IN ('QUEUED','RUNNING')`).get(id, owner) as any; if (!r) return null;
      const request = parse(r.request_json);
      if (canonicalHash({ request, profileHash: r.profile_hash }) !== r.request_hash) throw new ResearchProjectError('Job request integrity mismatch');
      const receipts = this.db.prepare(`SELECT f.*,b.sha256,b.object_uri,b.byte_size,b.media_type FROM public_fetch_receipts f
        LEFT JOIN raw_blobs b ON b.id=f.raw_blob_id WHERE f.job_id=? ORDER BY f.id`).all(id) as any[];
      snapshot = { request, requestHash: r.request_hash, profileHash: r.profile_hash, scheduleId: r.schedule_id, status: r.status,
        result: parse(r.result_json), finishedAt: r.finished_at, errorCode: r.error_code,
        receipts: receipts.map(f => ({ id: f.id, provider: f.provider, url: f.url, fetchedAt: f.fetched_at,
          httpStatus: f.http_status, adapterVersion: f.adapter_version, license: f.license, rawHash: f.sha256 ?? null })) };
      hash = canonicalHash(snapshot); label = `${request.kind} · ${r.status}`; href = '/automation';
      files = receipts.filter(f => f.sha256).map(f => file(f.sha256, f.object_uri, f.byte_size, f.media_type ?? 'application/octet-stream'));
    }
    return { summary: { kind, id, hash, label, href }, snapshot, files };
  }
  resources(owner: string, kind: ProjectResourceKind, limit = 50, offset = 0) {
    const tables: Record<ProjectResourceKind, string> = { paper: 'research_documents', assessment: 'paper_assessment_attempts', dataset: 'datasets',
      method: 'method_specs', run: 'runs', figure: 'figures', job: 'automation_jobs', schedule: 'automation_schedules' };
    // Table is selected only from the closed resource-kind vocabulary, never from user text.
    const table = tables[kind];
    const filter = kind === 'assessment' ? 'AND body_json IS NOT NULL' : kind === 'dataset' ? 'AND raw_blob_id IS NOT NULL'
      : kind === 'run' ? "AND status='COMPLETED' AND EXISTS(SELECT 1 FROM manifests m WHERE m.run_id=runs.id)"
      : kind === 'job' ? "AND finished_at IS NOT NULL AND status NOT IN ('QUEUED','RUNNING')" : '';
    const rows = this.db.prepare(`SELECT id FROM ${table} WHERE owner_principal_id=? ${filter} ORDER BY id`).all(owner) as any[];
    const available = rows.flatMap(row => { const r = this.resource(owner, kind, row.id); return r ? [r.summary] : []; });
    return { resources: available.slice(offset, offset + limit), total: available.length };
  }
}
