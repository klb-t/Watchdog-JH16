import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The startup durability gate (D17).
 *
 * On Cloud Run the container filesystem is ephemeral. This refuses to boot a
 * production instance whose provenance would not survive a restart, rather
 * than logging a warning — the warning would sit in a log nobody reads while
 * the instance kept serving manifests for blobs it had already lost.
 *
 * What "durable" means here is deliberately narrow and checkable:
 *
 *  - the blob store is GCS, or a path under a mounted volume; and
 *  - the database file is on a mounted volume, not in the image.
 */

export interface DurabilityInput {
  readonly env: NodeJS.ProcessEnv;
  readonly dbPath: string;
  readonly storeBackend: string;
  readonly storePath: string;
  /** Injected so the check is testable without a real mount table. */
  readonly isMountedVolume?: (p: string) => boolean;
}

export class EphemeralStorageError extends Error {
  readonly code = 'configuration_error';
  constructor(readonly problems: string[]) {
    super(
      'Refusing to start: this looks like a production deployment whose data would not survive a restart.\n'
      + problems.map(p => `  - ${p}`).join('\n')
      + '\n\nFix by setting STORE_BACKEND=gcs with GCS_BUCKET, and putting DB_PATH on a mounted volume.'
      + '\nOr, if this instance is deliberately throwaway (a frozen demo, a smoke test),'
      + '\nset WATCHDOG_ALLOW_EPHEMERAL_STORAGE=true to say so on purpose.'
    );
    this.name = 'EphemeralStorageError';
  }
}

/**
 * A path that survives a container restart. On Cloud Run that means a mounted
 * volume; `/tmp` is explicitly not one — it is a tmpfs, which is worse than
 * ephemeral disk because it also consumes the instance's memory allowance.
 */
export function looksDurable(p: string, env: NodeJS.ProcessEnv): boolean {
  const resolved = path.resolve(p);
  const declared = (env.WATCHDOG_DURABLE_PATHS ?? '/mnt')
    .split(':').map(s => s.trim()).filter(Boolean);
  if (resolved === '/tmp' || resolved.startsWith('/tmp/')) return false;
  return declared.some(root => resolved === path.resolve(root) || resolved.startsWith(`${path.resolve(root)}/`));
}

export function checkDurability(input: DurabilityInput): { durable: boolean; problems: string[] } {
  const problems: string[] = [];
  const durablePath = input.isMountedVolume ?? ((p: string) => looksDurable(p, input.env));

  if (input.storeBackend !== 'gcs' && !durablePath(input.storePath)) {
    problems.push(
      `The blob store writes to '${input.storePath}', which is inside the container. Every archived raw `
      + 'response — the bytes a manifest hashes — is lost on restart.');
  }
  if (!durablePath(input.dbPath)) {
    problems.push(
      `The database is at '${input.dbPath}', which is inside the container. Runs, observations and `
      + 'approvals are lost on restart.');
  }
  return { durable: problems.length === 0, problems };
}

export function assertStorageSafeForEnvironment(input: DurabilityInput): void {
  if (input.env.NODE_ENV !== 'production') return;
  if (input.env.WATCHDOG_ALLOW_EPHEMERAL_STORAGE === 'true') return;

  const { durable, problems } = checkDurability(input);
  if (!durable) throw new EphemeralStorageError(problems);
}

/** True when the directory exists and is writable — a mount that failed silently is common. */
export function isWritableDirectory(p: string): boolean {
  try {
    fs.mkdirSync(p, { recursive: true });
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
