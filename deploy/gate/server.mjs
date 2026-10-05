// WatchDog gate (E3.20): the always-available HTTPS address of a VM that sleeps when idle.
//
// Runs on Cloud Run (scales to zero, so it costs nothing while nobody visits). On each
// request it forwards to the VM over the private network; if the VM is asleep it starts
// it through the Compute Engine API and shows a "waking up" page that refreshes itself.
// Node.js built-ins only. Holds no data and no user credentials; the app does all
// authentication. Configuration comes from the environment and messages.json.
import http from 'node:http';
import { readFileSync } from 'node:fs';

const env = name => { const v = process.env[name]; if (!v) throw new Error(`Missing ${name}`); return v; };
const config = {
  project: env('GATE_PROJECT'), zone: env('GATE_ZONE'), instance: env('GATE_INSTANCE'),
  target: new URL(env('GATE_TARGET')),                         // e.g. http://10.186.0.2:8080
  computeBase: process.env.GATE_COMPUTE_BASE ?? 'https://compute.googleapis.com/compute/v1',
  metadataBase: process.env.GATE_METADATA_BASE ?? 'http://metadata.google.internal',
  startCooldownMs: Number(process.env.GATE_START_COOLDOWN_MS ?? 120_000),
  proxyTimeoutMs: Number(process.env.GATE_PROXY_TIMEOUT_MS ?? 600_000),
  port: Number(process.env.PORT ?? 8080),
};
const messages = JSON.parse(readFileSync(new URL('./messages.json', import.meta.url), 'utf8'));
const instanceUrl = `${config.computeBase}/projects/${config.project}/zones/${config.zone}/instances/${config.instance}`;
const log = (event, detail = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...detail }));

let token = { value: null, expires: 0 };
async function accessToken() {
  if (token.value && token.expires > Date.now() + 60_000) return token.value;
  const r = await fetch(`${config.metadataBase}/computeMetadata/v1/instance/service-accounts/default/token`, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error(`metadata token ${r.status}`);
  const t = await r.json();
  token = { value: t.access_token, expires: Date.now() + t.expires_in * 1000 };
  return token.value;
}
async function compute(path = '', method = 'GET') {
  const r = await fetch(`${instanceUrl}${path}`, { method, headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!r.ok) throw new Error(`compute ${method} ${path || 'instance'} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

let lastStart = 0;
/** Starts a stopped VM at most once per cooldown; returns the status seen. */
async function wake(reason) {
  const vm = await compute();
  if (['TERMINATED', 'STOPPED', 'SUSPENDED'].includes(vm.status) && Date.now() - lastStart > config.startCooldownMs) {
    lastStart = Date.now();
    await compute(vm.status === 'SUSPENDED' ? '/resume' : '/start', 'POST');
    log('vm_start_requested', { from: vm.status, reason });
    return 'STARTING';
  }
  return vm.status;
}

function waitingPage(res, status, isApi) {
  const lang = /^pl\b/i.test(String(res.req.headers['accept-language'] ?? '')) ? 'pl' : 'en';
  const m = messages.languages[lang] ?? messages.languages[messages.default_language];
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Retry-After', '10');
  if (isApi) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'waking', message: m.api, vm_status: status })); return; }
  res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="10"><meta name="robots" content="noindex"><title>WatchDog</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#0f172a}p{color:#475569}</style></head>
<body><h1>${m.title}</h1><p>${m.body}</p><p><small>${m.status}: ${String(status).replace(/[^A-Z_]/g, '')}</small></p></body></html>`);
}

const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
function forward(req, res) {
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !HOP.has(k)));
    headers['x-forwarded-proto'] = 'https';
    headers['x-forwarded-host'] = req.headers.host ?? '';
    const upstream = http.request({ host: config.target.hostname, port: config.target.port || 80, method: req.method, path: req.url, headers, timeout: config.proxyTimeoutMs }, up => {
      res.writeHead(up.statusCode ?? 502, Object.fromEntries(Object.entries(up.headers).filter(([k]) => !HOP.has(k))));
      up.pipe(res); up.on('end', resolve); up.on('error', resolve);
    });
    // A refused or timed-out connection before any response means the app is not reachable.
    upstream.on('error', reject);
    upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
    req.pipe(upstream);
  });
}

export const server = http.createServer(async (req, res) => {
  const isApi = (req.url ?? '').startsWith('/api/');
  try {
    if (req.url === '/__wake') {                 // Cloud Scheduler: wake for due collection jobs
      const status = await wake('schedule');
      res.writeHead(202, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ vm_status: status })); return;
    }
    if (req.url === '/__gate/health') { res.writeHead(200); res.end('ok'); return; }
    try { await forward(req, res); return; }
    catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      log('upstream_unreachable', { message: error.message });
    }
    waitingPage(res, await wake('visit'), isApi);
  } catch (error) {
    log('gate_error', { message: error.message });
    if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('WatchDog gate error. Try again in a minute.'); }
  }
});

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  server.listen(config.port, () => log('gate_listening', { port: config.port, target: config.target.origin, instance: config.instance }));
}
