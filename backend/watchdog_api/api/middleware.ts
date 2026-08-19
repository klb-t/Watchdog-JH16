import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { tracer } from '../utils/tracer';
import { randomUUID } from 'node:crypto';
import { authErrorStatus } from './auth_routes';

export function traceMiddleware(req: Request, res: Response, next: NextFunction) {
  const traceId = (req.headers['x-trace-id'] as string) || randomUUID();
  tracer.runWithSpan('http_request', `${req.method} ${req.path}`, () => {
    tracer.emit('INCOMING_REQUEST', { method: req.method, path: req.path, query: req.query });
    res.setHeader('x-trace-id', traceId);
    next();
  });
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  tracer.emit('REQUEST_ERROR', { error: err.message, stack: err.stack });
  
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      details: err.issues
    });
  }

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
    message: err.message
  });
}
