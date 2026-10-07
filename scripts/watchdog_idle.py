#!/usr/bin/env python3
"""VM idle decision. 0=sleep, 10=stay awake, other=measurement/configuration error.

A point-in-time absence of sessions is not a completed idle interval. Current
terminal/load/network use is persisted; application and desktop heartbeat mtimes
are observations, not timers to refresh merely because they are still recent.
No shutdown is performed here. watchdogctl owns the install lock and poweroff.
"""
import ipaddress
import json
import math
import os
import pathlib
import re
import stat
import subprocess
import sys
import tempfile
import time

STAY, SLEEP = 10, 0
IGNORED_PORTS = {22, 8080}


def parse_tcp(text, v6):
    """Yield (state, local_port, remote_ip) from /proc/net/tcp[6]."""
    for line in text.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 4:
            continue
        local, remote, state = parts[1:4]
        try:
            lport = int(local.rsplit(':', 1)[1], 16)
            raw = bytes.fromhex(remote.rsplit(':', 1)[0])
            if v6:
                raw = b''.join(raw[i:i + 4][::-1] for i in range(0, 16, 4))
                ip = ipaddress.IPv6Address(raw)
                ip = ip.ipv4_mapped or ip
            else:
                ip = ipaddress.IPv4Address(raw[::-1])
        except (ValueError, IndexError):
            continue
        yield state, lport, ip


def public_inbound(tables, ignored_ports=None):
    ignored_ports = IGNORED_PORTS if ignored_ports is None else set(ignored_ports)
    rows = [r for text, v6 in tables for r in parse_tcp(text, v6)]
    listening = {p for s, p, _ in rows if s == '0A'}
    return sorted({p for s, p, ip in rows
                   if s == '01' and p in listening and p not in ignored_ports and ip.is_global})


def decide(*, now, uptime_s, idle_minutes, max_load, load15, activity_mtime,
           sessions, keep_until, public_ports):
    window = idle_minutes * 60
    if keep_until and keep_until > now:
        return STAY, f'Kept awake by watchdogctl keep-awake for another {int(keep_until - now)}s; staying on.'
    if uptime_s < window:
        return STAY, f'Up {int(uptime_s)}s; staying on for at least {idle_minutes} minutes after boot.'
    if sessions:
        return STAY, f'{sessions} login session(s) open; staying on.'
    if load15 is not None and load15 >= max_load:
        return STAY, f'Machine busy: 15-minute load {load15:.2f} is at or above {max_load:.2f}; staying on.'
    if public_ports:
        return STAY, f'Inbound connections from the internet on port(s) {", ".join(map(str, public_ports))}; staying on.'
    if activity_mtime is not None and now - activity_mtime < window:
        return STAY, f'Last use {int(now - activity_mtime)}s ago; staying on.'
    return SLEEP, f'No use for {idle_minutes} minutes; powering off.'


def read_env_file(path):
    out = {}
    if path.is_file():
        for line in path.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                k, v = line.split('=', 1)
                out[k.strip()] = v.strip()
    return out


def regular_mtime(path):
    """Do not follow signals into arbitrary files, and do not conceal read errors."""
    try:
        value = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(value.st_mode):
        raise ValueError(f'Expected a regular activity file: {path}')
    return value.st_mtime


def terminal_session_count(text):
    # Display-only entries are represented by desktop input heartbeats, not by
    # keeping a disconnected VNC/CRD desktop alive forever. Unknown rows stay busy.
    count = 0
    for line in text.splitlines():
        fields = line.split()
        if fields and not (len(fields) > 1 and re.fullmatch(r':\d+(?:\.\d+)?', fields[1])):
            count += 1
    return count


def remember_use(path, now, busy=False):
    """Persist a timestamp atomically; failure prevents the shutdown decision."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.idle-use-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as out:
            out.write(json.dumps({'schema': 'watchdog.idle-use/1', 'observed_at': now, 'busy': busy}) + '\n')
        os.utime(name, (now, now))
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def gather(root):
    root = pathlib.Path(root)
    isolated = str(root) != '/'
    cfg = read_env_file(root / 'etc/watchdog/idle.env')
    idle = int(cfg.get('WATCHDOG_IDLE_MINUTES', '0'))
    max_load = float(cfg.get('WATCHDOG_IDLE_MAX_LOAD', '0.50'))
    if not 10 <= idle <= 1440 or not math.isfinite(max_load) or max_load <= 0:
        raise ValueError('Invalid idle interval/load threshold; staying on.')
    ignored = {int(v.strip()) for v in cfg.get('WATCHDOG_IDLE_IGNORE_PORTS', '22,8080').split(',') if v.strip()}
    if any(not 1 <= port <= 65535 for port in ignored):
        raise ValueError('Invalid ignored TCP port')
    now = time.time()
    activity = root / 'var/lib/watchdog/activity.json'
    keep = root / 'var/lib/watchdog/keep-awake-until'
    state = root / 'var/lib/watchdog/idle-last-observed-use.json'
    load15 = float((root / 'proc/loadavg').read_text().split()[2])
    uptime_s = float((root / 'proc/uptime').read_text().split()[0])
    if not all(math.isfinite(v) and v >= 0 for v in (load15, uptime_s)):
        raise ValueError('Invalid load or uptime measurement; staying on.')
    if isolated:
        who = root / 'var/run/who.txt'
        who_text = who.read_text() if who.is_file() else ''
    else:
        out = subprocess.run(['who'], capture_output=True, text=True, timeout=10, check=True)
        who_text = out.stdout
    sessions = terminal_session_count(who_text)
    # IPv4 table exists on supported hosts. Missing observation is not zero traffic.
    tables = [((root / 'proc/net/tcp').read_text(), False)]
    if (root / 'proc/net/tcp6').exists():
        tables.append(((root / 'proc/net/tcp6').read_text(), True))
    ports = public_inbound(tables, ignored)
    keep_until = float(keep.read_text().strip()) if regular_mtime(keep) is not None else None
    if keep_until is not None and not math.isfinite(keep_until):
        raise ValueError('Invalid keep-awake hold; staying on.')
    state_mtime = regular_mtime(state)
    previous_busy = False
    if state_mtime is not None:
        previous_busy = json.loads(state.read_text()).get('busy', False)
        if not isinstance(previous_busy, bool):
            raise ValueError('Invalid saved busy state')
    observed = [regular_mtime(activity), state_mtime]
    signals = root / 'run/keep-awake'
    if signals.exists():
        if signals.is_symlink() or not signals.is_dir():
            raise ValueError('Invalid heartbeat directory')
        observed.extend(regular_mtime(p) for p in sorted(signals.iterdir()))
    # Require evidence for this particular user/display, not any other desktop.
    for line in who_text.splitlines():
        fields = line.split()
        if len(fields) > 1 and re.fullmatch(r':\d+(?:\.\d+)?', fields[1]):
            name = re.sub(r'[^A-Za-z0-9._-]', '_', f'desktop-{fields[0]}-{fields[1][1:]}')
            if regular_mtime(signals / name) is None:
                sessions += 1
    busy = bool(sessions or load15 >= max_load or ports)
    last = max((v for v in observed if v is not None), default=None)
    if busy or previous_busy:
        # A busy->quiet transition starts a full interval at the first quiet poll.
        # This avoids shutting down up to one polling interval too early.
        remember_use(state, now, busy)
        last = max(last or now, now)
    elif last is not None and (state_mtime is None or last > state_mtime):
        # Persist the actual pulse time, not this poll's time; logout may remove it.
        remember_use(state, last, False)
    return dict(now=now, uptime_s=uptime_s, idle_minutes=idle, max_load=max_load,
                load15=load15, activity_mtime=last, sessions=sessions,
                keep_until=keep_until, public_ports=ports)


if __name__ == '__main__':
    try:
        code, message = decide(**gather(os.environ.get('WATCHDOG_ROOT', '/') or '/'))
    except (OSError, ValueError, IndexError, AttributeError, subprocess.SubprocessError) as exc:
        print(f'Idle observation failed; staying on: {exc}', file=sys.stderr)
        sys.exit(20)
    print(message)
    sys.exit(code)
