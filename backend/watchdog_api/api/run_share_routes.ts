import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { requireCapability } from './auth_routes';
import { sameOriginMutation } from './automation_routes';
import { AdmissionError } from '../identity/admission';
import type { RunShares } from '../services/run_shares';

/** Read-only run sharing (services/run_shares.ts). The link token is returned once, at creation. */
export function buildRunShareRouter(shares: RunShares) {
  const router = Router();
  const actor = (req: any) => ({ id: req.principal!.id as string, email: (req.principal!.email ?? null) as string | null });
  const handle = (fn: (req: any, res: any) => any) => (req: any, res: any, next: any) => {
    try { fn(req, res); } catch (e) { if (e instanceof AdmissionError) return res.status(e.status).json({ error: { code: e.code, message: e.message } }); next(e); } };
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/', requireCapability('run.view'), handle((req, res) => res.json({ shares: shares.list(actor(req)) })));
  router.post('/', requireCapability('run.create'), sameOriginMutation, handle((req, res) => {
    const r = shares.share(actor(req), { runIds: req.body?.run_ids, kind: req.body?.kind, target: req.body?.target, note: req.body?.note, expiresInDays: req.body?.expires_in_days }, randomUUID());
    res.status(201).json({ ...r, link_path: r.link_token ? `/share#t=${r.link_token}` : null });
  }));
  router.post('/redeem', requireCapability('run.view'), sameOriginMutation, handle((req, res) => res.json(shares.redeemLink(actor(req), req.body?.token, randomUUID()))));
  router.post('/:id/revoke', requireCapability('run.view'), sameOriginMutation, handle((req, res) => res.json(shares.revoke(actor(req), req.params.id, randomUUID()))));
  return router;
}
