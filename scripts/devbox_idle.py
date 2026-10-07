#!/usr/bin/env python3
"""Shared-host idle reconciler: unknown != idle; every busy signal resets the clock.

The existing dedicated-host controller remains available. This controller is enabled
only by the devbox profile, through a systemd drop-in; it shares the install lock.
"""
from __future__ import annotations
import argparse
import fcntl
import json
import math
import os
from pathlib import Path
import sys
import time
from devbox_common import SetupError, env_file, policy, require_vm, run, save_json
from watchdog_idle import parse_tcp, public_inbound


def decide(now: float, uptime: float, window: float, last_use: float | None,
           activity: list[float], reasons: list[str]) -> tuple[bool, float, str]:
    """Return (may_sleep, new_last_use, reason); no I/O or wall-clock access."""
    values = [now, uptime, window, *activity] + ([] if last_use is None else [last_use])
    if any(type(x) not in (int, float) or not math.isfinite(x) or x < 0 for x in values) or window <= 0:
        raise SetupError('Invalid time observation; staying on')
    last = now if last_use is None else last_use
    if activity:
        last = max(last, *activity)
    if reasons:
        return False, max(last, now), '; '.join(reasons)
    if uptime < window:
        return False, last, 'boot grace'
    if now - last < window:
        return False, last, f'last activity {max(0, int(now-last))}s ago'
    return True, last, f'no use for at least {int(window/60)} minutes'


def observe(root: Path, p: dict, now: float) -> tuple[float, list[float], list[str]]:
    proc = root / 'proc'
    uptime = float((proc / 'uptime').read_text().split()[0])
    load = float((proc / 'loadavg').read_text().split()[2])
    if not math.isfinite(load) or load < 0:
        raise SetupError('Invalid load measurement')
    reasons = ['load above threshold'] if load >= p['idle']['max_load15'] else []
    tables = [((proc / 'net/tcp').read_text(), False)]  # required, not empty-on-error
    if (proc / 'net/tcp6').exists():
        tables.append(((proc / 'net/tcp6').read_text(), True))
    for text, v6 in tables:
        lines = text.splitlines()
        if not lines or 'local_address' not in lines[0] or not any(k in lines[0] for k in ('rem_address', 'remote_address')):
            raise SetupError('Unreadable TCP table header')
        if len(list(parse_tcp(text, v6))) != len([line for line in lines[1:] if line.strip()]):
            raise SetupError('Malformed TCP observation')
    protected = set(p['idle']['protected_tcp_ports'])
    if any(state == '01' and port in protected for text, v6 in tables for state, port, _ in parse_tcp(text, v6)):
        reasons.append('SSH/RDP/VNC connection (including IAP and loopback)')
    if public_inbound(tables):
        reasons.append('another service has a public visitor')
    if root == Path('/'):
        sessions = run(['who']).stdout.strip()
    else:
        sessions = (root / 'run/who.txt').read_text()
    # GUI input has its own signal; a persistent virtual display alone is not use.
    gui_users = set(p['desktop']['users'].values())
    if any(line.split()[0] not in gui_users for line in sessions.splitlines() if line.split()):
        reasons.append('login session')
    keep = root / 'var/lib/watchdog/keep-awake-until'
    activity = []
    if keep.exists():
        until = float(keep.read_text().strip())
        if not math.isfinite(until) or until < 0:
            raise SetupError('Invalid keep-awake deadline')
        if until > now:
            reasons.append('manual keep-awake')
    for f in [root / 'var/lib/watchdog/activity.json', *sorted((root / 'var/lib/watchdog-desktop/activity').glob('*/last-input'))]:
        if f.exists():
            activity.append(f.stat().st_mtime)
    return uptime, activity, reasons


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--poweroff', action='store_true')
    a = ap.parse_args()
    require_vm()
    p = policy(Path('/etc/watchdog-desktop/profile.json'))
    cfg = env_file(Path('/etc/watchdog/idle.env'))
    if not cfg:
        print('Idle shutdown is not enabled; staying on')
        return 0
    minutes = int(cfg.get('WATCHDOG_IDLE_MINUTES', str(p['idle']['minutes'])))
    if not 10 <= minutes <= 1440:
        raise SetupError('Invalid idle minutes; staying on')
    lock = Path('/run/lock/watchdog-install.lock')
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open('a') as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Install or backup in progress; staying on')
            return 0
        now = time.time()
        uptime, activity, reasons = observe(Path('/'), p, now)
        state_path = Path('/var/lib/watchdog-host/idle-state.json')
        boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        state = json.loads(state_path.read_text()) if state_path.exists() else {}
        last = state.get('last_use') if state.get('boot_id') == boot else None
        sleep, last, reason = decide(now, uptime, minutes*60, last, activity, reasons)
        save_json(state_path, {'schema': 1, 'boot_id': boot, 'last_use': last, 'reason': reason, 'observed_at': now})
        print(('Sleep eligible: ' if sleep else 'Staying on: ') + reason, flush=True)
        if sleep and a.poweroff:
            run(['systemctl', 'poweroff'])
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (SetupError, OSError, ValueError, KeyError, TypeError) as e:
        print(f'Idle observation failed; staying on: {e}', file=sys.stderr)
        sys.exit(1)
