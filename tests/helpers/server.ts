import * as net from 'node:net';
import type { ChildProcess } from 'node:child_process';

/**
 * A port the OS reports free right now. Fixed random ranges overlapped between
 * suites that run in parallel, so one suite could reach another suite's server.
 */
export async function freePort(): Promise<number> {
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', () => resolve()));
  const { port } = socket.address() as net.AddressInfo;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  return port;
}

/**
 * Waits until a spawned test server answers `probe`. Its stdout and stderr are drained
 * and kept: an unread pipe fills at about 64 KB and then blocks the server mid-write,
 * and a server that cannot start must say why in the failure, not only that it did not.
 */
export async function waitForServer(server: ChildProcess, url: string, probe = '/api/auth/config', timeoutMs = 60_000) {
  let logs = '';
  const keep = (data: Buffer) => { logs = (logs + data.toString()).slice(-8_000); };
  server.stdout?.on('data', keep); server.stderr?.on('data', keep);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { if ((await fetch(`${url}${probe}`)).ok) return; } catch { /* not up yet */ }
    if (server.exitCode !== null || server.signalCode !== null) break;
    await new Promise(r => setTimeout(r, 250));
  }
  const state = server.exitCode !== null ? `exited with code ${server.exitCode}` : server.signalCode ? `killed by ${server.signalCode}` : `no answer within ${timeoutMs} ms`;
  throw new Error(`server did not start (${state}):\n${logs}`);
}
