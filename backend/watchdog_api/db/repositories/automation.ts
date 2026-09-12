import type { Database } from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalHash } from '../../domain/canonical';
import { AuditRepository } from './audit';
import { PrincipalRepository } from './principals';
import { can } from '../../../../shared/authorization';
import { JobRequestSchema, ScheduleSchema, nextOccurrence } from '../../../../shared/automation';
import type { AutomationJob, ScheduleRecord, ScheduleInput, JobRequest, JobStatus, PublicReceipt, PaperRecord, MemorySubstance } from '../../../../shared/automation';
import type { AutomationProfile } from '../../config/automation';
import type { ObjectStore } from '../../storage/object_store';

export class AutomationError extends Error { readonly code = 'automation_error'; constructor(message: string, readonly status = 409) { super(message); } }
export class AutomationRepository {
  constructor(private readonly db: Database, private readonly store: ObjectStore) {}
  audit(owner: string, action: string, id: string, detail: unknown = {}) {
    new AuditRepository(this.db).append(owner, action, 'automation', id, 'automation', detail);
  }
  archiveProfile(profile: AutomationProfile) {
    const { contentHash, ...body } = profile;
    if (canonicalHash(body) !== contentHash) throw new AutomationError('Invalid automation profile hash');
    this.db.prepare('INSERT OR IGNORE INTO automation_profiles VALUES (?,?,?)').run(contentHash, JSON.stringify(profile), new Date().toISOString());
  }
  profile(hash: string): AutomationProfile {
    const row = this.db.prepare('SELECT body_json FROM automation_profiles WHERE hash=?').get(hash) as any;
    if (!row) throw new AutomationError('Archived automation profile missing');
    const profile = JSON.parse(row.body_json), { contentHash, ...body } = profile;
    if (hash !== contentHash || canonicalHash(body) !== hash) throw new AutomationError('Archived profile hash mismatch');
    return profile;
  }
  authorized(owner: string, request?: JobRequest): boolean {
    const principal = new PrincipalRepository(this.db).get(owner);
    return !!principal?.active && can(principal.roles, 'run.create') && (request?.kind !== 'substance_refresh' || can(principal.roles, 'evidence.import'))
      && (request?.kind !== 'paper_review' || can(principal.roles, 'method.propose'));
  }
  private decodeJob(row: any): AutomationJob {
    return { id: row.id, ownerId: row.owner_principal_id, scheduleId: row.schedule_id, dueAt: row.due_at, status: row.status,
      request: JSON.parse(row.request_json), requestHash: row.request_hash, createdAt: row.created_at, startedAt: row.started_at,
      finishedAt: row.finished_at, result: row.result_json ? JSON.parse(row.result_json) : null, error: row.error_code,
      cancelRequested: !!row.cancel_requested };
  }
  jobs(owner: string) { return this.db.prepare('SELECT * FROM automation_jobs WHERE owner_principal_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(owner).map(r => this.decodeJob(r)); }
  job(id: string, owner: string): AutomationJob | null {
    const row = this.db.prepare('SELECT * FROM automation_jobs WHERE id=? AND owner_principal_id=?').get(id, owner);
    return row ? this.decodeJob(row) : null;
  }
  enqueue(owner: string, input: unknown, profileHash: string, now = new Date(), scheduleId: string | null = null, dueAt = now.toISOString()): AutomationJob {
    const request = JobRequestSchema.parse(input), id = randomUUID(), hash = canonicalHash({ request, profileHash });
    this.db.prepare(`INSERT INTO automation_jobs(id,owner_principal_id,schedule_id,due_at,status,request_json,request_hash,profile_hash,created_at)
      VALUES (?,?,?,?,'QUEUED',?,?,?,?)`).run(id, owner, scheduleId, dueAt, JSON.stringify(request), hash, profileHash, now.toISOString());
    this.audit(owner, 'automation.enqueue', id, { requestHash: hash, kind: request.kind });
    return this.job(id, owner)!;
  }
  private decodeSchedule(row: any): ScheduleRecord {
    return { ...JSON.parse(row.body_json), enabled: !!row.enabled, id: row.id, contentHash: row.content_hash, nextDueAt: row.next_due_at, updatedAt: row.updated_at };
  }
  schedules(owner: string) { return this.db.prepare('SELECT * FROM automation_schedules WHERE owner_principal_id=? ORDER BY name,id').all(owner).map(r => this.decodeSchedule(r)); }
  saveSchedule(owner: string, input: unknown, profileHash: string, now = new Date(), id?: string, expectedHash?: string): ScheduleRecord {
    const parsed = ScheduleSchema.parse(input);
    return this.db.transaction(() => {
      const old = id ? this.db.prepare('SELECT * FROM automation_schedules WHERE id=? AND owner_principal_id=?').get(id, owner) as any : null;
      if (id && !old) throw new AutomationError('Schedule not found', 404);
      if (old && expectedHash !== old.content_hash) throw new AutomationError('Schedule changed; reload before editing');
      const scheduleId = id ?? randomUUID(), contentHash = canonicalHash({ ...parsed, profileHash });
      const nextDueAt = old && canonicalHash(JSON.parse(old.body_json).recurrence) === canonicalHash(parsed.recurrence) && old.enabled
        ? old.next_due_at : nextOccurrence(parsed.recurrence, now);
      this.db.prepare(`INSERT INTO automation_schedules VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,body_json=excluded.body_json,content_hash=excluded.content_hash,profile_hash=excluded.profile_hash,
        enabled=excluded.enabled,next_due_at=excluded.next_due_at,updated_at=excluded.updated_at`)
        .run(scheduleId, owner, parsed.name, JSON.stringify(parsed), contentHash, profileHash, Number(parsed.enabled), nextDueAt, now.toISOString());
      if (!parsed.enabled) this.db.prepare("UPDATE automation_jobs SET status='CANCELED',finished_at=? WHERE schedule_id=? AND status='QUEUED'").run(now.toISOString(), scheduleId);
      this.audit(owner, 'automation.schedule', scheduleId, { contentHash, enabled: parsed.enabled, previousHash: old?.content_hash ?? null });
      return this.schedules(owner).find(s => s.id === scheduleId)!;
    }).immediate();
  }
  /** A transaction and UNIQUE(schedule_id,due_at) coordinate independent worker processes. */
  dispatchDue(now = new Date()): number {
    return this.db.transaction(() => {
      const due = this.db.prepare('SELECT * FROM automation_schedules WHERE enabled=1 AND next_due_at<=? ORDER BY next_due_at,id LIMIT 20').all(now.toISOString()) as any[];
      let count = 0;
      for (const row of due) {
        if (!this.authorized(row.owner_principal_id, JSON.parse(row.body_json).request)) {
          this.db.prepare('UPDATE automation_schedules SET enabled=0 WHERE id=?').run(row.id);
          this.audit(row.owner_principal_id, 'automation.authorization_paused', row.id); continue;
        }
        // An outstanding occurrence suppresses overlapping work, preserving a bounded queue.
        const busy = this.db.prepare("SELECT 1 FROM automation_jobs WHERE schedule_id=? AND status IN ('QUEUED','RUNNING')").get(row.id);
        if (!busy) { this.enqueue(row.owner_principal_id, JSON.parse(row.body_json).request, row.profile_hash, now, row.id, row.next_due_at); count++; }
        else this.audit(row.owner_principal_id, 'automation.occurrence_coalesced', row.id, { dueAt: row.next_due_at });
        this.db.prepare('UPDATE automation_schedules SET next_due_at=? WHERE id=?').run(nextOccurrence(JSON.parse(row.body_json).recurrence, now, row.next_due_at), row.id);
      }
      return count;
    }).immediate();
  }
  claim(now: Date, leaseMs: number, supportedKinds?: string[]): { job: AutomationJob; token: string; profile: AutomationProfile } | null {
    return this.db.transaction(() => {
      this.db.prepare("UPDATE automation_jobs SET status='INTERRUPTED',error_code='WORKER_LEASE_EXPIRED',finished_at=?,lease_token=NULL WHERE status='RUNNING' AND lease_until<=?")
        .run(now.toISOString(), now.toISOString());
      const kinds=supportedKinds?[...new Set(supportedKinds)]:null;
      if(kinds && !kinds.length)return null;
      const rows = this.db.prepare("SELECT * FROM automation_jobs WHERE status='QUEUED'"+
        (kinds?` AND CASE WHEN json_valid(request_json) THEN json_extract(request_json,'$.kind') IN (${kinds.map(()=>'?').join(',')}) ELSE 1 END`:'')+" ORDER BY created_at,id LIMIT 20").all(...(kinds??[])) as any[];
      for (const row of rows) {
        let profile: AutomationProfile, request: JobRequest;
        try {
          profile = this.profile(row.profile_hash);
          request = JobRequestSchema.parse(JSON.parse(row.request_json));
          if (canonicalHash({ request: JSON.parse(row.request_json), profileHash: profile.contentHash }) !== row.request_hash) throw new Error('Mismatch');
        } catch {
          this.db.prepare("UPDATE automation_jobs SET status='FAILED',error_code='SNAPSHOT_INTEGRITY_MISMATCH',finished_at=? WHERE id=?").run(now.toISOString(), row.id); continue;
        }
        if (!this.authorized(row.owner_principal_id, request)) {
          this.db.prepare("UPDATE automation_jobs SET status='CANCELED',error_code='OWNER_CAPABILITY_REVOKED',finished_at=? WHERE id=?").run(now.toISOString(), row.id); continue;
        }
        const token = randomUUID();
        this.db.prepare("UPDATE automation_jobs SET status='RUNNING',lease_token=?,lease_until=?,started_at=? WHERE id=? AND status='QUEUED'")
          .run(token, new Date(now.getTime() + leaseMs).toISOString(), now.toISOString(), row.id);
        return { job: this.job(row.id, row.owner_principal_id)!, token, profile };
      }
      return null;
    }).immediate();
  }
  heartbeat(id: string, token: string, now: Date, leaseMs: number): boolean {
    const row = this.db.prepare('SELECT owner_principal_id,request_json FROM automation_jobs WHERE id=?').get(id) as any;
    if (!row || !this.authorized(row.owner_principal_id, JSON.parse(row.request_json))) return false;
    return !!this.db.prepare("UPDATE automation_jobs SET lease_until=? WHERE id=? AND status='RUNNING' AND lease_token=? AND cancel_requested=0 AND lease_until>?")
      .run(new Date(now.getTime() + leaseMs).toISOString(), id, token, now.toISOString()).changes;
  }
  finish(id: string, token: string, status: JobStatus, result: Record<string, unknown>, error: string | null = null) {
    this.db.prepare("UPDATE automation_jobs SET status=?,result_json=?,error_code=?,finished_at=?,lease_token=NULL WHERE id=? AND status='RUNNING' AND lease_token=?")
      .run(status, JSON.stringify(result), error, new Date().toISOString(), id, token);
  }
  cancel(id: string, owner: string) {
    if (!this.job(id, owner)) throw new AutomationError('Job not found', 404);
    this.db.prepare("UPDATE automation_jobs SET cancel_requested=1,status=CASE WHEN status='QUEUED' THEN 'CANCELED' ELSE status END WHERE id=? AND owner_principal_id=?")
      .run(id, owner); this.audit(owner, 'automation.cancel', id);
    return this.job(id, owner)!;
  }
  /** Shared DB gate covers all worker processes, including a single arXiv connection. */
  sourceLease(provider: string, interval: number, now = Date.now()): { token: string; waitMs: number } {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM public_source_leases WHERE provider=?').get(provider) as any;
      if (row && row.lease_until > now) throw new AutomationError(`${provider}: another worker is using this source; retry in a later job`);
      const start = Math.max(row?.next_request_at ?? 0, now), token = randomUUID();
      this.db.prepare('INSERT INTO public_source_leases VALUES (?,?,?,?) ON CONFLICT(provider) DO UPDATE SET token=excluded.token,lease_until=excluded.lease_until,next_request_at=excluded.next_request_at')
        .run(provider, token, start + 60000, start + interval);
      return { token, waitMs: Math.max(0, start - now) };
    }).immediate();
  }
  releaseSource(provider: string, token: string) { this.db.prepare('UPDATE public_source_leases SET lease_until=0 WHERE provider=? AND token=?').run(provider, token); }
  async receipt(jobId: string, provider: string, url: string, status: number, bytes: Buffer | null, license: string, error: string | null = null): Promise<PublicReceipt> {
    const id = randomUUID(), now = new Date().toISOString(), sha = bytes ? createHash('sha256').update(bytes).digest('hex') : '';
    const uri = bytes ? await this.store.put(`raw/${sha}`, bytes) : null;
    let blobId: string | null = null;
    this.db.transaction(() => {
      if (bytes) {
        this.db.prepare('INSERT OR IGNORE INTO raw_blobs VALUES (?,?,?,?,?,?,?)').run(`public-${sha}`, sha, uri, bytes.length, 'application/octet-stream', 'public-source-response', now);
        blobId = (this.db.prepare('SELECT id FROM raw_blobs WHERE sha256=?').get(sha) as any).id;
      }
      this.db.prepare('INSERT INTO public_fetch_receipts VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, jobId, provider, url, now, blobId, status, 'public-adapters-1', license, error);
    })();
    return { id, jobId, provider, url, fetchedAt: now, sha256: sha, httpStatus: status, bytes: bytes?.length ?? 0, adapterVersion: 'public-adapters-1', license };
  }
  receipts(jobId: string, owner: string) {
    if (!this.job(jobId, owner)) throw new AutomationError('Job not found', 404);
    return (this.db.prepare('SELECT id FROM public_fetch_receipts WHERE job_id=? ORDER BY fetched_at,id').all(jobId) as any[]).map(r => this.getReceipt(r.id));
  }
  getReceipt(id: string): PublicReceipt {
    const r = this.db.prepare('SELECT f.*,b.sha256,b.byte_size FROM public_fetch_receipts f LEFT JOIN raw_blobs b ON f.raw_blob_id=b.id WHERE f.id=?').get(id) as any;
    if (!r) throw new AutomationError('Receipt not found', 404);
    return { id, jobId: r.job_id, provider: r.provider, url: r.url, fetchedAt: r.fetched_at, sha256: r.sha256 ?? '',
      httpStatus: r.http_status, bytes: r.byte_size ?? 0, adapterVersion: r.adapter_version, license: r.license };
  }
  async raw(id: string): Promise<Buffer> {
    const row = this.db.prepare('SELECT b.* FROM public_fetch_receipts f JOIN raw_blobs b ON f.raw_blob_id=b.id WHERE f.id=?').get(id) as any;
    if (!row) throw new AutomationError('Raw response not found', 404);
    const bytes = await this.store.get(row.object_uri);
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new AutomationError('Raw response integrity mismatch');
    return bytes;
  }
  /** PubChem CID is the identity; a query string is never silently made a scientific synonym. */
  putCompound(cid: number, name: string, value: any, receipt: PublicReceipt): string {
    const id = `pubchem:${cid}`, now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO substances(id,canonical_name,normalized_name,created_at) VALUES (?,?,?,?)').run(id, name, id, now);
      this.identifier(id, 'pubchem', String(cid), receipt.id);
      if (typeof value.InChIKey === 'string') this.identifier(id, 'inchi_key', value.InChIKey, receipt.id);
      this.record(id, 'pubchem', 'properties', value, receipt);
    })();
    return id;
  }
  identifier(id: string, namespace: string, value: string, receiptId: string) {
    this.db.prepare('INSERT OR IGNORE INTO external_identifiers VALUES (?,?,?,?)').run(id, namespace, value, receiptId);
  }
  alias(id: string, name: string, language: string | null, source: string) {
    const key = canonicalHash({ id, name, language, source });
    this.db.prepare('INSERT OR IGNORE INTO aliases(id,substance_id,alias,language,alias_type,source_id) VALUES (?,?,?,?,?,?)')
      .run(key, id, name, language, 'source_label', source);
  }
  record(id: string, provider: string, kind: string, value: unknown, receipt: PublicReceipt) {
    const hash = canonicalHash({ id, provider, kind, value }), key = `reference-${hash}`;
    this.db.prepare('INSERT OR IGNORE INTO substance_reference_records VALUES (?,?,?,?,?,?,?,?)')
      .run(key, id, provider, kind, JSON.stringify(value), hash, receipt.id, receipt.fetchedAt);
    return key;
  }
  activity(subject: string, value: any, receipt: PublicReceipt) {
    const target = `chembl:${value.targetId}`, hash = canonicalHash({ subject, value }), id = `activity-${hash}`;
    this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO targets(id,canonical_name,target_type,organism,external_identifiers_json,created_at) VALUES (?,?,?,?,?,?)')
        .run(target, value.targetName ?? value.targetId, 'unknown', value.organism, JSON.stringify({ chembl: value.targetId }), receipt.fetchedAt);
      this.db.prepare(`INSERT OR IGNORE INTO assertions(id,subject_type,subject_id,predicate,object_type,object_id,value_json,
        source_id,provider_id,citation_json,evidence_tier,quality_flags_json,content_hash,raw_sha256,created_at)
        VALUES (?,'substance',?,?,'target',?,?, 'pharmacology_activity','chembl',?,'CURATED_SECONDARY',?,?,?,?)`)
        .run(id, subject, ['Ki', 'Kd'].includes(value.measure) && value.assayType === 'B' ? 'BINDS_TO' : 'MODULATES', target, JSON.stringify(value),
          JSON.stringify({ provider: 'chembl', url: `https://www.ebi.ac.uk/chembl/explore/activity/${value.activityId}`, sourceUrl: receipt.url,
            sourceRecordId: String(value.activityId), receiptId: receipt.id, documentId: value.documentId, retrievedAt: receipt.fetchedAt, license: receipt.license }),
          JSON.stringify(value.flags), hash, receipt.sha256, receipt.fetchedAt);
    })();
  }
  substanceList(query = '') {
    const term = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    return this.db.prepare(`SELECT DISTINCT s.id,s.canonical_name AS name FROM substances s JOIN substance_reference_records r ON r.substance_id=s.id
      WHERE s.canonical_name LIKE ? ESCAPE '\\' OR s.id LIKE ? ESCAPE '\\' OR EXISTS
      (SELECT 1 FROM aliases a WHERE a.substance_id=s.id AND a.alias LIKE ? ESCAPE '\\') ORDER BY s.canonical_name,s.id LIMIT 200`).all(term, term, term);
  }
  substance(id: string): MemorySubstance | null {
    const row = this.db.prepare('SELECT * FROM substances WHERE id=?').get(id) as any;
    if (!row || !this.db.prepare('SELECT 1 FROM substance_reference_records WHERE substance_id=?').get(id)) return null;
    return { id, name: row.canonical_name,
      identifiers: this.db.prepare('SELECT namespace,value,provenance FROM external_identifiers WHERE substance_id=? ORDER BY namespace,value').all(id) as any[],
      aliases: this.db.prepare('SELECT alias AS name,language,source_id AS source FROM aliases WHERE substance_id=? ORDER BY language,alias LIMIT 500').all(id) as any[],
      records: (this.db.prepare('SELECT * FROM substance_reference_records WHERE substance_id=? ORDER BY created_at DESC,id').all(id) as any[])
        .map(r => ({ id: r.id, provider: r.provider, kind: r.kind, value: JSON.parse(r.value_json), receipt: this.getReceipt(r.receipt_id) })),
      activities: (this.db.prepare("SELECT * FROM assertions WHERE subject_type='substance' AND subject_id=? AND provider_id='chembl' ORDER BY created_at DESC,id LIMIT 3000").all(id) as any[])
        .map(r => ({ id: r.id, value: JSON.parse(r.value_json), evidenceTier: r.evidence_tier, approvalState: r.approved_hash === r.content_hash ? 'APPROVED' : 'PROPOSED', citation: JSON.parse(r.citation_json) })),
    };
  }
  paper(owner: string, input: Omit<PaperRecord, 'id'>) {
    const { receiptId, ...identity } = input, hash = canonicalHash(identity), id = canonicalHash({ owner, hash });
    this.db.prepare('INSERT OR IGNORE INTO paper_discoveries VALUES (?,?,?,?,?,?,?,?)').run(id, owner, input.provider, input.sourceId, hash,
      JSON.stringify({ ...input, id }), receiptId, new Date().toISOString());
    return id;
  }
  papers(owner: string): PaperRecord[] {
    return (this.db.prepare('SELECT body_json FROM paper_discoveries WHERE owner_principal_id=? ORDER BY first_seen_at DESC,id LIMIT 500').all(owner) as any[]).map(r => JSON.parse(r.body_json));
  }
}
