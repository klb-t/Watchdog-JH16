import type { Database } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { validateWorkbenchProfile } from '../../config/workbench';
import type { WorkbenchProfile } from '../../../../shared/workbench';
import type { ObjectStore } from '../../storage/object_store';
import { canonicalHash, canonicalizeJson } from '../../domain/canonical';
import { DatasetRecord, FigureSpec, SavedFigure, validateDataset, FigureSchema, checkFigureBindings, selectionIdentity } from '../../../../shared/workbench';
import { GeographyRepository } from './geography';
import { checkGeographyBinding } from '../../../../shared/geography';
import { WorkbenchError } from './workbench_error';
export { WorkbenchError } from './workbench_error';
import { appendAudit } from './audit';
import { ResearchRepository } from './research';
import { verifyDatasetExtraction } from '../../workbench/extraction_data';
import type { MethodSpec, AnalysisArtifact, TypedSeries } from '../../domain/method_spec';
import { assertTransition, type RunState } from '../../domain/run_state';

export class WorkbenchRepository {
  readonly geography: GeographyRepository;
  constructor(private readonly db: Database, readonly store: ObjectStore) { this.geography = new GeographyRepository(db, store); }
  archiveProfile(input: WorkbenchProfile): WorkbenchProfile {
    const profile = validateWorkbenchProfile(input);
    this.db.prepare('INSERT OR IGNORE INTO workbench_profiles VALUES (?,?,?)')
      .run(profile.contentHash, canonicalizeJson(profile), new Date().toISOString());
    return this.getProfile(profile.contentHash)!;
  }
  getProfile(hash: string): WorkbenchProfile | null {
    const row = this.db.prepare('SELECT profile_json FROM workbench_profiles WHERE content_hash=?').get(hash) as { profile_json: string } | undefined;
    if (!row) return null;
    const profile = validateWorkbenchProfile(JSON.parse(row.profile_json));
    if (profile.contentHash !== hash) throw new WorkbenchError('Archived visualization profile integrity mismatch.', 409);
    return profile;
  }
  async importDataset(input: unknown, actor: string, requestId: string): Promise<DatasetRecord> {
    const doc = validateDataset(input), contentHash = canonicalHash(doc), id = `dataset-${contentHash}-${canonicalHash(actor).slice(0, 10)}`;
    const requireOwnedExtraction=()=>{if(!doc.sourceCopy)return;const ref=doc.sourceCopy,research=new ResearchRepository(this.db),trial=research.trial(actor,ref.trialId),candidate=research.extractor(actor,ref.candidateId);
      if(!trial||trial.hash!==ref.trialHash||trial.body.kind!=='EXECUTION'||!candidate||candidate.hash!==ref.candidateHash||candidate.approvalState!=='APPROVED'||trial.candidateId!==candidate.id||trial.body.candidateHash!==candidate.hash||trial.body.raw!==ref.raw||canonicalHash(candidate.body.plan)!==canonicalHash(ref.plan))throw new WorkbenchError('Dataset requires its owned, exact extraction execution and activated parser.',409);
    };
    requireOwnedExtraction();verifyDatasetExtraction(doc);
    const bytes = Buffer.from(canonicalizeJson(doc)), uri = await this.store.put(`raw/${contentHash}`, bytes);
    requireOwnedExtraction();
    this.db.transaction(() => {
      const now = new Date().toISOString();
      this.db.prepare('INSERT OR IGNORE INTO raw_blobs(id,sha256,object_uri,byte_size,media_type,retention_class,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(`dataset-raw-${contentHash}`, contentHash, uri, bytes.length, 'application/json', 'dataset-import', now);
      const blob = this.db.prepare('SELECT id FROM raw_blobs WHERE sha256=?').get(contentHash) as any;
      this.db.prepare(`INSERT OR IGNORE INTO datasets(id,name,version,schema_json,sha256,row_count,column_count,owner_principal_id,visibility,created_at,raw_blob_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, doc.name, doc.version, JSON.stringify(doc.columns), contentHash, doc.rows.length, doc.columns.length, actor, 'private', now, blob.id);
      for (const c of doc.columns) this.db.prepare(`INSERT OR IGNORE INTO dataset_columns(dataset_id,name,physical_type,semantic_type,unit,role,metadata_json) VALUES (?,?,?,?,?,?,?)`)
        .run(id, c.key, c.type, c.semanticType, c.unit, null, JSON.stringify({ label: c.label, description: c.description }));
      this.db.prepare('INSERT INTO dataset_import_events VALUES (?,?,?,?,?)').run(randomUUID(), id, blob.id, actor, now);
      this.audit(actor, 'dataset.import', id, requestId, { contentHash, providerProfileId: doc.providerProfileId });
    })();
    return (await this.getDataset(id, actor, true))!;
  }
  async getDataset(id: string, actor: string, review = false): Promise<DatasetRecord | null> {
    const row = this.db.prepare(`SELECT d.*,b.object_uri FROM datasets d JOIN raw_blobs b ON b.id=d.raw_blob_id WHERE d.id=?`).get(id) as any;
    if (!row || !(row.owner_principal_id === actor || row.visibility === 'shared_aggregate')) return null;
    const document = validateDataset(JSON.parse((await this.store.get(row.object_uri)).toString()));
    // Re-read access/approval after asynchronous blob I/O so a concurrent revocation wins.
    const live = this.db.prepare('SELECT * FROM datasets WHERE id=?').get(id) as any;
    if (!live || !(live.owner_principal_id === actor || live.visibility === 'shared_aggregate')) return null;
    Object.assign(row, live);
    const contentHash = canonicalHash(document);
    if (contentHash !== row.sha256) throw new WorkbenchError('Dataset content does not match its stored hash.', 409);
    const approvalState = row.approved_hash === contentHash ? 'APPROVED' : 'PROPOSED';
    if (!review && approvalState !== 'APPROVED') return null;
    return { id, document, contentHash, approvalState, approvedHash: row.approved_hash, approvedBy: row.approved_by,
      approvedAt: row.approved_at, ownerId: row.owner_principal_id, visibility: row.visibility };
  }
  async listDatasets(actor: string, review: boolean) {
    const rows = this.db.prepare("SELECT id FROM datasets WHERE raw_blob_id IS NOT NULL AND (owner_principal_id=? OR visibility='shared_aggregate') ORDER BY created_at DESC,id").all(actor) as any[];
    const records = await Promise.all(rows.map(r => this.getDataset(r.id, actor, review)));
    return records.filter((r): r is DatasetRecord => Boolean(r));
  }
  async approveDataset(id: string, actor: string, expectedHash: string, share: boolean, requestId: string) {
    const current = await this.getDataset(id, actor, true);
    if (!current || current.contentHash !== expectedHash) throw new WorkbenchError('Dataset is unavailable or the review hash is stale.', 409);
    if (current.ownerId !== actor) throw new WorkbenchError('Only the owner can change dataset publication.', 403);
    this.db.transaction(() => {
      this.db.prepare('UPDATE datasets SET approved_hash=?,approved_by=?,approved_at=?,visibility=? WHERE id=?')
        .run(expectedHash, actor, new Date().toISOString(), share ? 'shared_aggregate' : 'private', id);
      this.audit(actor, 'dataset.approve', id, requestId, { expectedHash, sharedAggregate: share });
    })();
    return this.getDataset(id, actor, true);
  }
  async revokeDataset(id: string, actor: string, requestId: string) {
    const current = await this.getDataset(id, actor, true);
    if (!current || current.ownerId !== actor) throw new WorkbenchError('Dataset ownership required.', 403);
    this.db.transaction(() => {
      this.db.prepare('UPDATE datasets SET approved_hash=NULL,approved_by=NULL,approved_at=NULL WHERE id=?').run(id);
      this.audit(actor, 'dataset.revoke', id, requestId, { previousHash: current.approvedHash });
    })();
  }
  async requireFigure(input: unknown, actor: string) {
    const spec = FigureSchema.parse(input), record = await this.getDataset(spec.datasetId, actor);
    if (!record || record.contentHash !== spec.datasetHash) throw new WorkbenchError('An accessible, currently approved dataset with the exact figure hash is required.', 409);
    checkFigureBindings(spec, record.document);
    const geometry = spec.geography ? await this.geography.get(spec.geography.layerId, actor) : null;
    if (spec.geography) {
      if (!geometry) throw new WorkbenchError('An accessible, currently approved geometry layer is required.', 409);
      checkGeographyBinding(spec, geometry);
    }
    const result = spec.analysis ? await this.resultForFigure(spec, actor) : null;
    if ((result || geometry) && !await this.getDataset(spec.datasetId, actor)) throw new WorkbenchError('Dataset approval was revoked.', 409);
    if (geometry && !await this.geography.get(geometry.id, actor)) throw new WorkbenchError('Geometry approval was revoked.', 409);
    return { record, spec, result, geometry };
  }
  private async resultForFigure(spec: FigureSpec, actor: string) {
    const ref = spec.analysis!, method = this.method(ref.methodId);
    const row = this.db.prepare(`SELECT a.object_uri,m.object_uri manifest_uri,m.sha256 manifest_hash FROM artifacts a JOIN runs r ON r.id=a.run_id JOIN manifests m ON m.run_id=r.id
      WHERE a.sha256=? AND a.kind='workbench_result' AND a.owner_principal_id=? AND r.status='COMPLETED'`).get(ref.resultHash, actor) as any;
    if (!row || !method || method.hash !== ref.methodHash || method.approvalState !== 'APPROVED' || method.datasetId !== spec.datasetId)
      throw new WorkbenchError('The figure requires an owned result from this currently approved method and dataset.', 409);
    const columns = method.spec.steps[0]?.primitive === 'describe' ? [spec.channels.y] : [spec.channels.x, spec.channels.y];
    const expected = canonicalHash(selectionIdentity(spec, columns));
    if (!method.spec.assumptions.includes(`selection_sha256=${expected}`)) throw new WorkbenchError('Analysis result does not match the figure inputs and selection.', 409);
    const result = JSON.parse((await this.store.get(row.object_uri)).toString());
    if (canonicalHash(result) !== ref.resultHash || result.datasetHash !== spec.datasetHash || result.methodHash !== ref.methodHash || result.methodId !== ref.methodId)
      throw new WorkbenchError('Analysis result integrity mismatch.', 409);
    const manifest = JSON.parse((await this.store.get(row.manifest_uri)).toString());
    if (canonicalHash(manifest) !== row.manifest_hash || manifest.runId !== result.runId || !manifest.outputs.some((o: any) => o.sha256 === ref.resultHash)) throw new WorkbenchError('Analysis manifest integrity mismatch.', 409);
    return { ...result, hash: ref.resultHash, manifest: { hash: row.manifest_hash, document: manifest } };
  }
  async saveFigure(actor: string, spec: FigureSpec, favorite: boolean, requestId: string): Promise<SavedFigure> {
    await this.requireFigure(spec, actor);
    const id = randomUUID(), hash = canonicalHash(spec), savedAt = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO figures VALUES (?,?,?,?,?,?,?)').run(id, actor, spec.datasetId, JSON.stringify(spec), hash, Number(favorite), savedAt);
      this.audit(actor, 'figure.save', id, requestId, { hash, favorite, datasetHash: spec.datasetHash });
    })();
    return { id, ownerId: actor, spec, hash, favorite, savedAt };
  }
  figures(actor: string): SavedFigure[] {
    return (this.db.prepare('SELECT * FROM figures WHERE owner_principal_id=? ORDER BY saved_at DESC,id').all(actor) as any[])
      .map(r => { const spec = FigureSchema.parse(JSON.parse(r.spec_json));
        if (canonicalHash(spec) !== r.content_hash) throw new WorkbenchError('Saved figure integrity mismatch.', 409);
        return { id: r.id, ownerId: r.owner_principal_id, spec, hash: r.content_hash, favorite: Boolean(r.favorite), savedAt: r.saved_at }; });
  }
  proposeMethod(actor: string, datasetId: string, spec: MethodSpec, selection: unknown, requestId: string) {
    const hash = canonicalHash(spec), id = `wb-method-${hash}`;
    this.db.transaction(() => {
      this.db.prepare(`INSERT OR IGNORE INTO method_specs(id,name,version,spec_json,spec_hash,approval_state,owner_principal_id,created_at) VALUES (?,?,?,?,?,'PROPOSED',?,?)`)
        .run(id, spec.name, spec.specVersion, JSON.stringify(spec), hash, actor, new Date().toISOString());
      this.db.prepare('INSERT OR IGNORE INTO workbench_method_inputs VALUES (?,?,?)').run(id, datasetId, JSON.stringify(selection));
      this.audit(actor, 'workbench.method.propose', id, requestId, { hash });
    })();
    return this.method(id);
  }
  method(id: string) {
    const row = this.db.prepare('SELECT m.*,i.dataset_id,i.selection_json FROM method_specs m JOIN workbench_method_inputs i ON i.method_id=m.id WHERE m.id=?').get(id) as any;
    if (!row) return null;
    const spec = JSON.parse(row.spec_json) as MethodSpec, hash = canonicalHash(spec);
    const selection = JSON.parse(row.selection_json);
    if (hash !== row.spec_hash || !spec.assumptions.includes(`dataset_id=${row.dataset_id}`) || !spec.assumptions.includes(`selection_sha256=${canonicalHash(selectionIdentity(selection.figure, selection.columns))}`)) throw new WorkbenchError('Stored method input integrity mismatch.', 409);
    return { id, spec, hash, datasetId: row.dataset_id, selection, approvedHash: row.approved_hash,
      approvalState: row.approved_hash === hash ? 'APPROVED' : 'PROPOSED', approvedBy: row.approved_by, approvedAt: row.approved_at };
  }
  methods(datasetId: string) { return (this.db.prepare('SELECT method_id FROM workbench_method_inputs WHERE dataset_id=? ORDER BY method_id').all(datasetId) as any[]).map(r => this.method(r.method_id)); }
  approveMethod(id: string, actor: string, expectedHash: string, requestId: string) {
    const current = this.method(id);
    if (!current || current.hash !== expectedHash) throw new WorkbenchError('Method review hash is stale.', 409);
    this.db.transaction(() => {
      this.db.prepare("UPDATE method_specs SET approved_hash=?,approved_by=?,approved_at=?,approval_state='APPROVED' WHERE id=?")
        .run(expectedHash, actor, new Date().toISOString(), id);
      this.audit(actor, 'workbench.method.approve', id, requestId, { expectedHash });
    })();
    return this.method(id);
  }
  createRun(actor: string, config: unknown) {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO runs(id,run_type,status,owner_principal_id,visibility,created_at,effective_config,effective_config_hash)
      VALUES (?,'WORKBENCH_ANALYSIS','CREATED',?,'private',?,?,?)`).run(id, actor, new Date().toISOString(), JSON.stringify(config), canonicalHash(config));
    return id;
  }
  transitionRun(id: string, to: RunState, metadata: unknown = {}) {
    const row = this.db.prepare('SELECT status FROM runs WHERE id=?').get(id) as { status: RunState };
    assertTransition(row.status, to);
    this.db.prepare('UPDATE runs SET status=?,completed_at=? WHERE id=?').run(to, ['COMPLETED', 'FAILED'].includes(to) ? new Date().toISOString() : null, id);
    this.db.prepare("UPDATE run_steps SET status=?,completed_at=? WHERE run_id=? AND status='RUNNING'").run(to === 'FAILED' ? 'FAILED' : 'COMPLETED', new Date().toISOString(), id);
    const sequence = (this.db.prepare('SELECT count(*) n FROM run_steps WHERE run_id=?').get(id) as any).n;
    this.db.prepare(`INSERT INTO run_steps(id,run_id,step_name,sequence,status,started_at,completed_at,implementation_version,warning_json)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), id, to, sequence, to === 'FAILED' ? 'FAILED' : to === 'COMPLETED' ? 'COMPLETED' : 'RUNNING', new Date().toISOString(), ['COMPLETED', 'FAILED'].includes(to) ? new Date().toISOString() : null, 'workbench-1', JSON.stringify(metadata));
  }
  async persistResult(runId: string, actor: string, payload: { methodId: string; methodHash: string; datasetHash: string; inputHash: string; artifact: AnalysisArtifact; inputs: TypedSeries[]; [key: string]: unknown }) {
    const hash = canonicalHash(payload), bytes = Buffer.from(canonicalizeJson(payload));
    const uri = await this.store.put(`runs/${runId}/workbench-${hash}.json`, bytes);
    const method = this.method(payload.methodId)!;
    const manifest = { schemaVersion: 'workbench-manifest-1', runId, datasetHash: payload.datasetHash,
      inputs: { combinedHash: payload.inputHash, seriesHashes: payload.inputs.map(series => ({ name: series.name, hash: canonicalHash(series) })) },
      method: { id: method.id, hash: method.hash, approvedHash: method.approvedHash, approvedBy: method.approvedBy, approvedAt: method.approvedAt },
      outputs: [{ kind: 'workbench_result', sha256: hash, objectUri: uri, bytes: bytes.length }],
      executor: { id: payload.artifact.executorId, version: payload.artifact.executorVersion },
      profile: payload.profile, source: payload.source, comparisonScope: payload.comparisonScope,
      qualityFlags: payload.artifact.qualityFlags, environment: { nodeVersion: process.version } };
    const manifestHash = canonicalHash(manifest), manifestUri = await this.store.put(`runs/${runId}/manifest-${manifestHash}.json`, Buffer.from(canonicalizeJson(manifest)));
    this.db.transaction(() => {
      const now = new Date().toISOString(), analysisId = `analysis-${runId}`;
      this.db.prepare(`INSERT INTO artifacts(id,run_id,kind,media_type,object_uri,sha256,byte_size,owner_principal_id,visibility,created_at,metadata_json)
        VALUES (?,?,?,?,?,?,?,?,'private',?,?)`).run(randomUUID(), runId, 'workbench_result', 'application/json', uri, hash, bytes.length, actor, now, JSON.stringify({ manifestHash }));
      this.db.prepare('INSERT INTO manifests(run_id,schema_version,object_uri,sha256,finalized_at) VALUES (?,?,?,?,?)').run(runId, manifest.schemaVersion, manifestUri, manifestHash, now);
      this.db.prepare(`INSERT INTO analysis_runs(id,run_id,method_spec_id,input_hashes_json,executor_id,executor_version,status,created_at)
        VALUES (?,?,?,?,?,?,'COMPLETED',?)`).run(analysisId, runId, method.id, JSON.stringify(manifest.inputs.seriesHashes), payload.artifact.executorId, payload.artifact.executorVersion, now);
      for (const r of payload.artifact.results) this.db.prepare(`INSERT INTO analysis_results(id,analysis_run_id,metric_key,value_numeric,value_text,unit,is_missing,statistic_metadata_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), analysisId, r.metricKey, r.valueNumeric ?? null, r.valueText ?? null, r.unit, Number(r.isMissing), JSON.stringify(r.statisticMetadata ?? {}), now);
    })();
    return { hash, uri, manifestHash, manifestUri };
  }
  audit(actor: string, action: string, id: string, requestId: string, metadata: unknown) { appendAudit(this.db, actor, action, 'workbench', id, requestId, metadata); }
}
