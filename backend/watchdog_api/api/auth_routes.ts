import { Router, Request, Response, NextFunction } from 'express';
import {
  Identity, buildIdentity, authorize, Capability, capabilitiesFor, ROLES, AUTHORIZATION_PROFILE_VERSION,
  SESSION_COOKIE_NAME, sessionCookieHeader, clearSessionCookieHeader,
  principalIdFor, emailFingerprint, TokenRejectedError, ForbiddenError, UnauthenticatedError, isRole, can, SessionPayload,
} from '../identity';
import { PrincipalRepository } from '../db/repositories/principals';
import { Principal } from '../domain/principal';
import type { AdmissionStatus } from '../../../shared/admission';
import { sameOriginMutation } from './request_security';

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
      if (deps.identity.mode === 'oidc' && req.principal) {
        const p = req.principal;
        const stored = deps.principals.get(p.id);
        const roles = p.email ? deps.principals.effectiveRoles(p.email,deps.identity.verifier?.roleFor(p.email) ?? null) : [];
        // The signed cookie proves identity. It never freezes permissions for
        // twelve hours after an owner revokes or changes a grant.
        req.principal = stored?.active && stored.email === p.email && roles.length ? { ...p, roles } : null;
      }
    } catch {
      req.principal = null;
    }
    next();
  };
}

/** Mount after /api/auth. An admission identity is not an application user. */
export function requireInstallationAccess(req: Request, _res: Response, next: NextFunction) {
  if (!req.principal) return next(new UnauthenticatedError());
  next();
}

function sessionIdentity(req: Request, deps: AuthDeps): SessionPayload | null {
  const cookie = req.headers.cookie?.split(';').map(p => p.trim()).find(p => p.startsWith(`${SESSION_COOKIE_NAME}=`));
  return deps.identity.codec?.verify(cookie?.slice(SESSION_COOKIE_NAME.length+1)) ?? null;
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
  router.use((_req,res,next) => { res.setHeader('Cache-Control','no-store');next(); });
  router.use(sameOriginMutation);
  const now = deps.now ?? (() => new Date());
  const rolesFor = (email: string) => deps.principals.effectiveRoles(email,deps.identity.verifier?.roleFor(email) ?? null);
  const admissionStatus = (req: Request): AdmissionStatus => {
    const identity = sessionIdentity(req,deps);
    if (!identity) return { verified:false,email:null,status:'anonymous',request:null };
    const request = deps.principals.requestFor(principalIdFor(identity.sub));
    const grant = deps.principals.grant(identity.email);
    const status = rolesFor(identity.email).length ? 'approved' : grant?.active === false ? 'revoked' : request?.status ?? 'unrequested';
    return { verified:true,email:identity.email,status,request };
  };

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
      admission_enabled: deps.identity.mode === 'oidc',
    });
  });

  router.get('/me', (req, res) => {
    if (!req.principal) return res.status(401).json({ error: { code: 'unauthenticated' } });
    res.json({
      principal: {
        id: req.principal.id,
        email: req.principal.email,
        roles: req.principal.roles,
        identity_provenance: req.principal.identityProvenance,
      },
      // Sent so the UI hides what the user cannot do, rather than offering
      // buttons that fail. The server still enforces every one of them.
      capabilities: capabilitiesFor(req.principal.roles),
      authorization_profile_version: AUTHORIZATION_PROFILE_VERSION,
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

      const verified = await deps.identity.verifier.verifyIdentity(token);
      const id = principalIdFor(verified.subject);
      const at = now().toISOString();

      deps.principals.recordIdentity({ id,email:verified.email,displayName:verified.name,at });
      const roles = rolesFor(verified.email);
      deps.principals.syncRoles(id,roles);

      // The session's own lifetime, not Google's: a token minted with an
      // eight-hour expiry must not silently extend the session beyond what
      // this deployment intends.
      const exp = Math.min(now().getTime() + SESSION_TTL_SECONDS * 1000, verified.expiresAt);
      const cookie = deps.identity.codec.sign({
        sub: verified.subject, email: verified.email, role: roles[0] ?? null, exp,
        ...(roles.length ? {} : { scope:'admission' as const }),
      });

      res.setHeader('Set-Cookie',
        sessionCookieHeader(cookie, Math.floor((exp - now().getTime()) / 1000), deps.secureCookies));
      res.json({
        principal: roles.length ? { id,email:verified.email,roles } : null,
        admission: roles.length ? 'approved' : 'unrequested',
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

  router.get('/admission/status',(req,res) => res.json(admissionStatus(req)));

  router.post('/admission/request',(req,res) => {
    const identity = sessionIdentity(req,deps);
    if (!identity) return res.status(401).json({ error:{ code:'unauthenticated' } });
    const reason = req.body?.reason;
    if (typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 4000) {
      return res.status(400).json({ error:{ code:'validation_error',message:'Explain your intended use in 10–4000 characters.' } });
    }
    if (rolesFor(identity.email).length) return res.status(409).json({ error:{ code:'already_admitted' } });
    res.json({ request:deps.principals.submitRequest(principalIdFor(identity.sub),identity.email,reason.trim(),now().toISOString()) });
  });

  router.post('/admission/activate',(req,res) => {
    const identity = sessionIdentity(req,deps);
    if (!identity || !deps.identity.codec) return res.status(401).json({ error:{ code:'unauthenticated' } });
    const roles = rolesFor(identity.email);
    const principal = deps.principals.get(principalIdFor(identity.sub));
    if (!roles.length || !principal?.active) return res.status(403).json({ error:{ code:'access_pending' } });
    const cookie = deps.identity.codec.sign({ sub:identity.sub,email:identity.email,role:roles[0],exp:identity.exp });
    res.setHeader('Set-Cookie',sessionCookieHeader(cookie,Math.floor((identity.exp-now().getTime())/1000),deps.secureCookies));
    res.json({ activated:true });
  });

  router.get('/admission/admin',requireCapability('principal.invite'),(_req,res) => res.json({
    requests:deps.principals.requests(),invitations:deps.principals.invitations(),grants:deps.principals.grants(),roles:ROLES,
    principals:deps.principals.list().filter(p => p.email).map(p => ({ id:p.id,email:p.email,
      roles:p.active ? rolesFor(p.email!) : [],active:!!p.active && !!rolesFor(p.email!).length })),
  }));

  router.post('/admission/grants',requireCapability('principal.manage'),(req,res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const roles = req.body?.roles;
    const active = req.body?.active;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !Array.isArray(roles) || !roles.every(isRole) || typeof active !== 'boolean' || (active && !roles.length)) {
      return res.status(400).json({ error:{ code:'validation_error',message:'A valid email, explicit role profiles and active state are required.' } });
    }
    const removingManager = can(rolesFor(email),'principal.manage') && (!active || !can(roles,'principal.manage'));
    if (deps.identity.mode === 'oidc' && removingManager && !deps.principals.list().some(p => p.active && p.email && p.email !== email && can(rolesFor(p.email),'principal.manage'))) {
      return res.status(409).json({ error:{ code:'last_access_manager',message:'Keep another active developer before removing the last access manager.' } });
    }
    res.json({ grant:deps.principals.setGrant(email,roles,active,req.principal!.id,now().toISOString()) });
  });

  router.post('/admission/invitations',requireCapability('principal.invite'),(req,res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const message = req.body?.message ?? '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof message !== 'string' || message.length > 4000) {
      return res.status(400).json({ error:{ code:'validation_error',message:'A valid email and message up to 4000 characters are required.' } });
    }
    const at = now(), expiresAt = new Date(at.getTime()+7*24*60*60*1000);
    const created = deps.principals.createInvitation(email,message,req.principal!.id,at.toISOString(),expiresAt.toISOString());
    res.status(201).json({ ...created,invite_path:`/?invite=${created.token}` });
  });

  router.post('/admission/invitations/:id/revoke',requireCapability('principal.invite'),(req,res) => {
    res.json({ revoked:deps.principals.revokeInvitation(req.params.id,req.principal!.id,now().toISOString()) });
  });

  router.post('/admission/invitations/accept',(req,res) => {
    const identity = sessionIdentity(req,deps), token = req.body?.token;
    if (!identity) return res.status(401).json({ error:{ code:'unauthenticated' } });
    if (typeof token !== 'string' || token.length > 200) return res.status(400).json({ error:{ code:'validation_error' } });
    try {
      const request = deps.principals.acceptInvitation(token,principalIdFor(identity.sub),identity.email,now().toISOString());
      res.json({ request });
    } catch {
      res.status(404).json({ error:{ code:'invitation_unavailable',message:'Invitation unavailable for this verified identity.' } });
    }
  });

  router.post('/signout', (_req, res) => {
    res.setHeader('Set-Cookie', clearSessionCookieHeader(deps.secureCookies));
    res.json({ signed_out: true });
  });

  router.get('/principals', requireCapability('principal.view'), (_req, res) => {
    res.json({
      principals: deps.principals.list().map(p => ({
        id: p.id,
        // Fingerprinted rather than listed: an admin screen does not need to
        // enumerate colleagues' addresses to show who owns what.
        email_fingerprint: p.email ? emailFingerprint(p.email) : null,
        display_name: p.display_name,
        role: p.role,
        roles: p.roles,
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
