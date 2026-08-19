import { test } from 'node:test';
import * as assert from 'node:assert';
import { GcsObjectStore, GcsTransport, GcsError } from '../../backend/watchdog_api/storage/gcs';
import { WormViolationError } from '../../backend/watchdog_api/storage/object_store';
import {
  checkDurability, assertStorageSafeForEnvironment, looksDurable, EphemeralStorageError,
} from '../../backend/watchdog_api/storage/durability';
import { capabilityRegistry } from '../../backend/watchdog_api/sources/provider_registry';
import { NotImplementedError } from '../../backend/watchdog_api/utils/errors';

// -------------------------------------------------------------------------
// A fake GCS: an in-memory bucket plus the metadata token endpoint.
// -------------------------------------------------------------------------

/** Buffer.buffer is the shared pool, so a naive .buffer returns the wrong bytes. */
const toArrayBuffer = (b: Buffer): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function fakeGcs(seed: Record<string, Buffer> = {}) {
  const objects = new Map(Object.entries(seed));
  let tokenCalls = 0;

  const transport: GcsTransport = async (url, init) => {
    const ok = (body: Buffer | string) => ({
      ok: true, status: 200,
      text: async () => body.toString(),
      arrayBuffer: async () => toArrayBuffer(Buffer.isBuffer(body) ? body : Buffer.from(body)),
    });
    const fail = (status: number, body = '{}') => ({
      ok: false, status, text: async () => body,
      arrayBuffer: async () => toArrayBuffer(Buffer.from(body)),
    });

    if (url.includes('metadata')) {
      tokenCalls++;
      return ok(JSON.stringify({ access_token: 'ya29.token-value-here', expires_in: 3600 }));
    }
    if (url.includes('/upload/storage/')) {
      const name = decodeURIComponent(new URL(url).searchParams.get('name')!);
      if (url.includes('ifGenerationMatch=0') && objects.has(name)) return fail(412);
      objects.set(name, Buffer.from(init!.body as Buffer));
      return ok('{}');
    }
    if (url.includes('?alt=media')) {
      const name = decodeURIComponent(url.split('/o/')[1].split('?')[0]);
      const found = objects.get(name);
      return found ? ok(found) : fail(404);
    }
    // Bucket metadata, for healthCheck.
    return ok(JSON.stringify({ name: 'bucket' }));
  };

  return { transport, objects, tokenCalls: () => tokenCalls };
}

const gcs = (t: GcsTransport, prefix = '') =>
  new GcsObjectStore('wd-bucket', t, prefix, 'http://metadata.test/token', 'https://gcs.test');

// -------------------------------------------------------------------------
// E3.4 — GCS behind the same interface, with the same WORM rule.
// -------------------------------------------------------------------------

test('E3.4: a blob round-trips through GCS and its URI is a gs:// address', async () => {
  const f = fakeGcs();
  const store = gcs(f.transport);
  const payload = Buffer.from('{"total_results":482000}');

  const uri = await store.put('raw/abc123', payload);
  assert.strictEqual(uri, 'gs://wd-bucket/raw/abc123');
  assert.ok((await store.get(uri)).equals(payload));
});

test('E3.4: WORM behaves exactly as it does locally — content, not key existence', async () => {
  const store = gcs(fakeGcs().transport);
  const payload = Buffer.from('same bytes');

  const first = await store.put('raw/k', payload);
  const second = await store.put('raw/k', payload);
  assert.strictEqual(second, first, 'a content-addressed re-put is a no-op, as in the local store');

  await assert.rejects(() => store.put('raw/k', Buffer.from('different bytes')), WormViolationError);
});

test('E3.4: a lost race on an identical object is not a violation; on a different one it is', async () => {
  // ifGenerationMatch=0 makes the server refuse the second writer. That must
  // resolve on content, or two instances archiving the same fixture collide.
  const f = fakeGcs({ 'raw/k': Buffer.from('same bytes') });
  const store = gcs(f.transport);

  assert.strictEqual(await store.put('raw/k', Buffer.from('same bytes')), 'gs://wd-bucket/raw/k');
  await assert.rejects(() => store.put('raw/k', Buffer.from('other')), WormViolationError);
});

test('E3.4: a prefix scopes objects without leaking into the key', async () => {
  const f = fakeGcs();
  const store = gcs(f.transport, 'instance-a/');
  const uri = await store.put('raw/k', Buffer.from('x'));

  assert.strictEqual(uri, 'gs://wd-bucket/instance-a/raw/k');
  assert.ok(f.objects.has('instance-a/raw/k'));
  assert.ok((await store.get(uri)).equals(Buffer.from('x')));
});

test('E3.4: the access token is fetched once and reused across writes', async () => {
  const f = fakeGcs();
  const store = gcs(f.transport);
  for (let i = 0; i < 5; i++) await store.put(`raw/k${i}`, Buffer.from(`v${i}`));
  assert.strictEqual(f.tokenCalls(), 1, 'a 32-query run must not mint 32 tokens');
});

test('E3.4: off GCP the failure names the fix instead of hanging', async () => {
  const transport: GcsTransport = async () => ({
    ok: false, status: 500, text: async () => 'no metadata server',
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  await assert.rejects(() => gcs(transport).put('raw/k', Buffer.from('x')),
    (e: any) => e instanceof GcsError && /STORE_BACKEND/.test(e.message));
});

test('E3.4: a missing object is an error, never an empty buffer', async () => {
  await assert.rejects(() => gcs(fakeGcs().transport).get('gs://wd-bucket/raw/nope'), GcsError);
  await assert.rejects(() => gcs(fakeGcs().transport).get('file:///tmp/x'), /expected gs:\/\//);
  await assert.rejects(() => gcs(fakeGcs().transport).get('gs://other-bucket/raw/k'), /different bucket/);
});

// -------------------------------------------------------------------------
// The durability gate.
// -------------------------------------------------------------------------

const base = { dbPath: '/app/data/watchdog.sqlite', storeBackend: 'local', storePath: '/app/data/object_store' };

test('E3.4: production with container-local storage refuses to start, and says what is lost', () => {
  let err: EphemeralStorageError | null = null;
  try {
    assertStorageSafeForEnvironment({ ...base, env: { NODE_ENV: 'production' } as any });
  } catch (e) {
    err = e as EphemeralStorageError;
  }

  assert.ok(err instanceof EphemeralStorageError, 'production must refuse to start');
  assert.strictEqual(err!.problems.length, 2, 'both the blob store and the database are at risk');
  assert.match(err!.message, /lost on restart/);
  assert.match(err!.message, /STORE_BACKEND=gcs/, 'the message must name the fix');
});

test('E3.4: GCS plus a mounted database path passes', () => {
  assert.doesNotThrow(() => assertStorageSafeForEnvironment({
    env: { NODE_ENV: 'production' } as any,
    dbPath: '/mnt/watchdog/watchdog.sqlite', storeBackend: 'gcs', storePath: '(unused)',
  }));
});

test('E3.4: /tmp is not durable, and is worse than it looks', () => {
  assert.strictEqual(looksDurable('/tmp/watchdog.sqlite', {} as any), false,
    'on Cloud Run /tmp is a tmpfs that also consumes the memory allowance');
  assert.strictEqual(looksDurable('/mnt/data/watchdog.sqlite', {} as any), true);
  assert.strictEqual(looksDurable('/srv/x', { WATCHDOG_DURABLE_PATHS: '/srv' } as any), true);
});

test('E3.4: development is never blocked, and a throwaway instance stays possible', () => {
  assert.doesNotThrow(() => assertStorageSafeForEnvironment({ ...base, env: {} as any }));
  assert.doesNotThrow(() => assertStorageSafeForEnvironment({
    ...base, env: { NODE_ENV: 'production', WATCHDOG_ALLOW_EPHEMERAL_STORAGE: 'true' } as any,
  }));

  // A partial fix is still reported, so it cannot look finished.
  const partial = checkDurability({ ...base, storeBackend: 'gcs', env: {} as any });
  assert.strictEqual(partial.durable, false);
  assert.strictEqual(partial.problems.length, 1);
  assert.match(partial.problems[0], /database/);
});

// -------------------------------------------------------------------------
// Postgres is registered as a plan, and behaves like one.
// -------------------------------------------------------------------------

test('E3.4: Postgres is registered planned and throws rather than pretending', () => {
  const pg = capabilityRegistry.getProvider('postgres');
  assert.ok(pg, 'it must be visible as a plan, so the gap is inspectable');
  assert.strictEqual(pg!.status, 'planned');
  assert.strictEqual(capabilityRegistry.isSelectable('postgres'), false);
  assert.throws(() => capabilityRegistry.assertSelectable('postgres'), NotImplementedError);

  assert.strictEqual(capabilityRegistry.getProvider('gcs')!.status, 'implemented');
  assert.strictEqual(capabilityRegistry.getProvider('sqlite')!.status, 'implemented');
});
