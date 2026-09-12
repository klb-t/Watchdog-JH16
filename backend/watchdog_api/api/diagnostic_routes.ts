import { Router } from 'express';
import { z } from 'zod';
import { requireCapability } from './auth_routes';
import { tracer } from '../utils/tracer';
import { listTraces, readTrace, traceDirectory } from '../diag/view';
import { buildDiagnosticBundle } from '../diag/bundle';
import type { AuditRepository } from '../db/repositories/audit';
import { randomUUID } from 'node:crypto';
const params = z.object({ date: z.iso.date(), id: z.uuid() });
export function buildDiagnosticRouter(audit: AuditRepository) {
  const router = Router(); router.use(requireCapability('diagnostics.view'));
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/state', (_req, res) => res.json({ mode: tracer.getMode(), modes: ['OFF', 'ERRORS', 'NORMAL', 'TRACE'], traces: listTraces() }));
  router.post('/mode', (req, res, next) => {
    try {
      const { mode } = z.object({ mode: z.enum(['OFF', 'ERRORS', 'NORMAL', 'TRACE']) }).strict().parse(req.body);
      const previous = tracer.getMode();
      audit.append(req.principal!.id, 'diagnostics.mode', 'diagnostics', mode, tracer.getContext()?.request_id ?? randomUUID(), { previous, mode });
      tracer.setMode(mode); res.json({ mode });
    } catch (e) { next(e); }
  });
  router.get('/traces/:date/:id', (req, res, next) => { try { const { date, id } = params.parse(req.params); res.json(readTrace(date, id)); } catch (e) { next(e); } });
  router.get('/traces/:date/:id/bundle', requireCapability('diagnostics.bundle'), (req, res, next) => {
    try {
      const { date, id } = params.parse(req.params), trace = readTrace(date, id);
      const bundle = buildDiagnosticBundle({ runId: trace.events.find((e: any) => e.context?.run_id)?.context?.run_id ?? 'http-request', traceId: id, traceDir: traceDirectory(date, id), errorEnvelope: trace.errors });
      res.type('application/zip').setHeader('Content-Disposition', `attachment; filename="watchdog-trace-${id}.zip"`);
      res.setHeader('X-Content-SHA256', bundle.sha256); res.send(bundle.zip);
    } catch (e) { next(e); }
  });
  return router;
}
