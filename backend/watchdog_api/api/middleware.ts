import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { tracer } from '../utils/tracer';
import { randomUUID } from 'node:crypto';
import { authErrorStatus } from './auth_routes';
import { redact, redactText } from '../utils/redaction';

export function traceMiddleware(req: Request, res: Response, next: NextFunction) {
  const supplied = req.headers['x-trace-id'];
  const traceId = typeof supplied === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(supplied)
    ? supplied : randomUUID();
  void tracer.runWithSpan('http_request', `${req.method} ${req.path}`, () => new Promise<void>(resolve => {
    tracer.emit('INCOMING_REQUEST', { method: req.method, path: req.path });
    res.setHeader('x-trace-id', traceId);
    res.once('finish', resolve);
    res.once('close', resolve);
    next();
  }), { trace_id: traceId, request_id: randomUUID() }).catch(next);
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
