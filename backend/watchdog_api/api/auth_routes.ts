import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import {
  Identity, buildIdentity, authorize, Capability, capabilitiesFor, ROLES, AUTHORIZATION_PROFILE_VERSION,
  SESSION_COOKIE_NAME, sessionCookieHeader, clearSessionCookieHeader,
  emailFingerprint, TokenRejectedError, ForbiddenError, UnauthenticatedError,
} from '../identity';
import { grantableRoles } from '../../../shared/authorization';
import { PrincipalRepository } from '../db/repositories/principals';
import { AdmissionRepository } from '../db/repositories/admission';
import { AdmissionService, AdmissionError, AdmissionActor, APPLICATION_LIMITS } from '../identity/admission';
import { SignInService, SIGN_IN_LIMITS } from '../identity/sign_in';
import { MailService } from '../mail';
import { Principal } from '../domain/principal';
import { tracer } from '../utils/tracer';
import { RateLimiter, limitByIp } from './rate_limit';

/**
 * The authentication and admission surface (E4.1, E4.5).
 *
 * Sign-in proves an address. Admission — what that address may do — is a
 * separate, live decision (`identity/admission.ts`). The routes here therefore
 * sort every caller into one of three states and give each exactly one thing:
 *
 *  - anonymous → the sign-in methods;
 *  - signed in, not admitted (an *applicant*) → an application form and its
 *    status, and nothing that touches research data;
 *  - admitted (a *member*) → the application, gated per capability.
 *
 * The gate that enforces the middle state for every other route lives in
 * `admission_gate.ts`; the list of routes an applicant may reach is there too.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { principal?: Principal | null }
  }
}

const SESSION_TTL_SECONDS = 12 * 60 * 60;
const requestId = () => tracer.getContext()?.request_id ?? randomUUID();

export interface AuthDeps {
  identity: Identity;
  principals: PrincipalRepository;
  secureCookies: boolean;
  /** Present in accounts mode. */
  admission?: AdmissionService;
  admissionRepository?: AdmissionRepository;
  signIn?: SignInService;
  mail?: MailService;
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

export function actorOf(req: Request): AdmissionActor {
  if (!req.principal) throw new UnauthenticatedError();
  return { principalId: req.principal.id, email: req.principal.email, roles: req.principal.roles, requestId: requestId() };
}

/** Runs a handler and turns an `AdmissionError` into its own status and message. */
export function admissionRoute(fn: (req: Request, res: Response) => unknown | Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve().then(() => fn(req, res)).catch(error => {
      if (error instanceof AdmissionError) {
        return res.status(error.status).json({ error: { code: error.code, message: error.message } });
      }
      next(error);
    });
  };
}

function applicationView(a: ReturnType<AdmissionRepository['application']> & object) {
  return {
    id: a.id, status: a.status, submitted_at: a.submitted_at, decided_at: a.decided_at,
    decision_note: a.decision_note, reason: a.reason, affiliation: a.affiliation, display_name: a.display_name,
    requested_roles: JSON.parse(a.requested_roles_json),
  };
}

export function buildAuthRouter(deps: AuthDeps): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());
  const accounts = deps.identity.mode === 'accounts';

  // Per-address limits live in the database (SignInService); these bound what
  // one client can throw at the public endpoints regardless of address.
  const signInLimiter = new RateLimiter(20, 15 * 60_000);
  const previewLimiter = new RateLimiter(60, 15 * 60_000);
  const applicationLimiter = new RateLimiter(10, 60 * 60_000);

  const needAccounts = (res: Response) => {
    res.status(409).json({ error: { code: 'auth_not_configured',
      message: 'This instance runs without authentication; there is no session to create.' } });
  };

  /** Issues the session cookie for a principal at its current session generation. */
  const issueSession = (res: Response, principalId: string, sessionVersion: number, capMs?: number) => {
    const t = now().getTime();
    const exp = Math.min(t + SESSION_TTL_SECONDS * 1000, capMs ?? Number.POSITIVE_INFINITY);
    const cookie = deps.identity.codec!.sign({ pid: principalId, sv: sessionVersion, iat: t, exp });
    res.setHeader('Set-Cookie', sessionCookieHeader(cookie, Math.floor((exp - t) / 1000), deps.secureCookies));
    return new Date(exp).toISOString();
  };

  const signedIn = (res: Response, provider: 'google' | 'email' | 'operator', subject: string, email: string,
    displayName: string | null, capMs?: number) => {
    const result = deps.admission!.signIn({ provider, subject, email, displayName });
    if (!result) {
      return res.status(403).json({ error: { code: 'blocked',
        message: 'This address has been blocked on this installation.' } });
    }
    const expiresAt = issueSession(res, result.principalId, result.sessionVersion, capMs);
    const roles = deps.admission!.effective(email).roles;
    res.json({ principal: { id: result.principalId, email, roles }, admission: roles.length > 0 ? 'member' : 'applicant',
      expires_at: expiresAt });
  };

  /**
   * Everything a client needs to draw the sign-in screen, and nothing more.
   * Unauthenticated on purpose: a client cannot know how to authenticate
   * without being told what this deployment expects.
   */
  router.get('/config', admissionRoute(async (req, res) => {
    const mail = deps.mail ? await deps.mail.availability() : null;
    res.json({
      mode: deps.identity.mode,
      reason: deps.identity.config.reason,
      instance_name: deps.mail?.messages.instance_name ?? 'WatchDog',
      methods: {
        google: accounts && deps.identity.verifier ? { client_id: deps.identity.config.audience } : null,
        email_code: accounts && !!mail?.available,
      },
      // Mode kept under its old key for clients written before E4.5.
      google_client_id: deps.identity.config.audience,
      // Counts only. Who may sign in is a list of real people and is never served.
      grant_count: Object.keys(deps.identity.config.grants).length,
      roles: ROLES,
      signed_in: !!req.principal,
      application_limits: APPLICATION_LIMITS,
    });
  }));

  router.get('/me', (req, res) => {
    if (!req.principal) return res.status(401).json({ error: { code: 'unauthenticated' } });
    const roles = req.principal.roles;
    res.json({
      principal: {
        id: req.principal.id,
        email: req.principal.email,
        roles,
        identity_provenance: req.principal.identityProvenance,
      },
      admission: deps.identity.mode === 'local' ? 'local' : roles.length > 0 ? 'member' : 'applicant',
      // Sent so the UI hides what the user cannot do, rather than offering
      // buttons that fail. The server still enforces every one of them.
      capabilities: capabilitiesFor(roles),
      grantable_roles: grantableRoles(roles),
      authorization_profile_version: AUTHORIZATION_PROFILE_VERSION,
    });
  });

  // ------------------------------------------------------------ sign-in methods

  router.post('/session', limitByIp(signInLimiter, 'google'), async (req, res, next) => {
    try {
      if (!accounts || !deps.identity.verifier || !deps.admission) return needAccounts(res);
      const token = (req.body ?? {}).id_token;
      if (typeof token !== 'string' || token === '') {
        return res.status(400).json({ error: { code: 'validation_error', message: 'id_token is required.' } });
      }
      const verified = await deps.identity.verifier.verifyIdentity(token);
      // The session's own lifetime, not Google's: a token minted with a long
      // expiry must not silently extend the session beyond what this deployment
      // intends — and a short one caps it.
      signedIn(res, 'google', verified.subject, verified.email, verified.name, verified.expiresAt);
    } catch (e) {
      if (e instanceof TokenRejectedError) {
        // The reason names a configuration problem, never token contents, and
        // without it "sign-in failed" is unactionable.
        return res.status(401).json({ error: { code: 'unauthenticated', message: e.message } });
      }
      if (e instanceof AdmissionError) return res.status(e.status).json({ error: { code: e.code, message: e.message } });
      next(e);
    }
  });

  router.post('/email/start', limitByIp(signInLimiter, 'email-start'), admissionRoute(async (req, res) => {
    if (!accounts || !deps.signIn) return needAccounts(res);
    const { expiresAt } = await deps.signIn.startEmailCode(req.body?.email, req.body?.language);
    res.status(202).json({ sent: true, expires_at: expiresAt, code_length: SIGN_IN_LIMITS.codeLength });
  }));

  router.post('/email/verify', limitByIp(signInLimiter, 'email-verify'), admissionRoute((req, res) => {
    if (!accounts || !deps.signIn) return needAccounts(res);
    const email = deps.signIn.verifyEmailCode(req.body?.email, req.body?.code);
    signedIn(res, 'email', email, email, null);
  }));

  router.post('/operator/verify', limitByIp(signInLimiter, 'operator'), admissionRoute((req, res) => {
    if (!accounts || !deps.signIn) return needAccounts(res);
    const email = deps.signIn.verifyOperatorLink(req.body?.token);
    signedIn(res, 'operator', email, email, null);
  }));

  router.post('/signout', (_req, res) => {
    res.setHeader('Set-Cookie', clearSessionCookieHeader(deps.secureCookies));
    res.json({ signed_out: true });
  });

  /** Ends every session of this person on every device, including this one. */
  router.post('/signout-everywhere', (req, res) => {
    if (req.principal && accounts && deps.admissionRepository) deps.admissionRepository.bumpSessionVersion(req.principal.id);
    res.setHeader('Set-Cookie', clearSessionCookieHeader(deps.secureCookies));
    res.json({ signed_out: true, everywhere: !!req.principal });
  });

  // ------------------------------------------------------------ invitations (invitee side)

  router.post('/invitations/preview', limitByIp(previewLimiter, 'preview'), admissionRoute((req, res) => {
    if (!accounts || !deps.admission) return needAccounts(res);
    res.json({ invitation: deps.admission.preview(req.body?.token), signed_in_as: req.principal?.email ?? null });
  }));

  router.post('/invitations/redeem', limitByIp(previewLimiter, 'redeem'), admissionRoute((req, res) => {
    if (!accounts || !deps.admission) return needAccounts(res);
    const result = deps.admission.redeem(actorOf(req), req.body?.token);
    res.json({ redeemed: true, roles: result.roles, already_redeemed: result.alreadyRedeemed });
  }));

  // ------------------------------------------------------------ applications (applicant side)

  router.get('/application', admissionRoute((req, res) => {
    if (!accounts || !deps.admission) return needAccounts(res);
    res.json({ applications: deps.admission.myApplications(actorOf(req)).map(applicationView) });
  }));

  router.post('/application', limitByIp(applicationLimiter, 'apply'), admissionRoute((req, res) => {
    if (!accounts || !deps.admission) return needAccounts(res);
    const a = deps.admission.submitApplication(actorOf(req), {
      reason: req.body?.reason, affiliation: req.body?.affiliation, displayName: req.body?.display_name,
      requestedRoles: req.body?.requested_roles,
    });
    res.status(201).json({ application: applicationView(a) });
  }));

  router.post('/application/withdraw', admissionRoute((req, res) => {
    if (!accounts || !deps.admission) return needAccounts(res);
    res.json({ application: applicationView(deps.admission.withdrawApplication(actorOf(req))) });
  }));

  // ------------------------------------------------------------ principals (pre-E4.5 surfaces)

  router.get('/principals', requireCapability('principal.view'), (_req, res) => {
    res.json({
      principals: deps.principals.list().map(p => ({
        id: p.id,
        // Fingerprinted rather than listed: this listing predates admission and
        // is about ownership. People and their addresses live in /api/access.
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
   * Hands E1's `local-user` rows to a real principal. Explicit and gated: an
   * automatic claim on first sign-in would give the first person to find the
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
  if (e instanceof AdmissionError) return e.status;
  return null;
}

export { SESSION_COOKIE_NAME, buildIdentity, PrincipalRepository };
