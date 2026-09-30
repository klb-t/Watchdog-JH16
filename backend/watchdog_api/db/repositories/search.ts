import type { Database } from 'better-sqlite3';
import type { ObjectStore } from '../../storage/object_store';
import { FieldReferenceRepository } from './field_reference';
import { canonicalHash } from '../../domain/canonical';
import { can } from '../../../../shared/authorization';
import { SEARCH_KINDS, SEARCH_KIND_CAPABILITIES, type SearchHit, type SearchKind, type SearchProvenance } from '../../../../shared/search';
import type { Principal } from '../../domain/principal';
import type { Entity, ReferenceRecord } from '../../../../shared/field';
import { ScheduleSchema } from '../../../../shared/automation';
import { sourceRegistry } from '../../sources/registry';

interface IndexedHit { hit: SearchHit; terms: string[] }
export class SearchIntegrityError extends Error { readonly code = 'search_integrity_error'; }

/** Metadata reads live in the repository layer. No copied full-text index, credentials or private-cell snippets. */
export class SearchRepository {
  private readonly field: FieldReferenceRepository;
  constructor(private readonly db: Database, store: ObjectStore) {
    this.field = new FieldReferenceRepository(db, store);
  }
  availableKinds(principal: Principal): SearchKind[] {
    return SEARCH_KINDS.filter(kind => SEARCH_KIND_CAPABILITIES[kind].some(capability => can(principal.roles, capability)));
  }
  async entries(principal: Principal, requestedKind: SearchKind | 'all'): Promise<IndexedHit[]> {
    const kinds = new Set(this.availableKinds(principal).filter(kind => requestedKind === 'all' || requestedKind === kind));
    // Resolve provider I/O before reading access-controlled rows. A revocation
    // during status resolution must be reflected in both results and counts.
    const sources = kinds.has('source') ? await sourceRegistry.listWithLiveStatus() : [];
    const entries: IndexedHit[] = [], entities = new Map<string, IndexedHit>();
    const add = (hit: SearchHit, terms: string[] = []) => { if (kinds.has(hit.kind)) entries.push({ hit, terms: [hit.label, hit.id, ...terms] }); };
    const fieldHref = (kind: SearchKind, term: string, id: string, state: string | null) => can(principal.roles, 'responder.lookup') && state === 'APPROVED'
      ? `/responder?mode=${kind === 'symptom' ? 'symptoms' : kind === 'market_label' ? 'market' : 'pill'}&term=${encodeURIComponent(term)}&reference=${encodeURIComponent(id)}`
      : `/evidence?reference=${encodeURIComponent(id)}`;
    const entity = (value: Entity, provenance: SearchProvenance, terms: string[] = [], memory = false, href?: string) => {
      if (!kinds.has(value.type)) return;
      const key = `${value.type}:${value.id}`, previous = entities.get(key);
      if (previous) { previous.terms.push(...terms); if (!previous.hit.provenance.some(p => p.recordId === provenance.recordId)) previous.hit.provenance.push(provenance); return; }
      const hit: SearchHit = { id: value.id, kind: value.type, label: value.name, details: value.targetType ? [value.targetType] : [],
        href: href ?? (memory ? `/memory?substance=${encodeURIComponent(value.id)}` : fieldHref(value.type, value.name, provenance.recordId, provenance.approvalState)),
        visibility: 'reference', status: null, contentHash: null, provenance: [provenance] };
      const indexed = { hit, terms: [value.name, value.id, ...terms] }; entities.set(key, indexed); entries.push(indexed);
    };
    const provenance = (record: ReferenceRecord): SearchProvenance => ({ recordId: record.id, contentHash: record.contentHash,
      publisher: record.document.citation.publisher, url: record.document.citation.url,
      evidenceTier: record.document.evidenceTier, approvalState: record.approvalState });
    const referenceAccess = can(principal.roles, 'responder.lookup') || can(principal.roles, 'evidence.review');
    if (referenceAccess && ['substance', 'symptom', 'target', 'sample', 'market_label', 'interaction'].some(kind => kinds.has(kind as SearchKind))) {
      // Public-source memory is a shared reference catalogue. Do not expose job owner or acquisition requests.
      if (kinds.has('substance')) {
      const memories = this.db.prepare(`SELECT s.id,s.canonical_name,r.id record_id,r.content_hash,r.provider,p.url
        FROM substances s JOIN substance_reference_records r ON r.substance_id=s.id
        JOIN public_fetch_receipts p ON p.id=r.receipt_id ORDER BY s.id,r.id`).all() as any[];
      const names = new Map<string, string[]>();
      const aliasRows = this.db.prepare(`SELECT a.substance_id,a.alias FROM aliases a
        WHERE EXISTS(SELECT 1 FROM substance_reference_records r WHERE r.substance_id=a.substance_id) ORDER BY a.substance_id,a.alias,a.id`).all() as { substance_id: string; alias: string }[];
      const identifierRows = this.db.prepare(`SELECT i.substance_id,i.namespace,i.value FROM external_identifiers i
        WHERE EXISTS(SELECT 1 FROM substance_reference_records r WHERE r.substance_id=i.substance_id) ORDER BY i.substance_id,i.namespace,i.value`).all() as { substance_id: string; namespace: string; value: string }[];
      for (const row of aliasRows) names.set(row.substance_id, [...(names.get(row.substance_id) ?? []), row.alias]);
      for (const row of identifierRows) names.set(row.substance_id, [...(names.get(row.substance_id) ?? []), row.value, `${row.namespace}:${row.value}`]);
      for (const row of memories) {
        entity({ id: row.id, name: row.canonical_name, type: 'substance' }, { recordId: row.record_id, contentHash: row.content_hash,
          publisher: row.provider, url: row.url, evidenceTier: null, approvalState: 'SOURCE_RECORD' },
          names.get(row.id) ?? [], true);
      }
      }
      const records = this.field.list().filter(record => can(principal.roles, 'evidence.review') || record.approvalState === 'APPROVED');
      for (const record of records) {
        const doc = record.document, source = provenance(record);
        if (doc.kind === 'sample') {
          const appearance = [...doc.appearance.colors, doc.appearance.shape, doc.appearance.logo, doc.appearance.scoreLine].filter((s): s is string => Boolean(s));
          add({ id: record.id, kind: 'sample', label: doc.name, details: [...appearance, doc.region.name, doc.observedOn ?? 'Data nieznana', doc.timeBasis],
            href: fieldHref('sample', doc.appearance.logo ?? doc.name, record.id, record.approvalState), visibility: 'reference', status: record.approvalState,
            contentHash: record.contentHash, provenance: [source] }, [doc.key, ...appearance, doc.region.id, doc.region.name, ...doc.components.map(c => c.substance.name)]);
          for (const component of doc.components) entity(component.substance, source);
          if (doc.market) add({ id: `${record.id}:label`, kind: 'market_label', label: doc.market.label,
            details: [doc.market.group, doc.market.language, doc.region.name, doc.observedOn ?? 'Data nieznana'],
            href: fieldHref('market_label', doc.market.group, record.id, record.approvalState), visibility: 'reference', status: record.approvalState,
            contentHash: record.contentHash, provenance: [source] }, [doc.market.group, doc.region.id]);
        } else {
          entity(doc.subject, source); if (doc.object) entity(doc.object, source);
          if (doc.predicate === 'INTERACTS_WITH') add({ id: record.id, kind: 'interaction', label: `${doc.subject.name} · ${doc.object?.name ?? doc.predicate}`,
            details: [doc.predicate, doc.statement.language, doc.category], href: fieldHref('interaction', doc.subject.name, record.id, record.approvalState),
            visibility: 'reference', status: record.approvalState, contentHash: record.contentHash, provenance: [source] },
            [doc.subject.id, doc.object?.id ?? '', doc.statement.mechanism ?? '', doc.statement.severity ?? '']);
        }
      }
      // Preserve the approval state of imported activity assertions; this is a name index, not clinical approval.
      if (kinds.has('target')) {
      const targets = this.db.prepare(`SELECT DISTINCT t.id,t.canonical_name,t.target_type,a.subject_id,a.id record_id,a.content_hash,a.evidence_tier,a.approved_hash,a.citation_json,
        json_extract(a.value_json,'$.targetId') target_source_id
        FROM targets t JOIN assertions a ON a.object_type='target' AND a.object_id=t.id AND a.provider_id='chembl'
        WHERE EXISTS(SELECT 1 FROM substance_reference_records r WHERE r.substance_id=a.subject_id) ORDER BY t.id,a.subject_id,a.id`).all() as any[];
      for (const row of targets) { const citation = JSON.parse(row.citation_json);
        entity({ id: row.id, name: row.canonical_name, type: 'target' }, { recordId: row.record_id, contentHash: row.content_hash,
          publisher: 'chembl', url: citation.sourceUrl ?? citation.url ?? null, evidenceTier: row.evidence_tier,
          approvalState: row.approved_hash === row.content_hash ? 'APPROVED' : 'PROPOSED' }, [row.target_type], false,
          `/memory?substance=${encodeURIComponent(row.subject_id)}&target=${encodeURIComponent(row.target_source_id ?? row.id)}`);
      }
      }
    }
    if (kinds.has('dataset')) {
      const rows = this.db.prepare(`SELECT id,name,version,sha256,approved_hash,visibility,owner_principal_id FROM datasets
        WHERE raw_blob_id IS NOT NULL AND ((owner_principal_id=? AND (? OR approved_hash=sha256)) OR (visibility='shared_aggregate' AND approved_hash=sha256)) ORDER BY id`)
        .all(principal.id, Number(can(principal.roles, 'dataset.review'))) as any[];
      for (const row of rows) add({ id: row.id, kind: 'dataset', label: row.name, details: [row.version], href: `/workbench?dataset=${encodeURIComponent(row.id)}`,
        visibility: row.owner_principal_id === principal.id ? 'owned' : 'shared_aggregate', status: row.approved_hash === row.sha256 ? 'APPROVED' : 'PROPOSED', contentHash: row.sha256, provenance: [] });
    }
    if (kinds.has('paper')) {
      // Full text and its hash verification stay in the exact document view. Searching reads only stored metadata.
      const documents = this.db.prepare(`SELECT id,content_hash,json_extract(body_json,'$.title') title,json_extract(body_json,'$.source') source,
        json_extract(body_json,'$.coverage') coverage,json_extract(body_json,'$.language') language,json_extract(body_json,'$.geography') geography
        FROM research_documents WHERE owner_principal_id=? ORDER BY id`).all(principal.id) as any[];
      for (const row of documents) {
        add({ id: row.id, kind: 'paper', label: row.title, details: [row.source, row.coverage, row.language ?? 'Język nieznany'],
          href: `/research?document=${encodeURIComponent(row.id)}`, visibility: 'owned', status: row.coverage, contentHash: row.content_hash, provenance: [] },
          [row.source, ...JSON.parse(row.geography)]);
      }
      const discoveries = this.db.prepare(`SELECT id,provider,source_id,content_hash,json_extract(body_json,'$.title') title,
        json_extract(body_json,'$.doi') doi,json_extract(body_json,'$.authors') authors FROM paper_discoveries WHERE owner_principal_id=? ORDER BY id`).all(principal.id) as any[];
      for (const row of discoveries) {
        add({ id: row.id, kind: 'paper', label: row.title, details: [row.provider, row.doi ?? row.source_id, 'DISCOVERED'],
          href: `/research?discovery=${encodeURIComponent(row.id)}`, visibility: 'owned', status: 'DISCOVERED', contentHash: row.content_hash, provenance: [] },
          [row.source_id, row.doi ?? '', ...JSON.parse(row.authors ?? '[]')]);
      }
    }
    if (kinds.has('run')) {
      const rows = this.db.prepare('SELECT id,run_type,status,created_at,effective_config_hash FROM runs WHERE owner_principal_id=? ORDER BY id').all(principal.id) as any[];
      for (const row of rows) add({ id: row.id, kind: 'run', label: `${row.run_type} · ${row.id}`, details: [row.created_at], href: `/runs/${encodeURIComponent(row.id)}`,
        visibility: 'owned', status: row.status, contentHash: row.effective_config_hash, provenance: [] }, [row.run_type, row.status]);
    }
    if (kinds.has('schedule')) {
      const rows = this.db.prepare('SELECT id,body_json,content_hash,profile_hash,enabled,next_due_at FROM automation_schedules WHERE owner_principal_id=? ORDER BY id').all(principal.id) as any[];
      for (const row of rows) { const body = ScheduleSchema.parse(JSON.parse(row.body_json));
        if (canonicalHash({ ...body, profileHash: row.profile_hash }) !== row.content_hash) throw new SearchIntegrityError('Schedule metadata integrity mismatch.');
        add({ id: row.id, kind: 'schedule', label: body.name, details: [body.request.kind, body.recurrence.kind, row.next_due_at],
          href: `/automation?schedule=${encodeURIComponent(row.id)}`, visibility: 'owned', status: row.enabled ? 'ENABLED' : 'DISABLED', contentHash: row.content_hash, provenance: [] },
          [body.request.kind, ...('names' in body.request ? body.request.names : [])]);
      }
    }
    for (const source of sources) add({ id: source.source_id, kind: 'source', label: source.source_id,
      details: [source.adapter, source.status ?? '', source.remediation ?? ''].filter(Boolean), href: '/sources', visibility: 'registry', status: source.status ?? null, contentHash: null, provenance: [] },
      [source.adapter, source.description ?? '', ...(source.capabilities ?? [])]);
    for (const indexed of entities.values()) indexed.hit.provenance.sort((a, b) => a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0);
    return entries;
  }
}
