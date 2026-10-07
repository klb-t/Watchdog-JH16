import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

/**
 * E3.20 — a VM that sleeps when idle behind an always-on Cloud Run gate.
 * Operator commands run against an isolated root with recorded system-command
 * stubs; the Cloud Shell installer runs against a recorded gcloud; activity
 * marking runs in a real server process. No cloud resource is touched.
 */
function fakeRoot(appEnv: string) {
  const root = mkdtempSync(path.join(tmpdir(), 'watchdog-gate-ops-'));
  const write = (name: string, text: string, mode = 0o600) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), text, { mode }); };
  write('etc/watchdog/app.env', appEnv);
  write('etc/systemd/system/watchdog-idle.timer', 'synthetic');
  write('usr/local/lib/watchdog/watchdog_access.sh', readFileSync('scripts/watchdog_access.sh', 'utf8'), 0o755);
  write('proc/uptime', '7200.00 100.00\n');
  write('proc/loadavg', '0.05 0.04 0.03 1/100 123\n');
  write('usr/local/lib/watchdog/watchdog_idle.py', readFileSync('scripts/watchdog_idle.py', 'utf8'), 0o755);
  for (const command of ['systemctl', 'curl', 'docker', 'logger']) write(`test-bin/${command}`, `#!/usr/bin/env python3
import json,sys,os
with open(os.environ['WATCHDOG_ROOT']+'/calls','a') as f:f.write(json.dumps([os.path.basename(sys.argv[0]),*sys.argv[1:]])+'\\n')
`, 0o755);
  const run = (args: string[]) => spawnSync('bash', ['scripts/watchdogctl.sh', ...args], { env: { ...process.env, WATCHDOG_ROOT: root, PATH: path.join(root, 'test-bin') + ':' + process.env.PATH }, encoding: 'utf8', timeout: 15000 });
  const calls = () => existsSync(path.join(root, 'calls')) ? readFileSync(path.join(root, 'calls'), 'utf8').trim().split('\n').map(x => (JSON.parse(x) as string[]).join(' ')) : [];
  return { root, write, run, calls, read: (n: string) => readFileSync(path.join(root, n), 'utf8'), clean: () => rmSync(root, { recursive: true, force: true }) };
}

test('E3.20 enable-gate: refused before sign-in; then publishes on the private address and turns on the idle timer', () => {
  const r = fakeRoot('WATCHDOG_ALLOW_OPEN_INSTANCE=true\n'); try {
    const refused = r.run(['enable-gate', 'https://watchdog-gate-abc.a.run.app', '10.186.0.5']);
    assert.notEqual(refused.status, 0); assert.match(refused.stderr, /enable accounts first/); assert.deepEqual(r.calls(), []);
    r.write('etc/watchdog/app.env', 'WATCHDOG_AUTH=accounts\n');
    for (const bad of [['http://x.run.app', '10.186.0.5'], ['https://x.run.app', '34.118.12.7'], ['https://x.run.app', '10.186.0.5', '5']])
      assert.notEqual(r.run(['enable-gate', ...bad]).status, 0, bad.join(' '));
    const ok = r.run(['enable-gate', 'https://watchdog-gate-abc.a.run.app', '10.186.0.5', '45']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(r.read('etc/watchdog/network.env'), 'WATCHDOG_EXTRA_PUBLISH=--publish 10.186.0.5:8080:8080\n');
    assert.equal(r.read('etc/watchdog/idle.env'), 'WATCHDOG_IDLE_MINUTES=45\n');
    const env = r.read('etc/watchdog/app.env');
    assert.match(env, /WATCHDOG_PUBLIC_URL=https:\/\/watchdog-gate-abc\.a\.run\.app/); assert.match(env, /WATCHDOG_ACTIVITY_FILE=\/mnt\/watchdog\/activity\.json/);
    assert.match(env, /WATCHDOG_TRUST_PROXY=loopback,uniquelocal/);
    assert.ok(r.calls().includes('systemctl enable --now watchdog-idle.timer'));
    const off = r.run(['disable-gate']); assert.equal(off.status, 0, off.stderr);
    assert.equal(existsSync(path.join(r.root, 'etc/watchdog/network.env')), false); assert.equal(existsSync(path.join(r.root, 'etc/watchdog/idle.env')), false);
    assert.ok(r.calls().includes('systemctl disable --now watchdog-idle.timer'));
  } finally { r.clean(); }
});

test('E3.20 idle-check: powers off only when the gate is on, the machine is not freshly booted, nobody used it and nothing is installing', () => {
  const r = fakeRoot('WATCHDOG_AUTH=accounts\n'); try {
    const poweredOff = () => r.calls().filter(c => c === 'systemctl poweroff').length;
    assert.match(r.run(['idle-check']).stdout, /Gate not enabled/); assert.equal(poweredOff(), 0);
    r.write('etc/watchdog/idle.env', 'WATCHDOG_IDLE_MINUTES=30\n');
    r.write('proc/uptime', '600.12 10.00\n');
    assert.match(r.run(['idle-check']).stdout, /staying on for at least 30 minutes after boot/); assert.equal(poweredOff(), 0);
    r.write('proc/uptime', '7200.00 10.00\n');
    r.write('var/lib/watchdog/activity.json', '{"at":"now","reason":"request"}');
    assert.match(r.run(['idle-check']).stdout, /Last use \d+s ago; staying on/); assert.equal(poweredOff(), 0);
    const old = new Date(Date.now() - 31 * 60_000); utimesSync(path.join(r.root, 'var/lib/watchdog/activity.json'), old, old);
    // An install or backup holding the lock keeps the machine on.
    mkdirSync(path.join(r.root, 'run/lock'), { recursive: true });
    const holder = spawnSync('bash', ['-c', `exec 9>"${r.root}/run/lock/watchdog-install.lock"; flock -n 9 && bash scripts/watchdogctl.sh idle-check`],
      { env: { ...process.env, WATCHDOG_ROOT: r.root, PATH: path.join(r.root, 'test-bin') + ':' + process.env.PATH }, encoding: 'utf8' });
    assert.match(holder.stdout, /Install or backup in progress; staying on/); assert.equal(poweredOff(), 0);
    const off = r.run(['idle-check']); assert.equal(off.status, 0, off.stderr);
    assert.match(off.stdout, /No use for 30 minutes; powering off/); assert.equal(poweredOff(), 1);
  } finally { r.clean(); }
});

const tcp = (rows: string[]) => `  sl  local_address rem_address   st\n${rows.map((r, i) => `   ${i}: ${r} 00000000 0 0 1`).join('\n')}\n`;
// 0A = LISTEN, 01 = ESTABLISHED. Little-endian IPv4: 0100007F = 127.0.0.1, 0100000A = 10.0.0.1, 08080808 = 8.8.8.8
test('E3.20 idle decision: other services count — sessions, load, public connections and a manual hold keep the machine on', () => {
  const r = fakeRoot('WATCHDOG_AUTH=accounts\n'); try {
    r.write('etc/watchdog/idle.env', 'WATCHDOG_IDLE_MINUTES=30\n');
    const decide = () => { const x = r.run(['idle-check']); return { out: x.stdout, off: r.calls().filter(c => c === 'systemctl poweroff').length }; };
    // Quiet machine: sleeps.
    assert.equal(decide().off, 1);
    const reset = () => { rmSync(path.join(r.root, 'calls'), { force: true }); };
    // An open login session.
    reset(); r.write('var/run/who.txt', 'marcin pts/0 2026-10-07 10:00 (1.2.3.4)\n');
    let d = decide(); assert.match(d.out, /1 login session\(s\) open; staying on/); assert.equal(d.off, 0);
    rmSync(path.join(r.root, 'var/run/who.txt'));
    // A busy machine, e.g. another service computing.
    reset(); r.write('proc/loadavg', '1.90 1.20 0.80 3/100 123\n');
    d = decide(); assert.match(d.out, /Machine busy: 15-minute load 0\.80 is at or above 0\.50/); assert.equal(d.off, 0);
    r.write('etc/watchdog/idle.env', 'WATCHDOG_IDLE_MINUTES=30\nWATCHDOG_IDLE_MAX_LOAD=1.00\n');
    reset(); assert.equal(decide().off, 1, 'the load threshold is configurable');
    r.write('proc/loadavg', '0.05 0.04 0.03 1/100 123\n');
    // Another service (port 3000) with a visitor from the public internet.
    reset(); r.write('proc/net/tcp', tcp(['00000000:0BB8 00000000:0000 0A', '0100007F:0BB8 08080808:D2F0 01']));
    d = decide(); assert.match(d.out, /Inbound connections from the internet on port\(s\) 3000/); assert.equal(d.off, 0);
    // Not use: SSH, WatchDog's own port, loopback and private-network peers (containers, cloud agent).
    reset(); r.write('proc/net/tcp', tcp(['00000000:0016 00000000:0000 0A', '00000000:1F90 00000000:0000 0A', '00000000:0BB8 00000000:0000 0A',
      '0100007F:0016 08080808:D2F0 01', '0100007F:1F90 08080808:D2F1 01', '0100007F:0BB8 0100007F:D2F2 01', '0100007F:0BB8 0100000A:D2F3 01']));
    assert.equal(decide().off, 1);
    // IPv6-mapped public peer (::ffff:8.8.8.8) is public too.
    reset(); r.write('proc/net/tcp', tcp([])); r.write('proc/net/tcp6', tcp(['00000000000000000000000000000000:0BB8 00000000000000000000000000000000:0000 0A',
      '0000000000000000FFFF00000100007F:0BB8 0000000000000000FFFF000008080808:D2F4 01']));
    d = decide(); assert.match(d.out, /port\(s\) 3000/); assert.equal(d.off, 0);
    rmSync(path.join(r.root, 'proc/net/tcp6'));
    // Disconnected remote-desktop displays, tmux and screen are not people at a terminal.
    reset(); r.write('var/run/who.txt', 'marcin :10 2026-10-07 10:00 (:10)\nmarcin pts/3 2026-10-07 10:01 (:10)\nmarcin pts/4 2026-10-07 10:02 (tmux(812).%0)\n');
    assert.equal(decide().off, 1); rmSync(path.join(r.root, 'var/run/who.txt'));
    // A desktop or service signalling use in /run/keep-awake; a stale signal does not count.
    reset(); r.write('run/keep-awake/desktop-marcin-10', '');
    d = decide(); assert.match(d.out, /In use: desktop-marcin-10/); assert.equal(d.off, 0);
    const stale = new Date(Date.now() - 31 * 60_000); utimesSync(path.join(r.root, 'run/keep-awake/desktop-marcin-10'), stale, stale);
    reset(); assert.equal(decide().off, 1);
    // Manual hold.
    reset(); assert.equal(r.run(['keep-awake', '2']).status, 0);
    d = decide(); assert.match(d.out, /Kept awake by watchdogctl keep-awake/); assert.equal(d.off, 0);
    assert.notEqual(r.run(['keep-awake', '100']).status, 0); assert.notEqual(r.run(['keep-awake', 'x']).status, 0);
    assert.equal(r.run(['keep-awake', 'off']).status, 0);
    reset(); assert.equal(decide().off, 1);
  } finally { r.clean(); }
});

test('E3.20 idle decision: a failure to decide never powers the machine off', () => {
  const r = fakeRoot('WATCHDOG_AUTH=accounts\n'); try {
    r.write('etc/watchdog/idle.env', 'WATCHDOG_IDLE_MINUTES=3\n');
    const x = r.run(['idle-check']); assert.notEqual(x.status, 0);
    assert.equal(r.calls().filter(c => c === 'systemctl poweroff').length, 0);
  } finally { r.clean(); }
});

test('E3.20 unit: the private-address publish is optional and the loopback publish stays', () => {
  const unit = readFileSync('deploy/watchdog.service', 'utf8');
  assert.match(unit, /EnvironmentFile=-\/etc\/watchdog\/network\.env/);
  assert.match(unit, /--publish 127\.0\.0\.1:8080:8080 \$WATCHDOG_EXTRA_PUBLISH --mount/, 'unbraced, so an unset variable adds no argument');
  assert.match(readFileSync('deploy/watchdog-idle.service', 'utf8'), /ExecStart=\/usr\/local\/sbin\/watchdogctl idle-check/);
  assert.match(readFileSync('scripts/gcp_vm_bootstrap.sh', 'utf8'), /watchdog-idle\.service watchdog-idle\.timer/);
});

function gcloudHarness(extra: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'watchdog-gate-gcloud-')); mkdirSync(path.join(dir, 'bin'));
  writeFileSync(path.join(dir, 'bin', 'gcloud'), `#!/usr/bin/env python3
import json, os, sys
args=sys.argv[1:]
with open(os.environ['CLI_LOG'],'a') as f: f.write(json.dumps(args)+'\\n')
if args[:3]==['config','get-value','project']: print('test-project')
elif args[:3]==['compute','instances','describe']:
    print(json.dumps({'id':'12345','status':os.environ.get('VM_STATUS','TERMINATED'),'networkInterfaces':[{'network':'https://www.googleapis.com/compute/v1/projects/test-project/global/networks/default','subnetwork':'https://www.googleapis.com/compute/v1/projects/test-project/regions/'+os.environ.get('SUBNET_REGION','europe-central2')+'/subnetworks/default','networkIP':'10.186.0.5'}]}))
elif args[:4]==['compute','networks','subnets','describe']: print('10.186.0.0/20')
elif args[:3]==['run','services','describe']: print('https://watchdog-gate-abc-lm.a.run.app')
elif args[:3]==['iam','service-accounts','describe'] or args[:3]==['compute','firewall-rules','describe'] or args[:3]==['scheduler','jobs','describe']: sys.exit(1)
`, { mode: 0o755 });
  const env = { ...process.env, PATH: path.join(dir, 'bin') + ':' + process.env.PATH, CLI_LOG: path.join(dir, 'calls'), ...extra };
  const run = (flags: string[] = []) => spawnSync('bash', ['scripts/deploy_gcp_gate.sh', '--project', 'test-project', '--zone', 'europe-central2-a', '--instance', 'test-vm', ...flags], { env, encoding: 'utf8', timeout: 20000 });
  const calls = (): string[][] => existsSync(path.join(dir, 'calls')) ? readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').map(s => JSON.parse(s)) : [];
  return { run, calls, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

test('E3.20 installer: least privilege, subnet-scoped firewall, scale-to-zero gate, wake schedule, then enable-gate on the VM', () => {
  const h = gcloudHarness(); try {
    const r = h.run(['--idle-minutes', '40']); assert.equal(r.status, 0, r.stderr);
    const calls = h.calls(), find = (...words: string[]) => calls.find(a => words.every(w => a.includes(w)));
    const iam = find('add-iam-policy-binding')!;
    assert.deepEqual(iam.slice(0, 3), ['compute', 'instances', 'add-iam-policy-binding'], 'bound on the instance, not the project');
    assert.ok(!calls.some(a => a[0] === 'projects' && a.includes('add-iam-policy-binding')));
    const fw = find('firewall-rules', 'create')!;
    assert.equal(fw[fw.indexOf('--source-ranges') + 1], '10.186.0.0/20'); assert.equal(fw[fw.indexOf('--rules') + 1], 'tcp:8080');
    assert.equal(fw[fw.indexOf('--target-tags') + 1], 'wd-12345');
    const deploy = find('run', 'deploy')!;
    for (const flag of ['--allow-unauthenticated', '--vpc-egress', '--network', '--subnet']) assert.ok(deploy.includes(flag), flag);
    assert.equal(deploy[deploy.indexOf('--min-instances') + 1], '0');
    assert.match(deploy[deploy.indexOf('--set-env-vars') + 1], /GATE_TARGET=http:\/\/10\.186\.0\.5:8080/);
    assert.match(deploy[deploy.indexOf('--source') + 1], /deploy\/gate$/);
    const job = find('scheduler', 'create')!;
    assert.equal(job[job.indexOf('--uri') + 1], 'https://watchdog-gate-abc-lm.a.run.app/__wake');
    assert.ok(find('compute', 'instances', 'start'), 'a stopped VM is started before configuring it');
    const ssh = calls.find(a => a.includes('ssh'))!;
    assert.ok(ssh.includes('--tunnel-through-iap'));
    assert.match(ssh[ssh.indexOf('--command') + 1], /^sudo watchdogctl enable-gate https:\/\/watchdog-gate-abc-lm\.a\.run\.app 10\.186\.0\.5 40$/);
    assert.ok(calls.indexOf(ssh) > calls.indexOf(deploy), 'the VM learns the gate address only after the gate exists');
    assert.match(r.stdout, /WatchDog address: https:\/\/watchdog-gate-abc-lm\.a\.run\.app/);
  } finally { h.clean(); }
});

test('E3.20 installer: plan and bad input change nothing; a gate in another region than the VM is refused', () => {
  const h = gcloudHarness(); try {
    assert.equal(h.run(['--plan']).status, 0); assert.deepEqual(h.calls(), []);
    for (const flags of [['--idle-minutes', '5'], ['--wake-schedule', 'often'], ['--service', 'Bad_Name']]) assert.notEqual(h.run(flags).status, 0);
    assert.deepEqual(h.calls(), []);
  } finally { h.clean(); }
  const other = gcloudHarness({ SUBNET_REGION: 'europe-west1' }); try {
    const r = other.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /same region/);
    assert.ok(!other.calls().some(a => a.includes('deploy') || a.includes('add-iam-policy-binding')));
  } finally { other.clean(); }
});

test('E3.20 activity: real use marks the VM as busy; readiness probes do not', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'watchdog-activity-')), file = path.join(dir, 'activity.json');
  const port = 4900 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { detached: true, stdio: 'ignore', env: { ...process.env, PORT: String(port), NODE_ENV: 'production',
    WATCHDOG_ALLOW_OPEN_INSTANCE: 'true', WATCHDOG_ALLOW_EPHEMERAL_STORAGE: 'true', DB_PATH: path.join(dir, 'w.sqlite'), STORE_PATH: path.join(dir, 's'),
    WATCHDOG_DIAGNOSTICS_MODE: 'OFF', WATCHDOG_ACTIVITY_FILE: file } });
  try {
    for (let i = 0; i < 240; i++) { try { if ((await fetch(`${base}/api/auth/config`)).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 250)); }
    for (let i = 0; i < 3; i++) await fetch(`${base}/api/auth/config`);
    await new Promise(r => setTimeout(r, 200));
    assert.equal(existsSync(file), false, 'the gate’s readiness probe does not keep the VM awake');
    await fetch(`${base}/api/runs`);
    await new Promise(r => setTimeout(r, 200));
    assert.ok(existsSync(file), 'a signed-in API request does');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).reason, 'request');
  } finally { if (server.pid) try { process.kill(-server.pid, 'SIGKILL'); } catch { /* gone */ } rmSync(dir, { recursive: true, force: true }); }
});
