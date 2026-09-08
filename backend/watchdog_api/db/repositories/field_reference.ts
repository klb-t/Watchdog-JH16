import type { Database } from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import type { ObjectStore } from '../../storage/object_store';
import { canonicalHash, canonicalizeJson } from '../../domain/canonical';
import { approvalState, requireApproved } from '../../domain/approval';
import type { Approvable } from '../../domain/approval';
import type { ReferenceDocument, ReferenceRecord, Region, Entity, SampleDocument, AssertionDocument } from '../../../../shared/field';
import { validateReferenceDocument, FieldConflictError } from '../../field/validation';

const encode = (value: unknown) => JSON.stringify(value);
const decode = <T>(value: string | null, fallback: T): T => value === null ? fallback : JSON.parse(value);

/** Canonical records are reconstructed from the existing specimen/assertion graph.
 * There is no second clinical JSON store that can drift from those tables. */
export class FieldReferenceRepository {
  constructor(private readonly db: Database, private readonly store: ObjectStore) {}

  registerRegions(regions: Region[]): void {
    this.db.transaction(() => { for (const region of regions) this.putRegion(region); })();
  }
  private putRegion(region: Region): void {
    const found = this.db.prepare('SELECT name, parent_region_id FROM geographic_regions WHERE id=?').get(region.id) as any;
    if (found && (found.name !== region.name || found.parent_region_id !== region.parentId))
      throw new FieldConflictError(`Region '${region.id}' differs from its registered definition.`);
    this.db.prepare(`INSERT OR IGNORE INTO geographic_regions (id,name,parent_region_id,created_at) VALUES (?,?,?,?)`)
      .run(region.id, region.name, region.parentId, new Date().toISOString());
  }
  private getRegion(id: string | null): Region | null {
    if (!id) return null;
    const row = this.db.prepare('SELECT * FROM geographic_regions WHERE id=?').get(id) as any;
    if (!row) throw new FieldConflictError(`Unresolved region '${id}'.`);
    return { id: row.id, name: row.name, parentId: row.parent_region_id };
  }
  regions(): Region[] {
    const pending = (this.db.prepare('SELECT id FROM geographic_regions ORDER BY id').all() as any[]).map(r => this.getRegion(r.id)!);
    const ordered: Region[] = [], known = new Set<string>();
    while (pending.length) {
      const index = pending.findIndex(r => !r.parentId || known.has(r.parentId));
      if (index < 0) throw new FieldConflictError('Unresolved or cyclic regional hierarchy.');
      const [region] = pending.splice(index, 1); ordered.push(region); known.add(region.id);
    }
    return ordered;
  }
  private putEntity(entity: Entity): void {
    const table = { substance: 'substances', symptom: 'symptoms', target: 'targets' }[entity.type];
    const found = this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(entity.id) as any;
    if (found && found.canonical_name !== entity.name)
      throw new FieldConflictError(`Entity '${entity.id}' already has a different canonical name. Resolve the mapping explicitly.`);
    if (found && entity.type === 'target' && found.target_type !== entity.targetType)
      throw new FieldConflictError(`Target '${entity.id}' already has a different target type.`);
    if (found) return;
    const at = new Date().toISOString();
    if (entity.type === 'substance') this.db.prepare(`INSERT INTO substances(id,canonical_name,normalized_name,created_at) VALUES (?,?,?,?)`)
      .run(entity.id, entity.name, entity.name.toLowerCase(), at);
    else if (entity.type === 'symptom') this.db.prepare(`INSERT INTO symptoms(id,canonical_name,created_at) VALUES (?,?,?)`).run(entity.id, entity.name, at);
    else this.db.prepare(`INSERT INTO targets(id,canonical_name,target_type,created_at) VALUES (?,?,?,?)`).run(entity.id, entity.name, entity.targetType, at);
  }
  private getEntity(id: string, type: Entity['type']): Entity {
    const table = { substance: 'substances', symptom: 'symptoms', target: 'targets' }[type];
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as any;
    if (!row) throw new FieldConflictError(`Unresolved ${type} '${id}'.`);
    return { id, name: row.canonical_name, type, ...(type === 'target' ? { targetType: row.target_type } : {}) };
  }

  async importDocument(input: unknown, actorId: string, requestId: string): Promise<ReferenceRecord> {
    const doc = validateReferenceDocument(input);
    const contentHash = canonicalHash(doc);
    const id = `field-${contentHash}`;
    const bytes = Buffer.from(canonicalizeJson(input));
    const rawSha = createHash('sha256').update(bytes).digest('hex');
    const uri = await this.store.put(`raw/${rawSha}`, bytes);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`INSERT OR IGNORE INTO raw_blobs(id,sha256,object_uri,byte_size,media_type,retention_class,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(`field-raw-${rawSha}`, rawSha, uri, bytes.length, 'application/json', 'reference-import', now);
      const blob = this.db.prepare('SELECT id FROM raw_blobs WHERE sha256=?').get(rawSha) as any;
      const existing = this.get(id);
      if (existing && existing.contentHash !== contentHash) throw new FieldConflictError('The stored mapping was edited. Import a new version with a new key.');
      if (!existing) {
        if (doc.region) this.putRegion(doc.region);
        if (doc.kind === 'sample') this.insertSample(id, doc, contentHash, rawSha, now);
        else this.insertAssertion(id, doc, contentHash, rawSha, now);
      }
      // Raw bytes deduplicate; independent import events never do.
      this.db.prepare(`INSERT INTO field_import_events VALUES (?,?,?,?,?,?,?)`)
        .run(randomUUID(), id, blob.id, actorId, now, 'manual_mapping_import', doc.citation.url);
      this.audit(actorId, 'reference.import', id, requestId, { rawSha256: rawSha, contentHash });
    })();
    return this.get(id)!;
  }

  private insertSample(id: string, doc: SampleDocument, hash: string, raw: string, now: string): void {
    const pill = `${id}:pill`, market = doc.market ? `${id}:label` : null;
    this.db.prepare(`INSERT INTO pill_types(id,shape,color_json,logo_text,score_line,geography_id,first_observed_at,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(pill, doc.appearance.shape, encode(doc.appearance.colors), doc.appearance.logo,
        doc.appearance.scoreLine, doc.region.id, doc.observedOn, now);
    if (doc.market) this.db.prepare(`INSERT INTO market_labels(id,label_text,canonical_label_group,language,region_id,created_at)
      VALUES (?,?,?,?,?,?)`).run(market, doc.market.label, doc.market.group, doc.market.language, doc.region.id, now);
    this.db.prepare(`INSERT INTO tested_samples(id,pill_type_id,source_id,test_method,tested_at,lab_reference,evidence_tier,
      geography_id,created_at,claimed_label_id,reference_key,name,origin,observed_on,time_basis,unknown_components_json,
      citation_json,quality_flags_json,content_hash,raw_sha256) VALUES (${Array(20).fill('?').join(',')})`)
      .run(id, pill, doc.citation.publisher, doc.testMethod, doc.timeBasis === 'tested' ? doc.observedOn : null,
        doc.citation.sourceRecordId, doc.evidenceTier, doc.region.id, now, market, doc.key, doc.name, doc.origin,
        doc.observedOn, doc.timeBasis, encode(doc.unknownComponents), encode(doc.citation), encode(doc.qualityFlags), hash, raw);
    doc.components.forEach((component, i) => {
      this.putEntity(component.substance);
      this.db.prepare(`INSERT INTO pill_type_composition(id,pill_type_id,substance_id,concentration_value,concentration_unit,
        evidence_tier,tested_sample_id,created_at,note) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(`${id}:component:${i}`, pill, component.substance.id, component.amount, component.unit, doc.evidenceTier, id, now, component.note);
    });
  }

  private insertAssertion(id: string, doc: AssertionDocument, hash: string, raw: string, now: string): void {
    this.putEntity(doc.subject);
    if (doc.object) this.putEntity(doc.object);
    this.db.prepare(`INSERT INTO assertions(id,subject_type,subject_id,predicate,object_type,object_id,value_json,geography_id,
      language,valid_from,valid_to,source_id,provider_id,citation_json,evidence_tier,quality_flags_json,contradicts_json,
      supersedes_assertion_id,created_at,reference_key,content_hash,raw_sha256) VALUES (${Array(22).fill('?').join(',')})`)
      .run(id, doc.subject.type, doc.subject.id, doc.predicate, doc.object?.type ?? null, doc.object?.id ?? null,
        encode({ category: doc.category, statement: doc.statement }), doc.region?.id ?? null, doc.statement.language,
        doc.validFrom, doc.validTo, doc.citation.publisher, 'manual_mapping_import', encode(doc.citation), doc.evidenceTier,
        encode(doc.qualityFlags), encode(doc.contradicts), doc.supersedes, now, doc.key, hash, raw);
  }

  get(id: string): ReferenceRecord | null {
    const sample = this.db.prepare('SELECT * FROM tested_samples WHERE id=? AND reference_key IS NOT NULL').get(id) as any;
    if (sample) {
      const pill = this.db.prepare('SELECT * FROM pill_types WHERE id=?').get(sample.pill_type_id) as any;
      const market = this.db.prepare('SELECT * FROM market_labels WHERE id=?').get(sample.claimed_label_id) as any;
      const rows = this.db.prepare('SELECT * FROM pill_type_composition WHERE tested_sample_id=? ORDER BY substance_id').all(id) as any[];
      const doc: SampleDocument = { key: sample.reference_key, kind: 'sample', name: sample.name, origin: sample.origin,
        region: this.getRegion(sample.geography_id)!, observedOn: sample.observed_on, timeBasis: sample.time_basis,
        testMethod: sample.test_method, appearance: { colors: decode(pill.color_json, []), shape: pill.shape,
          logo: pill.logo_text, scoreLine: pill.score_line },
        market: market ? { label: market.label_text, group: market.canonical_label_group, language: market.language } : null,
        components: rows.map(row => ({ substance: this.getEntity(row.substance_id, 'substance'),
          amount: row.concentration_value, unit: row.concentration_unit, note: row.note })),
        unknownComponents: decode(sample.unknown_components_json, []), citation: decode(sample.citation_json, null),
        evidenceTier: sample.evidence_tier, qualityFlags: decode(sample.quality_flags_json, []) };
      return this.envelope(id, doc, sample);
    }
    const row = this.db.prepare('SELECT * FROM assertions WHERE id=? AND reference_key IS NOT NULL').get(id) as any;
    if (!row) return null;
    const payload = decode<any>(row.value_json, {});
    return this.envelope(id, { key: row.reference_key, kind: 'assertion', subject: this.getEntity(row.subject_id, row.subject_type),
      predicate: row.predicate, object: row.object_id ? this.getEntity(row.object_id, row.object_type) : null,
      category: payload.category, statement: payload.statement, region: this.getRegion(row.geography_id),
      validFrom: row.valid_from, validTo: row.valid_to, contradicts: decode(row.contradicts_json, []),
      supersedes: row.supersedes_assertion_id, citation: decode(row.citation_json, null), evidenceTier: row.evidence_tier,
      qualityFlags: decode(row.quality_flags_json, []) }, row);
  }
  private envelope(id: string, doc: ReferenceDocument, row: any): ReferenceRecord {
    const contentHash = canonicalHash(doc);
    return { id, document: doc, contentHash, approvedHash: row.approved_hash, approvedBy: row.approved_by,
      approvedAt: row.approved_at, approvalState: approvalState({ id, kind: 'reference_mapping', content: doc,
        approvedHash: row.approved_hash ?? undefined }), importedAt: row.created_at, rawSha256: row.raw_sha256 };
  }
  list(): ReferenceRecord[] {
    const ids = this.db.prepare(`SELECT id FROM tested_samples WHERE reference_key IS NOT NULL
      UNION SELECT id FROM assertions WHERE reference_key IS NOT NULL ORDER BY id`).all() as any[];
    return ids.map(row => this.get(row.id)!);
  }
  /** Only the explicit API human-action handler supplies this hash-bound object. */
  saveApproval(artifact: Approvable<ReferenceDocument>, expectedHash: string, requestId: string): ReferenceRecord {
    return this.db.transaction(() => {
      const current = this.get(artifact.id);
      if (!current || current.contentHash !== expectedHash) throw new FieldConflictError('The reference changed; review its new content before approving.');
      requireApproved({ ...artifact, content: current.document });
      const table = current.document.kind === 'sample' ? 'tested_samples' : 'assertions';
      this.db.prepare(`UPDATE ${table} SET approved_hash=?,approved_by=?,approved_at=? WHERE id=?`)
        .run(artifact.approvedHash, artifact.approvedBy, artifact.approvedAt, artifact.id);
      if (table === 'assertions') this.db.prepare("UPDATE assertions SET approval_state='APPROVED' WHERE id=?").run(artifact.id);
      this.audit(artifact.approvedBy!, 'reference.approve', artifact.id, requestId, { approvedHash: expectedHash });
      return this.get(artifact.id)!;
    })();
  }
  revoke(id: string, actorId: string, requestId: string): void {
    this.db.transaction(() => {
      const current = this.get(id);
      if (!current) throw new FieldConflictError('Reference not found.');
      const table = current.document.kind === 'sample' ? 'tested_samples' : 'assertions';
      this.db.prepare(`UPDATE ${table} SET approved_hash=NULL,approved_by=NULL,approved_at=NULL WHERE id=?`).run(id);
      if (table === 'assertions') this.db.prepare("UPDATE assertions SET approval_state='PROPOSED' WHERE id=?").run(id);
      this.audit(actorId, 'reference.revoke', id, requestId, { previousHash: current.approvedHash });
    })();
  }
  acceptOfflineEvents(actorId: string, events: import('../../../../shared/field').OfflineLookupEvent[], requestId: string): string[] {
    return this.db.transaction(() => events.map(event => {
      const hash = canonicalHash(event);
      const previous = this.db.prepare('SELECT * FROM field_offline_receipts WHERE id=?').get(event.id) as any;
      if (previous) {
        if (previous.actor_id !== actorId || previous.event_hash !== hash)
          throw new FieldConflictError('Offline event ID already has different content or owner.');
        return event.id;
      }
      this.db.prepare('INSERT INTO field_offline_receipts VALUES (?,?,?)').run(event.id, actorId, hash);
      this.audit(actorId, 'responder.lookup.offline', event.snapshotHash, requestId,
        { ...event, clientReported: true, clientClockVerified: false, resultsRecomputedByServer: false });
      return event.id;
    }))();
  }
  audit(actorId: string, action: string, objectId: string, requestId: string, metadata: unknown): void {
    const previous = this.db.prepare('SELECT event_hash FROM audit_events ORDER BY rowid DESC LIMIT 1').get() as any;
    const event = { id: randomUUID(), timestamp: new Date().toISOString(), actor_type: 'principal', actor_id: actorId,
      action, object_type: 'field_reference', object_id: objectId, request_id: requestId,
      metadata_json: encode(metadata), previous_event_hash: previous?.event_hash ?? null };
    this.db.prepare(`INSERT INTO audit_events(id,timestamp,actor_type,actor_id,action,object_type,object_id,
      request_id,metadata_json,previous_event_hash,event_hash) VALUES (${Array(11).fill('?').join(',')})`)
      .run(...Object.values(event), canonicalHash(event));
  }
}
