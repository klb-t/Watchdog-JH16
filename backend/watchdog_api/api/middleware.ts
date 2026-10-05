import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { tracer } from '../utils/tracer';
import { randomUUID } from 'node:crypto';
import { authErrorStatus } from './auth_routes';
import { redact, redactText } from '../utils/redaction';
import { markActivity, READINESS_PATHS } from '../utils/activity';

/** Requests at least this slow are printed even when they succeed. */
const SLOW_REQUEST_MS = Number(process.env.WATCHDOG_SLOW_REQUEST_MS ?? 2000);

export function traceMiddleware(req: Request, res: Response, next: NextFunction) {
  const supplied = req.headers['x-trace-id'];
  const traceId = typeof supplied === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(supplied)
    ? supplied : randomUUID();
  // Captured now: inside a mounted router req.path is relative to the mount point.
  const started = process.hrtime.bigint(), requestId = randomUUID(), fullPath = req.originalUrl.split('?')[0];
  let failure: { code: unknown; message: unknown } | null = null;
  // Route helpers answer domain errors (409, 404…) themselves, so they never reach
  // errorHandler. Capture the error code/message they send, and add the trace ID
  // to every error body so a person can quote it.
  const json = res.json.bind(res);
  res.json = (body: any) => {
    if (res.statusCode >= 400 && body && typeof body === 'object' && !Array.isArray(body)) {
      const code = typeof body.error === 'object' ? body.error?.code : body.error;
      const message = body.message ?? (typeof body.error === 'object' ? body.error?.message : undefined);
      failure = { code: code ?? null, message: typeof message === 'string' ? message.slice(0, 500) : null };
      body = { ...body, trace_id: traceId };
    }
    return json(body);
  };
  let logged = false;
  const finish = (aborted: boolean) => {
    if (logged) return; logged = true;
    const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
    if (!fullPath.startsWith('/api/') && res.statusCode < 400) return;
    const entry = { at: new Date().toISOString(), trace_id: traceId, request_id: requestId, method: req.method, path: fullPath,
      status: aborted && !res.writableEnded ? null : res.statusCode, duration_ms: durationMs, aborted: aborted && !res.writableEnded,
      actor_id: req.principal?.id ?? null, ...(failure ? { error: failure } : {}) };
    if (req.principal && fullPath.startsWith('/api/') && !READINESS_PATHS.has(`${req.method} ${fullPath}`)) markActivity('request');
    tracer.emit('REQUEST_COMPLETE', entry);
    tracer.record('requests.jsonl', entry);
    if (entry.status === null || entry.status >= 400 || durationMs >= SLOW_REQUEST_MS) {
      const f = failure as { code: unknown; message: unknown } | null;
      console.log(redactText(`[HTTP] ${entry.status ?? 'ABORTED'} ${req.method} ${fullPath} ${durationMs}ms trace=${traceId}${f ? ` ${String(f.code)}: ${String(f.message)}` : ''}`));
    }
  };
  void tracer.runWithSpan('http_request', `${req.method} ${req.path}`, () => new Promise<void>(resolve => {
    tracer.emit('INCOMING_REQUEST', { method: req.method, path: req.path });
    res.setHeader('x-trace-id', traceId);
    res.once('finish', () => { finish(false); resolve(); });
    res.once('close', () => { finish(true); resolve(); });
    next();
  }), { trace_id: traceId, request_id: requestId }).catch(next);
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  // JSON parser errors can quote submitted secrets before the vault can register
  // their values. Never log or echo the parser's request fragment.
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'REQUEST_TOO_LARGE', message: 'Request body exceeds the server limit; use a smaller source excerpt or batch.' });
  tracer.emitError(err, true);
  
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      details: redact(err.issues)
    });
  }

  if (err?.code === 'validation_error') return res.status(400).json({ error: err.code, message: err.message });

  // Identity failures are client-correctable and must not be reported as
  // internal errors: a 500 tells the caller to file a bug, when the answer is
  // 'sign in' or 'ask for a role'.
  const authStatus = authErrorStatus(err);
  if (authStatus !== null) {
    return res.status(authStatus).json({
      error: err.code ?? (authStatus === 403 ? 'forbidden' : 'unauthenticated'),
      message: err.message,
    });
  }

  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: redactText(String(err.message))
  });
}
