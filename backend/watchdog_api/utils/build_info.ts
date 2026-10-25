import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Which code produced a run. A container receives the commit at build time
 * (WATCHDOG_GIT_COMMIT); a checkout run from source asks Git, and a tree with
 * uncommitted changes says so instead of claiming the commit it started from.
 */
export interface BuildInfo { appVersion: string | null; gitCommit: string | null }

function fromGit(): string | null {
  try {
    const opts = { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] as ('ignore' | 'pipe')[], timeout: 5000, encoding: 'utf-8' as const };
    const head = execFileSync('git', ['rev-parse', 'HEAD'], opts).trim();
    if (!/^[a-f0-9]{40}$/.test(head)) return null;
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], opts).trim() !== '';
    return dirty ? `${head}-dirty` : head;
  } catch { return null; }
}

let cached: BuildInfo | null = null;
export function buildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  if (cached) return cached;
  let appVersion: string | null = null;
  try { appVersion = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')).version ?? null; } catch { /* absent */ }
  const declared = env.WATCHDOG_GIT_COMMIT && /^[a-f0-9]{7,40}(-dirty)?$/.test(env.WATCHDOG_GIT_COMMIT) ? env.WATCHDOG_GIT_COMMIT : null;
  cached = { appVersion, gitCommit: declared ?? fromGit() };
  return cached;
}
