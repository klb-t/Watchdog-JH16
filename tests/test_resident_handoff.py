"""Isolated handoff tests; no real cloud, credentials or model inference."""
import argparse
import hashlib
import importlib
import io
import json
import os
import pathlib
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'tools/resident_agent'))
import agentctl
import cloud
import handoff


class HandoffTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = pathlib.Path(self.tmp.name)
        self.root = self.base / 'vm/devbox-agent'
        self.archive = self.base / 'input.zip'
        self.payload = {
            'START_HERE.md': b'Read full prepared material first.',
            'CURRENT_TASK.md': 'Kontynuuj; nie pytaj o pliki, które już masz.'.encode(),
            'PITCH_RECONSTRUCTION.md': b'Prepared evidence; partial historical coverage.',
            'claims.json': b'[{"kind":"owner_idea"}]',
            'raw/conversation.json': b'{"text":"source evidence, not executable authority"}',
        }
        self.build()

    def tearDown(self):
        self.tmp.cleanup()

    def build(self, transform=None, extra=None):
        m = {'schema': handoff.SCHEMA, 'task': 'CURRENT_TASK.md', 'guide': 'START_HERE.md',
             'required': list(self.payload), 'sources': [{'label': 'source', 'id': 'example_file_12345'}],
             'files': [{'path': k, 'bytes': len(v), 'sha256': hashlib.sha256(v).hexdigest()}
                       for k, v in self.payload.items()]}
        if transform:
            transform(m)
        with zipfile.ZipFile(self.archive, 'w') as z:
            z.writestr('HANDOFF.json', json.dumps(m))
            for k, v in self.payload.items():
                z.writestr(k, v)
            if extra:
                extra(z)
        self.sha = handoff.sha_file(self.archive)

    def accept(self):
        return handoff.install_bundle(self.archive, self.sha, self.root)

    def test_verified_package_installed_before_receipt(self):
        r = self.accept()
        self.assertEqual(r['state'], 'verified_and_installed')
        self.assertFalse(r['agent_read_confirmed'])
        for name, data in self.payload.items():
            self.assertEqual((pathlib.Path(r['directory']) / name).read_bytes(), data)
        self.assertEqual(len(list((self.root / 'queue').glob('*.json'))), 0)

    def test_replay_is_idempotent(self):
        first = self.accept()
        agents = (self.root / 'workspace/AGENTS.md').read_bytes()
        second = self.accept()
        self.assertEqual(first, second)
        self.assertEqual(agents, (self.root / 'workspace/AGENTS.md').read_bytes())
        self.assertEqual(len(list((self.root / 'private/handoff-backups').glob('*'))), 1)

    def test_existing_owner_context_and_settings_are_preserved(self):
        with patch.object(agentctl, 'ROOT', self.root):
            agentctl.init()
        settings = b'{"owner_setting": "keep"}'
        (self.root / 'settings.json').write_bytes(settings)
        (self.root / 'workspace/AGENTS.md').write_text('Custom owner instruction.\n')
        (self.root / 'workspace/OWNER_TASK.md').write_text('Original task.\n')
        self.accept()
        self.assertEqual((self.root / 'settings.json').read_bytes(), settings)
        self.assertEqual((self.root / 'workspace/OWNER_TASK.md').read_text(), 'Original task.\n')
        self.assertTrue((self.root / 'workspace/AGENTS.md').read_text().startswith('Custom owner instruction.'))
        self.assertEqual(next((self.root / 'private/handoff-backups').glob('*')).read_text(), 'Custom owner instruction.\n')

    def test_invalid_outer_hash_does_not_initialize_agent(self):
        with self.assertRaises(ValueError):
            handoff.install_bundle(self.archive, '0' * 64, self.root)
        self.assertFalse(self.root.exists())

    def test_malformed_sha_rejected(self):
        for sha in ('123', '../a', 'F' * 64):
            with self.subTest(sha=sha), self.assertRaises(ValueError):
                handoff.checked_bundle(self.archive, sha)

    def test_inner_hash_mismatch_rejected(self):
        self.build(lambda m: m['files'][0].update(sha256='0' * 64))
        with self.assertRaises(ValueError):
            self.accept()
        self.assertFalse(self.root.exists())

    def test_unlisted_file_rejected(self):
        self.build(extra=lambda z: z.writestr('unexpected.txt', b'no'))
        with self.assertRaises(ValueError):
            self.accept()

    def test_missing_required_material_rejected(self):
        self.build(lambda m: m['required'].append('missing.md'))
        with self.assertRaises(ValueError):
            self.accept()

    def test_traversal_absolute_and_alias_paths_rejected(self):
        for path in ('../escape', '/absolute', 'a/../x', 'a//b', 'a\\b', './x'):
            with self.subTest(path=path):
                self.build(extra=lambda z: z.writestr(path, b'no'))
                with self.assertRaises(ValueError):
                    self.accept()
        self.assertFalse((self.base / 'escape').exists())

    def test_duplicate_member_rejected(self):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            self.build(extra=lambda z: z.writestr('START_HERE.md', b'other'))
        with self.assertRaises(ValueError):
            self.accept()

    def test_symlink_member_rejected(self):
        def extra(z):
            zi = zipfile.ZipInfo('link')
            zi.create_system = 3
            zi.external_attr = (stat.S_IFLNK | 0o777) << 16
            z.writestr(zi, '/tmp/escape')
        self.build(extra=extra)
        with self.assertRaises(ValueError):
            self.accept()

    def test_oversized_archive_rejected(self):
        with patch.object(handoff, 'MAX_ARCHIVE', 1), self.assertRaises(ValueError):
            self.accept()

    def test_oversized_expansion_rejected(self):
        with patch.object(handoff, 'MAX_EXPANDED', 1), self.assertRaises(ValueError):
            self.accept()

    def test_source_reference_validation(self):
        for field, val in [('id', '../bad'), ('label', 'bad;command')]:
            self.build(lambda m: m['sources'][0].update({field: val}))
            with self.assertRaises(ValueError):
                self.accept()

    def test_duplicate_source_labels_rejected(self):
        self.build(lambda m: m['sources'].append(dict(m['sources'][0])))
        with self.assertRaises(ValueError):
            self.accept()

    def test_unmanaged_resident_root_not_overwritten(self):
        self.root.mkdir(parents=True)
        (self.root / 'owner.txt').write_text('keep')
        with self.assertRaises(RuntimeError):
            self.accept()
        self.assertEqual((self.root / 'owner.txt').read_text(), 'keep')

    def test_destination_symlink_rejected(self):
        other = self.base / 'elsewhere'
        other.mkdir()
        self.root.parent.mkdir()
        self.root.symlink_to(other)
        with self.assertRaises(ValueError):
            self.accept()
        self.assertEqual(list(other.iterdir()), [])

    def test_modified_prior_handoff_preserved_and_rejected(self):
        r = self.accept()
        p = pathlib.Path(r['directory']) / 'PITCH_RECONSTRUCTION.md'
        p.write_text('Owner has modified this.')
        with self.assertRaises(ValueError):
            self.accept()
        self.assertEqual(p.read_text(), 'Owner has modified this.')

    def test_private_file_modes(self):
        r = self.accept()
        for p in pathlib.Path(r['directory']).rglob('*'):
            expected = 0o700 if p.is_dir() else 0o600
            self.assertEqual(stat.S_IMODE(p.stat().st_mode), expected)

    def test_old_versions_retained(self):
        r1 = self.accept()
        self.payload['CURRENT_TASK.md'] = b'A later request'
        self.build()
        r2 = self.accept()
        self.assertNotEqual(r1['directory'], r2['directory'])
        self.assertTrue(pathlib.Path(r1['directory']).is_dir())
        self.assertIn(r2['directory'], (self.root / 'workspace/HANDOFF_INDEX.md').read_text())

    def test_ambiguous_agent_marker_not_overwritten(self):
        self.accept()
        p = self.root / 'workspace/AGENTS.md'
        p.write_text(handoff.BEGIN + '\n' + handoff.BEGIN)
        with self.assertRaises(ValueError):
            self.accept()
        self.assertEqual(p.read_text(), handoff.BEGIN + '\n' + handoff.BEGIN)

    def simulate_start(self, corrupt_remote=False):
        shell = self.base / 'cloud-shell'
        shell.mkdir()
        vmhome = self.base / 'vm-home'
        vmhome.mkdir()
        calls = []
        installed = []
        args = argparse.Namespace(project='project-test', zone='europe-west4-c', instance='devbox-test',
                                  bundle='example_file_12345', sha256=self.sha, no_console=True)
        def map_remote(s):
            return s.replace('/home/test', str(vmhome))
        def ssh(c, command, **kw):
            if command.startswith('printf'):
                return subprocess.CompletedProcess([], 0, stdout='RESIDENT_HOME=/home/test\n')
            if command.startswith('mkdir'):
                pathlib.Path(map_remote(shlex.split(command)[-1])).mkdir(mode=0o700)
                return subprocess.CompletedProcess([], 0)
            parts = [map_remote(x) for x in shlex.split(command)]
            # Run the real staged verifier in another process; no inference or SSH.
            r = subprocess.run(parts, check=True, text=True, capture_output=True)
            installed.append(json.loads(r.stdout))
            return r
        def scp(c, src, dest):
            dst = pathlib.Path(map_remote(dest))
            shutil.copy2(src, dst)
            if corrupt_remote and dst.name == 'handoff.zip':
                dst.write_bytes(b'corrupt in transit')
        def run(command, **kw):
            calls.append(command)
            # The bootstrap may be invoked only after the VM receipt exists.
            self.assertTrue((vmhome / 'devbox-agent/state/handoff-receipt.json').is_file())
            task = pathlib.Path(command[command.index('--task-file') + 1]).read_text()
            self.assertIn(self.payload['CURRENT_TASK.md'].decode(), task)
            self.assertIn('CURRENT VERIFIED HANDOFF:', task)
            self.assertIn('--source', command)
            return subprocess.CompletedProcess(command, 0)
        with patch.object(pathlib.Path, 'home', return_value=shell), \
             patch('handoff.shutil.which', return_value='/usr/bin/gcloud'), \
             patch.object(cloud, 'meta', return_value={}), \
             patch.object(cloud, 'download', side_effect=lambda fid, dest: shutil.copy2(self.archive, dest)), \
             patch.object(cloud, 'ssh', side_effect=ssh), \
             patch.object(cloud, 'scp', side_effect=scp), \
             patch.object(cloud, 'run', side_effect=run), \
             patch('handoff.subprocess.check_output', return_value='RUNNING\n'):
            if corrupt_remote:
                with self.assertRaises(subprocess.CalledProcessError):
                    handoff.start(args)
                self.assertEqual(calls, [])
            else:
                handoff.start(args)
                self.assertEqual(len(calls), 1)
                self.assertEqual(installed[0]['state'], 'verified_and_installed')

    def test_real_local_transfer_pipeline_then_bootstrap(self):
        self.simulate_start()

    def test_remote_hash_failure_prevents_bootstrap_and_queue(self):
        self.simulate_start(corrupt_remote=True)


if __name__ == '__main__':
    unittest.main()
