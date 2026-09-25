import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
function harness(extra:Record<string,string>={}) {
  const dir=mkdtempSync(path.join(tmpdir(),'watchdog-gcp-'));mkdirSync(path.join(dir,'bin'));
  // Model the external CLI boundary; no credentials, network, root or cloud mutations.
  const cli=`#!/usr/bin/env python3
import json, os, sys
args=sys.argv[1:]; tool=os.path.basename(sys.argv[0]); log=os.environ['CLI_LOG']
with open(log,'a') as f: f.write(json.dumps([tool,*args])+'\\n')
if tool=='git':
    if 'rev-parse' in args: print('a'*40 if 'FETCH_HEAD^{commit}' in args else os.environ['MOCK_REPO'])
    if 'symbolic-ref' in args:
        if os.environ.get('DETACHED'): sys.exit(1)
        print('claude/current-work')
    if 'archive' in args:
        dest=next(a.split('=',1)[1] for a in args if a.startswith('--output='));open(dest,'wb').write(b'fixture archive')
elif tool=='gcloud':
    if args[:3]==['config','get-value','project']: print('test-project')
    if args[:3]==['compute','instances','describe']:
        print(json.dumps({'id':'12345','status':'RUNNING','networkInterfaces':[{'network':'https://www.googleapis.com/compute/v1/projects/test-project/global/networks/default',**({} if os.environ.get('NO_NAT') else {'accessConfigs':[{'natIP':'34.118.12.7'}]})}], 'disks':[{'boot':True,'source':'projects/test-project/zones/europe-central2-a/disks/test-vm'}]}))
    if args[:3]==['compute','firewall-rules','describe']:
        if os.environ.get('RULE_EXISTS')!='1': sys.exit(1)
        print(json.dumps({'direction':'INGRESS','network':'https://www.googleapis.com/compute/v1/projects/test-project/global/networks/default','targetTags':['other' if os.environ.get('COLLISION') else 'wd-12345'],('allowed' if args[3].endswith('-iap') else 'denied'):[{'IPProtocol':'tcp'}]}))
    if args[:2]==['compute','ssh']:
        cmd=args[args.index('--command')+1]
        if cmd=='true' and os.environ.get('FAIL_IAP'): sys.exit(1)
        if cmd.startswith('umask'): print('/tmp/watchdog-deploy.ABCD1234')
`;
  for(const tool of ['gcloud','git']) writeFileSync(path.join(dir,'bin',tool),cli,{mode:0o755});
  const env={...process.env,PATH:path.join(dir,'bin')+':'+process.env.PATH,CLI_LOG:path.join(dir,'calls'),MOCK_REPO:root,...extra};
  const run=(flags:string[]=[])=>spawnSync('bash',[path.join(root,'scripts/deploy_gcp_vm.sh'),'--project','test-project','--zone','europe-central2-a','--instance','test-vm',...flags],{env,encoding:'utf8',timeout:20_000});
  const calls=():string[][]=>{try{return readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));}catch{return [];}};
  return {run,calls,clean:()=>rmSync(dir,{recursive:true,force:true})};
}

test('E3.13: all installer entrypoints have valid bash syntax',()=>{
  for(const file of ['deploy_gcp_vm.sh','gcp_vm_bootstrap.sh','watchdogctl.sh','check_container.sh']) {
    const result=spawnSync('bash',['-n',path.join(root,'scripts',file)],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
  }
});

test('E3.13: plan and malformed arguments do not mutate cloud or fetch code',()=>{
  const h=harness();try {
    assert.equal(h.run(['--plan']).status,0);assert.deepEqual(h.calls(),[]);
    for(const flags of [['--instance','bad;cmd'],['--ref','--upload-pack=evil'],['--zone'],['--project','bad\nproject']]) {
      assert.notEqual(h.run(flags).status,0);
    }
    assert.deepEqual(h.calls(),[]);
  }finally{h.clean();}
});

test('E3.13: IAP is proved before deny rules; deployment is pinned and credentials stay local',()=>{
  const h=harness();try {
    const result=h.run();assert.equal(result.status,0,result.stderr);
    const calls=h.calls();
    const ssh=calls.findIndex(a=>a.includes('ssh')&&a.includes('true'));
    const deny=calls.findIndex(a=>a.includes('firewall-rules')&&a.includes('DENY'));
    assert.ok(ssh>=0&&deny>ssh);
    const fw=calls.filter(a=>a.includes('firewall-rules')&&a.includes('create'));
    assert.equal(fw.length,3);
    assert.ok(fw.every(a=>a[a.indexOf('--target-tags')+1]==='wd-12345'));
    assert.ok(fw.some(a=>a.includes('35.235.240.0/20')&&a.includes('tcp:22')&&a.includes('ALLOW')));
    assert.ok(fw.some(a=>a.includes('::/0')&&a.includes('DENY')));
    assert.ok(calls.some(a=>a.includes('set-disk-auto-delete')&&a.includes('--no-auto-delete')));
    assert.ok(calls.filter(a=>a.includes('ssh')||a.includes('scp')).every(a=>a.includes('--tunnel-through-iap')));
    const remote=calls.find(a=>a.some(v=>v.includes('sudo bash scripts/gcp_vm_bootstrap.sh')))!;
    assert.ok(remote.some(v=>v.includes('sha256sum -c -')&&v.includes('a'.repeat(40))));
    assert.ok(!calls.flat().some(v=>/GH_TOKEN|github_pat_|ghp_/.test(v)));
    assert.match(result.stdout,/Preview on port 8080/);
  }finally{h.clean();}
});

test('E3.13: failed IAP leaves previous SSH paths and boot-disk settings intact',()=>{
  const h=harness({FAIL_IAP:'1'});try {
    const result=h.run();assert.notEqual(result.status,0);assert.match(result.stderr,/IAP SSH failed/);
    assert.ok(!h.calls().some(a=>a.includes('DENY')||a.includes('scp')||a.includes('set-disk-auto-delete')));
  }finally{h.clean();}
});

test('E3.13: rerun updates only matching rules and rejects a name collision',()=>{
  for(const collision of [false,true]) {
    const h=harness({RULE_EXISTS:'1',...(collision?{COLLISION:'1'}:{})});try {
      const result=h.run();assert.equal(result.status===0,!collision,result.stderr);
      const mutations=h.calls().filter(a=>a.includes('firewall-rules')&&(a.includes('update')||a.includes('create')));
      if(collision) assert.equal(mutations.length,0);
      else {assert.equal(mutations.length,3);assert.ok(mutations.every(a=>a.includes('update')));}
    }finally{h.clean();}
  }
});

test('E3.13: runtime unit enforces durable single-writer private deployment',()=>{
  const unit=readFileSync(path.join(root,'deploy/watchdog.service'),'utf8');
  for(const contract of ['--publish 127.0.0.1:8080:8080','--user 1000:1000','--read-only','--cap-drop ALL',
    '--mount type=bind,src=/var/lib/watchdog,dst=/mnt/watchdog','--env-file /etc/watchdog/app.env','Restart=always']) assert.ok(unit.includes(contract),contract);
  assert.ok(!unit.includes('--privileged'));assert.ok(!unit.includes('docker.sock'));
  const bootstrap=readFileSync(path.join(root,'scripts/gcp_vm_bootstrap.sh'),'utf8');
  assert.ok(bootstrap.indexOf('docker build --pull')<bootstrap.indexOf('systemctl stop watchdog.service'));
  assert.ok(bootstrap.indexOf('Pre-update backup:')<bootstrap.indexOf('> /etc/watchdog/release.env'));
  assert.ok(!bootstrap.includes('WATCHDOG_ALLOW_EPHEMERAL_STORAGE'));
});

test('E3.13: without --ref the branch checked out in Cloud Shell is deployed, never a stale default',()=>{
  const h=harness();try {
    const result=h.run();assert.equal(result.status,0,result.stderr);
    assert.ok(h.calls().some(a=>a[0]==='git'&&a.includes('fetch')&&a.includes('claude/current-work')));
  }finally{h.clean();}
  const d=harness({DETACHED:'1'});try {
    const result=d.run();assert.notEqual(result.status,0);assert.match(result.stderr,/pass --ref/);
    assert.ok(!d.calls().some(a=>a[0]==='gcloud'));
  }finally{d.clean();}
});

test('public HTTPS: sslip.io host from the VM IP, static IP, 80/443 rule scoped to the VM, sign-in passed through',()=>{
  const h=harness();try {
    const result=h.run(['--public','--owner','Owner@Lab.Example']);assert.equal(result.status,0,result.stderr);
    const calls=h.calls();
    const web=calls.find(a=>a.includes('firewall-rules')&&a.includes('create')&&a.includes('wd-12345-web'))!;
    assert.ok(web,'a web rule is created');
    assert.equal(web[web.indexOf('--rules')+1],'tcp:80,tcp:443');assert.equal(web[web.indexOf('--target-tags')+1],'wd-12345');
    assert.ok(web.includes('ALLOW'));
    const iap=calls.findIndex(a=>a.includes('ssh')&&a.includes('true'));
    assert.ok(calls.indexOf(web)>iap,'nothing is opened before IAP is proved');
    const address=calls.find(a=>a.includes('addresses')&&a.includes('create'))!;
    assert.ok(address&&address.includes('34.118.12.7')&&address.includes('europe-central2'));
    const remote=calls.find(a=>a.some(v=>v.includes('sudo bash scripts/gcp_vm_bootstrap.sh')))!.find(v=>v.includes('gcp_vm_bootstrap'))!;
    assert.match(remote,/--owner owner@lab\.example/);assert.match(remote,/--public-host 34-118-12-7\.sslip\.io/);
    assert.match(result.stdout,/https:\/\/34-118-12-7\.sslip\.io/);
  }finally{h.clean();}
});

test('public HTTPS: own domain, missing external IP and bad values fail before any cloud change',()=>{
  const h=harness();try {
    const result=h.run(['--domain','WatchDog.Example.org']);assert.equal(result.status,0,result.stderr);
    assert.ok(h.calls().some(a=>a.some(v=>v.includes('--public-host watchdog.example.org'))));
  }finally{h.clean();}
  const n=harness({NO_NAT:'1'});try {
    const result=n.run(['--public']);assert.notEqual(result.status,0);assert.match(result.stderr,/no external IPv4/);
    assert.ok(!n.calls().some(a=>a.includes('firewall-rules')||a.includes('services')));
  }finally{n.clean();}
  const b=harness();try {
    for(const flags of [['--domain','https://x.org'],['--domain','a b.org'],['--owner','not-an-email'],['--owner','a"b@c.org']]) assert.notEqual(b.run(flags).status,0);
    assert.deepEqual(b.calls(),[]);
  }finally{b.clean();}
  const p=harness();try {
    const result=p.run(['--public','--plan']);assert.equal(result.status,0);assert.match(result.stdout,/sslip\.io/);assert.deepEqual(p.calls(),[]);
  }finally{p.clean();}
});

test('public HTTPS: sign-in is enforced before the internet can reach the app; proxy is contained',()=>{
  const bootstrap=readFileSync(path.join(root,'scripts/gcp_vm_bootstrap.sh'),'utf8');
  assert.ok(bootstrap.indexOf('Public access needs sign-in')<bootstrap.indexOf('docker build --pull'),'refused before building');
  assert.ok(bootstrap.indexOf('watchdogctl enable-accounts')<bootstrap.indexOf('watchdogctl enable-public'));
  assert.ok(bootstrap.includes('deploy/watchdog-proxy.service'));
  const ctl=readFileSync(path.join(root,'scripts/watchdogctl.sh'),'utf8');
  const block=ctl.slice(ctl.indexOf('  enable-public)'),ctl.indexOf('  disable-public)'));
  const refuse=block.indexOf("grep -qsx 'WATCHDOG_AUTH=accounts'");
  assert.ok(refuse>0);
  for(const change of ['set_env','ufw allow','systemctl']) assert.ok(block.indexOf(change)>refuse,`${change} only after the sign-in check`);
  const proxy=readFileSync(path.join(root,'deploy/watchdog-proxy.service'),'utf8');
  for(const contract of ['--network host','--read-only','--cap-drop ALL','--cap-add NET_BIND_SERVICE','no-new-privileges=true']) assert.ok(proxy.includes(contract),contract);
  assert.ok(!proxy.includes('--privileged'));assert.ok(!proxy.includes('docker.sock'));
  assert.match(proxy,/caddy:\d+\.\d+/,'the proxy image is pinned to a minor version');
  assert.match(ctl,/reverse_proxy 127\.0\.0\.1:8080/);
  const unit=readFileSync(path.join(root,'deploy/watchdog.service'),'utf8');
  assert.ok(unit.includes('--publish 127.0.0.1:8080:8080'),'the app itself never listens publicly');
});
