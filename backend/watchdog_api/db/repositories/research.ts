import type { Database } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { canonicalHash } from '../../domain/canonical';
import { AutomationError } from './automation';
import { PaperInputSchema, SubstitutionSchema, CopyPlanSchema, type PaperDocument } from '../../../../shared/research';
import { AuditRepository } from './audit';

export class ResearchRepository {
  constructor(private readonly db: Database) {}
  audit(owner: string, action: string, id: string, detail: unknown) { new AuditRepository(this.db).append(owner, action, 'research', id, id, detail); }
  saveDocument(owner: string, raw: unknown): PaperDocument {
    const body = PaperInputSchema.parse(raw), hash = canonicalHash(body), id = canonicalHash({ owner, hash });
    const inserted=this.db.prepare('INSERT OR IGNORE INTO research_documents VALUES (?,?,?,?,?)').run(id, owner, hash, JSON.stringify(body), new Date().toISOString());
    if(inserted.changes)this.audit(owner, 'paper.intake', id, { hash, coverage: body.coverage }); return this.document(owner, id)!;
  }
  document(owner: string, id: string): PaperDocument | null {
    const row = this.db.prepare('SELECT * FROM research_documents WHERE id=? AND owner_principal_id=?').get(id, owner) as any;
    if (!row) return null; const body = JSON.parse(row.body_json); if (canonicalHash(body) !== row.content_hash) throw new AutomationError('Document integrity mismatch');
    const origins=(this.db.prepare('SELECT * FROM research_document_origins WHERE document_id=? AND owner_principal_id=? ORDER BY id').all(id,owner) as any[])
      .map(r=>{const b=JSON.parse(r.body_json);if(canonicalHash(b)!==r.content_hash)throw new AutomationError('Document origin integrity mismatch');return {hash:r.content_hash,...b};});
    return { id, hash: row.content_hash, body, createdAt: row.created_at,origins };
  }
  linkDiscovery(owner:string,documentId:string,discoveryId:string) {
    if(!this.document(owner,documentId))throw new AutomationError('Document not found',404);
    const row=this.db.prepare('SELECT * FROM paper_discoveries WHERE id=? AND owner_principal_id=?').get(discoveryId,owner) as any;
    if(!row)throw new AutomationError('Owned discovery not found',404);
    const body={discoveryId,discoveryHash:row.content_hash,receiptId:row.receipt_id},hash=canonicalHash(body),id=canonicalHash({owner,documentId,hash});
    this.db.prepare('INSERT OR IGNORE INTO research_document_origins VALUES (?,?,?,?,?)').run(id,owner,documentId,hash,JSON.stringify(body));
    return this.document(owner,documentId)!;
  }
  documents(owner: string) { return (this.db.prepare('SELECT id FROM research_documents WHERE owner_principal_id=? ORDER BY created_at DESC,id LIMIT 200').all(owner) as any[]).map(r => this.document(owner, r.id)!); }
  pendingDocuments(owner: string, limit: number, includeAbstracts: boolean) {
    return (this.db.prepare(`SELECT d.id FROM research_documents d WHERE d.owner_principal_id=?
      AND NOT EXISTS (SELECT 1 FROM paper_assessment_attempts a WHERE a.document_id=d.id AND a.owner_principal_id=d.owner_principal_id)
      AND json_extract(d.body_json,'$.coverage')!='identifier_only' AND (? OR json_extract(d.body_json,'$.coverage')!='abstract')
      ORDER BY d.created_at DESC,d.id LIMIT ?`).all(owner,Number(includeAbstracts),limit) as any[]).map(r=>this.document(owner,r.id)!);
  }
  /** A dead worker cannot silently replay a possibly billed request. Recovery
   * records the interruption and leaves a new attempt to an explicit retry. */
  recoverAssessments(owner: string, now = new Date()) {
    const rows = this.db.prepare(`SELECT a.id,a.document_id,j.status AS job_status FROM paper_assessment_attempts a
      JOIN automation_jobs j ON j.id=a.job_id AND j.owner_principal_id=a.owner_principal_id
      WHERE a.owner_principal_id=? AND a.body_json IS NULL
      AND (j.status NOT IN ('QUEUED','RUNNING') OR (j.status='RUNNING' AND j.lease_until<=?))`).all(owner,now.toISOString()) as any[];
    for (const row of rows) this.finishAssessment(owner,row.id,{ error:'ASSESSMENT_INTERRUPTED',retryAutomatically:false,
      documentHash:this.document(owner,row.document_id)!.hash,jobStatus:row.job_status },'FAILED');
    return rows.length;
  }
  claimAssessment(owner: string, documentId: string, profileHash: string, jobId: string | null = null) {
    if (!this.document(owner, documentId)) throw new AutomationError('Document not found', 404);
    this.recoverAssessments(owner);
    if (jobId && !this.db.prepare("SELECT 1 FROM automation_jobs WHERE id=? AND owner_principal_id=? AND status='RUNNING'").get(jobId,owner)) throw new AutomationError('An owned running job is required');
    const id = randomUUID(), info = this.db.prepare('INSERT OR IGNORE INTO paper_assessment_attempts VALUES (?,?,?,?,?,NULL,NULL,?,NULL,?)').run(id, owner, documentId, profileHash, 'RUNNING', new Date().toISOString(),jobId);
    return info.changes ? id : null;
  }
  finishAssessment(owner: string, id: string, body: unknown, status: 'PROPOSED' | 'FAILED') {
    const hash = canonicalHash(body), info = this.db.prepare('UPDATE paper_assessment_attempts SET body_json=?,content_hash=?,status=?,finished_at=? WHERE id=? AND owner_principal_id=? AND body_json IS NULL')
      .run(JSON.stringify(body), hash, status, new Date().toISOString(), id, owner);
    if (!info.changes) throw new AutomationError('Assessment already finalized'); this.audit(owner, 'paper.assessment', id, { status, hash }); return this.assessment(owner, id)!;
  }
  assessment(owner: string, id: string) {
    const r = this.db.prepare('SELECT * FROM paper_assessment_attempts WHERE owner_principal_id=? AND id=?').get(owner, id) as any;
    if (!r) return null; const body = r.body_json ? JSON.parse(r.body_json) : null;
    if (body && canonicalHash(body) !== r.content_hash) throw new AutomationError('Assessment integrity mismatch');
    return { id: r.id, documentId: r.document_id, status: r.status, body, hash: r.content_hash, createdAt: r.created_at };
  }
  assessments(owner: string) { this.recoverAssessments(owner); return (this.db.prepare('SELECT id FROM paper_assessment_attempts WHERE owner_principal_id=? ORDER BY created_at DESC,id LIMIT 200').all(owner) as any[]).map(r => this.assessment(owner, r.id)!); }
  substitution(owner: string, raw: unknown) {
    const input = SubstitutionSchema.parse(raw), a = this.assessment(owner, input.assessmentId);
    if (!a?.body || a.hash !== input.assessmentHash || a.status !== 'PROPOSED') throw new AutomationError('Assessment missing or changed');
    if (!a.body.assessment.dataRequirements.some((d: any) => d.id === input.requirementId)) throw new AutomationError('Unknown data requirement');
    const meaning = input.kind === 'original_data_reuse' ? 'REANALYSIS_NOT_INDEPENDENT_REPLICATION' : input.kind === 'synthetic_scenario' ? 'SIMULATION_NOT_EMPIRICAL_EVIDENCE' : 'EXPLORATORY_METHOD_VARIANT';
    const body = { ...input, documentId: a.documentId, meaning, status: 'PROPOSED', independentConfirmation: 'Separate unexposed data and frozen method required', reviewedBy: owner };
    const hash = canonicalHash(body), id = canonicalHash({ owner, hash });
    this.db.prepare('INSERT OR IGNORE INTO research_substitutions VALUES (?,?,?,?,?)').run(id, owner, hash, JSON.stringify(body), new Date().toISOString());
    this.audit(owner, 'paper.substitution.propose', id, { hash, meaning }); return { id, hash, body };
  }
  substitutions(owner: string) { return (this.db.prepare('SELECT * FROM research_substitutions WHERE owner_principal_id=? ORDER BY created_at DESC,id LIMIT 200').all(owner) as any[]).map(r => {
    const body=JSON.parse(r.body_json); if(canonicalHash(body)!==r.content_hash)throw new AutomationError('Substitution integrity mismatch');
    return { id:r.id,hash:r.content_hash,body };
  }); }
  saveExtractor(owner: string, raw: unknown, provenance: unknown) {
    const body = { plan: CopyPlanSchema.parse(raw), provenance }, hash = canonicalHash(body), id = canonicalHash({ owner, hash });
    this.db.prepare('INSERT OR IGNORE INTO extraction_candidates VALUES (?,?,?,?,?,NULL,NULL)').run(id, owner, hash, JSON.stringify(body), new Date().toISOString());
    return this.extractor(owner, id)!;
  }
  extractor(owner: string, id: string) {
    const r = this.db.prepare('SELECT * FROM extraction_candidates WHERE owner_principal_id=? AND id=?').get(owner, id) as any;
    if (!r) return null; const body = JSON.parse(r.body_json); if (canonicalHash(body) !== r.content_hash) throw new AutomationError('Extractor integrity mismatch');
    return { id, hash: r.content_hash, body, approvalState: r.approved_hash === r.content_hash ? 'APPROVED' : 'PROPOSED' };
  }
  extractors(owner: string) { return (this.db.prepare('SELECT id FROM extraction_candidates WHERE owner_principal_id=? ORDER BY created_at DESC,id LIMIT 100').all(owner) as any[]).map(r => this.extractor(owner, r.id)!); }
  saveTrial(owner: string, candidateId: string, body: unknown) {
    if (!this.extractor(owner, candidateId)) throw new AutomationError('Extractor not found', 404);
    const hash = canonicalHash(body), id = randomUUID(); this.db.prepare('INSERT INTO extraction_trials VALUES (?,?,?,?,?,?)').run(id, owner, candidateId, JSON.stringify(body), hash, new Date().toISOString());
    return { id, hash, body };
  }
  trials(owner:string,candidateId:string) {
    if(!this.extractor(owner,candidateId))throw new AutomationError('Extractor not found',404);
    return this.db.prepare(`SELECT id,content_hash AS hash,created_at AS createdAt,
      json_extract(body_json,'$.kind') AS kind,json_extract(body_json,'$.passed') AS passed
      FROM extraction_trials WHERE owner_principal_id=? AND candidate_id=? ORDER BY created_at DESC,id LIMIT 50`).all(owner,candidateId);
  }
  trial(owner:string,id:string) {
    const r=this.db.prepare('SELECT * FROM extraction_trials WHERE owner_principal_id=? AND id=?').get(owner,id) as any;
    if(!r)return null;const body=JSON.parse(r.body_json);if(canonicalHash(body)!==r.content_hash)throw new AutomationError('Extraction trial integrity mismatch');
    return {id:r.id,hash:r.content_hash,body,createdAt:r.created_at,candidateId:r.candidate_id};
  }
  approveExtractor(owner: string, id: string, expectedHash: string) {
    const c = this.extractor(owner, id); if (!c || c.hash !== expectedHash) throw new AutomationError('Extractor review hash changed');
    const trials = this.db.prepare('SELECT body_json,content_hash FROM extraction_trials WHERE owner_principal_id=? AND candidate_id=?').all(owner, id) as any[];
    const bodies=trials.map(t=>{ const b=JSON.parse(t.body_json);if(canonicalHash(b)!==t.content_hash)throw new AutomationError('Extraction trial integrity mismatch');return b; });
    if (!bodies.some(b => b.passed === true && b.candidateHash === expectedHash)) throw new AutomationError('A passing exact-output test is required before activation');
    this.db.prepare('UPDATE extraction_candidates SET approved_hash=?,approved_at=? WHERE id=? AND owner_principal_id=?').run(expectedHash, new Date().toISOString(), id, owner);
    this.audit(owner, 'extractor.approve', id, { expectedHash }); return this.extractor(owner, id)!;
  }
}
