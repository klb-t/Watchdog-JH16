import type { FieldReferenceRepository } from '../db/repositories/field_reference';
import type { FieldProfile, FieldSnapshot } from '../../../shared/field';
import { lookupField } from '../../../shared/field_lookup';
import { canonicalHash } from '../domain/canonical';
import { tracer } from '../utils/tracer';
import { validateFieldQuery, validateReferenceDocument } from './validation';

export class FieldService {
  constructor(private readonly repository: FieldReferenceRepository, readonly profile: FieldProfile) {
    repository.registerRegions(profile.regions);
  }
  snapshot(principalId: string, now = new Date()): FieldSnapshot {
    const records = this.repository.list().filter(record => record.approvalState === 'APPROVED');
    for (const record of records) validateReferenceDocument(record.document);
    return { version: 'field-snapshot-1', generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.profile.offlineMaxHours * 3_600_000).toISOString(), principalId,
      profile: { ...this.profile, regions: this.repository.regions() }, records };
  }
  async lookup(input: unknown, principalId: string, requestId: string) {
    return tracer.runWithSpan('field_reference', 'lookup', async () => {
      const query = validateFieldQuery(input);
      tracer.validation(true, { schema: 'field-query-1', mode: query.mode });
      const snapshot = this.snapshot(principalId);
      const result = lookupField(snapshot, query);
      // Query descriptors belong in the authenticated audit record, never raw HTTP logs.
      this.repository.audit(principalId, 'responder.lookup', canonicalHash(query), requestId,
        { query, snapshotHash: canonicalHash(snapshot), resultIds: result.candidates.map(c => c.record.id),
          symptomIds: result.symptomCandidates.map(c => c.card.substance.id) });
      tracer.result({ candidateCount: result.candidates.length, symptomCandidateCount: result.symptomCandidates.length,
        flags: result.flags, queryHash: canonicalHash(query) });
      return { result, snapshotGeneratedAt: snapshot.generatedAt, traceId: tracer.getContext()?.trace_id };
    }, { request_id: requestId, actor_id: principalId });
  }
}
