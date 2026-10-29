"""Offline regressions for scripts/remote_desktop.sh. Does not install packages or launch desktops.

The Desktop class is copied from tests/test_desktop_recovery.py at 7898068
(astra/desktop-field-ready-20261007, PR #11); only test_generated_launchers_parse changed,
because the heartbeat launcher is no longer generated. Its Idle and Workstation classes are not
carried over: they test the idle poweroff and the Cloud Shell workstation entry, which are
not part of this repository (see docs/history/PR_10_12_REVIEW_2026-10-29.md).
"""
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/remote_desktop.sh'


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
            subprocess.run(['bash', '-n', str(Path(temp) / 'remote-desktop-session')], check=True)
            # The /run/keep-awake heartbeat is no longer generated or started (E3.23).
            self.assertFalse((Path(temp) / 'remote-desktop-heartbeat').exists())
            self.assertNotIn('remote-desktop-heartbeat', (Path(temp) / 'remote-desktop-session').read_text())

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


if __name__ == "__main__":
    unittest.main()
