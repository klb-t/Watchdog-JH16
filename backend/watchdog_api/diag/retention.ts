import { readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Keeps the diagnostics directory bounded on a long-running installation:
 * whole day directories older than `days` are removed, then the oldest
 * remaining days until the total is under `maxBytes`. Today is never removed.
 * Deterministic: days are processed in date order.
 */
export function pruneDiagnostics(root: string, options: { days: number; maxBytes: number; now?: Date }): { removed: string[]; bytes: number } {
  if (!existsSync(root)) return { removed: [], bytes: 0 };
  const now = options.now ?? new Date();
  const today = now.toISOString().split('T')[0];
  const cutoff = new Date(now.getTime() - options.days * 86_400_000).toISOString().split('T')[0];
  const size = (p: string): number => {
    const s = statSync(p);
    return s.isDirectory() ? readdirSync(p).reduce((n, name) => n + size(path.join(p, name)), 0) : s.size;
  };
  const days = readdirSync(root).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const removed: string[] = [];
  for (const d of days) if (d < cutoff && d !== today) { rmSync(path.join(root, d), { recursive: true, force: true }); removed.push(d); }
  let remaining = days.filter(d => !removed.includes(d)).map(d => ({ d, bytes: size(path.join(root, d)) }));
  let total = remaining.reduce((n, x) => n + x.bytes, 0);
  for (const x of remaining) {
    if (total <= options.maxBytes || x.d === today) break;
    rmSync(path.join(root, x.d), { recursive: true, force: true }); removed.push(x.d); total -= x.bytes;
  }
  remaining = remaining.filter(x => !removed.includes(x.d));
  return { removed, bytes: total };
}

export function retentionFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const days = Number(env.WATCHDOG_DIAGNOSTICS_RETENTION_DAYS ?? 14);
  const maxMb = Number(env.WATCHDOG_DIAGNOSTICS_MAX_MB ?? 2048);
  if (!Number.isFinite(days) || days < 1 || !Number.isFinite(maxMb) || maxMb < 16) {
    throw new Error('WATCHDOG_DIAGNOSTICS_RETENTION_DAYS must be ≥ 1 and WATCHDOG_DIAGNOSTICS_MAX_MB ≥ 16.');
  }
  return { days, maxBytes: maxMb * 1024 * 1024 };
}
