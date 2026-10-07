#!/usr/bin/env python3
"""One-entrypoint, resumable shared-VM installation. Run `cloud` in Cloud Shell.

Code is an immutable Git archive. Cloud identity and owner are invocation data;
private job state never belongs in the public repository. VM mutation happens
only after both systemd and GCE metadata identity checks on that VM.
"""
from __future__ import annotations
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import signal
from devbox_common import SetupError, ROOT, atomic, digest, env_file, file_hash, policy, require_vm, run, save_json


def valid_target(project: str, zone: str, instance: str, owner: str) -> None:
    for value, regex, name in [(project, r'[a-z][a-z0-9-]{4,61}[a-z0-9]', 'project'),
                               (zone, r'[a-z]+-[a-z0-9]+[0-9]-[a-z]', 'zone'),
                               (instance, r'[a-z][a-z0-9-]{0,62}', 'instance'),
                               (owner, r'[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+', 'owner')]:
        if not re.fullmatch(regex, value): raise SetupError(f'Invalid {name}')


def metadata(name: str) -> str:
    return run(['curl', '--fail', '--silent', '--show-error', '--noproxy', '*', '--max-time', '10',
                '-H', 'Metadata-Flavor: Google', 'http://metadata.google.internal/computeMetadata/v1/'+name]).stdout.strip()


def verify_identity(request: dict) -> None:
    require_vm()
    actual = (metadata('project/project-id'), metadata('instance/id'), metadata('instance/zone').split('/')[-1])
    expected = (request['project'], request['instance_id'], request['zone'])
    if actual != expected: raise SetupError('GCE target identity mismatch; no VM installation action taken')


def known_project(path: Path) -> bool:
    try:
        if json.loads((path/'package.json').read_text()).get('name') == 'watchdog-jh16': return True
    except (OSError, ValueError): pass
    try:
        return re.search(r'url\s*=\s*(?:https://github\.com/|git@github\.com:)klb-t/Watchdog-JH16(?:\.git)?\s*$',
                         (path/'.git/config').read_text(), re.M) is not None
    except OSError: return False


def legacy_state(root: Path = Path('/')) -> str:
    etc, service, data = root/'etc/watchdog', root/'etc/systemd/system/watchdog.service', root/'var/lib/watchdog'
    text = service.read_text() if service.is_file() else ''
    if 'Managed by scripts/gcp_vm_bootstrap.sh' in text: return 'managed'
    if not any(x.exists() for x in (etc, service, data, root/'opt/watchdog')): return 'absent'
    source = root/'opt/watchdog'
    if service.is_file() and '/opt/watchdog/' in text and (known_project(source) or known_project(source/'current')):
        return 'recognized-legacy'
    return 'unknown'


def quarantine_legacy() -> None:
    """A narrow migration, not name-based deletion. Unknown services are never adopted.

This path handles an old project-marked /opt/watchdog systemd installation. A
managed install uses the existing stronger database/image-bound backup instead.
"""
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + str(os.getpid())
    dest = Path('/var/backups/watchdog-legacy') / stamp
    dest.mkdir(parents=True, mode=0o700); dest.chmod(0o700)
    paths = [Path(x) for x in ['/etc/watchdog', '/var/lib/watchdog', '/opt/watchdog', '/etc/systemd/system/watchdog.service'] if Path(x).exists()]
    size = sum(int(run(['du', '-sb', str(x)]).stdout.split()[0]) for x in paths)
    if shutil.disk_usage(dest).free < size*1.1 + 1_000_000_000:
        raise SetupError('Not enough space for a verified legacy backup; nothing stopped')
    # Do not claim a containerized/foreign-volume legacy migration without its own contract.
    if shutil.which('docker'):
        names = run(['docker', 'ps', '-a', '--format', '{{.Names}}']).stdout.splitlines()
        if any(x in names for x in ('watchdog', 'watchdog-proxy')):
            raise SetupError('Unmanaged legacy container requires a mount/image review; no container/data removed')
    was_active = run(['systemctl', 'is-active', '--quiet', 'watchdog.service'], check=False).returncode == 0
    was_enabled = run(['systemctl', 'is-enabled', '--quiet', 'watchdog.service'], check=False).returncode == 0
    moved = []
    save_json(dest/'receipt.json', {'status': 'preparing', 'paths': [str(x) for x in paths],
                                  'was_active': was_active, 'was_enabled': was_enabled})
    try:
        run(['systemctl', 'stop', 'watchdog.service'])
        archive = dest/'legacy.tar.gz'
        run(['tar', '--numeric-owner', '-czf', str(archive), '-C', '/', *[str(x).lstrip('/') for x in paths]], timeout=3600)
        run(['tar', '-tzf', str(archive)], timeout=3600)
        checksum = file_hash(archive)
        run(['systemctl', 'disable', 'watchdog.service'])
        for p in paths:
            q = dest/'paths'/str(p).lstrip('/')
            q.parent.mkdir(parents=True, exist_ok=True)
            # rename is intentional: no recursive delete and no partial cross-device copy.
            p.rename(q); moved.append((p, q))
        run(['systemctl', 'daemon-reload'])
        save_json(dest/'receipt.json', {'status': 'quarantined', 'archive_sha256': checksum,
                                      'paths': [str(x) for x in paths], 'was_active': was_active, 'was_enabled': was_enabled})
        print(f'Legacy installation retained, not erased: {dest}', flush=True)
    except BaseException:
        for p, q in reversed(moved): q.rename(p)
        run(['systemctl', 'daemon-reload'], check=False)
        if was_enabled: run(['systemctl', 'enable', 'watchdog.service'], check=False)
        if was_active: run(['systemctl', 'start', 'watchdog.service'], check=False)
        raise


def vm(job: Path) -> int:
    os.umask(0o077)
    request = json.loads((job/'request.json').read_text())
    verify_identity(request)
    def interrupted(signum, frame):
        raise SetupError(f'Host job interrupted by signal {signum}; inspect phase state before retry')
    signal.signal(signal.SIGTERM, interrupted)
    p = policy(job/'source/config/deployment/devbox.json')
    status_file, log_file = job/'status.json', job/'install.log'
    lock = Path('/run/lock/watchdog-host-setup.lock')
    with lock.open('a') as guard, log_file.open('a', buffering=1) as log:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.dup2(log.fileno(), 1); os.dup2(log.fileno(), 2)
        phase = 'preflight'
        def status(state: str, error: str | None = None) -> None:
            save_json(status_file, {'schema': 1, 'status': state, 'phase': phase, 'commit': request['commit'],
                                   'profile_sha256': digest(p), 'updated_at': time.time(), 'error': error})
            print(f'[{state}] {phase}', flush=True)
        idle_was_on = run(['systemctl', 'is-active', '--quiet', 'watchdog-idle.timer'], check=False).returncode == 0
        try:
            status('running')
            import remote_desktop
            if Path('/etc/watchdog/recovery-required').exists():
                raise SetupError('Recovery marker present; preserve the pre-update backup and inspect it before any retry')
            if digest(p) != request['profile_sha256']:
                raise SetupError('Pinned source/profile identity mismatch')
            remote_desktop.preflight(p)
            old = legacy_state()
            if old == 'unknown':
                raise SetupError('Unknown Watchdog installation. No automatic deletion: inspect the service, source and data first')
            run(['systemctl', 'stop', 'watchdog-idle.timer'], check=False)
            if old == 'recognized-legacy':
                if not request['replace_legacy']: raise SetupError('Recognized legacy installation needs --replace-legacy')
                phase = 'legacy-backup'; status('running'); quarantine_legacy()
            phase = 'watchdog-build-and-backup'; status('running')
            release = env_file(Path('/etc/watchdog/release.env'))
            ready = run(['curl', '--fail', '--silent', '--max-time', '5', 'http://127.0.0.1:8080/api/auth/config'], check=False)
            if release.get('WATCHDOG_COMMIT') != request['commit'] or ready.returncode != 0:
                run(['bash', str(job/'source/scripts/gcp_vm_bootstrap.sh'), '--archive', str(job/'source.tar.gz'),
                     '--commit', request['commit'], '--owner', request['owner'], '--shared-host'],
                    timeout=p['install_timeout_seconds'], capture=False)
            elif env_file(Path('/etc/watchdog/app.env')).get('WATCHDOG_AUTH') != 'accounts':
                run(['watchdogctl', 'enable-accounts', request['owner'], '--no-link'], timeout=120, capture=False)
            phase = 'desktops'; status('running')
            run(['python3', str(job/'source/scripts/remote_desktop.py'), 'install',
                 '--profile', str(job/'source/config/deployment/devbox.json')],
                timeout=p['install_timeout_seconds'], capture=False)
            phase = 'local-acceptance'; status('running')
            run(['systemctl', 'is-active', '--quiet', 'watchdog.service'])
            phase = 'awaiting-cloud-gate-and-crd-authorization'; status('complete')
            return 0
        except BaseException as e:
            status('failed', str(e))
            raise
        finally:
            if idle_was_on:
                run(['systemctl', 'start', 'watchdog-idle.timer'], check=False)


class Cloud:
    def __init__(self, a: argparse.Namespace, p: dict):
        self.a, self.p = a, p
        self.common = ['--project', a.project, '--zone', a.zone]
    def gc(self, args: list[str], **kwargs):
        return run(['gcloud', *args], **kwargs)
    def js(self, args: list[str]):
        return json.loads(self.gc([*args, '--format=json']).stdout)
    def describe(self):
        return self.js(['compute', 'instances', 'describe', self.a.instance, *self.common])
    def ssh(self, command: str, *, tty: bool = False, **kwargs):
        return self.gc(['compute', 'ssh', self.a.instance, *self.common, '--tunnel-through-iap', '--quiet',
                        '--ssh-flag=-o ConnectTimeout=20', *(['--ssh-flag=-tt'] if tty else []), '--command', command], **kwargs)
    def prepare(self) -> dict:
        a, p = self.a, self.p
        info = self.describe()
        nics = info.get('networkInterfaces', [])
        if len(nics) != 1: raise SetupError('This profile needs one NIC; no network topology was changed')
        nic = nics[0]; tag = 'wd-'+str(info['id'])
        if not re.fullmatch(r'wd-[0-9]+', tag): raise SetupError('Invalid immutable VM identity')
        network = nic['network']; host = network.split('/projects/')[1].split('/')[0]
        boot = next(x for x in info['disks'] if x.get('boot'))
        if '/zones/' not in boot['source']: raise SetupError('Regional boot disks need a separate resize policy')
        disk = self.js(['compute', 'disks', 'describe', boot['source'].split('/')[-1], *self.common])
        mt = self.js(['compute', 'machine-types', 'describe', info['machineType'].split('/')[-1], *self.common])
        insufficient_ram = int(mt['memoryMb']) < p['minimum_ram_gb']*1024
        insufficient_disk = int(disk['sizeGb']) < p['minimum_disk_gb']
        print(f'VM: {a.instance}; RAM {int(mt["memoryMb"])/1024:g} GiB; boot disk {disk["sizeGb"]} GB. Existing larger resources will not shrink.', flush=True)
        if (insufficient_ram or insufficient_disk) and not a.ensure_capacity:
            raise SetupError('Capacity below profile; --ensure-capacity authorizes the required resize/restart')
        if insufficient_ram and (info.get('guestAccelerators') or any(x.get('type') == 'SCRATCH' for x in info['disks'])):
            raise SetupError('GPU/local-SSD VM cannot use the automatic type-change path')
        self.gc(['services', 'enable', 'compute.googleapis.com', 'iap.googleapis.com', '--project', a.project, '--quiet'], timeout=300)
        # Preserve the currently observed external address before *any* requested stop.
        external = next((x.get('natIP') for x in nic.get('accessConfigs', []) if x.get('natIP')), None)
        if external and (a.preserve_ip or insufficient_ram or insufficient_disk):
            addresses = self.js(['compute', 'addresses', 'list', '--project', a.project, '--filter=address='+external])
            if not addresses:
                self.gc(['compute', 'addresses', 'create', tag+'-ip', '--project', a.project, '--region', a.zone.rsplit('-',1)[0],
                         '--addresses', external, '--network-tier', nic['accessConfigs'][0].get('networkTier','PREMIUM'), '--quiet'])
        if insufficient_ram:
            target = self.js(['compute', 'machine-types', 'describe', p['upgrade_machine_type'], *self.common])
            if int(target['memoryMb']) < p['minimum_ram_gb']*1024 or int(target['guestCpus']) < int(mt['guestCpus']):
                raise SetupError('Configured type would not meet RAM or would reduce CPU count; choose a profile explicitly')
        restart_for_growth = insufficient_ram or insufficient_disk
        if restart_for_growth:
            if info['status'] == 'RUNNING':
                self.gc(['compute', 'instances', 'stop', a.instance, *self.common, '--quiet'], timeout=600)
            elif info['status'] != 'TERMINATED':
                raise SetupError('Resize needs RUNNING or TERMINATED state; no reset or data-discard fallback')
            info['status'] = 'TERMINATED'
        if insufficient_ram:
            self.gc(['compute', 'instances', 'set-machine-type', a.instance, *self.common,
                     '--machine-type', p['upgrade_machine_type'], '--quiet'], timeout=300)
        if insufficient_disk:
            self.gc(['compute', 'disks', 'resize', disk['name'], *self.common, '--size', str(p['minimum_disk_gb'])+'GB', '--quiet'], timeout=300)
        if info['status'] == 'TERMINATED': self.gc(['compute', 'instances', 'start', a.instance, *self.common, '--quiet'], timeout=600)
        elif info['status'] == 'SUSPENDED': self.gc(['compute', 'instances', 'resume', a.instance, *self.common, '--quiet'], timeout=600)
        elif info['status'] != 'RUNNING': raise SetupError('VM is transitioning; rerun after the current operation finishes')
        # Add only our VM-scoped IAP rule; never open SSH globally or alter IAM automatically.
        existing = self.gc(['compute', 'firewall-rules', 'describe', tag+'-iap', '--project', host, '--format=json'], check=False)
        common = ['--project', host, '--source-ranges', p['iap_source'], '--target-tags', tag, '--priority', '0', '--quiet']
        if existing.returncode == 0:
            r = json.loads(existing.stdout)
            if r.get('network') != network or r.get('targetTags') != [tag] or r.get('direction') != 'INGRESS' or not r.get('allowed'):
                raise SetupError('Existing IAP rule has foreign scope; not overwritten')
            self.gc(['compute', 'firewall-rules', 'update', tag+'-iap', *common, '--rules=tcp:22', '--no-disabled'])
        else:
            # A failed describe is not proof of absence. A scoped list distinguishes permission errors.
            rules = self.js(['compute', 'firewall-rules', 'list', '--project', host, '--filter=name='+tag+'-iap'])
            if rules: raise SetupError('Cannot read the existing IAP rule')
            self.gc(['compute', 'firewall-rules', 'create', tag+'-iap', *common, '--network', network,
                     '--direction=INGRESS', '--action=ALLOW', '--rules=tcp:22'])
        self.gc(['compute', 'instances', 'add-tags', a.instance, *self.common, '--tags', tag, '--quiet'])
        for attempt in range(p['ssh_attempts']):
            check = self.ssh('true', check=False, timeout=60)
            if check.returncode == 0: break
            if attempt == p['ssh_attempts']-1:
                raise SetupError('IAP SSH failed. Check IAP/OS Login roles and the guest SSH service; no public-SSH fallback')
            time.sleep(p['ssh_retry_seconds'])
        self.ssh('test "$(cat /proc/1/comm)" = systemd && sudo -n true')
        self.gc(['compute', 'instances', 'set-disk-auto-delete', a.instance, *self.common,
                 '--disk', disk['name'], '--no-auto-delete', '--quiet'])
        return self.describe()

    def install(self, info: dict) -> None:
        a, p = self.a, self.p
        commit = run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD']).stdout.strip()
        if not re.fullmatch('[0-9a-f]{40}', commit): raise SetupError('A full pinned Git commit is required')
        if run(['git', '-C', str(ROOT), 'status', '--porcelain', '--untracked-files=no']).stdout:
            raise SetupError('Tracked checkout is modified; refusing an unreviewed archive')
        request = {'schema': 1, 'project': a.project, 'zone': a.zone, 'instance': a.instance,
                   'instance_id': str(info['id']), 'owner': a.owner, 'commit': commit,
                   'replace_legacy': a.replace_legacy, 'profile_sha256': digest(p)}
        job_id = 'wd-setup-'+commit[:12]+'-'+digest(request)[:10]
        job = '/var/lib/watchdog-host/jobs/'+job_id
        print(f'Private resumable job: {job_id}', flush=True)
        with tempfile.TemporaryDirectory(prefix='watchdog-cloud-') as temp:
            temp = Path(temp)
            archive = temp/'source.tar.gz'; req = temp/'request.json'
            run(['git', '-C', str(ROOT), 'archive', '--format=tar.gz', '--output='+str(archive), commit])
            save_json(req, request)
            remote = self.ssh('umask 077; mktemp -d /tmp/watchdog-source.XXXXXXXX').stdout.strip()
            if not re.fullmatch(r'/tmp/watchdog-source\.[A-Za-z0-9]{8}', remote): raise SetupError('Unexpected remote staging directory')
            self.gc(['compute', 'scp', str(archive), str(req), a.instance+':'+remote+'/', *self.common,
                     '--tunnel-through-iap', '--quiet'], timeout=600)
            script = f'''set -eu
umask 077
mkdir -p /var/lib/watchdog-host/jobs
exec 9>/run/lock/watchdog-host-launch.lock
flock -n 9
job={shlex.quote(job)}
state=$(systemctl show {shlex.quote(job_id)} --property=ActiveState --value || true)
case "$state" in active|activating) echo 'Existing job is still running'; exit 0;; esac
install -d -m 0700 "$job" "$job/source"
if test -f "$job/status.json" && python3 -c 'import json,sys; sys.exit(json.load(open(sys.argv[1])).get("status") != "complete")' "$job/status.json" && systemctl is-active --quiet watchdog.service xrdp.service watchdog-vnc.service; then
  echo 'Reusing completed local installation'; exit 0
fi
printf '%s  %s\n' {shlex.quote(file_hash(archive))} {shlex.quote(remote+'/source.tar.gz')} | sha256sum -c -
printf '%s  %s\n' {shlex.quote(file_hash(req))} {shlex.quote(remote+'/request.json')} | sha256sum -c -
cp {shlex.quote(remote+'/source.tar.gz')} "$job/source.tar.gz"
cp {shlex.quote(remote+'/request.json')} "$job/request.json"
tar -xzf "$job/source.tar.gz" --no-same-owner -C "$job/source"
printf '%s\\n' '{{"schema":1,"status":"queued","phase":"starting","error":null}}' > "$job/status.json"
systemd-run --collect --unit={shlex.quote(job_id)} --property=UMask=0077 --property=RuntimeMaxSec={p['install_timeout_seconds']} /usr/bin/python3 "$job/source/scripts/devbox.py" vm --job "$job"
'''
            self.ssh(shlex.join(['sudo', 'bash', '-c', script]), timeout=120)
            self.ssh(shlex.join(['rm', '-rf', '--', remote]))
        deadline = time.monotonic()+p['install_timeout_seconds']+120
        last = None
        while time.monotonic() < deadline:
            r = self.ssh(shlex.join(['sudo', 'cat', job+'/status.json']), check=False, timeout=60)
            if r.returncode == 0:
                state = json.loads(r.stdout)
                message = (state['status'], state['phase'])
                if message != last: print(' / '.join(message), flush=True); last = message
                if state['status'] == 'complete': break
                if state['status'] == 'failed':
                    self.ssh(shlex.join(['sudo', 'tail', '-n', '50', job+'/install.log']), capture=False, check=False)
                    raise SetupError(f'VM job stopped at {state["phase"]}: {state.get("error")}; private log {job}/install.log')
            active = self.ssh('systemctl is-active '+job_id, check=False, timeout=60).stdout.strip()
            if active in ('inactive', 'failed', 'unknown'):
                raise SetupError(f'VM job is no longer active; inspect sudo journalctl -u {job_id} and {job}/install.log; rerun the same paste to resume')
            time.sleep(p['poll_seconds'])
        else: raise SetupError('Polling timed out; VM work is independent of this terminal. Rerun the same paste to reconnect')
        print('VM phase complete. Deploying the HTTPS wake gate; this cloud phase can also be rerun.', flush=True)
        run(['bash', str(ROOT/'scripts/deploy_gcp_gate.sh'), '--project', a.project, '--zone', a.zone,
             '--instance', a.instance, '--idle-minutes', str(p['idle']['minutes'])], timeout=1800, capture=False)
        self.ssh('sudo watchdogctl signin-link '+shlex.quote(a.owner), capture=False)
        print('\nChrome Remote Desktop authorization (interactive, never paste its code into a support log):\n'+
              shlex.join(['gcloud','compute','ssh',a.instance,*self.common,'--tunnel-through-iap','--', '-t',
                          'sudo watchdog-desktop crd-register']), flush=True)
        if a.configure_crd:
            print('Open https://remotedesktop.google.com/headless in another tab. Authorize and copy the Linux command.\n'
                  'Paste it at the hidden prompt below, then choose your own PIN.', flush=True)
            self.ssh('sudo watchdog-desktop crd-register', tty=True, timeout=1200, capture=False)
        print('Passwords: run sudo watchdog-desktop credentials on the VM. RDP/VNC remain loopback-only.\n'
              'To keep work awake: sudo watchdogctl keep-awake 3; release: sudo watchdogctl keep-awake off.', flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest='mode', required=True)
    cloud = sub.add_parser('cloud')
    for name in ('project', 'zone', 'instance', 'owner'): cloud.add_argument('--'+name, required=True)
    cloud.add_argument('--ensure-capacity', action='store_true', help='Allow only needed RAM/disk increases and a VM restart for RAM')
    cloud.add_argument('--preserve-ip', action='store_true', help='Promote current external IP to static; never release it automatically')
    cloud.add_argument('--replace-legacy', action='store_true', help='Backup/quarantine a positively identified legacy systemd project')
    cloud.add_argument('--configure-crd', action='store_true', help='Finish by prompting for Google authorization over an interactive IAP SSH session')
    cloud.add_argument('--plan', action='store_true')
    host = sub.add_parser('vm'); host.add_argument('--job', type=Path, required=True)
    a = ap.parse_args()
    if a.mode == 'vm': return vm(a.job)
    valid_target(a.project, a.zone, a.instance, a.owner)
    p = policy()
    if a.plan:
        print(json.dumps({'target': f'{a.project}/{a.zone}/{a.instance}', 'profile': p, 'ensure_capacity': a.ensure_capacity,
                          'preserve_ip': a.preserve_ip, 'replace_legacy': a.replace_legacy}, indent=2)); return 0
    for tool in ('gcloud', 'git', 'tar'):
        if not shutil.which(tool): raise SetupError(f'{tool} is required; run this in GCP Cloud Shell')
    if run(['git', '-C', str(ROOT), 'status', '--porcelain', '--untracked-files=no']).stdout:
        raise SetupError('Tracked checkout modified; no cloud mutations were attempted')
    c = Cloud(a, p); c.install(c.prepare())
    return 0


if __name__ == '__main__':
    try: sys.exit(main())
    except (SetupError, OSError, ValueError, KeyError, subprocess.SubprocessError) as e:
        print(f'Devbox setup stopped: {e}', file=sys.stderr); sys.exit(1)
