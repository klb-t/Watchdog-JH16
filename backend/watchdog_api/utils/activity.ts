import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Last real use of the installation, for a VM that powers itself off when idle
 * (E3.20, `watchdogctl idle-check`). Touched by signed-in API requests and by
 * running background jobs; readiness probes do not count, or a sleeping VM's
 * own wake-up checks would keep it awake forever.
 *
 * Off unless WATCHDOG_ACTIVITY_FILE is set. Throttled to one write per 30 s.
 * Never throws: losing an activity mark only means the VM may sleep sooner.
 */
const file = process.env.WATCHDOG_ACTIVITY_FILE ? path.resolve(process.env.WATCHDOG_ACTIVITY_FILE) : null;
const THROTTLE_MS = 30_000;
let last = 0;

export const READINESS_PATHS: ReadonlySet<string> = new Set(['GET /api/auth/config']);

export function markActivity(reason: string, now = Date.now()) {
  if (!file || now - last < THROTTLE_MS) return;
  last = now;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ at: new Date(now).toISOString(), reason }));
    fs.renameSync(tmp, file);
  } catch { /* see above */ }
}

/** Test hook: forget the throttle. */
export function resetActivityThrottle() { last = 0; }
