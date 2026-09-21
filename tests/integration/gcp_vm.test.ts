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
    if 'archive' in args:
        dest=next(a.split('=',1)[1] for a in args if a.startswith('--output='));open(dest,'wb').write(b'fixture archive')
elif tool=='gcloud':
    if args[:3]==['config','get-value','project']: print('test-project')
    if args[:3]==['compute','instances','describe']:
        print(json.dumps({'id':'12345','status':'RUNNING','networkInterfaces':[{'network':'https://www.googleapis.com/compute/v1/projects/test-project/global/networks/default'}], 'disks':[{'boot':True,'source':'projects/test-project/zones/europe-central2-a/disks/test-vm'}]}))
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
