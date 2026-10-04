import { Router, json, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { tracer } from '../utils/tracer';
import { RateLimiter, limitByIp } from './rate_limit';
import { redactText } from '../utils/redaction';

/**
 * POST /api/client-errors — browsers report their own failures (uncaught
 * errors, rejected promises, failed API calls) so a problem seen on someone's
 * phone leaves a record on the server. Reachable before sign-in, because the
 * sign-in screen itself can fail; therefore small, strict, same-origin only
 * and rate-limited. Metadata only: no request bodies, queries or credentials.
 */
const Report = z.object({
  kind: z.enum(['error', 'unhandledrejection', 'http', 'network']),
  message: z.string().max(2000),
  stack: z.string().max(8000).nullable().optional(),
  path: z.string().max(500),
  apiPath: z.string().max(500).nullable().optional(),
  method: z.string().max(10).nullable().optional(),
  status: z.number().int().nullable().optional(),
  traceId: z.string().max(64).nullable().optional(),
  at: z.string().max(40),
  userAgent: z.string().max(400).nullable().optional(),
}).strict();

export function buildClientErrorRouter(limiter = new RateLimiter(30, 10 * 60_000)) {
  const router = Router();
  router.post('/', json({ limit: '16kb' }), (req: Request, res: Response, next: NextFunction) => {
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'cross_site_request' });
    next();
  }, limitByIp(limiter, 'client-errors'), (req: Request, res: Response) => {
    const parsed = Report.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_client_error' });
    const r = parsed.data;
    // Only the path: a query string can carry tokens (e.g. invitation fragments are never sent, queries might be).
    const clean = { ...r, path: r.path.split('?')[0].split('#')[0], apiPath: r.apiPath?.split('?')[0] ?? null,
      received_at: new Date().toISOString(), actor_id: req.principal?.id ?? null, ip: req.ip ?? null };
    tracer.record('client-errors.jsonl', clean);
    console.log(redactText(`[CLIENT] ${r.kind} ${clean.path}${r.apiPath ? ` api=${r.method ?? ''} ${clean.apiPath} ${r.status ?? ''}` : ''}${r.traceId ? ` trace=${r.traceId}` : ''}: ${r.message.slice(0, 300)}`));
    res.status(204).end();
  });
  return router;
}
