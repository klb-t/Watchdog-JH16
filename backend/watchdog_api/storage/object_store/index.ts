import * as fs from 'node:fs';
import * as path from 'node:path';

export class WormViolationError extends Error {
  readonly code = 'storage_error';
  constructor(readonly key: string) {
    super(
      `WORM violation: '${key}' already holds different bytes and cannot be overwritten. ` +
      'For a content-addressed key this means a hash collision or a corrupted store, not a retry.'
    );
    this.name = 'WormViolationError';
  }
}

export interface ObjectStore {
  put(key: string, data: Buffer): Promise<string>;
  get(uri: string): Promise<Buffer>;
}

export class LocalFileSystemStore implements ObjectStore {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    fs.mkdirSync(this.basePath, { recursive: true });
  }

  async put(key: string, data: Buffer): Promise<string> {
    const filePath = path.join(this.basePath, key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    // WORM, enforced on *content* rather than on the mere existence of a key.
    //
    // Keys here are content addresses, so re-putting identical bytes changes
    // nothing and must succeed: dedup is decided against the database, and a
    // database that has been reset while the store survived would otherwise
    // fail every acquisition against blobs it no longer has rows for. That is
    // not a hypothetical — it is how a stale local store breaks a fresh run,
    // and on managed infrastructure the two stores are reset independently.
    //
    // Differing bytes under the same key remain a hard error. For a
    // content-addressed key that means a hash collision or a corrupted store,
    // and silently keeping either version would make provenance a fiction.
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath);
      if (existing.equals(data)) return `file://${filePath}`;
      throw new WormViolationError(key);
    }

    fs.writeFileSync(filePath, data);
    return `file://${filePath}`;
  }

  async get(uri: string): Promise<Buffer> {
    if (!uri.startsWith('file://')) throw new Error('Unsupported URI scheme');
    const filePath = uri.replace('file://', '');
    return fs.readFileSync(filePath);
  }
}
