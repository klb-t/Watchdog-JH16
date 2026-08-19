import { ObjectStore, WormViolationError } from './object_store';
import { createHash } from 'node:crypto';

/**
 * Google Cloud Storage behind the `ObjectStore` interface (E3.4).
 *
 * Why this exists: on Cloud Run the container filesystem is ephemeral. A
 * deployment that keeps E1's local blob directory loses every archived raw
 * response on the next restart while continuing to render charts from the
 * database — a system reporting provenance it no longer holds. That is not a
 * degraded deployment, it voids rule 6, and it is the reason D17 makes durable
 * storage a precondition of deploying rather than a follow-up.
 *
 * Written against the JSON API over `fetch` rather than `@google-cloud/storage`
 * for the same reason as Secret Manager: two endpoints do not justify that
 * dependency tree. Authentication comes from the instance metadata server, so
 * there is no service-account key file to leak.
 */

export type GcsTransport = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
}) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

export class GcsError extends Error {
  readonly code = 'storage_error';
  constructor(detail: string) {
    super(detail);
    this.name = 'GcsError';
  }
}

export class GcsObjectStore implements ObjectStore {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly bucket: string,
    private readonly transport: GcsTransport,
    private readonly prefix: string = '',
    private readonly metadataTokenUrl: string = METADATA_TOKEN_URL,
    private readonly apiBase: string = 'https://storage.googleapis.com',
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!bucket) throw new GcsError('A bucket name is required.');
  }

  private objectName(key: string): string {
    return this.prefix ? `${this.prefix.replace(/\/+$/, '')}/${key}` : key;
  }

  private async accessToken(): Promise<string> {
    // Refreshed a minute early, so a token does not expire mid-upload.
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;

    const res = await this.transport(this.metadataTokenUrl, { headers: { 'Metadata-Flavor': 'Google' } });
    if (!res.ok) {
      throw new GcsError(
        `The GCP metadata server returned ${res.status}. Outside GCP, leave STORE_BACKEND unset to use the local store.`);
    }
    const body = JSON.parse(await res.text());
    if (typeof body?.access_token !== 'string') throw new GcsError('The metadata server returned no access_token.');

    this.token = {
      value: body.access_token,
      expiresAt: this.now() + (typeof body.expires_in === 'number' ? body.expires_in * 1000 : 300_000),
    };
    return this.token.value;
  }

  private async head(key: string): Promise<Buffer | null> {
    const token = await this.accessToken();
    const url = `${this.apiBase}/storage/v1/b/${encodeURIComponent(this.bucket)}`
      + `/o/${encodeURIComponent(this.objectName(key))}?alt=media`;
    const res = await this.transport(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new GcsError(`GCS read of '${key}' returned ${res.status}.`);
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * WORM on content, matching the local store exactly.
   *
   * Identical bytes under an existing key succeed: keys here are content
   * addresses, dedup is decided against the database, and the database and the
   * bucket are reset independently on managed infrastructure. Differing bytes
   * under one key remain a hard error.
   */
  async put(key: string, data: Buffer): Promise<string> {
    const existing = await this.head(key);
    if (existing) {
      if (existing.equals(data)) return this.uri(key);
      throw new WormViolationError(key);
    }

    const token = await this.accessToken();
    const url = `${this.apiBase}/upload/storage/v1/b/${encodeURIComponent(this.bucket)}`
      + `/o?uploadType=media&name=${encodeURIComponent(this.objectName(key))}`
      // Refuses to overwrite server-side too. The check above races with
      // another instance writing the same key; this makes the race safe rather
      // than merely unlikely.
      + '&ifGenerationMatch=0';

    const res = await this.transport(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(data.length),
      },
      body: data,
    });

    if (res.status === 412) {
      // Another writer won the race. Identical content is still fine; that is
      // the same rule as above, decided after the fact.
      const other = await this.head(key);
      if (other && other.equals(data)) return this.uri(key);
      throw new WormViolationError(key);
    }
    if (!res.ok) throw new GcsError(`GCS write of '${key}' returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return this.uri(key);
  }

  async get(uri: string): Promise<Buffer> {
    const key = this.keyFromUri(uri);
    const found = await this.head(key);
    if (!found) throw new GcsError(`No object at ${uri}.`);
    return found;
  }

  uri(key: string): string {
    return `gs://${this.bucket}/${this.objectName(key)}`;
  }

  private keyFromUri(uri: string): string {
    if (!uri.startsWith('gs://')) throw new GcsError(`Unsupported URI scheme in '${uri}'; expected gs://.`);
    const rest = uri.slice('gs://'.length);
    const slash = rest.indexOf('/');
    if (slash < 0) throw new GcsError(`Malformed GCS URI '${uri}'.`);
    if (rest.slice(0, slash) !== this.bucket) {
      throw new GcsError(`URI '${uri}' names a different bucket than this store (${this.bucket}).`);
    }
    const name = rest.slice(slash + 1);
    const p = this.prefix.replace(/\/+$/, '');
    return p && name.startsWith(`${p}/`) ? name.slice(p.length + 1) : name;
  }

  /** Verifies bucket access at startup, so a misconfiguration fails fast. */
  async healthCheck(): Promise<void> {
    const token = await this.accessToken();
    const url = `${this.apiBase}/storage/v1/b/${encodeURIComponent(this.bucket)}`;
    const res = await this.transport(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new GcsError(
        `Cannot access bucket '${this.bucket}' (HTTP ${res.status}). ` +
        "Check the bucket exists and the service account has 'Storage Object Admin' on it.");
    }
  }
}

/** Content address for a payload, matching the local store's key scheme. */
export function contentKey(prefix: string, data: Buffer): string {
  return `${prefix}/${createHash('sha256').update(data).digest('hex')}`;
}
