import { readdir, readFile, writeFile, rename, rm, access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

const versionFor = html => 'watchdog-shell-' + createHash('sha256').update(html).digest('hex').slice(0, 16);
const referencedAssets = html => [...new Set([...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g)].map(m => m[1]))].sort();

/** Fail if an old worker or partially built shell could produce a blank offline app. */
export async function verifyFieldShell(outputRoot = 'dist') {
  const html = await readFile(path.join(outputRoot, 'index.html'), 'utf8');
  const worker = await readFile(path.join(outputRoot, 'field-sw.js'), 'utf8');
  const nameLine = worker.match(/^const NAME = ("[^\n]*");$/m);
  const assetsLine = worker.match(/^const ASSETS = (\[[^\n]*\]);$/m);
  if (!nameLine || !assetsLine) throw new Error('Offline shell is missing its cache metadata.');
  const name = JSON.parse(nameLine[1]), assets = JSON.parse(assetsLine[1]);
  if (name !== versionFor(html)) throw new Error('Offline shell version does not match the current index.html. Regenerate the shell after the client build.');
  if (!Array.isArray(assets) || assets.some(asset => typeof asset !== 'string' || !(asset === '/index.html' || /^\/assets\/[^/]+\.(js|css)$/.test(asset))) || new Set(assets).size !== assets.length)
    throw new Error('Offline shell contains invalid or duplicate asset paths.');
  const required = ['/index.html', ...referencedAssets(html)];
  for (const asset of required) if (!assets.includes(asset)) throw new Error(`Offline shell does not cache the current client asset '${asset}'.`);
  for (const asset of assets) await access(path.join(outputRoot, asset.slice(1)));
  return { version: name, assets, required };
}

export async function buildFieldShell(outputRoot = 'dist') {
  const assets = (await readdir(path.join(outputRoot, 'assets'))).filter(f => /\.(js|css)$/.test(f)).sort().map(f => `/assets/${f}`);
  const html = await readFile(path.join(outputRoot, 'index.html'), 'utf8');
  // Reference data never enters CacheStorage. It uses principal-bound, expiring snapshots.
  const worker = `const NAME = ${JSON.stringify(versionFor(html))};
const ASSETS = ${JSON.stringify(['/index.html', ...assets])};
self.addEventListener('install', event => event.waitUntil(caches.open(NAME).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('watchdog-shell-') && k !== NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const u = new URL(event.request.url);
  if (u.origin !== self.location.origin || event.request.method !== 'GET' || u.pathname.startsWith('/api/')) return;
  if (ASSETS.includes(u.pathname)) event.respondWith(caches.open(NAME).then(async c => (await c.match(u.pathname)) || fetch(event.request)));
  else if (event.request.mode === 'navigate' && u.pathname === '/responder') event.respondWith(fetch(event.request).catch(() => caches.open(NAME).then(c => c.match('/index.html'))));
});
`;
  const temporary = path.join(outputRoot, `.field-sw-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, worker);
    await rename(temporary, path.join(outputRoot, 'field-sw.js'));
  } finally { await rm(temporary, { force: true }); }
  // Read back the actual output, including every asset currently referenced by HTML.
  return verifyFieldShell(outputRoot);
}
