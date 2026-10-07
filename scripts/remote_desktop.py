#!/usr/bin/env python3
"""Managed KDE/GNOME sessions over RDP, TigerVNC and Chrome Remote Desktop.

Only this installer's accounts/configuration are changed. CRD registration is a
separate interactive action: neither a Google authorization code nor PIN is logged.
"""
from __future__ import annotations
import argparse
import fcntl
import getpass
import grp
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shutil
import socket
import string
import subprocess
import sys
import time
from devbox_common import (SetupError, ROOT, atomic, digest, env_file, file_hash,
                           policy, require_vm, run, save_json)

ETC = Path('/etc/watchdog-desktop')
LIB = Path('/usr/local/lib/watchdog')
STATE = Path('/var/lib/watchdog-desktop')
MARKER = 'Watchdog devbox managed account'


def ini_change(text: str, section: str, updates: dict[str, str]) -> str:
    """Change one section without rewriting/comment-stripping the rest of an INI."""
    lines, out, active, found = text.splitlines(), [], False, False
    pending = dict(updates)
    for line in lines:
        h = re.fullmatch(r'\s*\[([^]]+)\]\s*', line)
        if h:
            if active:
                out.extend(f'{k}={v}' for k, v in pending.items()); pending.clear()
            active = h[1].casefold() == section.casefold()
            found |= active
        m = re.match(r'^\s*([^;#=\s]+)\s*=', line)
        if active and m and m[1].casefold() in {x.casefold() for x in updates}:
            key = next(x for x in updates if x.casefold() == m[1].casefold())
            if key in pending:
                out.append(f'{key}={pending.pop(key)}')
            continue  # eliminate duplicate settings within this section
        out.append(line)
    if not found:
        out.extend(['', f'[{section}]'])
    out.extend(f'{k}={v}' for k, v in pending.items())
    return '\n'.join(out) + '\n'


def credential_set(existing: dict | None, users: dict) -> dict:
    if existing is not None:
        if set(existing.get('accounts', {})) != set(users.values()) or len(existing.get('vnc', '')) != 8:
            raise SetupError('Existing credentials are inconsistent; refusing to reset passwords')
        return existing
    alphabet = string.ascii_letters + string.digits
    return {'accounts': {u: ''.join(secrets.choice(alphabet) for _ in range(28)) for u in users.values()},
            'vnc': ''.join(secrets.choice(alphabet) for _ in range(8))}


def launcher() -> str:
    return '''#!/bin/bash
# Managed by remote_desktop.py; one Unix account per transport.
set -eu
unset SESSION_MANAGER DBUS_SESSION_BUS_ADDRESS
export XDG_SESSION_TYPE=x11
export LIBGL_ALWAYS_SOFTWARE=1
export QT_X11_NO_MITSHM=1
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
[ -d "$XDG_RUNTIME_DIR" ] || { echo 'No user runtime directory' >&2; exit 1; }
/usr/bin/python3 /usr/local/lib/watchdog/remote_desktop.py heartbeat &
heartbeat=$!
trap 'kill "$heartbeat" 2>/dev/null || true' EXIT
choice=$(cat "$HOME/.watchdog-desktop")
case "$choice" in
  kde) export XDG_CURRENT_DESKTOP=KDE; command=/usr/bin/startplasma-x11 ;;
  gnome) export XDG_CURRENT_DESKTOP=GNOME; command=/usr/bin/gnome-session ;;
  *) echo 'Unknown desktop; not substituting another session' >&2; exit 1 ;;
esac
/usr/bin/dbus-run-session -- "$command"
'''


def owned_file(path: Path, text: str, user: str, mode: int = 0o600) -> None:
    atomic(path, text, mode)
    p = pwd.getpwnam(user)
    os.chown(path, p.pw_uid, p.pw_gid)


def apt(p: dict, args: list[str]) -> None:
    run(['env', 'DEBIAN_FRONTEND=noninteractive', 'NEEDRESTART_MODE=l', 'apt-get',
         '-o', f'DPkg::Lock::Timeout={p["apt_lock_seconds"]}', *args],
        timeout=p['install_timeout_seconds'], capture=False)


def preflight(p: dict) -> None:
    require_vm()
    os_release = env_file(Path('/etc/os-release'))
    system = ':'.join(os_release.get(k, '').strip('"') for k in ('ID', 'VERSION_ID'))
    if system not in p['desktop']['supported_os']:
        raise SetupError(f'Desktop profile not validated for {system}; no OS upgrade attempted')
    if run(['dpkg', '--print-architecture']).stdout.strip() != 'amd64':
        raise SetupError('This CRD/Chrome profile needs amd64; no architecture substitution')
    managed = (ETC / 'managed-v1').exists()
    if not managed and Path('/etc/xrdp/xrdp.ini').exists():
        raise SetupError('An existing unmanaged xrdp configuration needs review; it was not replaced')
    for u in p['desktop']['users'].values():
        try:
            entry = pwd.getpwnam(u)
        except KeyError:
            continue
        if not managed or entry.pw_gecos != MARKER or entry.pw_dir != f'/home/{u}':
            raise SetupError(f'Account {u} is not owned by this installer')
    if not managed:
        for port in (p['desktop']['rdp_port'], 5900 + p['desktop']['vnc_display']):
            with socket.socket() as s:
                if s.connect_ex(('127.0.0.1', port)) == 0:
                    raise SetupError(f'TCP port {port} is occupied; no service was stopped')
    if shutil.disk_usage('/var').free < p['free_space_gb'] * 1_000_000_000:
        raise SetupError(f'Desktop/build reserve requires {p["free_space_gb"]} GB free; no automatic data pruning')


def install(p: dict) -> None:
    preflight(p)
    os.umask(0o077)
    ETC.mkdir(parents=True, exist_ok=True); ETC.chmod(0o755)
    STATE.mkdir(parents=True, exist_ok=True); STATE.chmod(0o755)
    # Mark ownership before any account can be created; reruns recognize partial installs.
    atomic(ETC / 'managed-v1', 'watchdog.devbox/1\n')
    save_json(ETC / 'profile.json', p, 0o644)
    credentials_path = ETC / 'credentials.json'
    creds = credential_set(json.loads(credentials_path.read_text()) if credentials_path.exists() else None,
                           p['desktop']['users'])
    save_json(credentials_path, creds)
    # Prevent a *new* package from exposing a default 0.0.0.0 RDP listener, or
    # starting a local display manager. Existing display managers are untouched.
    mask_file = ETC / 'installation-masks.json'
    masks = json.loads(mask_file.read_text()) if mask_file.exists() else []
    for unit in ['xrdp.service', 'xrdp-sesman.service', 'gdm3.service', 'sddm.service', 'lightdm.service']:
        link = Path('/etc/systemd/system') / unit
        unit_path = run(['systemctl', 'show', unit, '--property=FragmentPath', '--value'], check=False).stdout.strip()
        if not unit_path and not link.exists() and not link.is_symlink():
            # Persist intent first: a crash must not leave an unowned mask behind.
            if unit not in masks:
                masks.append(unit); save_json(mask_file, masks)
            run(['systemctl', 'mask', unit])
    apt(p, ['update'])
    apt(p, ['install', '-y', '--no-install-recommends', *p['desktop']['packages']])
    if not Path('/usr/bin/startplasma-x11').exists():
        # Plasma 6 distributions split the X11 session into this package.
        apt(p, ['install', '-y', '--no-install-recommends', 'plasma-workspace-x11'])
    for command in ['startplasma-x11', 'gnome-session', 'dbus-run-session', 'tigervncserver', 'tigervncpasswd', 'xprintidle']:
        if not shutil.which(command):
            raise SetupError(f'Required desktop component missing: {command}')
    downloads = STATE / 'downloads'; downloads.mkdir(exist_ok=True); downloads.chmod(0o755)
    receipt = {}
    for key, package in [('crd_deb', 'chrome-remote-desktop'), ('chrome_deb', 'google-chrome-stable')]:
        present = run(['dpkg-query', '-W', '-f=${Status}', package], check=False)
        if 'install ok installed' not in present.stdout:
            dest = downloads / (package + '.deb')
            run(['curl', '--fail', '--location', '--retry', '3', '--proto', '=https', '--tlsv1.2',
                 p['desktop'][key], '-o', str(dest)], timeout=900, capture=False)
            dest.chmod(0o644)
            expected = run(['dpkg-deb', '--field', str(dest), 'Package']).stdout.strip()
            if expected != package:
                raise SetupError(f'Downloaded package identity differs: {expected}')
            receipt[package] = {'url': p['desktop'][key], 'sha256': file_hash(dest)}
            apt(p, ['install', '-y', '--no-install-recommends', str(dest)])
        receipt.setdefault(package, {})['installed_version'] = run(['dpkg-query', '-W', '-f=${Version}', package]).stdout.strip()
    save_json(ETC / 'package-receipt.json', receipt)
    try: grp.getgrnam('devbox')
    except KeyError: run(['groupadd', 'devbox'])
    try: grp.getgrnam('watchdog-rdp')
    except KeyError: run(['groupadd', 'watchdog-rdp'])
    Path('/srv/devbox').mkdir(exist_ok=True)
    os.chown('/srv/devbox', 0, grp.getgrnam('devbox').gr_gid); os.chmod('/srv/devbox', 0o2770)
    LIB.mkdir(parents=True, exist_ok=True)
    (STATE / 'activity').mkdir(exist_ok=True); (STATE / 'activity').chmod(0o755)
    for name in ['remote_desktop.py', 'devbox_common.py', 'devbox_idle.py']:
        dest = LIB / name
        if Path(__file__).resolve().parent / name != dest:
            atomic(dest, (Path(__file__).resolve().parent / name).read_text(), 0o644)
    atomic(LIB / 'desktop-session', launcher(), 0o755)
    atomic(Path('/usr/local/sbin/watchdog-desktop'), '#!/bin/sh\nexec python3 /usr/local/lib/watchdog/remote_desktop.py "$@"\n', 0o755)
    users = p['desktop']['users']
    applied_file = ETC / 'passwords-applied.json'
    applied = json.loads(applied_file.read_text()) if applied_file.exists() else []
    for u in users.values():
        try: pwd.getpwnam(u)
        except KeyError:
            run(['useradd', '--create-home', '--shell', '/bin/bash', '--comment', MARKER, u])
        run(['usermod', '-a', '-G', 'devbox', u])
        # Never reset a user's later password change on a repeated installation.
        if u not in applied:
            run(['chpasswd'], input=f'{u}:{creds["accounts"][u]}\n')
            applied.append(u); save_json(applied_file, applied)
        run(['loginctl', 'enable-linger', u])
        home = Path(pwd.getpwnam(u).pw_dir)
        activity = STATE / 'activity' / u
        activity.mkdir(parents=True, exist_ok=True); activity.chmod(0o700)
        os.chown(activity, pwd.getpwnam(u).pw_uid, pwd.getpwnam(u).pw_gid)
        if not (home / '.watchdog-desktop').exists():
            owned_file(home / '.watchdog-desktop', p['desktop']['default'] + '\n', u)
        for filename in ['.xsession', '.chrome-remote-desktop-session']:
            owned_file(home / filename, '#!/bin/sh\nexec /usr/local/lib/watchdog/desktop-session\n', u, 0o700)
        kde = home / '.config/kwinrc'
        if not kde.exists():
            owned_file(kde, '[Compositing]\nEnabled=false\n', u)
            os.chown(kde.parent, pwd.getpwnam(u).pw_uid, pwd.getpwnam(u).pw_gid)
        # An explicit shared project directory, not shared desktop profiles/DBus sessions.
        link = home / 'Projects'
        if not link.exists(): link.symlink_to('/srv/devbox', target_is_directory=True)
    run(['usermod', '-a', '-G', 'watchdog-rdp', users['rdp']])
    run(['usermod', '-a', '-G', 'ssl-cert', 'xrdp'])
    ini = Path('/etc/xrdp/xrdp.ini')
    atomic(ini, ini_change(ini.read_text(), 'Globals', {'port': f'tcp://127.0.0.1:{p["desktop"]["rdp_port"]}',
                                                     'security_layer': 'tls'}), 0o644)
    ses = Path('/etc/xrdp/sesman.ini')
    atomic(ses, ini_change(ses.read_text(), 'Security', {'AllowRootLogin': 'false', 'TerminalServerUsers': 'watchdog-rdp',
                                                      'AlwaysGroupCheck': 'true'}), 0o644)
    # A desktop password must not silently become an internet SSH password.
    ssh = Path('/etc/ssh/sshd_config.d/95-watchdog-desktop.conf')
    previous = ssh.read_text() if ssh.exists() else None
    atomic(ssh, 'Match User ' + ','.join(users.values()) + '\n    PasswordAuthentication no\n    KbdInteractiveAuthentication no\nMatch all\n', 0o644)
    try: run(['/usr/sbin/sshd', '-t'])
    except SetupError:
        if previous is None: ssh.unlink()
        else: atomic(ssh, previous, 0o644)
        raise
    run(['systemctl', 'reload', 'ssh'])
    # VNC is loopback-only and uses its own display and account. No kill-all calls.
    vuser = users['vnc']; home = Path(pwd.getpwnam(vuser).pw_dir)
    password = home / '.vnc/passwd'
    password.parent.mkdir(exist_ok=True); password.parent.chmod(0o700)
    result = subprocess.run(['tigervncpasswd', '-f'], input=(creds['vnc']+'\n').encode(), capture_output=True, check=True)
    password.write_bytes(result.stdout); password.chmod(0o600)
    for f in (password.parent, password): os.chown(f, pwd.getpwnam(vuser).pw_uid, pwd.getpwnam(vuser).pw_gid)
    display = p['desktop']['vnc_display']
    unit = f'''# Managed by remote_desktop.py
[Unit]
Description=Watchdog private TigerVNC desktop
After=network.target
[Service]
Type=simple
User={vuser}
PAMName=login
WorkingDirectory={home}
Environment=HOME={home}
ExecStart=/usr/bin/tigervncserver :{display} -fg -localhost yes -SecurityTypes VncAuth -PasswordFile {password} -geometry {p['desktop']['geometry']} -depth 24 -xstartup /usr/local/lib/watchdog/desktop-session
ExecStop=/usr/bin/tigervncserver -kill :{display}
Restart=on-failure
RestartSec=15
[Install]
WantedBy=multi-user.target
'''
    atomic(Path('/etc/systemd/system/watchdog-vnc.service'), unit, 0o644)
    for unit_name in ('xrdp.service', 'xrdp-sesman.service'):
        if unit_name in masks:
            run(['systemctl', 'unmask', unit_name]); masks.remove(unit_name); save_json(mask_file, masks)
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', 'xrdp.service', 'watchdog-vnc.service'])
    # Assert actual socket binding, not just a successful package installation.
    for attempt in range(30):
        listeners = run(['ss', '-H', '-ltn']).stdout.splitlines()
        if all(any(line.split()[3].endswith(':'+str(port)) for line in listeners)
               for port in [p['desktop']['rdp_port'], 5900 + display]): break
        time.sleep(2)
    for port in [p['desktop']['rdp_port'], 5900 + display]:
        matches = [line.split()[3] for line in listeners if line.split()[3].endswith(':'+str(port))]
        if not matches or any(x not in (f'127.0.0.1:{port}', f'[::1]:{port}') for x in matches):
            raise SetupError(f'Desktop port {port} failed its loopback-only acceptance check')
    atomic(Path('/etc/systemd/system/watchdog-idle.service.d/devbox.conf'),
           '[Service]\nExecStart=\nExecStart=/usr/bin/python3 /usr/local/lib/watchdog/devbox_idle.py --poweroff\n', 0o644)
    atomic(Path('/etc/systemd/system/watchdog-idle.timer.d/devbox.conf'),
           f'[Timer]\nOnUnitActiveSec=\nOnUnitActiveSec={p["idle"]["poll_seconds"]}s\n', 0o644)
    run(['systemctl', 'daemon-reload'])
    if Path('/etc/watchdog/idle.env').exists(): run(['systemctl', 'restart', 'watchdog-idle.timer'])
    save_json(ETC / 'accepted.json', {'schema': 1, 'profile_sha256': digest(p), 'checked_at': time.time(),
                                    'scope': 'packages, accounts, loopback listeners; CRD authorization and visible GUI not accepted'})
    print('Desktop services configured. CRD requires your one-time Google authorization. Credentials were not logged.', flush=True)


def heartbeat() -> None:
    p = policy(ETC / 'profile.json')
    user = pwd.getpwuid(os.getuid()).pw_name
    if user not in p['desktop']['users'].values():
        raise SetupError('Not a managed desktop account')
    dest = STATE / 'activity' / user / 'last-input'
    while True:
        try:
            idle = int(run(['xprintidle'], timeout=10).stdout.strip())
            if idle < 0: raise ValueError('negative idle')
            if idle < p['idle']['input_recent_ms']: dest.touch()
        except (SetupError, OSError, ValueError):
            # Unknown GUI input state must never be interpreted as permission to power off.
            dest.touch()
        time.sleep(p['idle']['activity_sample_seconds'])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('command', choices=['install', 'credentials', 'status', 'select', 'crd-register', 'heartbeat'])
    ap.add_argument('desktop', nargs='?', choices=['kde', 'gnome'])
    ap.add_argument('--profile', type=Path)
    a = ap.parse_args()
    if a.command == 'heartbeat': heartbeat(); return 0
    require_vm()
    p = policy(a.profile or (ETC / 'profile.json' if (ETC / 'profile.json').exists() else None))
    if a.command == 'install':
        with Path('/run/lock/watchdog-install.lock').open('a') as f:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            install(p)
    elif a.command == 'credentials':
        print((ETC / 'credentials.json').read_text())
    elif a.command == 'status':
        run(['systemctl', '--no-pager', 'status', 'xrdp', 'watchdog-vnc',
             'chrome-remote-desktop@'+p['desktop']['users']['crd']], check=False, capture=False)
    elif a.command == 'select':
        if not a.desktop: raise SetupError('Use select kde or select gnome')
        for u in p['desktop']['users'].values():
            owned_file(Path(pwd.getpwnam(u).pw_dir) / '.watchdog-desktop', a.desktop+'\n', u)
        print('Selection saved. Log out of the desktop session, then reconnect; no active session was killed.')
    elif a.command == 'crd-register':
        u = p['desktop']['users']['crd']
        if run(['systemctl', 'is-active', '--quiet', 'chrome-remote-desktop@'+u], check=False).returncode == 0:
            print('Chrome Remote Desktop is already running; its registration was not replaced.')
            return 0
        try:
            grp.getgrnam('chrome-remote-desktop')
            run(['usermod', '-a', '-G', 'chrome-remote-desktop', u])
        except KeyError: pass
        # Parse only Google's --code value; never evaluate a copied shell command.
        text = getpass.getpass('Paste the Google headless command (hidden), or only its authorization code: ')
        m = re.search(r'--code=(?:"([^"\n]+)"|\x27([^\x27\n]+)\x27|([^\s]+))', text)
        code = next((x for x in m.groups() if x is not None), '') if m else text.strip()
        if not re.fullmatch(r'[A-Za-z0-9/_.~-]{10,512}', code): raise SetupError('Invalid authorization code')
        env = dict(os.environ, DISPLAY='')
        u = p['desktop']['users']['crd']
        # No capture/log: start-host prompts for the PIN directly in this terminal.
        return subprocess.run(['runuser', '-u', u, '--', '/opt/google/chrome-remote-desktop/start-host',
                               '--code='+code, '--redirect-url=https://remotedesktop.google.com/_/oauthredirect',
                               '--name='+socket.gethostname()], env=dict(env, HOME=pwd.getpwnam(u).pw_dir),
                              cwd=pwd.getpwnam(u).pw_dir).returncode
    return 0


if __name__ == '__main__':
    try: sys.exit(main())
    except (SetupError, OSError, ValueError, KeyError, subprocess.SubprocessError) as e:
        print(f'Desktop setup stopped: {e}', file=sys.stderr); sys.exit(1)
