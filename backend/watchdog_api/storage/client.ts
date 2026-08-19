import { LocalFileSystemStore, ObjectStore } from './object_store';
import { GcsObjectStore, GcsTransport } from './gcs';
import * as path from 'node:path';

const STORE_PATH = process.env.STORE_PATH || path.join(process.cwd(), 'data', 'object_store');
const STORE_BACKEND = (process.env.STORE_BACKEND ?? 'local').toLowerCase();

const gcsTransport: GcsTransport = (url, init) => fetch(url, init as any) as any;

/**
 * Selected by environment, defaulting to local. The default matters: adding a
 * cloud backend must not make a clean `git clone && npm run demo:jh16` require
 * a GCP project.
 */
function buildStore(): ObjectStore {
  if (STORE_BACKEND === 'gcs') {
    const bucket = process.env.GCS_BUCKET;
    if (!bucket) {
      // Refused rather than silently falling back to local: a deployment that
      // asked for durable storage and quietly got ephemeral storage is exactly
      // the failure the durability gate exists to prevent.
      throw new Error('STORE_BACKEND=gcs requires GCS_BUCKET to be set.');
    }
    return new GcsObjectStore(bucket, gcsTransport, process.env.GCS_PREFIX ?? '');
  }
  return new LocalFileSystemStore(STORE_PATH);
}

export const store = buildStore();
export const storeBackend = STORE_BACKEND;
export const storePath = STORE_PATH;
