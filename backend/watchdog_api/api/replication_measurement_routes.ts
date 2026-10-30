import { Router } from 'express';
import { z } from 'zod';
import { requireCapability } from './auth_routes';
import { sameOriginMutation } from './automation_routes';
import { AutomationError } from '../db/repositories/automation';
import type { AuditRepository } from '../db/repositories/audit';
import { listReplicationTargets } from '../services/replication_dossier';
import type { ReplicationMeasurements } from '../services/replication_measurements';

/** A new measurement for a replication target with a `measurement` block in its dossier. */
export function buildReplicationMeasurementRouter(measurements: ReplicationMeasurements, audit: AuditRepository) {
  const router = Router();
  const target = (id: string) => listReplicationTargets().find(t => t.target.target_id === id) ?? null;
  router.get('/:id/measurement', requireCapability('run.view'), (req, res) => {
    const t = target(req.params.id), d = t ? measurements.describe(req.principal!.id, t) : null;
    if (!d) return res.status(404).json({ error: 'NOT_FOUND' });
    res.setHeader('Cache-Control', 'no-store'); res.json({ measurement: d });
  });
  router.post('/:id/measurement', requireCapability('run.create'), sameOriginMutation, (req, res, next) => {
    try {
      const body = z.object({ consent: z.literal(true), expectedPresetHash: z.string().regex(/^[a-f0-9]{64}$/),
        dataRole: z.enum(['exploratory', 'confirmation']), protocolId: z.string().uuid().optional() }).strict().parse(req.body);
      const t = target(req.params.id);
      if (!t) return res.status(404).json({ error: 'NOT_FOUND' });
      const launched = measurements.launch(req.principal!.id, t, body);
      audit.append(req.principal!.id, 'replication.measure', 'replication', req.params.id, 'replication-measure', { run: launched.runId, preset_hash: body.expectedPresetHash, data_role: body.dataRole });
      res.status(201).json(launched);
    } catch (e) {
      // `reason` ({code, params}) is additive: the interface shows it in the reader's language; `message` stays for logs and the API.
      if (e instanceof AutomationError) { const reason = (e as { reason?: unknown }).reason; return res.status(409).json({ error: 'measurement_refused', message: e.message, ...(reason ? { reason } : {}) }); }
      next(e);
    }
  });
  return router;
}
