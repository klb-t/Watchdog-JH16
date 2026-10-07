"""Offline regressions. Does not install packages, launch desktops, or touch GCP."""
import importlib.util
import os
from pathlib import Path
import re
import stat
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/remote_desktop.sh'
spec = importlib.util.spec_from_file_location('idle', ROOT / 'scripts/watchdog_idle.py')
idle = importlib.util.module_from_spec(spec); spec.loader.exec_module(idle)


class Desktop(unittest.TestCase):
    def shell(self, command, *args, env=None):
        return subprocess.run(['bash', '-c', 'source "$1"; shift; ' + command, 'test', str(SCRIPT), *map(str, args)],
                              text=True, capture_output=True, env=env)

    def test_bash_syntax(self):
        subprocess.run(['bash', '-n', str(SCRIPT)], check=True)

    def test_source_does_not_run_installer(self):
        r = self.shell('printf ready')
        self.assertEqual((r.returncode, r.stdout), (0, 'ready'))

    def test_original_pipeline_fails_with_sigpipe(self):
        r = subprocess.run(['bash', '-c', "set -eo pipefail; pw=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 8); echo BAD"], capture_output=True)
        self.assertEqual(r.returncode, 141)
        self.assertNotIn(b'BAD', r.stdout)

    def test_password_and_private_permissions(self):
        with tempfile.TemporaryDirectory() as temp:
            d = Path(temp); tool = d / 'tigervncpasswd'
            tool.write_text('#!/bin/sh\n[ "$1" = -f ] || exit 1\nread -r p\nprintf "12345678"\n'); tool.chmod(0o755)
            env = dict(os.environ, PATH=str(d) + ':' + os.environ['PATH'])
            # Stub runuser only; the real credential helper still executes in a temporary home.
            r = self.shell('runuser() { shift 3; "$@"; }; set_vnc_password test "$1"', d, env=env)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertRegex(r.stdout.strip(), r'^[A-Za-z2-9]{8}$')
            self.assertEqual((d / '.vnc/passwd').read_bytes(), b'12345678')
            for name in ['passwd', 'password.txt']:
                self.assertEqual(stat.S_IMODE((d / '.vnc' / name).stat().st_mode), 0o600)

    def test_password_tool_failure_is_not_success(self):
        with tempfile.TemporaryDirectory() as temp:
            d = Path(temp); tool = d / 'tigervncpasswd'; tool.write_text('#!/bin/sh\nexit 9\n'); tool.chmod(0o755)
            env = dict(os.environ, PATH=str(d) + ':' + os.environ['PATH'])
            r = self.shell('runuser() { shift 3; "$@"; }; set_vnc_password test "$1"', d, env=env)
            self.assertNotEqual(r.returncode, 0)
            self.assertFalse((d / '.vnc/passwd').exists())

    def test_managed_backup_is_unique(self):
        with tempfile.TemporaryDirectory() as temp:
            f = Path(temp) / 'cfg'; f.write_text('first')
            r = self.shell('write_managed "$1" 0600 "# $MARKER"; printf second > "$1"; write_managed "$1" 0600 "# $MARKER"', f)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(sorted(p.read_text() for p in Path(temp).glob('cfg.bak-*')), ['first', 'second'])

    def test_write_refuses_symlink(self):
        with tempfile.TemporaryDirectory() as temp:
            f = Path(temp) / 'target'; f.write_text('keep'); link = Path(temp) / 'link'; link.symlink_to(f)
            r = self.shell('write_managed "$1" 0600 changed', link)
            self.assertNotEqual(r.returncode, 0)
            self.assertEqual(f.read_text(), 'keep')

    def test_keyboard_variant_shell_configuration(self):
        with tempfile.TemporaryDirectory() as temp:
            c = Path(temp) / 'conf'; c.write_text("KEYBOARD='us(intl)'\nVNC_DISPLAY=10\n")
            r = self.shell('CONF=$1; read_conf; printf "%s" "$KEYBOARD"', c)
            self.assertEqual((r.returncode, r.stdout), (0, 'us(intl)'))

    def test_tunnel_port_is_arithmetic(self):
        with tempfile.TemporaryDirectory() as temp:
            c = Path(temp) / 'conf'; c.write_text('VNC_DISPLAY=10\n')
            r = self.shell('CONF=$1; print_how_to_connect test', c)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn('5910:127.0.0.1:5910', r.stdout)
            self.assertNotIn('59010', r.stdout)

    def test_generated_launchers_parse(self):
        with tempfile.TemporaryDirectory() as temp:
            r = self.shell('write_managed() { printf "%s\n" "$3" > "$DIR/$(basename "$1")"; }; DIR=$1; install_launchers', temp)
            self.assertEqual(r.returncode, 0, r.stderr)
            for name in ['remote-desktop-session', 'remote-desktop-heartbeat']:
                subprocess.run(['bash', '-n', str(Path(temp) / name)], check=True)

    def test_crd_paste_is_not_executed_by_shell(self):
        s = SCRIPT.read_text(); block = s.split("<<'PYCRD'\n", 1)[1].split('\nPYCRD', 1)[0]
        block = block.split("with open('/dev/tty'", 1)[0] + '\nprint(repr(argv))\n'
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / 'must-not-exist'
            cmd = f'DISPLAY= /opt/google/chrome-remote-desktop/start-host --code="$(touch {target})" --redirect-url="https://remotedesktop.google.com/_/oauthredirect" --name="$(hostname)"'
            r = subprocess.run(['python3', '-c', block, 'test', temp, cmd], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertFalse(target.exists())
            self.assertIn('--code=$(touch', r.stdout)
            self.assertNotIn('--name=$(hostname)', r.stdout)

    def test_crd_extra_command_rejected(self):
        s = SCRIPT.read_text(); block = s.split("<<'PYCRD'\n", 1)[1].split('\nPYCRD', 1)[0]
        block = block.split("with open('/dev/tty'", 1)[0]
        cmd = 'DISPLAY= /opt/google/chrome-remote-desktop/start-host --code=x --redirect-url=https://remotedesktop.google.com/_/oauthredirect --name=host ; echo bad'
        r = subprocess.run(['python3', '-c', block, 'test', '/tmp', cmd], capture_output=True)
        self.assertNotEqual(r.returncode, 0)

    def test_wallet_is_not_disabled(self):
        self.assertNotIn('write_default /etc/xdg/kwalletrc', SCRIPT.read_text())

    def test_vnc_supported_layouts(self):
        s = SCRIPT.read_text()
        self.assertIn('"$vdir/tigervnc.conf"', s)
        self.assertIn('"$modern/config.pl"', s)
        self.assertIn('systemctl stop "$unit:$n.service"', s)


class Idle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.put('etc/watchdog/idle.env', 'WATCHDOG_IDLE_MINUTES=30\n')
        self.put('proc/loadavg', '0.01 0.01 0.01 1/10 100\n')
        self.put('proc/uptime', '10000.0 1.0\n')
        self.put('proc/net/tcp', 'header\n')
        self.put('var/run/who.txt', '')
        (self.root / 'var/lib/watchdog').mkdir(parents=True)

    def tearDown(self): self.tmp.cleanup()

    def put(self, name, text):
        p = self.root / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(text); return p

    def decision(self, now=20000):
        with patch.object(idle.time, 'time', return_value=now):
            return idle.decide(**idle.gather(self.root))[0]

    def test_idle_sleeps(self): self.assertEqual(self.decision(), idle.SLEEP)

    def test_recent_desktop_input_stays(self):
        p = self.put('run/keep-awake/desktop-test-10', '')
        os.utime(p, (19950, 19950))
        self.assertEqual(self.decision(), idle.STAY)

    def test_stale_desktop_input_does_not_slide_window(self):
        p = self.put('run/keep-awake/desktop-test-10', '')
        os.utime(p, (19000, 19000))
        self.assertEqual(self.decision(20000), idle.STAY)
        self.assertEqual(self.decision(20800), idle.SLEEP)

    def test_full_interval_after_ssh_closes(self):
        self.put('var/run/who.txt', 'test pts/0 2026-10-07 12:00\n')
        self.assertEqual(self.decision(20000), idle.STAY)
        self.put('var/run/who.txt', '')
        self.assertEqual(self.decision(20001), idle.STAY)
        self.assertEqual(self.decision(21799), idle.STAY)
        self.assertEqual(self.decision(21801), idle.SLEEP)

    def test_full_interval_after_load_falls(self):
        self.put('proc/loadavg', '2 2 2 1/10 100\n'); self.assertEqual(self.decision(), idle.STAY)
        self.put('proc/loadavg', '0 0 0 1/10 100\n')
        self.assertEqual(self.decision(20001), idle.STAY)
        self.assertEqual(self.decision(21801), idle.SLEEP)

    def test_unobserved_display_session_stays_awake(self):
        self.put('var/run/who.txt', 'test :10 2026-10-07 12:00\n')
        self.assertEqual(self.decision(), idle.STAY)

    def test_other_desktop_cannot_mask_unobserved_session(self):
        self.put('var/run/who.txt', 'test :10 2026-10-07 12:00\n')
        p = self.put('run/keep-awake/desktop-other-20', '')
        os.utime(p, (18000, 18000))
        self.assertEqual(self.decision(), idle.STAY)

    def test_observed_idle_display_can_sleep(self):
        self.put('var/run/who.txt', 'test :10 2026-10-07 12:00\n')
        p = self.put('run/keep-awake/desktop-test-10', '')
        os.utime(p, (18000, 18000))
        self.assertEqual(self.decision(), idle.SLEEP)

    def test_logout_keeps_last_desktop_pulse(self):
        p = self.put('run/keep-awake/desktop-test-10', '')
        os.utime(p, (19950, 19950))
        self.assertEqual(self.decision(20000), idle.STAY)
        p.unlink()
        self.assertEqual(self.decision(20001), idle.STAY)
        self.assertEqual(self.decision(21750), idle.SLEEP)

    def test_busy_to_quiet_uses_first_quiet_poll(self):
        self.put('var/run/who.txt', 'test pts/0 2026-10-07 12:00\n')
        self.assertEqual(self.decision(20000), idle.STAY)
        self.put('var/run/who.txt', '')
        self.assertEqual(self.decision(20299), idle.STAY)
        self.assertEqual(self.decision(21800), idle.STAY)
        self.assertEqual(self.decision(22099), idle.SLEEP)

    def test_bad_saved_state_is_not_idle(self):
        self.put('var/lib/watchdog/idle-last-observed-use.json', 'not-json')
        with self.assertRaises(ValueError): self.decision()

    def test_missing_load_is_not_idle(self):
        (self.root / 'proc/loadavg').unlink()
        with self.assertRaises(OSError): self.decision()

    def test_missing_network_is_not_idle(self):
        (self.root / 'proc/net/tcp').unlink()
        with self.assertRaises(OSError): self.decision()

    def test_invalid_load_is_not_idle(self):
        for v in ['nan', 'inf', '-1', 'oops']:
            with self.subTest(v=v):
                self.put('proc/loadavg', f'0 0 {v} 1/10 1\n')
                with self.assertRaises(ValueError): self.decision()

    def test_invalid_hold_is_not_ignored(self):
        self.put('var/lib/watchdog/keep-awake-until', 'broken')
        with self.assertRaises(ValueError): self.decision()

    def test_manual_hold_stays(self):
        self.put('var/lib/watchdog/keep-awake-until', '21000')
        self.assertEqual(self.decision(), idle.STAY)

    def test_boot_grace(self):
        self.put('proc/uptime', '60 1')
        self.assertEqual(self.decision(), idle.STAY)

    def test_symlink_signal_fails_safe(self):
        d = self.root / 'run/keep-awake'; d.mkdir(parents=True)
        (d / 'desktop-bad').symlink_to('/etc/passwd')
        with self.assertRaises(ValueError): self.decision()

    def test_configured_ignore_ports_validated(self):
        self.put('etc/watchdog/idle.env', 'WATCHDOG_IDLE_MINUTES=30\nWATCHDOG_IDLE_IGNORE_PORTS=70000\n')
        with self.assertRaises(ValueError): self.decision()

    def test_ipv4_connections(self):
        text = 'header\n0: 00000000:01BB 00000000:0000 0A\n1: 0100007F:01BB 08080808:ABCD 01\n'
        self.assertEqual(idle.public_inbound([(text, False)]), [443])
        self.assertEqual(idle.public_inbound([(text, False)], {443}), [])

    def test_cli_reports_failure_without_poweroff(self):
        (self.root / 'proc/loadavg').unlink()
        r = subprocess.run(['python3', str(ROOT / 'scripts/watchdog_idle.py')], env=dict(os.environ, WATCHDOG_ROOT=str(self.root)), capture_output=True)
        self.assertEqual(r.returncode, 20)
        self.assertIn(b'staying on', r.stderr)


class Workstation(unittest.TestCase):
    def harness(self, status='RUNNING', fail=False):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        d = Path(temp.name); repo = d / 'repo'; (repo / 'scripts').mkdir(parents=True)
        for name in ['deploy_workstation.sh', 'remote_desktop.sh']:
            shutil.copy2(ROOT / 'scripts' / name, repo / 'scripts' / name)
        for name in ['deploy_gcp_vm.sh', 'deploy_gcp_gate.sh']:
            (repo / 'scripts' / name).write_text('#!/bin/bash\n'
                + 'printf "%s %s\n" "$(basename "$0")" "$*" >> "$CALLS"\n'
                + ('[[ ${FAIL_DEPLOY:-0} != 1 ]]\n' if name == 'deploy_gcp_vm.sh' else 'true\n'))
        subprocess.run(['git', 'init', '-q', str(repo)], check=True)
        subprocess.run(['git', '-C', str(repo), 'add', '.'], check=True)
        subprocess.run(['git', '-C', str(repo), '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
                        'commit', '-qm', 'fixture'], check=True)
        bins = d / 'bin'; bins.mkdir()
        for name in ['python3', 'npx', 'gcloud']:
            f = bins / name
            f.write_text('#!/bin/bash\n'
                + 'printf "%s %s\n" "$(basename "$0")" "$*" >> "$CALLS"\n'
                + ('if [[ $* == *"value(status)"* ]]; then echo "$VM_STATE"; fi\n' if name == 'gcloud' else 'true\n'))
            f.chmod(0o755)
        log = d / 'calls'
        env = dict(os.environ, PATH=str(bins) + ':' + os.environ['PATH'], CALLS=str(log),
                   VM_STATE=status, FAIL_DEPLOY='1' if fail else '0')
        r = subprocess.run(['bash', str(repo / 'scripts/deploy_workstation.sh'), '--project', 'test-project',
                            '--zone', 'europe-west4-c', '--instance', 'test-vm', '--owner', 'test@example.invalid',
                            '--non-interactive'], env=env, capture_output=True, text=True, timeout=10)
        return r, log.read_text() if log.exists() else ''

    def test_order_and_iap_shared_host(self):
        r, calls = self.harness()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertLess(calls.index('npx '), calls.index('gcloud '))
        self.assertLess(calls.index('deploy_gcp_vm.sh '), calls.index('deploy_gcp_gate.sh '))
        self.assertIn('--shared-host', calls)
        for line in calls.splitlines():
            if line.startswith('gcloud compute ssh '): self.assertIn('--tunnel-through-iap', line)
        self.assertIn('--user "$(id -un)"', calls)

    def test_failed_application_never_starts_desktop_or_gate(self):
        r, calls = self.harness(fail=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('phase watchdog', r.stderr)
        self.assertNotIn('deploy_gcp_gate.sh ', calls)
        self.assertNotIn('gcloud compute ssh ', calls)

    def test_stopped_vm_is_started_not_recreated(self):
        r, calls = self.harness(status='TERMINATED')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('gcloud compute instances start test-vm ', calls)
        self.assertNotIn('instances delete', calls)
        self.assertNotIn('instances create', calls)

    def test_unsettled_vm_is_not_force_reset(self):
        r, calls = self.harness(status='STOPPING')
        self.assertNotEqual(r.returncode, 0)
        self.assertNotIn('deploy_gcp_vm.sh ', calls)
        self.assertNotIn(' reset ', calls)

    def test_all_shell_entrypoints_parse(self):
        for name in ['remote_desktop.sh', 'deploy_workstation.sh', 'workstation_finish.sh']:
            subprocess.run(['bash', '-n', str(ROOT / 'scripts' / name)], check=True)


if __name__ == '__main__': unittest.main(verbosity=2)
