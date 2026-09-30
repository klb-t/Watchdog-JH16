import type { Request, Response, NextFunction } from 'express';

/** Browser mutations must target this host and use JSON; no proxy header can override the host check. */
export function sameOriginMutation(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin, fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite === 'cross-site' || (origin && (() => { try { return new URL(origin).host !== req.headers.host; } catch { return true; } })()))
    return res.status(403).json({ error: 'CROSS_ORIGIN_MUTATION' });
  if (!req.is('application/json')) return res.status(415).json({ error: 'JSON_REQUIRED' });
  next();
}
