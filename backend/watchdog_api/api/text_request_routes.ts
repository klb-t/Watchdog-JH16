import { Router } from 'express';
import { z } from 'zod';
import { requireCapability } from './auth_routes';
import { sameOriginMutation } from './automation_routes';
import { AutomationError } from '../db/repositories/automation';
import type { AuditRepository } from '../db/repositories/audit';
import type { RunRepository } from '../db/repositories/runs';
import type { TextRequestRepository } from '../db/repositories/text_requests';
import type { TextRequests } from '../services/text_requests';

/** Requests from a pasted text (services/text_requests.ts). */
export function buildTextRequestRouter(service: TextRequests, repo: TextRequestRepository, runs: RunRepository, audit: AuditRepository) {
  const router = Router();
  const handle = (fn: (req: any, res: any) => Promise<any> | any) => async (req: any, res: any, next: any) => {
    try { await fn(req, res); } catch (e) { if (e instanceof AutomationError) return res.status((e as any).status ?? 409).json({ error: 'request_refused', message: e.message }); next(e); } };
  const withRuns = (r: any) => ({ ...r, runs: r.events.flatMap((e: any) => (e.body.runIds ?? []).map((id: string) => { const run = runs.getRun(id); return { action: e.body.action, run_id: id, status: run?.status ?? 'unknown' }; })) });
  const Text = z.object({ text: z.string().min(1).max(20000) }).strict();
  router.get('/', requireCapability('run.view'), handle((req, res) => res.json({ requests: repo.list(req.principal!.id) })));
  router.post('/preview', requireCapability('run.create'), sameOriginMutation, handle(async (req, res) => res.json({ analysis: await service.preview(Text.parse(req.body).text) })));
  router.post('/', requireCapability('run.create'), sameOriginMutation, handle(async (req, res) => {
    const b = z.object({ text: z.string().min(1).max(20000), expectedPlanHash: z.string().regex(/^[a-f0-9]{64}$/), consent: z.literal(true) }).strict().parse(req.body);
    const r = await service.submit(req.principal!.id, b.text, b.expectedPlanHash);
    audit.append(req.principal!.id, 'text_request.submit', 'text_request', r.id, 'text-request', { plan_hash: b.expectedPlanHash, target: r.body.analysis.target?.target_id ?? null });
    res.status(201).json({ request: withRuns(r) });
  }));
  router.get('/:id', requireCapability('run.view'), handle((req, res) => { const r = repo.get(req.principal!.id, req.params.id); if (!r) return res.status(404).json({ error: 'NOT_FOUND' }); res.setHeader('Cache-Control', 'no-store'); res.json({ request: withRuns(r) }); }));
  router.post('/:id/accept', requireCapability('run.create'), sameOriginMutation, handle((req, res) => {
    const b = z.object({ action: z.string().min(1).max(80), consent: z.literal(true) }).strict().parse(req.body);
    const r = service.accept(req.principal!.id, req.params.id, b.action);
    audit.append(req.principal!.id, 'text_request.accept', 'text_request', req.params.id, 'text-request-accept', { action: b.action });
    res.json({ request: withRuns(r) });
  }));
  router.post('/:id/answer', requireCapability('run.create'), sameOriginMutation, handle((req, res) => {
    const b = z.object({ question: z.string().min(1).max(80), answer: z.string().trim().min(1).max(4000) }).strict().parse(req.body);
    res.json({ request: withRuns(service.answer(req.principal!.id, req.params.id, b.question, b.answer)) });
  }));
  return router;
}
