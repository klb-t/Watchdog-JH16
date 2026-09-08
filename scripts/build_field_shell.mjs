import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const assets = (await readdir('dist/assets')).filter(f => /\.(js|css)$/.test(f)).map(f => `/assets/${f}`);
const version = createHash('sha256').update(await readFile('dist/index.html')).digest('hex').slice(0, 16);
// Only the app shell is cached by the worker. Reference data lives in the
// authenticated, expiring snapshot; no /api response ever enters CacheStorage.
await writeFile('dist/field-sw.js', `const NAME = ${JSON.stringify('watchdog-shell-' + version)};
const ASSETS = ${JSON.stringify(['/index.html', ...assets])};
self.addEventListener('install', event => event.waitUntil(caches.open(NAME).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('watchdog-shell-') && k !== NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const u = new URL(event.request.url);
  if (u.origin !== self.location.origin || event.request.method !== 'GET' || u.pathname.startsWith('/api/')) return;
  if (ASSETS.includes(u.pathname)) event.respondWith(caches.open(NAME).then(async c => (await c.match(u.pathname)) || fetch(event.request)));
  else if (event.request.mode === 'navigate' && u.pathname === '/responder') event.respondWith(fetch(event.request).catch(() => caches.open(NAME).then(c => c.match('/index.html'))));
});
`);
