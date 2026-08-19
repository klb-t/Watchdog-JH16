import { Router, Request, Response, NextFunction } from 'express';
import {
  Identity, buildIdentity, authorize, Capability, RBAC, ROLES,
  SESSION_COOKIE_NAME, sessionCookieHeader, clearSessionCookieHeader,
  principalIdFor, emailFingerprint, TokenRejectedError, ForbiddenError, UnauthenticatedError,
} from '../identity';
import { PrincipalRepository } from '../db/repositories/principals';
import { Principal } from '../domain/principal';

/**
 * The authentication surface (E4.1).
 *
 * The flow is deliberately the small one: the browser obtains a Google ID
 * token via Google Identity Services and posts it here; this verifies it and
 * issues an HttpOnly session cookie. No authorisation-code exchange, no client
 * secret on the server, no token storage. The full code flow buys refresh
 * tokens and offline access, neither of which this application wants — it acts
 * only as the signed-in person, never on their behalf while they are away.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { principal?: Principal | null }
  }
}

const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface AuthDeps {
  identity: Identity;
  principals: PrincipalRepository;
  secureCookies: boolean;
  now?: () => Date;
}

/**
 * Resolves the principal for every request. Never rejects: authorisation is
 * decided per route, and a blanket rejection here would make the sign-in page
 * and the health check unreachable.
 */
export function principalMiddleware(deps: AuthDeps) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.principal = await deps.identity.resolve(req);
    } catch {
      req.principal = null;
    }
    next();
  };
}

/** Route-level gate. The only way a mutating route should be reachable. */
export function requireCapability(capability: Capability) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      authorize(req.principal ?? null, capability);
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function buildAuthRouter(deps: AuthDeps): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  /**
   * What the frontend needs to render a sign-in button, and nothing more.
   * Unauthenticated on purpose: a client cannot know how to authenticate
   * without being told what this deployment expects.
   */
  router.get('/config', (req, res) => {
    res.json({
      mode: deps.identity.mode,
      reason: deps.identity.config.reason,
      google_client_id: deps.identity.config.audience,
      // Counts only. The grant list is a list of real people and is never served.
      grant_count: Object.keys(deps.identity.config.grants).length,
      roles: ROLES,
      signed_in: !!req.principal,
    });
  });

  router.get('/me', (req, res) => {
    if (!req.principal) return res.status(401).json({ error: { code: 'unauthenticated' } });
    const role = req.principal.roles[0];
    res.json({
      principal: {
        id: req.principal.id,
        email: req.principal.email,
        roles: req.principal.roles,
        identity_provenance: req.principal.identityProvenance,
      },
      // Sent so the UI hides what the user cannot do, rather than offering
      // buttons that fail. The server still enforces every one of them.
      capabilities: RBAC[role as keyof typeof RBAC] ?? [],
    });
  });

  router.post('/session', async (req, res, next) => {
    try {
      if (deps.identity.mode !== 'oidc' || !deps.identity.verifier || !deps.identity.codec) {
        return res.status(409).json({
          error: {
            code: 'auth_not_configured',
            message: 'This instance runs without authentication; there is no session to create.',
          },
        });
      }

      const token = (req.body ?? {}).id_token;
      if (typeof token !== 'string' || token === '') {
        return res.status(400).json({ error: { code: 'validation_error', message: 'id_token is required.' } });
      }

      const verified = await deps.identity.verifier.verify(token);
      const id = principalIdFor(verified.subject);
      const at = now().toISOString();

      deps.principals.upsertOnSignIn({
        id, email: verified.email, displayName: verified.name,
        role: verified.role, identityProvenance: 'google-oidc', at,
      });

      // The session's own lifetime, not Google's: a token minted with an
      // eight-hour expiry must not silently extend the session beyond what
      // this deployment intends.
      const exp = Math.min(now().getTime() + SESSION_TTL_SECONDS * 1000, verified.expiresAt);
      const cookie = deps.identity.codec.sign({
        sub: verified.subject, email: verified.email, role: verified.role, exp,
      });

      res.setHeader('Set-Cookie',
        sessionCookieHeader(cookie, Math.floor((exp - now().getTime()) / 1000), deps.secureCookies));
      res.json({
        principal: { id, email: verified.email, roles: [verified.role] },
        expires_at: new Date(exp).toISOString(),
      });
    } catch (e) {
      if (e instanceof TokenRejectedError) {
        // The reason is safe to return — it names a configuration or grant
        // problem, never anything about the token's contents — and without it
        // "sign-in failed" is unactionable.
        return res.status(401).json({ error: { code: 'unauthenticated', message: e.message } });
      }
      next(e);
    }
  });

  router.post('/signout', (_req, res) => {
    res.setHeader('Set-Cookie', clearSessionCookieHeader(deps.secureCookies));
    res.json({ signed_out: true });
  });

  router.get('/principals', requireCapability('principal.manage'), (_req, res) => {
    res.json({
      principals: deps.principals.list().map(p => ({
        id: p.id,
        // Fingerprinted rather than listed: an admin screen does not need to
        // enumerate colleagues' addresses to show who owns what.
        email_fingerprint: p.email ? emailFingerprint(p.email) : null,
        display_name: p.display_name,
        role: p.role,
        identity_provenance: p.identity_provenance,
        created_at: p.created_at,
        last_seen_at: p.last_seen_at,
        owns_rows: deps.principals.countOwnedBy(p.id),
      })),
    });
  });

  /**
   * Hands E1's `local-user` rows to a real principal. Admin-only and explicit:
   * an automatic claim on first sign-in would give the first person to find the
   * URL everything the instance had.
   */
  router.post('/principals/migrate-local-user', requireCapability('principal.manage'), (req, res, next) => {
    try {
      const target = (req.body ?? {}).to_principal_id ?? req.principal!.id;
      res.json({ moved: deps.principals.migrateLocalUserRows(String(target)), to: target });
    } catch (e) {
      next(e);
    }
  });

  return router;
}

/** Maps the identity errors onto HTTP, for the shared error handler. */
export function authErrorStatus(e: unknown): number | null {
  if (e instanceof UnauthenticatedError || e instanceof TokenRejectedError) return 401;
  if (e instanceof ForbiddenError) return 403;
  return null;
}

export { SESSION_COOKIE_NAME, buildIdentity, PrincipalRepository };
