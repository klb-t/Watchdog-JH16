#!/usr/bin/env python3
"""Cloud Shell onboarding + private Drive export transfer. No embedded owner data.
Transfer survives a browser disconnect, but cannot survive destruction of Cloud Shell's VM.
"""
from __future__ import annotations
import argparse, fcntl, hashlib, json, os, pathlib, re, shlex, shutil, subprocess, sys, tempfile, time
import urllib.request, urllib.error

def run(args,**kw):return subprocess.run(args,check=True,**kw)
def common(c):return ['--project',c['project'],'--zone',c['zone'],'--tunnel-through-iap','--quiet']
def ssh(c,command,tty=False,capture=False):
    args=['gcloud','compute','ssh',c['instance'],*common(c),'--command',command]
    if tty:args.append('--ssh-flag=-tt')
    return run(args,text=True,capture_output=capture)
def scp(c,source,destination):run(['gcloud','compute','scp',*common(c),str(source),c['instance']+':'+destination])
def token():return subprocess.check_output(['gcloud','auth','print-access-token'],text=True).strip()
def meta(fid):
    req=urllib.request.Request(f'https://www.googleapis.com/drive/v3/files/{fid}?fields=id,name,size,md5Checksum,modifiedTime',headers={'Authorization':'Bearer '+token()})
    with urllib.request.urlopen(req,timeout=45) as r:return json.load(r)
def hash_file(p,kind):
    h=hashlib.new(kind)
    with open(p,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def download(fid,dest):
    m=meta(fid);size=int(m['size']);md5=m.get('md5Checksum')
    if dest.exists() and dest.stat().st_size==size and (not md5 or hash_file(dest,'md5')==md5):return m
    part=dest.with_suffix('.part');start=part.stat().st_size if part.exists() else 0
    if start>size:raise RuntimeError('Partial download larger than source; manual review needed')
    if shutil.disk_usage(dest.parent).free<size-start+256*1024*1024:raise RuntimeError('Not enough local space for export')
    for attempt in range(5):
        start=part.stat().st_size if part.exists() else 0
        if start==size:break
        headers={'Authorization':'Bearer '+token()}
        if start:headers['Range']=f'bytes={start}-'
        req=urllib.request.Request(f'https://www.googleapis.com/drive/v3/files/{fid}?alt=media',headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=90) as r:
                # A server can ignore Range: replace this incomplete temp, never append duplicated bytes.
                append=start>0 and r.status==206
                if r.status==206 and not r.headers.get('Content-Range','').startswith(f'bytes {start}-'):
                    raise RuntimeError('Invalid Content-Range')
                with open(part,'ab' if append else 'wb') as out:
                    os.chmod(part,0o600)
                    while True:
                        b=r.read(1024*1024)
                        if not b:break
                        out.write(b)
                    out.flush();os.fsync(out.fileno())
            break
        except (urllib.error.URLError,TimeoutError):
            if attempt==4:raise
            time.sleep(2**attempt)
    if part.stat().st_size!=size or (md5 and hash_file(part,'md5')!=md5):
        raise RuntimeError('Export size/checksum mismatch; partial file kept, not imported')
    newer=meta(fid)
    if newer.get('md5Checksum')!=md5 or newer['size']!=m['size']:raise RuntimeError('Drive source changed during transfer')
    os.replace(part,dest);return m

def transfer(config_path):
    c=json.loads(pathlib.Path(config_path).read_text());folder=pathlib.Path(config_path).parent
    lock=open(folder/'transfer.lock','a')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:return
    states=[]
    for src in c['sources']:
        p=folder/(src['label']+'-'+src['id']+'.zip')
        try:
            m=download(src['id'],p);sha=hash_file(p,'sha256');target=c['home']+'/devbox-agent/sources/'+src['label']+'-'+sha[:16]+'.zip'
            # Verify remote free space before SCP; no archive overwrites before checksum verification.
            size=int(m['size'])
            ssh(c,'python3 -c '+shlex.quote('import shutil; assert shutil.disk_usage('+repr(c['home'])+').free > '+str(size+256*1024*1024)))
            scp(c,p,target+'.part')
            code='import hashlib,os,pathlib; p=pathlib.Path('+repr(target+'.part')+'); h=hashlib.sha256(); f=p.open("rb"); '+\
                 '[h.update(b) for b in iter(lambda:f.read(1048576),b"")]; f.close(); assert h.hexdigest()=='+repr(sha)+'; os.chmod(p,0o600); os.replace(p,'+repr(target)+')'
            ssh(c,'python3 -c '+shlex.quote(code));states.append(dict(src,state='transferred',sha256=sha,metadata=m))
        except Exception as e:states.append(dict(src,state='blocked',error=type(e).__name__))
        (folder/'transfer-status.json').write_text(json.dumps(states,indent=2))
    scp(c,folder/'transfer-status.json',c['home']+'/devbox-agent/state/transfer-status.json')
    cmd='python3 "$HOME/devbox-agent/current/agentctl.py" scan "$HOME"/devbox-agent/sources/*.zip'
    try:ssh(c,cmd)
    except subprocess.CalledProcessError:pass
    prompt=('Read the actual transfer-status.json and analysis/selection.json. Missing sources mean incomplete coverage. '
      'Run the cached two-stage review helper ../current/review.py with discovered small model, then Astra at maximum supported effort. '
      'Do not silently replace unavailable models, do not use API credentials or buy credits. '
      'Reconcile the full shortlisted conversations with source IDs, distinguishing owner decisions, ideas, model proposals and revisions. '
      'Keep mixed and uncertain items; audit exclusions. Save private PITCH_REQUIREMENTS.md, CONFLICTS.md, COVERAGE.md, and implementation backlog. '
      'After source analysis implement the constrained pitching agent, not a public administrator, with a genuine instrumented avatar interface. '
      'No contact with investors or public data publication without an explicit later request.')
    local=folder/'review-task.txt';local.write_text(prompt)
    scp(c,local,c['home']+'/devbox-agent/private/review-task.txt')
    review_id='source-review-'+hashlib.sha256(json.dumps([(x['id'],x.get('sha256'),x['state']) for x in states],sort_keys=True).encode()).hexdigest()[:16]
    ssh(c,'python3 "$HOME/devbox-agent/current/agentctl.py" queue --id '+review_id+' --file "$HOME/devbox-agent/private/review-task.txt"')


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--transfer');ap.add_argument('--project');ap.add_argument('--zone');ap.add_argument('--instance')
    ap.add_argument('--source',action='append',default=[]);ap.add_argument('--task-file');ap.add_argument('--no-console',action='store_true')
    a=ap.parse_args();os.umask(0o077)
    if a.transfer:return transfer(a.transfer)
    for value in (a.project,a.zone,a.instance):
        if not value or not re.fullmatch(r'[a-z][a-z0-9-]{1,62}',value):raise ValueError('Invalid GCP target')
    c=vars(a).copy();c['sources']=[]
    for item in a.source:
        label,fid=item.split('=',1)
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,40}',label) or not re.fullmatch(r'[A-Za-z0-9_-]{10,200}',fid):raise ValueError('Invalid source')
        c['sources'].append({'label':label,'id':fid})
    if len({s['label'] for s in c['sources']})!=len(c['sources']):raise ValueError('Duplicate source label')
    c['task']=pathlib.Path(a.task_file).read_text()
    status=subprocess.check_output(['gcloud','compute','instances','describe',a.instance,'--project',a.project,'--zone',a.zone,'--format=value(status)'],text=True).strip()
    if status in ('TERMINATED','SUSPENDED'):
        run(['gcloud','compute','instances','start' if status=='TERMINATED' else 'resume',a.instance,'--project',a.project,'--zone',a.zone,'--quiet'])
    elif status!='RUNNING':raise RuntimeError('VM is transitioning; no reset performed')
    home=ssh(c,'printf "RESIDENT_HOME=%s\\n" "$HOME"',capture=True).stdout
    match=re.search(r'^RESIDENT_HOME=(/[^\r\n]+)$',home,re.M)
    if not match:raise RuntimeError('Cannot resolve remote home')
    c['home']=match.group(1)
    if not re.fullmatch(r'/home/[A-Za-z0-9_.-]+',c['home']):raise RuntimeError('Unsupported home path; not guessed')
    identity=hashlib.sha256(json.dumps([a.project,a.zone,a.instance,c['sources']],sort_keys=True).encode()).hexdigest()[:20]
    folder=pathlib.Path('/tmp')/('resident-transfer-'+str(os.getuid())+'-'+identity)
    if folder.is_symlink():raise RuntimeError('Refusing transfer-directory symlink')
    folder.mkdir(mode=0o700,exist_ok=True)
    if folder.stat().st_uid!=os.getuid():raise RuntimeError('Transfer directory belongs to another user')
    folder.chmod(0o700)
    config_path=folder/'owner.json';config_path.write_text(json.dumps(c,ensure_ascii=False))
    stage=c['home']+'/.resident-stage-'+os.urandom(6).hex()
    ssh(c,'mkdir -m 700 '+shlex.quote(stage))
    for name in ('agentctl.py','review.py','install_vm.sh'):
        scp(c,pathlib.Path(__file__).parent/name,stage+'/'+name)
    scp(c,config_path,stage+'/owner.json')
    ssh(c,'bash '+shlex.quote(stage+'/install_vm.sh'),tty=True)
    # Optional Drive authorization happens AFTER the agent is installed.
    if c['sources']:
        try:
            try:meta(c['sources'][0]['id'])
            except urllib.error.HTTPError as e:
                if e.code not in (401,403):raise
                print('Google Drive needs authorization. Complete the browser/device flow below.')
                run(['gcloud','auth','login','--enable-gdrive-access','--no-launch-browser','--force'])
                meta(c['sources'][0]['id'])
        except Exception as e:
            print('Drive access not ready; the resident agent remains installed:',type(e).__name__)
    # Detached transfer starts after owner auth. The VM worker is independent of this process.
    with open(folder/'transfer.log','ab',buffering=0) as log:
        subprocess.Popen([sys.executable,str(pathlib.Path(__file__).resolve()),'--transfer',str(config_path)],
            stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
    print('EXPORT_TRANSFER_STARTED; private local log:',folder/'transfer.log')
    print('The resident queue runs on the VM; no connection to this ChatGPT thread has been created.')
    if not a.no_console:ssh(c,'"$HOME/agent"',tty=True)

if __name__=='__main__':
    try:main()
    except Exception as e:
        print('BOOTSTRAP BLOCKED:',str(e),file=sys.stderr);sys.exit(1)
