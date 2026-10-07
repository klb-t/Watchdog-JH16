#!/usr/bin/env python3
"""Resumable desktop-only deployment. Never replaces WatchDog application/data.

Root commands: launch, apply, status, credentials. Unprivileged command: session.
Settings are data; privileged operations are named functions, never commands from JSON.
Transport and graphical acceptance are reported separately. See desktop-field guide.
"""
from __future__ import annotations
import argparse
import contextlib
import copy
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'scripts/remote_desktop.sh'
POLICY = ROOT / 'config/deployment/desktop-field.json'
STATE = Path('/var/lib/watchdog-desktop')
SETTINGS = Path('/etc/watchdog-desktop/settings.json')
RUNTIME = SETTINGS.with_name('runtime.json')
UNIT = 'watchdog-desktop-install.service'
MARKER = '# Managed by watchdog desktop-field/1'
GENERATED = [
 '/usr/local/bin/remote-desktop-session', '/usr/local/bin/remote-desktop-heartbeat',
 '/usr/local/sbin/remote-desktop', '/etc/chrome-remote-desktop-session',
 '/etc/systemd/system/watchdog-vnc.service', '/etc/systemd/system/watchdog-novnc.service',
 '/etc/systemd/system/watchdog-dcv-session.service', '/etc/xrdp/xrdp.ini',
 '/etc/dcv/dcv.conf', '/etc/xdg/startkderc', '/etc/xdg/kscreenlockerrc',
 '/etc/xdg/kwinrc', '/etc/xdg/baloofilerc', '/etc/polkit-1/rules.d/45-remote-desktop.rules'
]

class Blocked(RuntimeError):
    pass


def command(argv, *, capture=False, check=True, timeout=7200, **kw):
    return subprocess.run([str(x) for x in argv], check=check, text=True,
                          capture_output=capture, timeout=timeout, **kw)


def output(argv):
    return command(argv, capture=True).stdout.strip()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def private_dir(path):
    path.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise Blocked(f'Refusing symlink directory: {path}')
    path.chmod(0o700)


def atomic(path, text, mode=0o600):
    path = Path(path)
    if path.is_symlink() or any(p.is_symlink() for p in path.parents):
        raise Blocked(f'Refusing symlink in managed path: {path}')
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(text); stream.flush(); os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), mode)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def save(path, obj, mode=0o600):
    atomic(path, json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2) + '\n', mode)


def load(path, default=None):
    if not path.exists(): return copy.deepcopy(default)
    return json.loads(path.read_text())


def parse_env(text):
    """Import simple assignments, without sourcing/evaluating legacy shell content."""
    result = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith('#'): continue
        match = re.fullmatch(r'([A-Z][A-Z0-9_]*)=(.*)', line.strip())
        if not match: raise Blocked('Legacy configuration is not simple KEY=value data.')
        key, value = match.groups()
        if any(c in value for c in ('$','`',';','&','|','<','>','\n','\r')):
            raise Blocked(f'Executable syntax in legacy setting {key}; no evaluation performed.')
        values = shlex.split(value, comments=True)
        if len(values) > 1: raise Blocked(f'Invalid legacy value: {key}')
        result[key] = values[0] if values else ''
    return result


def merge_defaults(defaults, stored):
    if not isinstance(stored, dict): raise Blocked('Settings must be a JSON object.')
    if stored.get('schema_version', 1) != 1:
        raise Blocked('Unknown settings schema: refusing downgrade/implicit migration.')
    merged = copy.deepcopy(defaults)
    for key, value in stored.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key].update(value)
        else: merged[key] = value
    return merged


def validate(cfg):
    if cfg['schema_version'] != 1: raise Blocked('Unknown schema version.')
    if not cfg['desktops'] or any(x not in ('kde','gnome') for x in cfg['desktops']):
        raise Blocked('Unsupported desktop name.')
    if cfg['default_desktop'] not in cfg['desktops']: raise Blocked('Default desktop is not requested.')
    if not re.fullmatch(r'[a-z]{2,3}(\([a-z0-9_]+\))?', cfg['keyboard']): raise Blocked('Invalid keyboard.')
    if not re.fullmatch(r'[1-9][0-9]{2,4}x[1-9][0-9]{2,4}', cfg['geometry']): raise Blocked('Invalid geometry.')
    for key, low, high in [('heartbeat_seconds',10,600),('heartbeat_active_ms',1000,3600000),
                            ('novnc_port',2000,65000),('dcv_port',1024,65000),('minimum_free_gib',1,100)]:
        if type(cfg[key]) is not int or not low <= cfg[key] <= high: raise Blocked(f'Invalid {key}.')
    if cfg['dcv_port'] == cfg['novnc_port'] or 3389 in (cfg['dcv_port'],cfg['novnc_port']):
        raise Blocked('Conflicting configured ports.')
    if not isinstance(cfg['protocols'],list) or any(x not in ('rdp','vnc','crd','dcv') for x in cfg['protocols']):
        raise Blocked('Unknown protocol.')
    if type(cfg['dcv_evaluation']) is not bool: raise Blocked('Invalid DCV evaluation policy.')
    for values in cfg['packages'].values():
        if not isinstance(values,list) or any(not re.fullmatch(r'[a-z0-9][a-z0-9+.-]*', p) for p in values):
            raise Blocked('Invalid package data.')
    for version, url in cfg['dcv_artifacts'].items():
        if version not in ('22.04','24.04') or not re.fullmatch(
          r'https://d1uj6qtbmh3dt5\.cloudfront\.net/2025\.0/Servers/nice-dcv-2025\.0-20103-ubuntu(2204|2404)-x86_64\.tgz',url):
            raise Blocked('DCV artifact needs a reviewed adapter revision.')
    return cfg


def check_user(user):
    if not re.fullmatch(r'[a-z_][a-z0-9_.-]*\$?', user) or user == 'root': raise Blocked('Invalid desktop account.')
    account = pwd.getpwnam(user)
    if not re.fullmatch(r'/[A-Za-z0-9_./-]+', account.pw_dir) or not Path(account.pw_dir).is_dir():
        raise Blocked('Unsupported home path.')
    return account


def base(function, *args):
    # Only caller-selected function names; no configuration-supplied shell programs.
    return command(['bash','-c','source "$1"; shift; "$@"; ((FAILED == 0))',
                    'desktop-field', BASE, function, *args])


def addresses(port):
    result = command(['ss','-H','-ltn','sport','=',f':{port}'],capture=True)
    return [row.split()[3] for row in result.stdout.splitlines() if row.strip()]


def loopback_address(value):
    try:
        return ipaddress.ip_address(value.rsplit(':',1)[0].strip('[]')).is_loopback
    except ValueError: return False


def check_listener(port, service=None, wait=20):
    for _ in range(wait):
        found = addresses(port)
        if found:
            if not all(loopback_address(a) for a in found):
                if service: command(['systemctl','stop',service], check=False)
                raise Blocked(f'Port {port} is not loopback-only; managed service stopped.')
            return found
        time.sleep(1)
    raise Blocked(f'No listener on port {port}.')


def active(service):
    return command(['systemctl','is-active','--quiet',service],check=False).returncode == 0


@contextlib.contextmanager
def locks():
    files=[]
    try:
        for name in ('remote-desktop-install','watchdog-install'):
            f=open(f'/run/lock/{name}.lock','a'); files.append(f)
            fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
        yield
    except BlockingIOError:
        raise Blocked('Another WatchDog/desktop installation or backup holds the lock; retry later.')
    finally:
        for f in files: f.close()


@contextlib.contextmanager
def package_policy():
    path=Path('/usr/sbin/policy-rc.d'); backup=STATE/'policy-rc.d.saved'; flag=STATE/'policy-guard.json'
    if flag.exists(): restore_policy()
    existed=path.exists() or path.is_symlink()
    if existed: shutil.copy2(path,backup,follow_symlinks=False)
    save(flag,{'existed':existed})
    # Preserve a preexisting symlink as a symlink; never write through it.
    if path.is_symlink(): path.unlink()
    atomic(path, '#!/bin/sh\n'+MARKER+' temporary package guard\nexit 101\n',0o755)
    try: yield
    finally: restore_policy()


def restore_policy():
    flag=STATE/'policy-guard.json'; path=Path('/usr/sbin/policy-rc.d'); backup=STATE/'policy-rc.d.saved'
    record=load(flag)
    if record is None: return
    expected='#!/bin/sh\n'+MARKER+' temporary package guard\nexit 101\n'
    if path.is_symlink() or not path.exists() or path.read_text()!=expected:
        raise Blocked('Package-start policy changed concurrently; saved original retained.')
    if record['existed']: os.replace(backup,path)
    else: path.unlink()
    flag.unlink()


def apt(packages):
    args=['apt-get','-y','-o','DPkg::Lock::Timeout=600','-o','Dpkg::Options::=--force-confdef',
          '-o','Dpkg::Options::=--force-confold','install',*packages]
    env=dict(os.environ,DEBIAN_FRONTEND='noninteractive',NEEDRESTART_MODE='l',NEEDRESTART_SUSPEND='1')
    with package_policy(): command(args,env=env)


def capabilities():
    version=''; gnome=False
    if shutil.which('gnome-shell'):
        version=command(['gnome-shell','--version'],capture=True,check=False).stdout.strip()
        match=re.search(r'(\d+)',version)
        sessions=Path('/usr/share/xsessions')
        has_entry=any(sessions.glob('*gnome*.desktop')) or (sessions/'ubuntu.desktop').exists()
        gnome=bool(match and int(match[1])<49 and shutil.which('gnome-session') and has_entry)
    return {'kde':bool(shutil.which('startplasma-x11')),'gnome':gnome,'gnome_version':version}


def snapshot(home):
    destination=STATE/'backups'/time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
    destination=Path(tempfile.mkdtemp(prefix=destination.name+'-',dir=destination.parent))
    destination.chmod(0o700)
    paths=[*GENERATED,'/etc/remote-desktop.conf','/etc/watchdog-desktop','/etc/tigervnc',
           '/etc/xrdp','/etc/dcv','/etc/xdg','/etc/dconf','/etc/X11/Xwrapper.config',
           '/etc/tmpfiles.d/keep-awake.conf',str(home/'.vnc'),str(home/'.config/remote-desktop'),
           str(home/'.config/tigervnc'),str(home/'.config/chrome-remote-desktop'),str(home/'startwm.sh')]
    with tarfile.open(destination/'configuration.tar.gz','w:gz',dereference=False) as archive:
        for p in sorted(set(paths)):
            if os.path.lexists(p): archive.add(p,arcname=p.lstrip('/'))
    save(destination/'inventory.json',{'scope':'desktop configuration and credentials, NOT application databases',
                                      'paths':sorted(set(paths)),'created':time.time()})
    return str(destination)


def tracked_hashes():
    return {p:digest(Path(p).read_bytes()) for p in GENERATED if Path(p).is_file() and not Path(p).is_symlink()}


def check_drift(previous):
    for name, expected in previous.items():
        p=Path(name)
        if p.is_symlink() or not p.is_file() or digest(p.read_bytes())!=expected:
            raise Blocked(f'Managed file changed outside installer: {name}. Kept intact; reconcile before upgrade.')


def service(name, body):
    path=Path('/etc/systemd/system')/name
    if path.exists() and MARKER not in path.read_text(): raise Blocked(f'Foreign unit: {path}')
    atomic(path,MARKER+'\n'+body,0o644)
    command(['systemctl','daemon-reload'])
    command(['systemctl','enable',name])
    command(['systemctl','restart',name])


def safe_extract(tgz, destination):
    with tarfile.open(tgz,'r:gz') as archive:
        for item in archive.getmembers():
            if item.issym() or item.islnk() or not (item.isfile() or item.isdir()):
                raise Blocked('Unexpected link/device in download archive.')
            p=Path(item.name)
            if p.is_absolute() or '..' in p.parts: raise Blocked('Unsafe download archive path.')
        archive.extractall(destination)


def fetch(url,path):
    # TLS verification is never disabled. Return redirects are restricted to the same AWS/Google host.
    request=urllib.request.Request(url,headers={'User-Agent':'WatchDog-desktop-installer/1'})
    with urllib.request.urlopen(request,timeout=120) as response:
        if urllib.parse.urlparse(response.url).hostname != urllib.parse.urlparse(url).hostname:
            raise Blocked('Unexpected artifact redirect.')
        with open(path,'wb') as stream: shutil.copyfileobj(response,stream)


def dcv_plan(osinfo,arch,cfg):
    if osinfo.get('ID')!='ubuntu' or osinfo.get('VERSION_ID') not in cfg['dcv_artifacts'] or arch!='amd64':
        raise Blocked('DCV adapter supports Ubuntu 22.04/24.04 amd64 only; no foreign-distro package forced.')
    if not cfg['dcv_evaluation'] and not shutil.which('dcv'):
        raise Blocked('DCV evaluation disabled; configure a license before installation.')
    return cfg['dcv_artifacts'][osinfo['VERSION_ID']]


class Installer:
    def __init__(self,user):
        self.account=check_user(user); self.user=user; self.home=Path(self.account.pw_dir)
        self.osinfo=parse_env(Path('/etc/os-release').read_text())
        old=parse_env(Path('/etc/remote-desktop.conf').read_text()) if Path('/etc/remote-desktop.conf').exists() else {}
        defaults=load(POLICY)
        stored=load(SETTINGS)
        if stored is None:
            stored={'schema_version':1,'legacy_import_keys':sorted(old)}
            for src,dst in [('DEFAULT_DESKTOP','default_desktop'),('KEYBOARD','keyboard'),
                            ('HEARTBEAT_SECONDS','heartbeat_seconds'),('HEARTBEAT_ACTIVE_MS','heartbeat_active_ms')]:
                if old.get(src): stored[dst]=int(old[src]) if src.startswith('HEARTBEAT') else old[src]
        self.cfg=validate(merge_defaults(defaults,stored))
        self.generation=digest((digest(Path(__file__).read_bytes())+digest(BASE.read_bytes())+
                              json.dumps(self.cfg,sort_keys=True)+user).encode())
        self.state=load(STATE/'status.json',{})
        if self.state.get('generation')!=self.generation:
            if self.state: save(STATE/'history'/f'{int(time.time())}.json',self.state)
            check_drift(load(STATE/'managed-hashes.json',{}))
            self.state={'schema_version':1,'generation':self.generation,'user':user,'phases':{},'running':False}
        self.persist()

    def persist(self):
        self.state['updated_at']=time.time(); save(STATE/'status.json',self.state)

    def phase(self,name,fn,critical=False):
        previous=self.state['phases'].get(name,{})
        if previous.get('status') in ('configured','needs-auth'):
            print(f'{name}: {previous["status"]} (saved)',flush=True); return
        self.state['phase']=name; self.state['running']=True
        self.state['phases'][name]={'status':'running'}; self.persist()
        print(f'=== {name} ===',flush=True)
        try:
            result=fn() or {}; result.setdefault('status','configured')
        except Blocked as exc:
            result={'status':'blocked','reason':str(exc)}
        except (OSError,ValueError,subprocess.SubprocessError) as exc:
            result={'status':'failed','reason':str(exc)}
        self.state['phases'][name]=result; self.persist()
        print(f'{name}: {result}',flush=True)
        if critical and result['status'] not in ('configured','needs-auth'):
            raise Blocked(f'Critical phase {name}: {result.get("reason",result["status"])}')

    def desktop_packages(self,name):
        key='gnome_'+self.osinfo['ID'] if name=='gnome' else name
        apt(self.cfg['packages'][key])
        if name=='kde' and not shutil.which('startplasma-x11'):
            for package in ('plasma-session-x11','plasma-workspace-x11'):
                if command(['apt-cache','show',package],capture=True,check=False).returncode==0:
                    apt([package]); break
        caps=capabilities()
        if not caps[name]: raise Blocked(f'{name} packages installed, but no accepted X11 session: {caps}')
        return {'status':'configured','graphical_login':'not-tested'}

    def shared(self):
        caps=capabilities()
        available=[x for x in self.cfg['desktops'] if caps[x]]
        if not available: raise Blocked('Neither requested desktop has a usable X11 launcher.')
        # Existing preferences are not erased. The session launcher reports any fallback.
        atomic('/etc/remote-desktop.conf', '# Managed by remote_desktop.sh\n'+
          f'DEFAULT_DESKTOP={shlex.quote(self.cfg["default_desktop"])}\nKEYBOARD={shlex.quote(self.cfg["keyboard"])}\n'+
          f'RD_USER={shlex.quote(self.user)}\nHEARTBEAT_SECONDS={self.cfg["heartbeat_seconds"]}\n'+
          f'HEARTBEAT_ACTIVE_MS={self.cfg["heartbeat_active_ms"]}\n',0o644)
        base('configure_headless'); base('install_launchers')
        base('configure_desktop_defaults',str(caps['kde']).lower(),str(caps['gnome']).lower(),self.cfg['keyboard'])
        base('configure_polkit'); base('configure_signals')
        base('configure_user',self.user,self.home,self.cfg['default_desktop'],'false','true')
        # Use a capability-aware launcher, rather than mistaking gnome-session's mere existence for X11 support.
        atomic('/usr/local/bin/remote-desktop-session', '#!/bin/sh\n'+MARKER+'\nexec /usr/bin/python3 '+
               shlex.quote(str(Path(__file__)))+' session\n',0o755)
        atomic('/usr/local/sbin/remote-desktop',BASE.read_text(),0o755)
        save(RUNTIME,{'settings':self.cfg,'capabilities':caps,'user':self.user},0o644)
        command(['loginctl','enable-linger',self.user])
        return {'status':'configured','capabilities':caps,'graphical_login':'not-tested'}

    def rdp(self):
        if addresses(3389) and not active('xrdp.service'): raise Blocked('Port 3389 belongs to another service.')
        apt(self.cfg['packages']['rdp']); base('configure_rdp',self.user,self.home,'local')
        check_listener(3389,'xrdp.service')
        return {'status':'configured','port':3389,'password_present':output(['passwd','-S',self.user]).split()[1]=='P',
                'graphical_login':'not-tested'}

    def vnc(self):
        packages=self.cfg['packages']['vnc']
        # Older apt repositories ship the password tool in tigervnc-common.
        apt([p for p in packages if p!='tigervnc-tools' or command(['apt-cache','show',p],capture=True,check=False).returncode==0])
        mapping=Path('/etc/tigervnc/vncserver.users'); mapping.parent.mkdir(parents=True,exist_ok=True)
        text=mapping.read_text() if mapping.exists() else ''
        existing=re.search(r'^:(\d+)='+re.escape(self.user)+r'$',text,re.M)
        display=int(existing[1]) if existing else 0
        if not display:
            for n in range(1,100):
                if re.search(r'^:'+str(n)+r'=',text,re.M) or Path(f'/tmp/.X{n}-lock').exists() or addresses(5900+n): continue
                display=n; break
            if not display: raise Blocked('No free VNC display.')
            atomic(mapping,text.rstrip('\n')+f'\n:{display}={self.user}\n',0o644)
        if not 1<=display<=99: raise Blocked('Existing VNC display outside supported range; preserved.')
        port=5900+display
        if port in (self.cfg['novnc_port'],self.cfg['dcv_port']): raise Blocked('VNC port conflicts with another configured protocol.')
        env=Path('/etc/remote-desktop.conf'); atomic(env,env.read_text()+f'VNC_DISPLAY={display}\n',0o644)
        passwd=self.home/'.vnc/passwd'
        if not passwd.exists():
            modern=self.home/'.config/tigervnc/passwd'
            if modern.is_file() and not modern.is_symlink() and modern.stat().st_size==8:
                command(['runuser','-u',self.user,'--','mkdir','-p',str(passwd.parent)])
                command(['runuser','-u',self.user,'--','install','-m','0600',str(modern),str(passwd)])
            else:
                command(['bash','-c','source "$1"; set_vnc_password "$2" "$3" >/dev/null',
                         'desktop-field',BASE,self.user,self.home])
        if passwd.is_symlink() or passwd.stat().st_size!=8: raise Blocked('Invalid existing VNC credential; not overwritten.')
        if addresses(port):
            owners=[f'tigervncserver@:{display}.service',f'vncserver@:{display}.service','watchdog-vnc.service']
            if not any(active(s) for s in owners): raise Blocked(f'Unrecognized existing listener on {port}; not stopped.')
            check_listener(port)
            return {'status':'configured','port':port,'display':display,'reused':True,'graphical_login':'not-tested'}
        # Replace only inactive native units for the exact imported user/display.
        # Otherwise two enabled units would race for the same X display after a reboot.
        for native in (f'tigervncserver@:{display}.service',f'vncserver@:{display}.service'):
            if active(native): raise Blocked(f'{native} is active without a listener; not replacing a live session.')
            command(['systemctl','disable',native],check=False,capture=True)
        executable=shutil.which('tigervncserver')
        if not executable: raise Blocked('Missing tigervncserver launcher.')
        service('watchdog-vnc.service',f'''[Unit]
Description=WatchDog user VNC desktop
After=network.target
[Service]
Type=simple
User={self.user}
PAMName=login
Environment=HOME={self.home}
Environment=USER={self.user}
WorkingDirectory={self.home}
UMask=0077
ExecStart={executable} :{display} -fg -localhost yes -SecurityTypes VncAuth -rfbauth {passwd} -geometry {self.cfg['geometry']} -depth 24 -xstartup /usr/local/bin/remote-desktop-session
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
''')
        check_listener(port,'watchdog-vnc.service',40)
        with socket.create_connection(('127.0.0.1',port),timeout=5) as sock:
            if not sock.recv(12).startswith(b'RFB '): raise Blocked('VNC listener did not speak RFB.')
        return {'status':'configured','port':port,'display':display,'graphical_login':'not-tested'}

    def crd(self):
        if output(['dpkg','--print-architecture'])!='amd64': raise Blocked('CRD package requires amd64.')
        if command(['dpkg-query','-W','-f=${Status}','chrome-remote-desktop'],capture=True,check=False).stdout.strip()!='install ok installed':
            with tempfile.TemporaryDirectory(prefix='desktop-crd-') as tmp:
                package=Path(tmp)/'crd.deb'; fetch('https://dl.google.com/linux/direct/chrome-remote-desktop_current_amd64.deb',package)
                command(['dpkg-deb','-I',package],capture=True); apt([str(package)])
        base('configure_crd',self.user,self.home)
        registered=any((self.home/'.config/chrome-remote-desktop').glob('host#*.json'))
        return {'status':'configured' if registered else 'needs-auth','registered':registered,
                'next_action':'sudo remote-desktop crd-register','graphical_login':'not-tested'}

    def novnc(self):
        vnc=self.state['phases'].get('vnc',{})
        if vnc.get('status')!='configured': raise Blocked('noVNC requires the VNC phase.')
        port=self.cfg['novnc_port']
        if addresses(port) and not active('watchdog-novnc.service'): raise Blocked(f'Port {port} belongs to another service.')
        apt(self.cfg['packages']['novnc'])
        page=Path('/usr/share/novnc/vnc.html')
        if not page.exists(): raise Blocked('noVNC package lacks vnc.html.')
        executable=shutil.which('websockify')
        if not executable: raise Blocked('websockify not found.')
        service('watchdog-novnc.service',f'''[Unit]
Description=Loopback browser bridge to VNC (requires an authenticated SSH tunnel)
After=network.target
[Service]
Type=simple
DynamicUser=yes
ExecStart={executable} --web /usr/share/novnc 127.0.0.1:{port} 127.0.0.1:{vnc['port']}
Restart=on-failure
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
[Install]
WantedBy=multi-user.target
''')
        check_listener(port,'watchdog-novnc.service')
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/vnc.html',timeout=10) as response:
            if response.status!=200: raise Blocked('Browser bridge HTTP check failed.')
        return {'status':'configured','port':port,'websocket_and_graphics':'not-tested'}

    def dcv(self):
        url=dcv_plan(self.osinfo,output(['dpkg','--print-architecture']),self.cfg)
        if not shutil.which('dcv'):
            with tempfile.TemporaryDirectory(prefix='desktop-dcv-') as tmp:
                directory=Path(tmp); archive=directory/'dcv.tgz'; checksum=directory/'checksum'
                fetch(url,archive); fetch(url+'.sha256sum',checksum)
                match=re.search(r'\b[0-9a-fA-F]{64}\b',checksum.read_text())
                if not match or digest(archive.read_bytes())!=match[0].lower(): raise Blocked('DCV checksum mismatch.')
                safe_extract(archive,directory/'unpacked')
                packages=[]
                for prefix in ('nice-dcv-server_','nice-dcv-web-viewer_','nice-xdcv_'):
                    found=sorted((directory/'unpacked').rglob(prefix+'*.deb'))
                    if len(found)!=1: raise Blocked(f'Expected exactly one {prefix} package.')
                    packages.append(str(found[0]))
                apt(packages); save(STATE/'dcv-artifact.json',{'url':url,'sha256':match[0].lower(),'installed_at':time.time()})
        port=self.cfg['dcv_port']
        if addresses(port) and not active('dcvserver.service'): raise Blocked('DCV port belongs to another service.')
        # Preserve licenses/certificates and all unrelated settings; modify only transport policy.
        import configparser, io
        path=Path('/etc/dcv/dcv.conf'); cfg=configparser.ConfigParser(interpolation=None,strict=False)
        cfg.optionxform=str
        if path.exists(): cfg.read(path)
        for section in ('connectivity','security'):
            if not cfg.has_section(section): cfg.add_section(section)
        cfg['connectivity']['web-port']=str(port)
        cfg['connectivity']['web-listen-endpoints']=f"['127.0.0.1:{port}']"
        cfg['connectivity']['enable-quic-frontend']='false'
        auth=cfg['security'].get('authentication','"system"').strip('\"\'')
        if auth!='system': raise Blocked('Existing DCV uses a custom authentication provider; preserved.')
        cfg['security']['authentication']='"system"'
        text=io.StringIO(); cfg.write(text); atomic(path,MARKER+'\n'+text.getvalue(),0o644)
        command(['usermod','-aG','video','dcv'])
        command(['systemctl','enable','dcvserver.service']); command(['systemctl','restart','dcvserver.service'])
        check_listener(port,'dcvserver.service')
        service('watchdog-dcv-session.service',f'''[Unit]
Description=WatchDog DCV virtual session (license required)
After=dcvserver.service
Requires=dcvserver.service
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 {Path(__file__)} dcv-session --user {self.user}
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
''')
        return {'status':'configured','port':port,'license':'existing license or automatic evaluation; no purchase',
                'graphical_login':'not-tested','transport':'TCP over SSH; QUIC disabled'}

    def run(self):
        if self.osinfo.get('ID') not in ('ubuntu','debian'): raise Blocked('Only Ubuntu/Debian desktop packages are supported.')
        if self.osinfo['ID']=='ubuntu' and int(self.osinfo['VERSION_ID'].split('.')[0])<22: raise Blocked('Ubuntu 22.04+ required.')
        if self.osinfo['ID']=='debian' and int(self.osinfo['VERSION_ID'].split('.')[0])<12: raise Blocked('Debian 12+ required.')
        with locks():
            if not self.state.get('backup'):
                (STATE/'backups').mkdir(exist_ok=True)
                self.state['backup']=snapshot(self.home); self.persist()
            SETTINGS.parent.mkdir(parents=True,exist_ok=True)
            SETTINGS.parent.chmod(0o755)
            # Operational preferences persist; shipped package/artifact defaults can advance with the source release.
            save(SETTINGS,{k:v for k,v in self.cfg.items() if k not in ('packages','dcv_artifacts')},0o644)
            free=shutil.disk_usage('/').free/(1024**3)
            if free<self.cfg['minimum_free_gib']: raise Blocked(f'Only {free:.1f} GiB free; no purge or disk resize performed.')
            try:
                self.phase('apt-index',lambda:command(['apt-get','update']) and {},True)
                self.phase('common',lambda:apt(self.cfg['packages']['common']),True)
                for desktop in self.cfg['desktops']:
                    self.phase('desktop-'+desktop,lambda d=desktop:self.desktop_packages(d))
                self.phase('shared',self.shared,True)
                for name in ('rdp','vnc','crd','dcv'):
                    if name in self.cfg['protocols']: self.phase(name,getattr(self,name))
                if 'vnc' in self.cfg['protocols']: self.phase('novnc',self.novnc)
                self.state['completed']=True
                save(STATE/'managed-hashes.json',tracked_hashes())
                self.state['acceptance']='Server probes only. A real graphical login is still required.'
            finally:
                self.state['running']=False; self.persist()


def session():
    if os.geteuid()==0: raise Blocked('Refusing a root graphical desktop.')
    runtime=load(RUNTIME); cfg=runtime['settings']; caps=runtime['capabilities']
    pref=Path.home()/'.config/remote-desktop/desktop'
    requested=pref.read_text().strip() if pref.exists() else cfg['default_desktop']
    selected=requested if caps.get(requested) is True else next((d for d in cfg['desktops'] if caps.get(d) is True),None)
    if not selected: raise Blocked('No supported X11 desktop available.')
    logs=Path.home()/'.local/state/remote-desktop'; logs.mkdir(parents=True,exist_ok=True)
    log=logs/'session.log'
    if log.exists() and log.stat().st_size>5_000_000: os.replace(log,log.with_suffix('.log.1'))
    stream=open(log,'a',buffering=1); os.dup2(stream.fileno(),1); os.dup2(stream.fileno(),2)
    print(f'{time.ctime()}: requested={requested}, selected={selected}; no preference overwritten',flush=True)
    env=dict(os.environ,XDG_SESSION_TYPE='x11'); env.pop('DBUS_SESSION_BUS_ADDRESS',None)
    env.setdefault('XDG_RUNTIME_DIR',f'/run/user/{os.getuid()}')
    keyboard=cfg['keyboard']; match=re.fullmatch(r'([a-z]+)(?:\(([a-z0-9_]+)\))?',keyboard)
    args=['setxkbmap','-layout',match[1]]
    if match[2]: args+=['-variant',match[2]]
    command(args,check=False,env=env)
    subprocess.Popen(['/usr/local/bin/remote-desktop-heartbeat'],env=env)
    if selected=='kde':
        env.update(XDG_CURRENT_DESKTOP='KDE',DESKTOP_SESSION='plasma',XDG_SESSION_DESKTOP='KDE')
        argv=['dbus-run-session','--','startplasma-x11']
    else:
        ubuntu=Path('/usr/share/gnome-session/sessions/ubuntu.session').exists()
        name='ubuntu' if ubuntu else 'gnome'
        env.update(XDG_CURRENT_DESKTOP='ubuntu:GNOME' if ubuntu else 'GNOME',DESKTOP_SESSION=name,XDG_SESSION_DESKTOP=name)
        if ubuntu:
            env.update(GNOME_SHELL_SESSION_MODE='ubuntu',XDG_CONFIG_DIRS='/etc/xdg/xdg-ubuntu:/etc/xdg',
                       XDG_DATA_DIRS='/usr/share/ubuntu:/usr/local/share:/usr/share:/var/lib/snapd/desktop')
        argv=['dbus-run-session','--','gnome-session','--session='+name]
        helptext=command(['gnome-session','--help'],capture=True,check=False).stdout
        if '--builtin' in helptext: argv.append('--builtin')
    os.execvpe(argv[0],argv,env)


def dcv_session(user):
    check_user(user)
    session_id='wd-'+user.replace('.','-').replace('_','-')
    listing=output(['dcv','list-sessions'])
    if re.search(r"Session:\s+'"+re.escape(session_id)+r"'",listing): return
    command(['dcv','create-session','--type','virtual','--owner',user,'--user',user,'--name','WatchDog desktop',
             '--gl','off','--init','/usr/local/bin/remote-desktop-session',session_id])


def status():
    data=load(STATE/'status.json',{'completed':False,'phases':{}})
    data['service_state']=command(['systemctl','is-active',UNIT],capture=True,check=False).stdout.strip()
    if data['service_state']=='failed': data['running']=False
    data['live_listeners']={}
    for key,result in data['phases'].items():
        if result.get('port'):
            try: data['live_listeners'][key]=addresses(int(result['port']))
            except Exception: data['live_listeners'][key]=None
    print(json.dumps(data,ensure_ascii=False))


def launch(user):
    check_user(user)
    if active(UNIT) or command(['systemctl','show',UNIT,'-p','ActiveState','--value'],capture=True,check=False).stdout.strip()=='activating':
        print('Existing detached installation is running.'); return
    old=parse_env(Path('/etc/remote-desktop.conf').read_text()) if Path('/etc/remote-desktop.conf').exists() else {}
    user=old.get('RD_USER') or user; check_user(user)
    # Copy source files to a root-owned content-addressed release; never execute mutable upload paths as root later.
    names=['scripts/desktop_field.py','scripts/remote_desktop.sh','config/deployment/desktop-field.json']
    content_id=digest(b''.join(n.encode()+b'\0'+(ROOT/n).read_bytes()+b'\0' for n in names))
    target=Path('/opt/watchdog-desktop/releases')/content_id
    for name in names:
        (target/name).parent.mkdir(parents=True,exist_ok=True)
        for parent in (target/name).parents:
            if str(parent).startswith('/opt/watchdog-desktop'): parent.chmod(0o755)
        atomic(target/name,(ROOT/name).read_text(),0o644)
    private_dir(STATE); log=STATE/'install.log'
    if not log.exists(): atomic(log,'')
    atomic('/etc/systemd/system/'+UNIT,MARKER+f'''
[Unit]
Description=Resumable WatchDog desktop installation
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
UMask=0077
ExecStart=/usr/bin/python3 {target}/scripts/desktop_field.py apply --user {user}
TimeoutStartSec=infinity
StandardOutput=append:{log}
StandardError=append:{log}
''',0o644)
    command(['systemctl','daemon-reload']); command(['systemctl','reset-failed',UNIT],check=False)
    command(['systemctl','start','--no-block',UNIT])
    print('Detached job started. Log: '+str(log))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['launch','apply','status','credentials','session','dcv-session','repair-policy'])
    parser.add_argument('--user',default=os.environ.get('SUDO_USER',''))
    args=parser.parse_args()
    if args.action=='session': session(); return
    if os.geteuid()!=0: raise Blocked('Run this command through sudo on the target VM.')
    if not Path('/run/systemd/system').is_dir(): raise Blocked('This is not a systemd VM; do not install into Cloud Shell.')
    if args.action=='launch': launch(args.user)
    elif args.action=='status': status()
    elif args.action=='dcv-session': dcv_session(args.user)
    elif args.action=='repair-policy': restore_policy()
    elif args.action=='credentials':
        data=load(STATE/'status.json',{}); user=data.get('user') or args.user; account=check_user(user)
        file=Path(account.pw_dir)/'.vnc/password.txt'
        value=''
        if file.is_file() and not file.is_symlink():
            result=command(['runuser','-u',user,'--','cat',str(file)],capture=True,check=False)
            if result.returncode==0: value=result.stdout.strip()
        # This dedicated command is never written to the installation log.
        print(json.dumps({'user':user,'vnc_password':value}))
    else:
        private_dir(STATE)
        signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
        Installer(args.user).run()

if __name__=='__main__':
    try: main()
    except (Blocked,OSError,ValueError,subprocess.SubprocessError) as exc:
        print('STOP: '+str(exc),file=sys.stderr); sys.exit(1)
