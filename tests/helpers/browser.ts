import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium } from 'playwright';

/**
 * Which Chromium to launch, for every browser test.
 *
 * Playwright's own build first — that is what CI installs, and it matches the
 * library version. Only if it is absent, any Chromium found under
 * PLAYWRIGHT_BROWSERS_PATH (or /opt/pw-browsers): development containers often
 * carry a browser from a different Playwright release, and a test that cannot
 * find it silently turns every browser assertion into a launch failure.
 *
 * One helper for every browser suite, because each suite re-deriving this is
 * how a new one ended up unable to run outside CI.
 */
export function resolveChromium(): string | undefined {
  try {
    if (fs.existsSync(chromium.executablePath())) return undefined;
  } catch { /* no bundled path known; fall through to scanning */ }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!fs.existsSync(root)) return undefined;
  for (const dir of fs.readdirSync(root).sort()) {
    for (const candidate of [
      path.join(root, dir, 'chrome-linux', 'chrome'),
      path.join(root, dir, 'chrome-linux', 'headless_shell'),
    ]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}
