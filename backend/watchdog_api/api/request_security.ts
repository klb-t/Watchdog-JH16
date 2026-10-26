import type { Request, Response, NextFunction } from 'express';

const crossOrigin = (req: Request) => {
  const origin = req.headers.origin, fetchSite = req.headers['sec-fetch-site'];
  return fetchSite === 'cross-site' || (origin && (() => { try { return new URL(origin).host !== req.headers.host; } catch { return true; } })());
};

/** Browser mutations must target this host and use JSON; no proxy header can override the host check. */
export function sameOriginMutation(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (crossOrigin(req)) return res.status(403).json({ error: 'CROSS_ORIGIN_MUTATION' });
  if (!req.is('application/json')) return res.status(415).json({ error: 'JSON_REQUIRED' });
  next();
}

/**
 * The same host check for a file upload. Only content types a cross-site form
 * cannot send without a CORS preflight are accepted, so the JSON rule's CSRF
 * protection holds (text/plain, form encodings and multipart stay refused).
 */
export function sameOriginUpload(types: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (crossOrigin(req)) return res.status(403).json({ error: 'CROSS_ORIGIN_MUTATION' });
    if (!types.some(t => req.is(t))) return res.status(415).json({ error: 'UNSUPPORTED_UPLOAD_TYPE', accepted: types });
    next();
  };
}
