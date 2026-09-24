import type { Request, Response, NextFunction } from 'express';
import type { AuthMode } from '../identity';

/**
 * The closed door (E4.5), for every `/api` route at once.
 *
 * Route-level capability checks already exist, but "every router remembered to
 * check" is not a property anyone can review. Two routers in fact checked only
 * that *someone* was signed in — fine while signing in required a grant, and an
 * open door the moment a verified stranger can sign in to apply. This gate makes
 * the rule structural: in accounts mode, the only API an anonymous caller or an
 * applicant can reach is the list below. Everything else needs admission, and
 * then still needs its own capability.
 *
 * Paths are relative to the `/api` mount.
 */
export const OPEN_ENDPOINTS: ReadonlySet<string> = new Set([
  'GET /auth/config',
  'GET /auth/me',
  'POST /auth/session',
  'POST /auth/email/start',
  'POST /auth/email/verify',
  'POST /auth/operator/verify',
  'POST /auth/signout',
  'POST /auth/signout-everywhere',
  'POST /auth/invitations/preview',
  'POST /auth/invitations/redeem',
  'GET /auth/application',
  'POST /auth/application',
  'POST /auth/application/withdraw',
]);

export function admissionGate(mode: AuthMode) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (mode === 'local') return next();
    if (OPEN_ENDPOINTS.has(`${req.method} ${req.path.replace(/\/+$/, '') || '/'}`)) return next();
    if (!req.principal) {
      return res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in to continue.' } });
    }
    if (req.principal.roles.length === 0) {
      return res.status(403).json({ error: { code: 'not_admitted',
        message: 'You are signed in but have not been given access to this installation yet.' } });
    }
    next();
  };
}

/**
 * Refuses state-changing requests from other sites. The session cookie is
 * SameSite=Lax already; this is the second lock, and unlike the per-router
 * `sameOriginMutation` it does not insist on JSON, so it can sit in front of
 * every route including uploads.
 */
export function crossSiteGuard(publicOrigin: string | null) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      return res.status(403).json({ error: { code: 'cross_site_request', message: 'Cross-site requests are refused.' } });
    }
    const origin = req.headers.origin;
    if (!origin) return next();
    let host: string;
    try { host = new URL(origin).host; } catch { host = ''; }
    const allowed = host !== '' && (host === req.headers.host || (publicOrigin !== null && origin === publicOrigin));
    if (!allowed) {
      return res.status(403).json({ error: { code: 'cross_site_request', message: 'Cross-site requests are refused.' } });
    }
    next();
  };
}
