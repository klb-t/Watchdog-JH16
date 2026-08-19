/**
 * The secret store, per D17 and `05_PROVIDERS_AND_CAPABILITIES.md`.
 *
 * `provider_credentials.secret_ref` is a *pointer*. This module is the only
 * place that turns a pointer into a value, and it is built so that the value
 * is hard to leak rather than merely undocumented:
 *
 *  - the resolved value lives in a `#private` field, so `JSON.stringify`,
 *    `Object.keys`, spread and `structuredClone` cannot reach it — a handle
 *    accidentally returned by an API route serialises to its status, not its
 *    key;
 *  - callers receive the value only inside `use()`, a callback scope, so there
 *    is no property to forward by mistake;
 *  - every resolved value is registered with the redactor at resolution time,
 *    so a key interpolated into an upstream error message is scrubbed by value
 *    even though the message has no credential-shaped key to match on.
 *
 * A credential that is configured-but-empty is `invalid`, not `absent`. The two
 * are different operator problems: `absent` means nothing was set, `invalid`
 * means something was set and is unusable, and collapsing them sends the
 * maintainer looking in the wrong place.
 */

import { registerSecretValue } from '../utils/redaction';

export type CredentialStatus = 'present' | 'absent' | 'invalid';

export class CredentialUnavailableError extends Error {
  readonly code = 'credential_unavailable';
  constructor(readonly ref: string, readonly status: CredentialStatus, detail: string) {
    super(`Credential '${ref}' is ${status}. ${detail}`);
    this.name = 'CredentialUnavailableError';
  }
}

export class MalformedSecretRefError extends Error {
  readonly code = 'validation_error';
  constructor(ref: string, detail: string) {
    super(`Malformed secret_ref '${ref}'. ${detail}`);
    this.name = 'MalformedSecretRefError';
  }
}

/**
 * A resolution result that carries the value without exposing it as a property.
 */
export class SecretHandle {
  #value: string | null;

  constructor(
    readonly ref: string,
    readonly status: CredentialStatus,
    readonly detail: string,
    value: string | null,
  ) {
    this.#value = value;
    if (status === 'present' && value === null) {
      throw new Error("Invariant: a 'present' handle must carry a value.");
    }
    if (status !== 'present' && value !== null) {
      throw new Error("Invariant: only a 'present' handle may carry a value.");
    }
  }

  get isPresent(): boolean { return this.status === 'present'; }

  /**
   * The only way out. Throws rather than yielding a placeholder, because a
   * caller that receives `''` for a missing key sends an unauthenticated
   * request and reports the upstream 401 as a provider failure.
   */
  use<T>(fn: (value: string) => T): T {
    if (this.#value === null) throw new CredentialUnavailableError(this.ref, this.status, this.detail);
    return fn(this.#value);
  }

  /** What may safely be logged, returned by an API, or written to a manifest. */
  describe(): { ref: string; status: CredentialStatus; detail: string } {
    return { ref: this.ref, status: this.status, detail: this.detail };
  }

  toJSON() { return this.describe(); }
}

/** One backend for one `secret_ref` scheme. */
export interface SecretProvider {
  readonly scheme: string;
  resolve(locator: string, ref: string): Promise<SecretHandle>;
}

/** `env:NAME` — the local and Cloud Run default. */
export class EnvSecretProvider implements SecretProvider {
  readonly scheme = 'env';
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async resolve(locator: string, ref: string): Promise<SecretHandle> {
    if (!/^[A-Z][A-Z0-9_]*$/.test(locator)) {
      throw new MalformedSecretRefError(ref,
        "An 'env' locator must be an environment variable name matching /^[A-Z][A-Z0-9_]*$/.");
    }
    const raw = this.env[locator];
    if (raw === undefined) {
      return new SecretHandle(ref, 'absent', `Environment variable ${locator} is not set.`, null);
    }
    if (raw.trim() === '') {
      return new SecretHandle(ref, 'invalid',
        `Environment variable ${locator} is set but empty. This is a configuration error, not an absent credential.`, null);
    }
    return new SecretHandle(ref, 'present', `Resolved from environment variable ${locator}.`, raw.trim());
  }
}

export type HttpTransport = (url: string, init: { method: string; headers: Record<string, string> })
  => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * `gcp-sm:projects/<p>/secrets/<s>/versions/<v>` via the Secret Manager REST
 * API, authenticated from the instance metadata server.
 *
 * Deliberately not `@google-cloud/secret-manager`: that package pulls a large
 * gRPC dependency tree into a project that otherwise has thirteen runtime
 * dependencies, to make two HTTP calls.
 */
export class GcpSecretManagerProvider implements SecretProvider {
  readonly scheme = 'gcp-sm';
  private static readonly METADATA_TOKEN_URL =
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

  constructor(
    private readonly transport: HttpTransport,
    private readonly metadataTokenUrl: string = GcpSecretManagerProvider.METADATA_TOKEN_URL,
    private readonly apiBase: string = 'https://secretmanager.googleapis.com/v1',
  ) {}

  private async accessToken(ref: string): Promise<string> {
    const res = await this.transport(this.metadataTokenUrl, {
      method: 'GET', headers: { 'Metadata-Flavor': 'Google' },
    });
    if (!res.ok) {
      throw new CredentialUnavailableError(ref, 'invalid',
        `The GCP metadata server returned ${res.status}. Outside GCP, use an 'env:' secret_ref instead.`);
    }
    const parsed = JSON.parse(await res.text());
    const token = parsed?.access_token;
    if (typeof token !== 'string' || token === '') {
      throw new CredentialUnavailableError(ref, 'invalid', 'The metadata server returned no access_token.');
    }
    registerSecretValue(token);
    return token;
  }

  async resolve(locator: string, ref: string): Promise<SecretHandle> {
    if (!/^projects\/[^/]+\/secrets\/[^/]+\/versions\/[^/]+$/.test(locator)) {
      throw new MalformedSecretRefError(ref,
        "A 'gcp-sm' locator must be projects/<project>/secrets/<secret>/versions/<version|latest>.");
    }
    const token = await this.accessToken(ref);
    const res = await this.transport(`${this.apiBase}/${locator}:access`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) {
      return new SecretHandle(ref, 'absent', `Secret Manager has no version at ${locator}.`, null);
    }
    if (!res.ok) {
      return new SecretHandle(ref, 'invalid', `Secret Manager returned ${res.status} for ${locator}.`, null);
    }
    const body = JSON.parse(await res.text());
    const b64 = body?.payload?.data;
    if (typeof b64 !== 'string') {
      return new SecretHandle(ref, 'invalid', `Secret Manager returned no payload.data for ${locator}.`, null);
    }
    const value = Buffer.from(b64, 'base64').toString('utf-8').trim();
    if (value === '') {
      return new SecretHandle(ref, 'invalid', `The secret version at ${locator} is empty.`, null);
    }
    return new SecretHandle(ref, 'present', `Resolved from Secret Manager ${locator}.`, value);
  }
}

export class SecretStore {
  private providers = new Map<string, SecretProvider>();
  private cache = new Map<string, SecretHandle>();

  constructor(providers: SecretProvider[]) {
    for (const p of providers) this.providers.set(p.scheme, p);
  }

  schemes(): string[] { return [...this.providers.keys()].sort(); }

  /**
   * Resolves and caches. Caching matters beyond speed: without it a Secret
   * Manager read happens on every fetch in a 32-query run, which is 32 audit
   * log entries and 32 chances to be rate-limited mid-study.
   */
  async resolve(ref: string): Promise<SecretHandle> {
    const cached = this.cache.get(ref);
    if (cached) return cached;

    const idx = ref.indexOf(':');
    if (idx <= 0) {
      throw new MalformedSecretRefError(ref,
        `Expected '<scheme>:<locator>'. Known schemes: ${this.schemes().join(', ') || 'none'}.`);
    }
    const scheme = ref.slice(0, idx);
    const locator = ref.slice(idx + 1);
    const provider = this.providers.get(scheme);
    if (!provider) {
      throw new MalformedSecretRefError(ref,
        `No provider for scheme '${scheme}'. Known schemes: ${this.schemes().join(', ') || 'none'}.`);
    }

    const handle = await provider.resolve(locator, ref);
    // Registered here rather than at each call site, so that a new backend
    // cannot forget to do it. Guarded, because `use()` throws on an absent
    // credential and an absent credential is an ordinary state, not an error.
    if (handle.isPresent) handle.use(v => registerSecretValue(v));
    this.cache.set(ref, handle);
    return handle;
  }

  /** Status without resolving a value into a caller's hands. */
  async status(ref: string): Promise<CredentialStatus> {
    return (await this.resolve(ref)).status;
  }

  clearCache(): void { this.cache.clear(); }
}

const defaultTransport: HttpTransport = (url, init) => fetch(url, init) as any;

/**
 * The process-wide store. `gcp-sm` is registered unconditionally; it fails with
 * a precise message off-GCP rather than being silently unavailable.
 */
export const secretStore = new SecretStore([
  new EnvSecretProvider(),
  new GcpSecretManagerProvider(defaultTransport),
]);
