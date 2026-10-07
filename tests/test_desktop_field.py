"""Isolated regression tests. No apt/systemd/cloud changes and no claimed live GUI tests."""
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch,MagicMock

ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    m=importlib.util.module_from_spec(spec); sys.modules[name]=m; spec.loader.exec_module(m); return m
field=module('desktop_field',ROOT/'scripts/desktop_field.py')
cloud=module('desktop_cloud',ROOT/'scripts/desktop_cloud.py')

class Data(unittest.TestCase):
    def setUp(self): self.cfg=json.loads((ROOT/'config/deployment/desktop-field.json').read_text())
    def test_shipped_policy_valid(self): self.assertEqual(field.validate(self.cfg)['default_desktop'],'kde')
    def test_preserves_changed_values_and_unknown_data(self):
        old={'schema_version':1,'geometry':'1600x900','future_note':'retain','heartbeat_seconds':90}
        result=field.merge_defaults(self.cfg,old)
        self.assertEqual(result['geometry'],'1600x900'); self.assertEqual(result['heartbeat_seconds'],90)
        self.assertEqual(result['future_note'],'retain'); self.assertIn('novnc_port',result)
    def test_unknown_version_is_not_downgraded(self):
        with self.assertRaises(field.Blocked): field.merge_defaults(self.cfg,{'schema_version':2})
    def test_default_copy_not_aliased(self):
        result=field.merge_defaults(self.cfg,{}); result['packages']['common'].append('modified')
        self.assertNotIn('modified',self.cfg['packages']['common'])
    def test_shell_configuration_not_executed(self):
        for value in ('$(touch /tmp/NOT_ALLOWED)','`whoami`','a;true','a|true','a&true'):
            with self.subTest(value=value),self.assertRaises(field.Blocked): field.parse_env('KEY='+value)
    def test_quoted_legacy_and_os_release(self):
        self.assertEqual(field.parse_env("KEYBOARD='us(intl)'\nPRETTY_NAME=\"Ubuntu 24.04.3 LTS\"\n"),
                         {'KEYBOARD':'us(intl)','PRETTY_NAME':'Ubuntu 24.04.3 LTS'})
    def test_invalid_settings(self):
        for key,value in [('novnc_port',True),('dcv_port',3389),('geometry','1920x1080;true'),
                          ('keyboard','$(id)'),('default_desktop','not-a-desktop'),('dcv_evaluation','true')]:
            cfg=copy.deepcopy(self.cfg);cfg[key]=value
            with self.subTest(key=key),self.assertRaises(field.Blocked):field.validate(cfg)
    def test_package_name_not_a_command(self):
        self.cfg['packages']['common'].append('--allow-unauthenticated')
        with self.assertRaises(field.Blocked):field.validate(self.cfg)
    def test_dcv_ubuntu_24_supported(self):
        self.assertIn('ubuntu2404',field.dcv_plan({'ID':'ubuntu','VERSION_ID':'24.04'},'amd64',self.cfg))
    def test_dcv_ubuntu_26_not_forced(self):
        with self.assertRaises(field.Blocked):field.dcv_plan({'ID':'ubuntu','VERSION_ID':'26.04'},'amd64',self.cfg)
    def test_dcv_debian_not_relabelled_ubuntu(self):
        with self.assertRaises(field.Blocked):field.dcv_plan({'ID':'debian','VERSION_ID':'13'},'amd64',self.cfg)
    def test_dcv_gcp_arm_not_claimed_supported(self):
        with self.assertRaises(field.Blocked):field.dcv_plan({'ID':'ubuntu','VERSION_ID':'24.04'},'arm64',self.cfg)
    def test_evaluation_can_be_disabled(self):
        self.cfg['dcv_evaluation']=False
        with patch.object(field.shutil,'which',return_value=None),self.assertRaises(field.Blocked):
            field.dcv_plan({'ID':'ubuntu','VERSION_ID':'24.04'},'amd64',self.cfg)
    def test_loopback_ipv4_and_ipv6(self):
        for address in ('127.0.0.1:3389','[::1]:5901','127.0.0.2:8443'):self.assertTrue(field.loopback_address(address))
        for address in ('0.0.0.0:3389','[::]:3389','*:6080','10.0.0.1:8443'):self.assertFalse(field.loopback_address(address))
    def test_public_listener_stops_managed_service(self):
        with patch.object(field,'addresses',return_value=['0.0.0.0:8443']),patch.object(field,'command') as command:
            with self.assertRaises(field.Blocked):field.check_listener(8443,'dcvserver.service',1)
            command.assert_called_once_with(['systemctl','stop','dcvserver.service'],check=False)

class Files(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def test_atomic_file_permissions(self):
        file=self.root/'config.json';field.save(file,{'a':1})
        self.assertEqual(stat.S_IMODE(file.stat().st_mode),0o600)
        self.assertEqual(json.loads(file.read_text()),{'a':1})
    def test_atomic_symlink_rejected(self):
        target=self.root/'real';target.write_text('unchanged');link=self.root/'link';link.symlink_to(target)
        with self.assertRaises(field.Blocked):field.atomic(link,'overwrite')
        self.assertEqual(target.read_text(),'unchanged')
    def test_drift_protects_local_changes(self):
        file=self.root/'config';file.write_text('installed');manifest={str(file):field.digest(file.read_bytes())}
        field.check_drift(manifest);file.write_text('my edit')
        with self.assertRaises(field.Blocked):field.check_drift(manifest)
        self.assertEqual(file.read_text(),'my edit')
    def test_drift_protects_deleted_file(self):
        with self.assertRaises(field.Blocked):field.check_drift({str(self.root/'absent'):'abc'})
    def test_safe_archive(self):
        archive=self.root/'good.tgz'
        with tarfile.open(archive,'w:gz') as out:
            info=tarfile.TarInfo('sub/package.deb');info.size=4;out.addfile(info,io.BytesIO(b'test'))
        field.safe_extract(archive,self.root/'out')
        self.assertEqual((self.root/'out/sub/package.deb').read_bytes(),b'test')
    def test_archive_traversal_and_links_rejected(self):
        for name,kind in [('../outside',tarfile.REGTYPE),('/tmp/outside',tarfile.REGTYPE),('link',tarfile.SYMTYPE)]:
            archive=self.root/'bad.tgz'
            with tarfile.open(archive,'w:gz') as out:
                info=tarfile.TarInfo(name);info.type=kind;info.linkname='/etc/passwd';out.addfile(info)
            with self.assertRaises(field.Blocked):field.safe_extract(archive,self.root/'out')
    def test_library_is_pinned_previous_blob(self):
        # Git's blob ID proves the existing helper was not silently changed by this increment.
        content=(ROOT/'scripts/remote_desktop.sh').read_bytes()
        import hashlib
        blob=hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest()
        self.assertEqual(blob,'3f4a5633ec3616834ca7f715475ecdc6451f4511')

class Phases(unittest.TestCase):
    def installer(self):
        obj=object.__new__(field.Installer);obj.state={'phases':{}};obj.persist=MagicMock();return obj
    def test_optional_block_does_not_block_other_method(self):
        obj=self.installer()
        def unsupported():raise field.Blocked('DCV unsupported OS')
        obj.phase('dcv',unsupported)
        next_phase=MagicMock(return_value={})
        obj.phase('novnc',next_phase)
        next_phase.assert_called_once();self.assertEqual(obj.state['phases']['dcv']['status'],'blocked')
        self.assertEqual(obj.state['phases']['novnc']['status'],'configured')
    def test_resume_skips_completed_phase(self):
        obj=self.installer();obj.state['phases']['vnc']={'status':'configured','port':5901}
        callback=MagicMock();obj.phase('vnc',callback);callback.assert_not_called()
    def test_failed_phase_retried(self):
        obj=self.installer();obj.state['phases']['vnc']={'status':'failed'}
        callback=MagicMock(return_value={});obj.phase('vnc',callback);callback.assert_called_once()
    def test_crd_auth_is_not_repeated_automatically(self):
        obj=self.installer();obj.state['phases']['crd']={'status':'needs-auth'}
        callback=MagicMock();obj.phase('crd',callback);callback.assert_not_called()
    def test_unexpected_failure_is_not_configured(self):
        obj=self.installer()
        def fail():raise subprocess.CalledProcessError(9,['apt-get'])
        obj.phase('vnc',fail);self.assertEqual(obj.state['phases']['vnc']['status'],'failed')
    def test_critical_failure_stops_dependency_chain(self):
        obj=self.installer()
        with self.assertRaises(field.Blocked):obj.phase('shared',lambda:(_ for _ in ()).throw(field.Blocked('no X11')),True)
    def test_running_state_saved_before_side_effect(self):
        obj=self.installer()
        def work():
            self.assertEqual(obj.state['phases']['vnc']['status'],'running');self.assertTrue(obj.persist.called)
        obj.phase('vnc',work)

class Tunnel(unittest.TestCase):
    def test_forward_is_two_explicit_loopbacks(self):
        self.assertEqual(cloud.forward_arguments({'rdp':{'local':13389,'remote':3389}}),
                         ['-L','127.0.0.1:13389:127.0.0.1:3389'])
    def test_no_shell_injection_in_port(self):
        with self.assertRaises(ValueError):cloud.forward_arguments({'vnc':{'local':'1;id','remote':5901}})
    def test_nondefault_display_port_not_concatenated(self):
        self.assertIn('127.0.0.1:15910:127.0.0.1:5910',cloud.forward_arguments({'vnc':{'local':15910,'remote':5910}}))
    def test_password_only_in_fragment(self):
        from urllib.parse import urlparse,parse_qs
        link=cloud.browser_url('example.cloudshell.dev',18080,'a b&secret')
        parsed=urlparse(link)
        self.assertNotIn('secret',parsed.query)
        self.assertEqual(parse_qs(parsed.fragment)['password'],['a b&secret'])
    def test_webhost_validation(self):
        with self.assertRaises(ValueError):cloud.browser_url('evil.example/path?x=',18080,'secret')
    def test_cloud_target_names_validated(self):
        with self.assertRaises(ValueError):cloud.Cloud({'project':'foo;uname','zone':'europe-west4-c','instance':'devbox-20260923'})
    def test_sources_do_not_purge_or_resize(self):
        source=(ROOT/'scripts/desktop_field.py').read_text()+(ROOT/'scripts/desktop_cloud.py').read_text()
        for forbidden in ('docker system prune','gcloud compute instances delete','apt-get purge','mkfs.',"'set-machine-type'"):
            self.assertNotIn(forbidden,source)
    def test_credentials_not_part_of_report(self):
        source=(ROOT/'scripts/desktop_field.py').read_text()
        status=source.split('def status():',1)[1].split('\ndef launch',1)[0]
        self.assertNotIn('password.txt',status);self.assertNotIn('vnc_password',status)
    def test_generated_password_is_suppressed_in_installer_log(self):
        source=(ROOT/'scripts/desktop_field.py').read_text()
        self.assertIn('set_vnc_password "$2" "$3" >/dev/null',source)

if __name__=='__main__':unittest.main()
