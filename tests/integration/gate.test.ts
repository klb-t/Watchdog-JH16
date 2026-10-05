import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * E3.20 gate: the always-on address of a sleeping VM. A fake Compute Engine API
 * (with its metadata token server) and a fake app stand in for Google and the VM.
 */
let vmStatus = 'TERMINATED';
const calls: string[] = [];
let appUp = false;
const listen = (s: http.Server) => new Promise<number>(r => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));

const google = http.createServer((req, res) => {
  calls.push(`${req.method} ${req.url}`);
  if (req.url?.startsWith('/computeMetadata/')) {
    assert.equal(req.headers['metadata-flavor'], 'Google');
    res.end(JSON.stringify({ access_token: 'fake-token', expires_in: 3600 })); return;
  }
  assert.equal(req.headers.authorization, 'Bearer fake-token');
  if (req.method === 'POST' && req.url?.endsWith('/start')) { vmStatus = 'STAGING'; res.end('{}'); return; }
  res.end(JSON.stringify({ status: vmStatus }));
});
const app = http.createServer((req, res) => {
  if (!appUp) { req.socket.destroy(); return; }
  let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
    res.writeHead(201, { 'Content-Type': 'application/json', 'Set-Cookie': 'wd_session=abc; HttpOnly; Secure' });
    res.end(JSON.stringify({ method: req.method, url: req.url, body, host: req.headers.host, proto: req.headers['x-forwarded-proto'], fwdHost: req.headers['x-forwarded-host'] }));
  });
});
let gate: http.Server, base = '';

before(async () => {
  const gPort = await listen(google), aPort = await listen(app);
  Object.assign(process.env, { GATE_PROJECT: 'p', GATE_ZONE: 'europe-central2-a', GATE_INSTANCE: 'vm', GATE_TARGET: `http://127.0.0.1:${aPort}`,
    GATE_COMPUTE_BASE: `http://127.0.0.1:${gPort}/compute/v1`, GATE_METADATA_BASE: `http://127.0.0.1:${gPort}`, GATE_START_COOLDOWN_MS: '60000' });
  gate = (await import('../../deploy/gate/server.mjs')).server as http.Server;
  base = `http://127.0.0.1:${await listen(gate)}`;
});
after(() => { gate?.close(); google.close(); app.close(); });

test('gate: a visit to a sleeping VM starts it once and shows a self-refreshing page', async () => {
  const page = await fetch(`${base}/workbench`, { headers: { 'Accept-Language': 'pl-PL' } });
  assert.equal(page.status, 503); assert.equal(page.headers.get('retry-after'), '10');
  const html = await page.text();
  assert.match(html, /Uruchamiam WatchDoga/); assert.match(html, /http-equiv="refresh"/); assert.match(html, /STARTING/);
  assert.deepEqual(calls.filter(c => c.startsWith('POST')), ['POST /compute/v1/projects/p/zones/europe-central2-a/instances/vm/start']);
  const api = await fetch(`${base}/api/runs`);
  assert.equal(api.status, 503); assert.equal((await api.json()).error, 'waking');
  assert.equal(calls.filter(c => c.startsWith('POST')).length, 1, 'no second start while booting');
});

test('gate: once the app answers, requests and bodies pass through with the public host preserved', async () => {
  vmStatus = 'RUNNING'; appUp = true;
  const r = await fetch(`${base}/api/research/x?y=1`, { method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'watchdog-gate-abc.a.run.app' }, body: '{"a":1}' });
  assert.equal(r.status, 201);
  assert.match(r.headers.get('set-cookie') ?? '', /wd_session=abc/);
  const seen = await r.json();
  assert.deepEqual([seen.method, seen.url, seen.body, seen.proto], ['POST', '/api/research/x?y=1', '{"a":1}', 'https']);
  assert.equal(seen.host, seen.fwdHost, 'the app sees the address people use, so its same-origin checks hold');
});

test('gate: a running VM whose app is down is not restarted; the scheduler wake endpoint reports state', async () => {
  appUp = false; const before = calls.filter(c => c.startsWith('POST')).length;
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 503); assert.match(await r.text(), /RUNNING/);
  assert.equal(calls.filter(c => c.startsWith('POST')).length, before);
  const wake = await fetch(`${base}/__wake`);
  assert.equal(wake.status, 202); assert.equal((await wake.json()).vm_status, 'RUNNING');
  assert.equal((await fetch(`${base}/__gate/health`)).status, 200);
});
