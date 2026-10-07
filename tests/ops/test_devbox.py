"""E3.22: offline operational contracts. No host/cloud writes or paid calls.

These tests do NOT establish a live VM deployment, an X11 desktop login, a Google
OAuth registration, package availability or cloud IAM/quota acceptance.
"""
from __future__ import annotations
import argparse
import copy
import json
import math
import os
from pathlib import Path
import stat
import shlex
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
import devbox_common as common
import devbox_idle as idle
import remote_desktop as desktop
import devbox


class PolicyTests(unittest.TestCase):
    def test_valid_profile(self):
        p = common.policy()
        self.assertTrue(p['shared_host'])
        self.assertEqual(16, p['minimum_ram_gb'])
        self.assertEqual(30, p['idle']['minutes'])
    def test_invalid_numbers(self):
        for key, value in [('minimum_ram_gb', True), ('ssh_attempts', 0), ('install_timeout_seconds', -1)]:
            p = common.policy(); p[key] = value
            with self.subTest(key=key), self.assertRaises(common.SetupError): common.validate_policy(p)
    def test_unknown_schema_and_dedicated_rejected(self):
        for k, v in [('schema', 'next'), ('shared_host', False)]:
            p = common.policy(); p[k] = v
            with self.assertRaises(common.SetupError): common.validate_policy(p)
    def test_ports_must_match_idle_policy(self):
        p = common.policy(); p['desktop']['rdp_port'] = 4000
        with self.assertRaises(common.SetupError): common.validate_policy(p)
    def test_transport_users_must_be_distinct(self):
        p = common.policy(); p['desktop']['users']['vnc'] = p['desktop']['users']['rdp']
        with self.assertRaises(common.SetupError): common.validate_policy(p)
    def test_packages_are_arguments_not_shell(self):
        p = common.policy(); p['desktop']['packages'] = ['curl; touch /tmp/injected']
        with self.assertRaises(common.SetupError): common.validate_policy(p)
    def test_download_origin_is_not_replaceable_by_untrusted_host(self):
        p = common.policy(); p['desktop']['crd_deb'] = 'https://example.test/arbitrary.deb'
        with self.assertRaises(common.SetupError): common.validate_policy(p)
    def test_load_nan_inf_zero_rejected(self):
        for v in [math.nan, math.inf, -1, 0, True]:
            p = common.policy(); p['idle']['max_load15'] = v
            with self.assertRaises(common.SetupError): common.validate_policy(p)
    def test_atomic_write_is_private_and_complete(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'state.json'; common.save_json(p, {'a': 1})
            self.assertEqual(0o600, stat.S_IMODE(p.stat().st_mode))
            common.save_json(p, {'a': 2})
            self.assertEqual({'a': 2}, json.loads(p.read_text()))
            self.assertEqual(['state.json'], os.listdir(d))
    def test_cloud_shell_is_not_a_vm(self):
        with patch.object(common.os, 'geteuid', return_value=0), patch.object(Path, 'read_text', return_value='python\n'):
            with self.assertRaisesRegex(common.SetupError, 'Cloud Shell'): common.require_vm()


class IdleTests(unittest.TestCase):
    def test_first_observation_starts_full_window(self):
        sleep, last, _ = idle.decide(10000, 9999, 1800, None, [], [])
        self.assertFalse(sleep); self.assertEqual(10000, last)
    def test_every_busy_signal_resets_the_clock(self):
        for reason in ['SSH', 'load', 'public visitor', 'manual keep-awake', 'desktop input']:
            sleep, last, _ = idle.decide(10000, 9999, 1800, 1, [], [reason])
            self.assertFalse(sleep); self.assertEqual(10000, last)
            self.assertFalse(idle.decide(11799, 12000, 1800, last, [], [])[0])
            self.assertTrue(idle.decide(11800, 12000, 1800, last, [], [])[0])
    def test_app_and_gui_timestamps_share_latest_observation(self):
        self.assertFalse(idle.decide(10000, 9999, 1800, 100, [500, 9990], [])[0])
    def test_boot_grace(self):
        self.assertFalse(idle.decide(10000, 50, 1800, 1, [], [])[0])
    def test_clock_rollback_does_not_trigger_shutdown(self):
        self.assertFalse(idle.decide(10000, 9999, 1800, 20000, [], [])[0])
    def test_bad_observation_is_error_not_idle(self):
        for value in [math.nan, math.inf, -1]:
            with self.assertRaises(common.SetupError): idle.decide(value, 9999, 1800, 100, [], [])
    def fixture(self, d):
        root = Path(d)
        for p, text in {'proc/uptime': '9999 1\n', 'proc/loadavg': '0.1 0.1 0.1 1/10 1\n',
                        'proc/net/tcp': 'sl local_address rem_address st\n', 'run/who.txt': ''}.items():
            f = root/p; f.parent.mkdir(parents=True, exist_ok=True); f.write_text(text)
        return root
    def test_iap_ssh_without_tty_is_activity(self):
        with tempfile.TemporaryDirectory() as d:
            r = self.fixture(d)
            (r/'proc/net/tcp').write_text('sl local_address rem_address st\n0: 0100007F:0016 0100000A:D210 01\n')
            self.assertIn('SSH/RDP/VNC', idle.observe(r, common.policy(), 10000)[2][0])
    def test_loopback_rdp_and_vnc_are_activity(self):
        for port in [3389, 5912]:
            with tempfile.TemporaryDirectory() as d:
                r = self.fixture(d)
                (r/'proc/net/tcp').write_text(f'sl local_address rem_address st\n0: 0100007F:{port:04X} 0100007F:D210 01\n')
                self.assertTrue(idle.observe(r, common.policy(), 10000)[2])
    def test_missing_tcp_is_not_idle(self):
        with tempfile.TemporaryDirectory() as d:
            r = self.fixture(d); (r/'proc/net/tcp').unlink()
            with self.assertRaises(OSError): idle.observe(r, common.policy(), 10000)
    def test_corrupt_tcp_is_not_idle(self):
        for text in ['garbage', 'sl local_address rem_address st\nmalformed row\n']:
            with tempfile.TemporaryDirectory() as d:
                r = self.fixture(d); (r/'proc/net/tcp').write_text(text)
                with self.assertRaises(common.SetupError): idle.observe(r, common.policy(), 10000)
    def test_invalid_load_is_not_idle(self):
        with tempfile.TemporaryDirectory() as d:
            r = self.fixture(d); (r/'proc/loadavg').write_text('0 0 nan 0')
            with self.assertRaises(common.SetupError): idle.observe(r, common.policy(), 10000)
    def test_invalid_hold_is_not_ignored(self):
        with tempfile.TemporaryDirectory() as d:
            r = self.fixture(d); p = r/'var/lib/watchdog/keep-awake-until'; p.parent.mkdir(parents=True); p.write_text('nan')
            with self.assertRaises(common.SetupError): idle.observe(r, common.policy(), 10000)
    def test_background_gui_session_is_not_itself_activity(self):
        with tempfile.TemporaryDirectory() as d:
            r = self.fixture(d); (r/'run/who.txt').write_text('wd-crd :20\nwd-vnc :12\n')
            self.assertEqual([], idle.observe(r, common.policy(), 10000)[2])
    def test_other_login_remains_activity(self):
        with tempfile.TemporaryDirectory() as d:
            r = self.fixture(d); (r/'run/who.txt').write_text('operator pts/1\n')
            self.assertIn('login session', idle.observe(r, common.policy(), 10000)[2])
    def test_gui_input_file_is_observed(self):
        with tempfile.TemporaryDirectory() as d:
            r = self.fixture(d); f = r/'var/lib/watchdog-desktop/activity/wd-crd/last-input'
            f.parent.mkdir(parents=True); f.touch(); os.utime(f, (9900, 9900))
            self.assertEqual([9900], idle.observe(r, common.policy(), 10000)[1])


class DesktopTests(unittest.TestCase):
    def test_ini_changes_only_target_section(self):
        old = '; note\n[Globals]\nport=3389\nfoo=bar\n[Xorg]\nport=-1\n'
        new = desktop.ini_change(old, 'Globals', {'port': 'tcp://127.0.0.1:3389'})
        self.assertIn('; note', new); self.assertIn('foo=bar', new); self.assertIn('[Xorg]\nport=-1', new)
        self.assertIn('port=tcp://127.0.0.1:3389', new)
    def test_ini_rerun_is_idempotent(self):
        old = '[Globals]\nport=1\nport=2\n[Other]\nport=3\n'
        a = desktop.ini_change(old, 'Globals', {'port': 'tcp://127.0.0.1:3389'})
        self.assertEqual(a, desktop.ini_change(a, 'Globals', {'port': 'tcp://127.0.0.1:3389'}))
        self.assertEqual(1, a.count('tcp://'))
    def test_new_ini_section(self):
        self.assertIn('[Security]\nAllowRootLogin=false', desktop.ini_change('[Other]\na=1\n', 'Security', {'AllowRootLogin':'false'}))
    def test_passwords_are_generated_once_and_not_reset(self):
        users = common.policy()['desktop']['users']; first = desktop.credential_set(None, users)
        self.assertEqual(8, len(first['vnc']))
        self.assertTrue(all(len(x)==28 for x in first['accounts'].values()))
        self.assertIs(first, desktop.credential_set(first, users))
    def test_inconsistent_credentials_are_not_silently_replaced(self):
        with self.assertRaises(common.SetupError): desktop.credential_set({'accounts': {}, 'vnc': 'bad'}, common.policy()['desktop']['users'])
    def test_session_script_parses_as_bash(self):
        p = subprocess.run(['bash', '-n'], input=desktop.launcher(), text=True, capture_output=True)
        self.assertEqual(0, p.returncode, p.stderr)
    def test_session_has_no_silent_desktop_substitution(self):
        s = desktop.launcher()
        self.assertIn('unset SESSION_MANAGER DBUS_SESSION_BUS_ADDRESS', s)
        self.assertIn('dbus-run-session', s); self.assertIn('not substituting', s)
    def test_crd_input_is_never_a_shell_eval(self):
        source = (ROOT/'scripts/remote_desktop.py').read_text()
        self.assertIn("getpass.getpass", source)
        self.assertNotIn('shell=True', source)
        self.assertNotIn('eval(', source)
    def test_vnc_is_loopback_only(self):
        source = (ROOT/'scripts/remote_desktop.py').read_text()
        self.assertIn('-localhost yes -SecurityTypes VncAuth', source)
        self.assertIn('PAMName=login', source)


class HostTests(unittest.TestCase):
    def test_valid_target(self):
        devbox.valid_target('test-project', 'europe-west4-c', 'test-vm', 'operator@example.test')
    def test_bad_target_before_cloud_mutations(self):
        with self.assertRaises(common.SetupError): devbox.valid_target('p;cmd', 'europe-west4-c', 'vm', 'x@y.z')
    def test_identity_mismatch_is_not_accepted(self):
        with patch.object(devbox, 'require_vm'), patch.object(devbox, 'metadata', side_effect=['other-project','123','zones/europe-west4-c']):
            with self.assertRaises(common.SetupError): devbox.verify_identity({'project':'test-project','instance_id':'123','zone':'europe-west4-c'})
    def test_legacy_absent_managed_and_unknown(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); self.assertEqual('absent', devbox.legacy_state(root))
            (root/'var/lib/watchdog').mkdir(parents=True); self.assertEqual('unknown', devbox.legacy_state(root))
            service = root/'etc/systemd/system/watchdog.service'; service.parent.mkdir(parents=True)
            service.write_text('Managed by scripts/gcp_vm_bootstrap.sh')
            self.assertEqual('managed', devbox.legacy_state(root))
    def test_hardware_watchdog_name_is_not_project_identity(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); service=root/'etc/systemd/system/watchdog.service'; service.parent.mkdir(parents=True)
            service.write_text('ExecStart=/usr/sbin/watchdog\n')
            self.assertEqual('unknown', devbox.legacy_state(root))
    def test_project_marked_legacy_can_be_recognized(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); service=root/'etc/systemd/system/watchdog.service'; service.parent.mkdir(parents=True)
            service.write_text('ExecStart=/opt/watchdog/start.sh\n')
            source=root/'opt/watchdog'; source.mkdir(parents=True); (source/'package.json').write_text('{"name":"watchdog-jh16"}')
            self.assertEqual('recognized-legacy', devbox.legacy_state(root))
    def test_no_blanket_cleanup_commands(self):
        s=(ROOT/'scripts/devbox.py').read_text()
        for command in ['docker system prune', 'rm -rf /var/lib', 'rm -rf /opt', 'git reset --hard']:
            self.assertNotIn(command, s)
    def test_plan_runs_without_gcloud_and_without_writes(self):
        p = subprocess.run([sys.executable, str(ROOT/'scripts/devbox.py'), 'cloud', '--project', 'test-project',
                            '--zone','europe-west4-c','--instance','test-vm','--owner','operator@example.test','--plan'], capture_output=True, text=True)
        self.assertEqual(0,p.returncode,p.stderr); self.assertTrue(json.loads(p.stdout)['profile']['shared_host'])


class CloudHarness(devbox.Cloud):
    def __init__(self, ram=16384, disk=50, cpus=4, ensure=False):
        a = argparse.Namespace(project='test-project',zone='europe-west4-c',instance='test-vm',owner='operator@example.test',
                               ensure_capacity=ensure,preserve_ip=True,replace_legacy=True)
        super().__init__(a, common.policy()); self.calls=[]; self.ram=ram; self.disk=disk; self.cpus=cpus
        self.info={'id':'123','status':'RUNNING','machineType':'types/current',
                   'disks':[{'boot':True,'source':'https://compute/projects/test-project/zones/europe-west4-c/disks/boot'}],
                   'networkInterfaces':[{'network':'https://compute/projects/test-project/global/networks/default','accessConfigs':[{'natIP':'192.0.2.3'}]}]}
    def describe(self): return copy.deepcopy(self.info)
    def gc(self, args, **kwargs):
        self.calls.append(args)
        if args[:3]==['compute','disks','describe']: out={'name':'boot','sizeGb':str(self.disk)}
        elif args[:3]==['compute','machine-types','describe']:
            out={'memoryMb':self.ram,'guestCpus':self.cpus} if args[3]=='current' else {'memoryMb':16384,'guestCpus':4}
        elif args[:3]==['compute','addresses','list']: out=[]
        elif args[:3]==['compute','firewall-rules','list']: out=[]
        elif args[:3]==['compute','firewall-rules','describe']: return subprocess.CompletedProcess(args,1,'','not found')
        else: out={}
        return subprocess.CompletedProcess(args,0,json.dumps(out),'')
    def ssh(self, command, **kwargs): self.calls.append(['ssh',command]); return subprocess.CompletedProcess(['ssh'],0,'','')


class CloudTests(unittest.TestCase):
    def test_adequate_capacity_is_never_shrunk_or_stopped(self):
        h=CloudHarness(ram=32768,disk=100); h.prepare()
        self.assertFalse(any('stop' in x or 'resize' in x or 'set-machine-type' in x for x in h.calls))
    def test_resize_requires_explicit_flag(self):
        h=CloudHarness(ram=4096,disk=20)
        with self.assertRaises(common.SetupError): h.prepare()
        self.assertFalse(any('stop' in x for x in h.calls))
    def test_ip_is_reserved_before_stop_and_disk_resize(self):
        h=CloudHarness(ram=4096,disk=20,ensure=True); h.prepare()
        reserve=next(i for i,x in enumerate(h.calls) if x[:3]==['compute','addresses','create'])
        stop=next(i for i,x in enumerate(h.calls) if x[:3]==['compute','instances','stop'])
        self.assertLess(reserve,stop)
        self.assertTrue(any(x[:3]==['compute','disks','resize'] for x in h.calls))
    def test_cpu_downgrade_rejected_before_stop(self):
        h=CloudHarness(ram=4096,cpus=8,ensure=True)
        with self.assertRaises(common.SetupError): h.prepare()
        self.assertFalse(any(x[:3]==['compute','instances','stop'] for x in h.calls))
    def test_iap_rule_scoped_to_one_vm(self):
        h=CloudHarness(); h.prepare()
        rule=next(x for x in h.calls if x[:3]==['compute','firewall-rules','create'])
        self.assertIn('35.235.240.0/20',rule); self.assertIn('wd-123',rule)
        self.assertNotIn('0.0.0.0/0',rule)


class LaunchTests(unittest.TestCase):
    def test_rendered_remote_launcher_is_valid_bash_and_job_state_precedes_start(self):
        class Harness(CloudHarness):
            def __init__(self):
                super().__init__(); self.a.configure_crd = False; self.script = None
            def ssh(self, command, **kwargs):
                text = ''
                if 'mktemp -d' in command: text = '/tmp/watchdog-source.ABCDEFGH'
                elif command.startswith('sudo bash -c'):
                    self.script = shlex.split(command)[3]
                elif command.startswith('sudo cat'):
                    text = '{"status":"complete","phase":"local-acceptance"}'
                return subprocess.CompletedProcess(['ssh'],0,text,'')
        h = Harness()
        def fake_run(argv, **kwargs):
            text = ''
            if 'rev-parse' in argv: text = 'a'*40
            elif 'archive' in argv:
                Path(next(x.split('=',1)[1] for x in argv if x.startswith('--output='))).write_bytes(b'fixture archive')
            return subprocess.CompletedProcess(argv,0,text,'')
        with patch.object(devbox, 'run', side_effect=fake_run): h.install(h.describe())
        self.assertIsNotNone(h.script)
        checked = subprocess.run(['bash', '-n'], input=h.script, text=True, capture_output=True)
        self.assertEqual(0, checked.returncode, checked.stderr)
        self.assertIn('systemd-run --collect', h.script)
        self.assertIn('sha256sum -c -', h.script)
        self.assertLess(h.script.index('"status":"queued"'), h.script.index('systemd-run'))


if __name__ == '__main__': unittest.main(verbosity=2)
