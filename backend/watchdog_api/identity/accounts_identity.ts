import { GoogleOidcVerifier, JwksCache, JwksTransport, OidcConfig } from './oidc';
import { AccountSessionCodec, SessionIdentityProvider } from './account_sessions';
import { Identity, AuthConfigError, readAuthConfig } from './index';
import { Principal, LocalUserIdentityProvider } from '../domain/principal';
import { SecretStore, secretStore as defaultSecretStore } from '../secrets';
import { AdmissionService } from './admission';
import { AdmissionRepository } from '../db/repositories/admission';
const defaultJwksTransport: JwksTransport = (url) => fetch(url) as any;
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

export async function buildAccountsIdentity(
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
  const codec = handle.use(k => new AccountSessionCodec(k));
  const verifier = config.audience
    ? new GoogleOidcVerifier({ audience: config.audience, grants: config.grants } as OidcConfig, new JwksCache(jwksTransport))
    : null;
  const provider = new SessionIdentityProvider(codec, sessionLookup(admission));

  return {
    mode: 'accounts', config, verifier, codec: null, accountCodec: codec,
    resolve: (request) => provider.resolveOrNull(request),
  };
}

