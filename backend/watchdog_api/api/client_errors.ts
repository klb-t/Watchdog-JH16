import { json, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { z } from 'zod';
import { tracer } from '../utils/tracer';
import { RateLimiter, limitByIp } from './rate_limit';
import { sameOriginMutation } from './request_security';
import { redactText } from '../utils/redaction';

/**
 * POST /api/client-errors — browsers report their own failures (uncaught
 * errors, rejected promises, failed API calls) so a problem seen on someone's
 * phone leaves a record on the server.
 *
 * Reachable before sign-in, because the sign-in screen itself can fail. It is
 * the one unauthenticated write, so it is hardened in this order, cheapest
 * first: same origin and JSON only (`sameOriginMutation`), a per-address rate
 * limit (`RateLimiter`), then a small body limit with its own parser. The app's
 * 2 MB parser skips this path (`isClientErrorPath`), otherwise it would read
 * the body first and the small limit would never apply.
 *
 * Metadata only. Paths lose their query and fragment, URLs inside the message
 * and stack lose theirs too (invitation and sign-in links carry tokens there),
 * and the record goes through the central redaction before it is written.
 */
export const CLIENT_ERRORS_PATH = '/api/client-errors';

/** Matches what Express routes to CLIENT_ERRORS_PATH (case-insensitive, trailing slashes). */
export function isClientErrorPath(p: string): boolean {
  return p.toLowerCase().replace(/\/+$/, '') === CLIENT_ERRORS_PATH;
}

export interface ClientErrorLimits { maxBytes: number; rateLimit: number; rateWindowMs: number }

export const CLIENT_ERROR_DEFAULTS: Readonly<ClientErrorLimits> = { maxBytes: 16 * 1024, rateLimit: 30, rateWindowMs: 600_000 };

/** Settings (documented in .env.example); absent means the default, anything malformed refuses to start. */
export function clientErrorLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): ClientErrorLimits {
  const read = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
    return n;
  };
  return {
    maxBytes: read('WATCHDOG_CLIENT_ERRORS_MAX_BYTES', CLIENT_ERROR_DEFAULTS.maxBytes, 1024, 1024 * 1024),
    rateLimit: read('WATCHDOG_CLIENT_ERRORS_RATE_LIMIT', CLIENT_ERROR_DEFAULTS.rateLimit, 1, 10_000),
    rateWindowMs: read('WATCHDOG_CLIENT_ERRORS_RATE_WINDOW_SECONDS', CLIENT_ERROR_DEFAULTS.rateWindowMs / 1000, 1, 86_400) * 1000,
  };
}

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

const withoutQuery = (p: string) => p.split('?')[0].split('#')[0];
/** Drops the query and fragment of every URL or absolute path inside free text. */
export const stripUrlQueries = (text: string) => text.replace(/((?:https?:\/\/|\/)[^\s?#'"()<>]*)[?#][^\s'"()<>]*/g, '$1');

export function buildClientErrorHandlers(limits: ClientErrorLimits = clientErrorLimitsFromEnv(),
  limiter = new RateLimiter(limits.rateLimit, limits.rateWindowMs)): RequestHandler[] {
  const parse = json({ limit: limits.maxBytes });
  const body: RequestHandler = (req, res, next) => parse(req, res, (err?: any) => {
    if (!err) return next();
    if (err.status === 413 || err.type === 'entity.too.large') return res.status(413).json({ error: 'client_error_too_large', limit_bytes: limits.maxBytes });
    return res.status(400).json({ error: 'invalid_client_error' });
  });
  const store = (req: Request, res: Response, _next: NextFunction) => {
    const parsed = Report.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_client_error' });
    const r = parsed.data;
    const clean = { ...r, message: stripUrlQueries(r.message), stack: r.stack == null ? r.stack ?? null : stripUrlQueries(r.stack),
      path: withoutQuery(r.path), apiPath: r.apiPath == null ? null : withoutQuery(r.apiPath),
      received_at: new Date().toISOString(), actor_id: req.principal?.id ?? null, ip: req.ip ?? null };
    tracer.record('client-errors.jsonl', clean);
    console.log(redactText(`[CLIENT] ${r.kind} ${clean.path}${clean.apiPath ? ` api=${r.method ?? ''} ${clean.apiPath} ${r.status ?? ''}` : ''}${r.traceId ? ` trace=${r.traceId}` : ''}: ${clean.message.slice(0, 300)}`));
    res.status(204).end();
  };
  return [sameOriginMutation, limitByIp(limiter, 'client-errors'), body, store];
}
