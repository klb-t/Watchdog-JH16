import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireCapability } from './auth_routes';
import type { FieldReferenceRepository } from '../db/repositories/field_reference';
import { FieldService } from '../field/service';
import { approve } from '../domain/approval';
import { FieldConflictError, FieldValidationError, FieldQuerySchema, validateReferenceDocument } from '../field/validation';
import { tracer } from '../utils/tracer';
import { canonicalHash } from '../domain/canonical';
import { loadFieldCatalog } from '../config/field';
import type { OfflineLookupEvent } from '../../../shared/field';

const requestId = () => tracer.getContext()?.request_id ?? randomUUID();
const boundary = (operation: string, fn: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    void tracer.runWithSpan('field_reference', operation, () => fn(req, res),
      { actor_id: req.principal?.id, request_id: requestId() }).catch(next);
  };
const offlineEvents = z.object({ events: z.array(z.object({ id: z.uuid(), clientOccurredAt: z.iso.datetime(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/), query: FieldQuerySchema,
  resultIds: z.array(z.string().max(200)).max(1000) }).strict()).max(100) }).strict();

export function buildFieldRouter(repository: FieldReferenceRepository, service: FieldService) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/profile', requireCapability('responder.lookup'), boundary('profile', (_req, res) => res.json(service.profile)));
  router.get('/snapshot', requireCapability('responder.lookup'), boundary('snapshot', (req, res) => {
    const snapshot = service.snapshot(req.principal!.id);
    repository.audit(req.principal!.id, 'responder.snapshot', canonicalHash(snapshot), requestId(), { recordCount: snapshot.records.length });
    res.json({ snapshot, hash: canonicalHash(snapshot) });
  }));
  router.post('/lookup', requireCapability('responder.lookup'), boundary('lookup_request', async (req, res) => {
    res.json(await service.lookup(req.body, req.principal!.id, requestId()));
  }));
  router.post('/offline-events', requireCapability('responder.lookup'), boundary('offline_audit', (req, res) => {
    const { events } = offlineEvents.parse(req.body);
    res.json({ acceptedIds: repository.acceptOfflineEvents(req.principal!.id, events as OfflineLookupEvent[], requestId()) });
  }));
  router.get('/catalog', requireCapability('evidence.review'), boundary('catalog', (_req, res) => res.json({ proposals: loadFieldCatalog() })));
  router.get('/references', requireCapability('evidence.review'), boundary('references', (_req, res) => {
    res.json({ records: repository.list(), profile: service.profile });
  }));
  router.post('/references', requireCapability('evidence.import'), boundary('import', async (req, res) => {
    const record = await repository.importDocument(req.body, req.principal!.id, requestId());
    tracer.result({ referenceId: record.id, contentHash: record.contentHash, state: record.approvalState });
    res.status(201).json({ record });
  }));
  router.post('/references/:id/approve', requireCapability('evidence.approve'), boundary('approve', (req, res) => {
    const { expectedHash } = z.object({ expectedHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.body);
    const record = repository.get(req.params.id);
    if (!record) return res.status(404).json({ error: 'not_found' });
    if (record.contentHash !== expectedHash) throw new FieldConflictError('The displayed hash is stale. Review the current reference.');
    validateReferenceDocument(record.document);
    const approved = approve({ id: record.id, kind: 'reference_mapping', content: record.document },
      req.principal!.id, new Date().toISOString());
    res.json({ record: repository.saveApproval(approved, expectedHash, requestId()) });
  }));
  router.post('/references/:id/revoke', requireCapability('evidence.approve'), boundary('revoke', (req, res) => {
    z.object({}).strict().parse(req.body);
    repository.revoke(req.params.id, req.principal!.id, requestId());
    res.json({ revoked: true });
  }));
  router.use((error: any, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof FieldValidationError || error instanceof FieldConflictError || error?.code === 'validation_error')
      return res.status(error instanceof FieldConflictError ? 409 : 400).json({ error: error.code, message: error.message });
    next(error);
  });
  return router;
}
