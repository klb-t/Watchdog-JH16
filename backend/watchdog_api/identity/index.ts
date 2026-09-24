import {
  GoogleOidcVerifier, JwksCache, JwksTransport, SessionIdentityProvider, SessionCodec,
  OidcConfig, TokenRejectedError,
} from './oidc';
import type { AdmissionService } from './admission';
import type { AdmissionRepository } from '../db/repositories/admission';
import { Role, isRole, Capability, can, ForbiddenError, UnauthenticatedError, ROLES } from './roles';
import { Principal, LOCAL_USER, LocalUserIdentityProvider } from '../domain/principal';
import { SecretStore, secretStore as defaultSecretStore } from '../secrets';

export * from './roles';
export * from './oidc';

/**
 * Wiring identity into the process (E4.1).
 *
 * Two modes, and the difference between them is load-bearing:
 *
 *  - **local** — no authentication, every request is `local-user` with the
 *    `dev` role. This is E1's behaviour and it stays the default for local
 *    work, because requiring an OAuth client to run the test suite is the
 *    infrastructure-before-flow trap `CLAUDE.md` §2 names.
 *  - **accounts** (E4.5) — people sign in (Google, or a one-time code sent to
 *    their address), and what they may do comes from admission grants that are
 *    re-read on every request. Called `oidc` before E4.5, when Google was the
 *    only method and the environment grant list the only admission.
 *
 * The dangerous state is local mode on a public URL. That is prevented by
 * `assertAuthSafeForEnvironment`, which refuses to start rather than warning:
 * a warning in a Cloud Run log is a warning nobody reads, and the failure it
 * describes is an open instance.
 */

export type AuthMode = 'local' | 'accounts';

export interface AuthConfig {
  readonly mode: AuthMode;
  readonly audience: string | null;
  readonly grants: Readonly<Record<string, Role>>;
  /** Why the mode is what it is — surfaced in the API so it is inspectable. */
  readonly reason: string;
}

export class AuthConfigError extends Error {
  readonly code = 'configuration_error';
  constructor(detail: string) {
    super(detail);
    this.name = 'AuthConfigError';
  }
}

/**
 * Grants live in an environment variable rather than a versioned config file,
 * unlike everything else in this project.
 *
 * Deliberate exception to rule 3: the grant list is a list of real people's
 * email addresses. Rule 3 exists so that *scientific* parameters are inspectable
 * and hashed; committing personal data to git to satisfy it would trade a real
 * privacy problem for a nominal reproducibility gain. Who may sign in is not a
 * parameter of the science.
 */
export function parseGrants(raw: string | undefined): Record<string, Role> {
  if (!raw || raw.trim() === '') return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AuthConfigError(
      'WATCHDOG_GRANTS must be JSON, e.g. {"you@example.com":"admin","@yourlab.org":"researcher"}.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AuthConfigError('WATCHDOG_GRANTS must be a JSON object mapping address or @domain to a role.');
  }

  const out: Record<string, Role> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isRole(v)) {
      throw new AuthConfigError(
        `WATCHDOG_GRANTS: '${k}' is granted '${String(v)}', which is not a role. Valid roles: ${ROLES.join(', ')}.`);
    }
    const key = k.trim().toLowerCase();
    if (key === '' || key === '*' || key === '@') {
      throw new AuthConfigError(
        `WATCHDOG_GRANTS: '${k}' would grant access to everyone. There is no wildcard; list addresses or an @domain.`);
    }
    if (!key.includes('@')) {
      throw new AuthConfigError(`WATCHDOG_GRANTS: '${k}' is neither an email address nor an @domain suffix.`);
    }
    out[key] = v;
  }
  return out;
}

/**
 * Accounts mode is on when Google sign-in is configured or when it is asked for
 * explicitly (`WATCHDOG_AUTH=accounts`, for installations that sign people in by
 * emailed code only).
 *
 * An empty `WATCHDOG_GRANTS` is no longer an error, as it was in E4.1. Then it
 * meant "nobody can ever get in". Now the default is closed rather than open —
 * a stranger can only apply — and the first administrator can be created from
 * the server shell (`watchdog-admin grant`). The reason string says so, so the
 * state is inspectable rather than silent.
 */
export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const audience = env.GOOGLE_OAUTH_CLIENT_ID?.trim() || null;
  const grants = parseGrants(env.WATCHDOG_GRANTS);
  const requested = env.WATCHDOG_AUTH?.trim().toLowerCase();
  if (requested && requested !== 'accounts' && requested !== 'local') {
    throw new AuthConfigError(`WATCHDOG_AUTH must be 'accounts' or 'local', not '${env.WATCHDOG_AUTH}'.`);
  }

  if (requested === 'local' || (!audience && requested !== 'accounts')) {
    return { mode: 'local', grants: {}, audience: null,
      reason: 'No sign-in is configured (GOOGLE_OAUTH_CLIENT_ID unset, WATCHDOG_AUTH not "accounts"), so every request is the local user.' };
  }
  const methods = [audience ? 'Google' : null, 'emailed code (when mail is configured)'].filter(Boolean).join(' and ');
  const bootstrap = Object.keys(grants).length;
  return { mode: 'accounts', audience, grants,
    reason: `Sign-in by ${methods}. ${bootstrap > 0 ? `${bootstrap} operator grant(s) from the environment.`
      : 'No operator grant in the environment: create the first administrator with `watchdog-admin grant`.'}` };
}

/**
 * The startup gate. Called before the server listens.
 *
 * `WATCHDOG_ALLOW_OPEN_INSTANCE` exists because a deliberately public
 * read-only demo is a legitimate deployment (open question Q7), but it has to
 * be typed out on purpose — it cannot be reached by forgetting a variable.
 */
export function assertAuthSafeForEnvironment(
  config: AuthConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const isProduction = env.NODE_ENV === 'production';
  if (!isProduction || config.mode === 'accounts') return;
  if (env.WATCHDOG_ALLOW_OPEN_INSTANCE === 'true') return;

  throw new AuthConfigError(
    'Refusing to start: NODE_ENV=production with no authentication configured, which would publish an ' +
    'instance where anyone can start runs and approve methods.\n' +
    '  Fix by setting WATCHDOG_AUTH=accounts (and optionally GOOGLE_OAUTH_CLIENT_ID) with SESSION_SIGNING_KEY.\n' +
    '  Or, if an open instance is genuinely intended, set WATCHDOG_ALLOW_OPEN_INSTANCE=true.');
}

const defaultJwksTransport: JwksTransport = (url) => fetch(url) as any;

export interface Identity {
  readonly mode: AuthMode;
  readonly config: AuthConfig;
  /** Present only in accounts mode with Google configured. */
  readonly verifier: GoogleOidcVerifier | null;
  /** Present only in accounts mode. */
  readonly codec: SessionCodec | null;
  resolve(request: unknown): Promise<Principal | null>;
}

/** In local mode the single principal holds `dev`, matching E1's behaviour. */
export const LOCAL_PRINCIPAL: Principal = { ...LOCAL_USER, roles: ['dev'] };

export interface AdmissionWiring {
  readonly service: AdmissionService;
  readonly repository: AdmissionRepository;
}

/**
 * The per-request lookup that makes revocation immediate: an inactive
 * principal, or a cookie from an older session generation, resolves to nobody;
 * roles come from `AdmissionService.effective`, never from the cookie.
 */
export function sessionLookup(admission: AdmissionWiring) {
  return (principalId: string, sessionVersion: number): Principal | null => {
    const row = admission.repository.principal(principalId);
    if (!row || !row.active || row.session_version !== sessionVersion || !row.email) return null;
    const email = row.email.toLowerCase();
    return {
      id: row.id,
      email,
      roles: admission.service.effective(email).roles,
      identityProvenance: 'session',
    };
  };
}

export async function buildIdentity(
  env: NodeJS.ProcessEnv = process.env,
  secrets: SecretStore = defaultSecretStore,
  jwksTransport: JwksTransport = defaultJwksTransport,
  admission?: AdmissionWiring,
): Promise<Identity> {
  const config = readAuthConfig(env);

  if (config.mode === 'local') {
    const local = new LocalUserIdentityProvider();
    return {
      mode: 'local', config, verifier: null, codec: null,
      resolve: async (request) => ({ ...(await local.resolve(request)), roles: ['dev'] }),
    };
  }

  // The operator-fixable problem is reported before the wiring one.
  const handle = await secrets.resolve('env:SESSION_SIGNING_KEY');
  if (!handle.isPresent) {
    throw new AuthConfigError(
      'Sign-in is configured but SESSION_SIGNING_KEY is missing, so sessions cannot be signed. ' +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  }
  if (!admission) {
    throw new AuthConfigError('Accounts mode needs the admission service; this is a wiring error, not a configuration one.');
  }
  const codec = handle.use(k => new SessionCodec(k));
  const verifier = config.audience
    ? new GoogleOidcVerifier({ audience: config.audience, grants: config.grants } as OidcConfig, new JwksCache(jwksTransport))
    : null;
  const provider = new SessionIdentityProvider(codec, sessionLookup(admission));

  return {
    mode: 'accounts', config, verifier, codec,
    resolve: (request) => provider.resolveOrNull(request),
  };
}

/** Throws unless the principal holds the capability. The single check point. */
export function authorize(principal: Principal | null, capability: Capability): Principal {
  if (!principal) throw new UnauthenticatedError();
  if (!can(principal.roles, capability)) throw new ForbiddenError(capability, principal.roles);
  return principal;
}

export { TokenRejectedError, ForbiddenError, UnauthenticatedError };
