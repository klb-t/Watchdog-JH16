#!/usr/bin/env python3
"""Small host-operation primitives. Configuration is data, never shell code."""
from __future__ import annotations
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Any

ROOT = Path(__file__).resolve().parent.parent


class SetupError(RuntimeError):
    pass


def run(argv: list[str], *, timeout: int = 120, input: str | None = None,
        check: bool = True, capture: bool = True) -> subprocess.CompletedProcess[str]:
    try:
        p = subprocess.run(argv, input=input, text=True, capture_output=capture, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise SetupError(f'{argv[0]}: {type(e).__name__}; no automatic mutation retry') from e
    if check and p.returncode:
        # Do not repeat argv: authentication codes and owner identities may be there.
        raise SetupError(f'{argv[0]} failed ({p.returncode}): {(p.stderr or "")[-1600:]}')
    return p


def atomic(path: Path, text: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as f:
            os.fchmod(f.fileno(), mode)
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def save_json(path: Path, value: Any, mode: int = 0o600) -> None:
    atomic(path, json.dumps(value, indent=2, sort_keys=True) + '\n', mode)


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def integer(v: Any, low: int, high: int, name: str) -> int:
    if type(v) is not int or not low <= v <= high:
        raise SetupError(f'{name}: expected integer {low}..{high}')
    return v


def validate_policy(p: dict) -> dict:
    if p.get('schema') != 'watchdog.devbox/1' or p.get('shared_host') is not True:
        raise SetupError('Only the versioned shared-host profile is accepted')
    for key, lo, hi in [('minimum_ram_gb', 4, 128), ('minimum_disk_gb', 20, 2048),
                        ('free_space_gb', 12, 1024), ('ssh_attempts', 1, 60),
                        ('ssh_retry_seconds', 1, 60), ('poll_seconds', 2, 60),
                        ('install_timeout_seconds', 60, 14400), ('apt_lock_seconds', 30, 1800)]:
        integer(p[key], lo, hi, key)
    if not re.fullmatch(r'[a-z0-9-]+', p['upgrade_machine_type']):
        raise SetupError('Invalid machine type')
    if p['iap_source'] != '35.235.240.0/20':
        raise SetupError('IAP source must be the documented IPv4 forwarding range')
    d, idle = p['desktop'], p['idle']
    if d['default'] not in ('kde', 'gnome'):
        raise SetupError('Desktop must be kde or gnome; no silent substitution')
    integer(d['rdp_port'], 1024, 65535, 'rdp_port')
    integer(d['vnc_display'], 1, 99, 'vnc_display')
    if d['rdp_port'] == 5900 + d['vnc_display']:
        raise SetupError('Desktop ports collide')
    if not re.fullmatch(r'[1-9][0-9]{2,3}x[1-9][0-9]{2,3}', d['geometry']):
        raise SetupError('Invalid desktop geometry')
    if set(d['users']) != {'rdp', 'vnc', 'crd'} or len(set(d['users'].values())) != 3:
        raise SetupError('Each transport needs a separate Unix account')
    if any(not re.fullmatch(r'wd-[a-z][a-z0-9-]{0,20}', u) for u in d['users'].values()):
        raise SetupError('Desktop users must be wd-* service-specific accounts')
    if not d['packages'] or any(not re.fullmatch(r'[a-z0-9][a-z0-9+.-]+', x) for x in d['packages']):
        raise SetupError('Invalid apt package name')
    for k in ('crd_deb', 'chrome_deb'):
        if not re.fullmatch(r'https://dl\.google\.com/linux/direct/[a-z0-9_-]+\.deb', d[k]):
            raise SetupError('Desktop downloads must use the official Google HTTPS host')
    integer(idle['minutes'], 10, 1440, 'idle minutes')
    integer(idle['poll_seconds'], 15, 300, 'idle poll')
    integer(idle['activity_sample_seconds'], 5, 60, 'activity sample')
    integer(idle['input_recent_ms'], 1000, 300000, 'input window')
    if type(idle['max_load15']) not in (int, float) or not math.isfinite(idle['max_load15']) or idle['max_load15'] <= 0:
        raise SetupError('Load threshold must be positive and finite')
    if not {22, d['rdp_port'], 5900 + d['vnc_display']}.issubset(idle['protected_tcp_ports']):
        raise SetupError('The idle policy must protect the configured SSH/RDP/VNC ports')
    for port in idle['protected_tcp_ports']:
        integer(port, 1, 65535, 'protected port')
    return p


def policy(path: Path | None = None) -> dict:
    try:
        return validate_policy(json.loads((path or ROOT / 'config/deployment/devbox.json').read_text()))
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise SetupError(f'Invalid or unreadable devbox profile: {type(e).__name__}') from e


def require_vm() -> None:
    if os.geteuid() != 0:
        raise SetupError('Use sudo on the target VM')
    if Path('/proc/1/comm').read_text().strip() != 'systemd':
        raise SetupError('This is not a systemd VM. Do not install into Cloud Shell or a container')


def env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    return dict(line.split('=', 1) for line in path.read_text().splitlines()
                if '=' in line and not line.lstrip().startswith('#'))
