#!/usr/bin/env python3
"""Cloud Shell controller: upload verified sources, launch detached, open private SSH forwards.
No cloud firewall/IAM changes, no deletion/resize, no credential logging.
Cloud Shell's HTTPS preview exposes HTTP/noVNC, NOT native RDP sockets on Android.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request

MARKER='# WatchDog desktop-cloud/1'
HOME=Path.home()/'.local/share/watchdog-desktop-client'
ROOT=Path(__file__).resolve().parents[1]
NAMES=['scripts/desktop_field.py','scripts/remote_desktop.sh','config/deployment/desktop-field.json']


def run(args,**kw):
    return subprocess.run([str(a) for a in args],text=True,check=True,**kw)


def write(path,text,mode=0o600):
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.is_symlink(): raise RuntimeError(f'Refusing symlink: {path}')
    fd,name=tempfile.mkstemp(dir=path.parent,prefix='.'+path.name)
    with os.fdopen(fd,'w') as f: f.write(text); f.flush(); os.fsync(f.fileno()); os.fchmod(f.fileno(),mode)
    os.replace(name,path)


def read(path,default=None):
    return json.loads(path.read_text()) if path.exists() else default


def free_port(preferred,used):
    with socket.socket() as s:
        try:
            if preferred in used: raise OSError('reserved')
            s.bind(('127.0.0.1',preferred))
        except OSError: s.bind(('127.0.0.1',0))
        return s.getsockname()[1]


def forward_arguments(endpoints):
    result=[]
    for key,item in sorted(endpoints.items()):
        if type(item['local']) is not int or type(item['remote']) is not int or not all(1024<=item[k]<=65000 for k in ('local','remote')):
            raise ValueError('Invalid port mapping.')
        result+=['-L',f'127.0.0.1:{item["local"]}:127.0.0.1:{item["remote"]}']
    return result


def browser_url(host,port,password=''):
    if not re.fullmatch(r'[A-Za-z0-9.-]+',host): raise ValueError('Invalid Cloud Shell WEB_HOST.')
    suffix='/vnc.html?autoconnect=1&resize=scale&path=websockify'
    if password: suffix+='#password='+urllib.parse.quote(password,safe='')
    return f'https://{port}-{host}'+suffix


class Cloud:
    def __init__(self,config):
        self.cfg=config
        for key,pattern in [('project',r'[a-z][a-z0-9-]{4,61}[a-z0-9]'),('zone',r'[a-z]+-[a-z0-9]+[0-9]-[a-z]'),
                            ('instance',r'[a-z][a-z0-9-]{0,61}[a-z0-9]')]:
            if not re.fullmatch(pattern,config[key]): raise ValueError('Invalid '+key)
        self.common=['--project',config['project'],'--zone',config['zone'],'--quiet']
        self.transport=config.get('transport','iap')
        self.directory=HOME/hashlib.sha256(json.dumps(config,sort_keys=True).encode()).hexdigest()[:12]
        self.directory.mkdir(parents=True,exist_ok=True); self.directory.chmod(0o700)
        self.remote='/usr/bin/python3 /opt/watchdog-desktop/current/scripts/desktop_field.py'

    def ssh_args(self):
        return ['gcloud','compute','ssh',self.cfg['instance'],*self.common,'--ssh-flag=-oConnectTimeout=20','--ssh-flag=-oConnectionAttempts=1']+(['--tunnel-through-iap'] if self.transport=='iap' else [])

    def ssh(self,command,*,capture=True,tty=False):
        return run([*self.ssh_args(),*(['--ssh-flag=-tt'] if tty else []),'--command',command],
                   capture_output=capture,stdin=None if tty else subprocess.DEVNULL,timeout=900 if tty else 180)

    def discover_transport(self):
        failures=[]
        for transport in ('iap','direct'):
            self.transport=transport
            try:
                result=self.ssh('test -d /run/systemd/system && id -un')
                user=result.stdout.strip()
                if not re.fullmatch(r'[a-z_][a-z0-9_.-]*\$?',user): raise RuntimeError('Unexpected target user.')
                self.cfg['transport']=transport
                return user
            except (subprocess.CalledProcessError,subprocess.TimeoutExpired) as exc:
                detail=getattr(exc,'stderr','') or str(exc)
                if isinstance(detail,bytes): detail=detail.decode(errors='replace')
                failures.append(transport+': '+detail[-1800:])
        raise RuntimeError('Cannot connect; no firewall or IAM policy was relaxed.\n'+'\n'.join(failures))

    def install(self):
        status=run(['gcloud','compute','instances','describe',self.cfg['instance'],*self.common,
                    '--format=value(status)'],capture_output=True).stdout.strip()
        if status in ('TERMINATED','SUSPENDED'):
            run(['gcloud','compute','instances','start' if status=='TERMINATED' else 'resume',self.cfg['instance'],*self.common])
        elif status!='RUNNING': raise RuntimeError('VM is '+status+'; no forced reset performed.')
        user=self.discover_transport()
        with tempfile.TemporaryDirectory(prefix='watchdog-desktop-') as temp:
            archive=Path(temp)/'desktop.tgz'
            with tarfile.open(archive,'w:gz',dereference=False) as tar:
                for name in NAMES:
                    file=ROOT/name
                    if not file.is_file() or file.is_symlink(): raise RuntimeError('Missing/untrusted source: '+name)
                    tar.add(file,arcname=name)
            sha=hashlib.sha256(archive.read_bytes()).hexdigest()
            remote_temp=self.ssh('umask 077; mktemp -d /tmp/watchdog-desktop.XXXXXXXX').stdout.strip()
            if not re.fullmatch(r'/tmp/watchdog-desktop\.[A-Za-z0-9]{8}',remote_temp): raise RuntimeError('Unexpected remote staging path.')
            run(['gcloud','compute','scp',str(archive),self.cfg['instance']+':'+remote_temp+'/desktop.tgz',
                 *self.common,*(['--tunnel-through-iap'] if self.transport=='iap' else [])],stdout=subprocess.DEVNULL)
            q=shlex.quote
            # Uploaded archive was locally created with an explicit file list, not downloaded from an untrusted URL.
            cmd=(f'cd {q(remote_temp)} && printf "%s  desktop.tgz\\n" {sha} | sha256sum -c - && '
                 f'tar -xzf desktop.tgz && sudo python3 scripts/desktop_field.py launch --user {q(user)}')
            print(self.ssh(cmd).stdout,flush=True)
        # The launch command installs its immutable source path; resolve it from systemd rather than guess.
        exe=self.ssh("systemctl show watchdog-desktop-install.service -p ExecStart --value").stdout
        match=re.search(r'(/opt/watchdog-desktop/releases/[0-9a-f]{64}/scripts/desktop_field\.py)',exe)
        if not match: raise RuntimeError('Cannot resolve installed controller from service.')
        self.remote='/usr/bin/python3 '+match[1]
        self.cfg['remote']=self.remote
        self.persist_client()
        for _ in range(120):
            time.sleep(15)
            try: data=self.get_status()
            except subprocess.CalledProcessError:
                print('SSH interrupted. Installation continues under systemd. Re-paste to reconnect.',flush=True); return None
            print('VM: '+data.get('service_state','unknown')+'; phase: '+data.get('phase','starting'),flush=True)
            if data.get('service_state') not in ('activating','active','reloading'):
                return data
        print('Still running. The detached job continues; use ~/wd-desktop status.',flush=True)
        return None

    def persist_client(self):
        write(self.directory/'connection.json',json.dumps(self.cfg,indent=2)+'\n')
        write(HOME/'latest.json',json.dumps(self.cfg)+'\n')
        write(HOME/'desktop_cloud.py',Path(__file__).read_text(),0o700)
        helper=Path.home()/'wd-desktop'
        if helper.exists() and MARKER not in helper.read_text():
            print('Existing ~/wd-desktop was not overwritten. Client: '+str(HOME/'desktop_cloud.py'))
        else:
            write(helper,'#!/bin/sh\n'+MARKER+'\nexec python3 '+shlex.quote(str(HOME/'desktop_cloud.py'))+' "${1:-tunnel}"\n',0o700)

    def get_status(self):
        self.remote=self.cfg.get('remote',self.remote)
        return json.loads(self.ssh('sudo '+self.remote+' status').stdout)

    def show(self,data):
        print('\n=== STATUS (not proof of a graphical login) ===')
        for key,value in sorted(data.get('phases',{}).items()):
            print(key+': '+value.get('status','unknown')+(' — '+value['reason'] if value.get('reason') else ''))
        if data.get('backup'): print('Private backup on VM: '+data['backup'])

    def tunnel(self,data):
        self.remote=self.cfg.get('remote',self.remote)
        # A private, owned control socket identifies this connection; no PID-based kill or guesswork.
        identity=hashlib.sha256((self.cfg['project']+self.cfg['zone']+self.cfg['instance']).encode()).hexdigest()[:12]
        socket_path=HOME/('ssh-'+identity+'.sock')
        tunnel_file=HOME/('tunnel-'+identity+'.json')
        endpoints={}; defaults={'rdp':13389,'vnc':15901,'dcv':18443,'novnc':18080}; used=set()
        for key,preferred in defaults.items():
            result=data.get('phases',{}).get(key,{})
            listeners=data.get('live_listeners',{}).get(key,[])
            if result.get('status')=='configured' and listeners and result.get('port'):
                local=free_port(preferred,used); used.add(local)
                endpoints[key]={'local':local,'remote':result['port']}
        if not endpoints:
            print('No verified listening endpoints. Installation log on VM: /var/lib/watchdog-desktop/install.log'); return
        old=read(tunnel_file,{})
        alive=subprocess.run(['ssh','-S',str(socket_path),'-O','check','unused-host'],capture_output=True).returncode==0
        if alive and {k:v['remote'] for k,v in old.items()}=={k:v['remote'] for k,v in endpoints.items()}:
            endpoints=old
        else:
            if alive: run(['ssh','-S',str(socket_path),'-O','exit','unused-host'],capture_output=True)
            if socket_path.exists(): socket_path.unlink()
            argv=[*self.ssh_args(),'--','-N','-o','ControlMaster=yes','-o','ControlPath='+str(socket_path),
                  '-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3',
                  *forward_arguments(endpoints)]
            log=open(self.directory/'tunnel.log','a')
            proc=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
            ready=False
            for _ in range(45):
                time.sleep(1)
                if proc.poll() is not None: break
                ready=subprocess.run(['ssh','-S',str(socket_path),'-O','check','unused-host'],capture_output=True).returncode==0
                if ready: break
            if not ready: raise RuntimeError('SSH forwarding failed; see '+str(self.directory/'tunnel.log'))
            write(tunnel_file,json.dumps(endpoints)+'\n')
        # Portable learning artifact: binds on the machine that executes this command, not magically on Android.
        native=[*self.ssh_args(),'--','-N','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30',*forward_arguments(endpoints)]
        write(self.directory/'tunnel-command.sh','#!/bin/sh\n'+shlex.join(native)+'\n',0o700)
        print('\n=== SSH TUNNEL RUNNING ===')
        for key,ports in endpoints.items():
            print(f'{key}: Cloud Shell 127.0.0.1:{ports["local"]} -> VM 127.0.0.1:{ports["remote"]}')
        print('Reconnect: ~/wd-desktop tunnel  |  status: ~/wd-desktop status  |  CRD authorization: ~/wd-desktop authorize')
        print('Portable SSH command: '+str(self.directory/'tunnel-command.sh'))
        host=os.environ.get('WEB_HOST')
        if host and 'novnc' in endpoints:
            try: credentials=json.loads(self.ssh('sudo '+self.remote+' credentials').stdout)
            except subprocess.SubprocessError: credentials={}
            password=credentials.get('vnc_password','')
            print('\nOPEN DESKTOP — PRIVATE LINK; do not screenshot/share:')
            print(browser_url(host,endpoints['novnc']['local'],password))
            if not password: print('Existing VNC password preserved; enter it in the browser when requested.')
        elif 'novnc' in endpoints:
            print('Browser: http://127.0.0.1:'+str(endpoints['novnc']['local'])+'/vnc.html')
        print('Native RDP/VNC clients on a phone cannot use Cloud Shell localhost directly. Browser preview is the bridge.')
        print('Closing/expiring Cloud Shell ends this tunnel, not the VM-side installation. Re-run ~/wd-desktop tunnel.')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['install','status','tunnel','authorize'])
    for key in ('project','zone','instance'): parser.add_argument('--'+key)
    args=parser.parse_args()
    if not shutil.which('gcloud'): raise RuntimeError('Run this controller in Google Cloud Shell.')
    if args.action=='install' and os.environ.get('WEB_HOST','')=='' and socket.gethostname()==args.instance:
        raise RuntimeError('You are already on the target VM. Open Cloud Shell (console.cloud.google.com), not browser SSH.')
    HOME.mkdir(parents=True,exist_ok=True); HOME.chmod(0o700)
    if args.action=='install':
        cfg={key:getattr(args,key) for key in ('project','zone','instance')}
        if not all(cfg.values()): raise RuntimeError('Provide project, zone and instance.')
    else:
        cfg=read(HOME/'latest.json')
        if not cfg: raise RuntimeError('No saved target; first run the install command.')
    cloud=Cloud(cfg)
    if args.action=='authorize':
        cloud.ssh('sudo remote-desktop crd-register',capture=False,tty=True); return
    data=cloud.install() if args.action=='install' else cloud.get_status()
    if data:
        cloud.show(data)
        if args.action!='status': cloud.tunnel(data)

if __name__=='__main__':
    try: main()
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError) as exc:
        print('STOP: '+str(exc),file=sys.stderr); sys.exit(1)
