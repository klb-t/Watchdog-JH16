import { createHash, createHmac, createPublicKey, verify as cryptoVerify, timingSafeEqual } from 'node:crypto';
import { Principal, IdentityProvider } from '../domain/principal';
import { Role, isRole } from './roles';
import { SecretStore, secretStore as defaultSecretStore } from '../secrets';

/**
 * Google OIDC as one implementation of the `IdentityProvider` seam E1 shipped
 * (D3, D17). The domain interface is unchanged; this is the implementation D3
 * promised, not a migration.
 *
 * Verified locally against Google's JWKS rather than by calling a tokeninfo
 * endpoint: a network round trip per request is both a latency cost and a
 * dependency on Google being reachable in order to read your own data.
 *
 * No JWT library. The verification is ~60 lines of `node:crypto` and the
 * alternative is a transitive dependency tree inside the security boundary,
 * in a project that keeps thirteen runtime dependencies deliberately.
 */

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export type JwksTransport = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class TokenRejectedError extends Error {
  readonly code = 'unauthenticated';
  constructor(readonly reason: string) {
    super(`ID token rejected: ${reason}`);
    this.name = 'TokenRejectedError';
  }
}

interface Jwk { kid: string; kty: string; alg?: string; use?: string; n: string; e: string; }

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function decodeSegment(seg: string): any {
  try {
    return JSON.parse(b64urlToBuffer(seg).toString('utf-8'));
  } catch {
    throw new TokenRejectedError('a segment is not valid base64url JSON');
  }
}

/** Caches Google's signing keys; they rotate on the order of days. */
export class JwksCache {
  private keys: Jwk[] = [];
  private fetchedAt = 0;

  constructor(
    private readonly transport: JwksTransport,
    private readonly url: string = GOOGLE_JWKS_URL,
    private readonly ttlMs: number = 60 * 60 * 1000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async get(kid: string, allowRefresh = true): Promise<Jwk> {
    if (this.keys.length === 0 || this.now() - this.fetchedAt > this.ttlMs) await this.refresh();

    const hit = this.keys.find(k => k.kid === kid);
    if (hit) return hit;

    // An unknown kid usually means rotation, so refresh once before rejecting.
    // Not more than once: an attacker-chosen kid must not become a way to make
    // this server hammer Google.
    if (allowRefresh) {
      await this.refresh();
      const retry = this.keys.find(k => k.kid === kid);
      if (retry) return retry;
    }
    throw new TokenRejectedError(`no signing key matches kid '${kid}'`);
  }

  private async refresh(): Promise<void> {
    const res = await this.transport(this.url);
    if (!res.ok) throw new TokenRejectedError(`JWKS endpoint returned ${res.status}`);
    let parsed: any;
    try {
      parsed = JSON.parse(await res.text());
    } catch {
      throw new TokenRejectedError('JWKS endpoint returned a body that is not JSON');
    }
    if (!Array.isArray(parsed?.keys)) throw new TokenRejectedError('JWKS response has no keys array');
    this.keys = parsed.keys.filter((k: Jwk) => k.kty === 'RSA' && k.n && k.e);
    this.fetchedAt = this.now();
  }
}

export interface OidcConfig {
  /** The OAuth client id this deployment accepts tokens for. */
  readonly audience: string;
  /**
   * Email addresses or `@domain` suffixes allowed to sign in, with their role.
   * There is deliberately no wildcard and no default role: an installation that
   * grants a role to every Google account is one Google account away from an
   * open instance, and that is not a state this can reach by omission.
   */
  readonly grants: Readonly<Record<string, Role>>;
  readonly clockSkewSeconds?: number;
}

export interface VerifiedIdentity {
  readonly subject: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: Role;
  readonly expiresAt: number;
}

export class GoogleOidcVerifier {
  constructor(
    private readonly config: OidcConfig,
    private readonly jwks: JwksCache,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The grant that applies to an address, exact match before domain match. */
  roleFor(email: string): Role | null {
    const lower = email.toLowerCase();
    const exact = this.config.grants[lower];
    if (isRole(exact)) return exact;

    const at = lower.lastIndexOf('@');
    if (at < 0) return null;
    const domain = this.config.grants[lower.slice(at)];
    return isRole(domain) ? domain : null;
  }

  async verify(idToken: string): Promise<VerifiedIdentity> {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new TokenRejectedError('not a three-part JWS');

    const header = decodeSegment(parts[0]);
    // `alg: none` and HMAC confusion are the two classic JWT bypasses. Pinned
    // rather than read from the token, because a value the attacker supplies
    // must never choose the verification algorithm.
    if (header.alg !== 'RS256') throw new TokenRejectedError(`unsupported alg '${header.alg}'`);
    if (typeof header.kid !== 'string') throw new TokenRejectedError('header has no kid');

    const jwk = await this.jwks.get(header.kid);
    const key = createPublicKey({ key: jwk as any, format: 'jwk' });
    const signed = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf-8');
    if (!cryptoVerify('RSA-SHA256', signed, key, b64urlToBuffer(parts[2]))) {
      throw new TokenRejectedError('signature does not verify');
    }

    const claims = decodeSegment(parts[1]);
    const skew = this.config.clockSkewSeconds ?? 60;
    const nowSec = Math.floor(this.now() / 1000);

    if (!GOOGLE_ISSUERS.has(claims.iss)) throw new TokenRejectedError(`unexpected issuer '${claims.iss}'`);
    // Without this a valid Google token minted for any other application would
    // be accepted here.
    if (claims.aud !== this.config.audience) throw new TokenRejectedError('audience does not match this deployment');
    if (typeof claims.exp !== 'number' || claims.exp + skew < nowSec) throw new TokenRejectedError('token has expired');
    if (typeof claims.iat === 'number' && claims.iat - skew > nowSec) throw new TokenRejectedError('token is issued in the future');
    if (typeof claims.sub !== 'string' || claims.sub === '') throw new TokenRejectedError('token has no subject');
    if (typeof claims.email !== 'string' || claims.email === '') throw new TokenRejectedError('token carries no email');
    // An unverified address can be set to anyone's, which would make the grant
    // list meaningless.
    if (claims.email_verified !== true) throw new TokenRejectedError('email address is not verified');

    const role = this.roleFor(claims.email);
    if (!role) throw new TokenRejectedError(`no grant exists for ${claims.email}`);

    return {
      subject: claims.sub,
      email: claims.email.toLowerCase(),
      name: typeof claims.name === 'string' ? claims.name : null,
      role,
      expiresAt: claims.exp * 1000,
    };
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionPayload {
  readonly sub: string;
  readonly email: string;
  readonly role: Role;
  readonly exp: number;
}

export class SessionCodec {
  constructor(private readonly signingKey: string) {
    if (signingKey.length < 32) {
      throw new Error('The session signing key must be at least 32 characters. A short key is a guessable one.');
    }
  }

  private mac(body: string): string {
    return createHmac('sha256', this.signingKey).update(body).digest('base64url');
  }

  sign(payload: SessionPayload): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
    return `${body}.${this.mac(body)}`;
  }

  /** Returns null for anything that does not verify. Never throws on input. */
  verify(cookie: string | undefined | null, nowMs: number = Date.now()): SessionPayload | null {
    if (!cookie) return null;
    const idx = cookie.lastIndexOf('.');
    if (idx <= 0) return null;

    const body = cookie.slice(0, idx);
    const provided = Buffer.from(cookie.slice(idx + 1));
    const expected = Buffer.from(this.mac(body));
    // Length-checked first: timingSafeEqual throws on a length mismatch, and
    // that throw would itself be an oracle.
    if (provided.length !== expected.length) return null;
    if (!timingSafeEqual(provided, expected)) return null;

    let payload: SessionPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    } catch {
      return null;
    }
    if (!isRole(payload.role)) return null;
    if (typeof payload.exp !== 'number' || payload.exp < nowMs) return null;
    return payload;
  }
}

/**
 * `IdentityProvider` backed by a verified session cookie.
 *
 * Resolving an unauthenticated request returns `null` rather than a guest
 * principal. A guest principal is how an authorisation check accidentally
 * passes: the caller sees an object and stops asking.
 */
export class OidcIdentityProvider implements IdentityProvider {
  constructor(
    private readonly codec: SessionCodec,
    private readonly cookieName: string = 'watchdog_session',
  ) {}

  private cookieFrom(request: unknown): string | null {
    const header = (request as any)?.headers?.cookie;
    if (typeof header !== 'string') return null;
    for (const part of header.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === this.cookieName) return v.join('=');
    }
    return null;
  }

  async resolve(request: unknown): Promise<Principal> {
    const p = await this.resolveOrNull(request);
    if (!p) throw new TokenRejectedError('no valid session cookie');
    return p;
  }

  async resolveOrNull(request: unknown): Promise<Principal | null> {
    const payload = this.codec.verify(this.cookieFrom(request));
    if (!payload) return null;
    return {
      // Stable across email changes, unlike the address. Prefixed so a Google
      // subject can never collide with the `local-user` constant.
      id: `google:${payload.sub}`,
      email: payload.email,
      roles: [payload.role],
      identityProvenance: 'google-oidc',
    };
  }
}

export const SESSION_COOKIE_NAME = 'watchdog_session';

export function sessionCookieHeader(value: string, maxAgeSeconds: number, secure: boolean): string {
  // HttpOnly: unreadable from JavaScript, so an XSS cannot exfiltrate it.
  // SameSite=Lax: blocks cross-site POSTs while keeping ordinary navigation.
  // Secure in production only, so local http development still works.
  return [
    `${SESSION_COOKIE_NAME}=${value}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${maxAgeSeconds}`,
  ].filter(Boolean).join('; ');
}

export function clearSessionCookieHeader(secure: boolean): string {
  return sessionCookieHeader('', 0, secure);
}

/** Derives a stable principal id for a verified identity, for row ownership. */
export function principalIdFor(subject: string): string {
  return `google:${subject}`;
}

/** A short, non-reversible fingerprint for logs. Never the address itself. */
export function emailFingerprint(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 12);
}

export async function loadSessionCodec(
  ref = 'env:SESSION_SIGNING_KEY',
  secrets: SecretStore = defaultSecretStore,
): Promise<SessionCodec | null> {
  const handle = await secrets.resolve(ref);
  return handle.isPresent ? handle.use(k => new SessionCodec(k)) : null;
}
