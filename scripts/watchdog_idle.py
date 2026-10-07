#!/usr/bin/env python3
"""Should this VM power itself off? (E3.20, `watchdogctl idle-check`)

Exit 0 and a line "No use for N minutes; powering off." — go to sleep.
Exit 10 and the reason — stay on. Anything else is an error: staying on is the safe default.

The machine may run other services next to WatchDog, so "idle" means nothing is
happening beyond the system's own background work:

  * boot grace period — never within N minutes of boot;
  * WatchDog use — signed-in requests and running jobs (activity file);
  * an open login session (SSH, console);
  * load — the 15-minute load average at or above WATCHDOG_IDLE_MAX_LOAD (default 0.50);
  * inbound connections from the public internet to any listening port other than
    SSH and WatchDog's own (so other services in use keep the machine awake;
    private/VPC, loopback and link-local peers do not, since containers and the
    cloud agent hold such connections open permanently);
  * a manual hold: `watchdogctl keep-awake HOURS`.

Standard library only. Pure decision function; the CLI only gathers facts.
"""
import ipaddress
import json
import os
import pathlib
import subprocess
import sys
import time

STAY, SLEEP = 10, 0
IGNORED_PORTS = {22, 8080}


def parse_tcp(text, v6):
    """Yield (state, local_port, remote_ip) for each row of /proc/net/tcp[6]."""
    for line in text.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 4:
            continue
        local, remote, state = parts[1], parts[2], parts[3]
        try:
            lport = int(local.rsplit(':', 1)[1], 16)
            raw = bytes.fromhex(remote.rsplit(':', 1)[0])
            if v6:  # four little-endian 32-bit words
                raw = b''.join(raw[i:i + 4][::-1] for i in range(0, 16, 4))
                ip = ipaddress.IPv6Address(raw)
                ip = ip.ipv4_mapped or ip
            else:
                ip = ipaddress.IPv4Address(raw[::-1])
        except (ValueError, IndexError):
            continue
        yield state, lport, ip


def public_inbound(tables):
    """Ports (not SSH/WatchDog) with an ESTABLISHED connection from a public address."""
    rows = [r for text, v6 in tables for r in parse_tcp(text, v6)]
    listening = {p for s, p, _ in rows if s == '0A'}
    busy = set()
    for state, port, ip in rows:
        if state == '01' and port in listening and port not in IGNORED_PORTS and ip.is_global:
            busy.add(port)
    return sorted(busy)


def decide(*, now, uptime_s, idle_minutes, max_load, load15, activity_mtime, sessions, keep_until, public_ports):
    window = idle_minutes * 60
    if keep_until and keep_until > now:
        return STAY, f'Kept awake by watchdogctl keep-awake for another {int(keep_until - now)}s; staying on.'
    if uptime_s < window:
        return STAY, f'Up {int(uptime_s)}s; staying on for at least {idle_minutes} minutes after boot.'
    if activity_mtime is not None and now - activity_mtime < window:
        return STAY, f'Last use {int(now - activity_mtime)}s ago; staying on.'
    if sessions:
        return STAY, f'{sessions} login session(s) open; staying on.'
    if load15 is not None and load15 >= max_load:
        return STAY, f'Machine busy: 15-minute load {load15:.2f} is at or above {max_load:.2f}; staying on.'
    if public_ports:
        return STAY, f'Inbound connections from the internet on port(s) {", ".join(map(str, public_ports))}; staying on.'
    return SLEEP, f'No use for {idle_minutes} minutes; powering off.'


def read_env_file(path):
    out = {}
    if path.is_file():
        for line in path.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                k, v = line.split('=', 1)
                out[k.strip()] = v.strip()
    return out


def gather(root):
    root = pathlib.Path(root)
    isolated = str(root) != '/'
    cfg = read_env_file(root / 'etc/watchdog/idle.env')
    idle = int(cfg.get('WATCHDOG_IDLE_MINUTES', '0'))
    if idle < 10:
        raise SystemExit('Invalid WATCHDOG_IDLE_MINUTES.')
    max_load = float(cfg.get('WATCHDOG_IDLE_MAX_LOAD', '0.50'))
    activity = root / 'var/lib/watchdog/activity.json'
    keep = root / 'var/lib/watchdog/keep-awake-until'
    try:
        load15 = float((root / 'proc/loadavg').read_text().split()[2])
    except (OSError, IndexError, ValueError):
        load15 = None
    if isolated:  # tests: sessions come from a fixture, not the host
        who = root / 'var/run/who.txt'
        sessions = len([l for l in who.read_text().splitlines() if l.strip()]) if who.is_file() else 0
    else:
        out = subprocess.run(['who'], capture_output=True, text=True, timeout=10)
        if out.returncode != 0:
            raise SystemExit('Cannot list login sessions; staying on.')
        sessions = len([l for l in out.stdout.splitlines() if l.strip()])
    tables = []
    for name, v6 in (('tcp', False), ('tcp6', True)):
        f = root / 'proc/net' / name
        if f.is_file():
            tables.append((f.read_text(), v6))
    try:
        keep_until = float(keep.read_text().strip()) if keep.is_file() else None
    except ValueError:
        keep_until = None
    return dict(now=time.time(), uptime_s=float((root / 'proc/uptime').read_text().split()[0]), idle_minutes=idle,
                max_load=max_load, load15=load15, activity_mtime=activity.stat().st_mtime if activity.is_file() else None,
                sessions=sessions, keep_until=keep_until, public_ports=public_inbound(tables))


if __name__ == '__main__':
    code, message = decide(**gather(os.environ.get('WATCHDOG_ROOT', '/') or '/'))
    print(message)
    sys.exit(code)
