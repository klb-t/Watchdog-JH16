import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Principal, IdentityProvider } from '../domain/principal';
import { TokenRejectedError } from './oidc';

export interface AccountSessionPayload {
  readonly pid: string;
  readonly sv: number;
  readonly iat: number;
  readonly exp: number;
}

export class AccountSessionCodec {
  constructor(private readonly signingKey: string) {
    if (signingKey.length < 32) {
      throw new Error('The session signing key must be at least 32 characters. A short key is a guessable one.');
    }
  }

  private mac(body: string): string {
    return createHmac('sha256', this.signingKey).update(body).digest('base64url');
  }

  sign(payload: AccountSessionPayload): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
    return `${body}.${this.mac(body)}`;
  }

  /** Returns null for anything that does not verify. Never throws on input. */
  verify(cookie: string | undefined | null, nowMs: number = Date.now()): AccountSessionPayload | null {
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

    let payload: AccountSessionPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    } catch {
      return null;
    }
    if (typeof payload?.pid !== 'string' || payload.pid.length === 0 || payload.pid.length > 200) return null;
    if (!Number.isInteger(payload.sv) || payload.sv < 1) return null;
    if (typeof payload.exp !== 'number' || payload.exp < nowMs) return null;
    return { pid: payload.pid, sv: payload.sv, iat: payload.iat, exp: payload.exp };
  }
}

/**
 * `IdentityProvider` backed by a verified session cookie.
 *
 * Resolving an unauthenticated request returns `null` rather than a guest
 * principal. A guest principal is how an authorisation check accidentally
 * passes: the caller sees an object and stops asking.
 */
/** Reads one cookie from a raw request. Shared by every cookie-backed check. */
export function readCookie(request: unknown, name: string): string | null {
  const header = (request as any)?.headers?.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/** Turns a verified session into the principal as it stands *now*, or null. */
export type SessionLookup = (principalId: string, sessionVersion: number) => Principal | null;

export class SessionIdentityProvider implements IdentityProvider {
  constructor(
    private readonly codec: AccountSessionCodec,
    private readonly lookup: SessionLookup,
    private readonly cookieName: string = 'watchdog_session',
    private readonly now: () => number = () => Date.now(),
  ) {}

  async resolve(request: unknown): Promise<Principal> {
    const p = await this.resolveOrNull(request);
    if (!p) throw new TokenRejectedError('no valid session cookie');
    return p;
  }

  /**
   * Null — never a guest principal — for anything short of a valid cookie
   * naming an active principal at its current session version. A guest
   * principal is how an authorisation check accidentally passes: the caller
   * sees an object and stops asking.
   */
  async resolveOrNull(request: unknown): Promise<Principal | null> {
    const payload = this.codec.verify(readCookie(request, this.cookieName), this.now());
    if (!payload) return null;
    return this.lookup(payload.pid, payload.sv);
  }
}

