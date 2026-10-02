import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('E3.17/E4.7: isolated operator commands preserve grants and refuse public access before accounts',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'watchdog-access-ops-'));
  const write=(name:string,text:string,mode=0o600)=>{mkdirSync(path.dirname(path.join(root,name)),{recursive:true});writeFileSync(path.join(root,name),text,{mode});};
  write('etc/watchdog/app.env','WATCHDOG_GRANTS={"previous@lab.example":"researcher"}\nWATCHDOG_ALLOW_OPEN_INSTANCE=true\n');
  write('etc/systemd/system/watchdog-proxy.service','synthetic unit');
  write('usr/local/lib/watchdog/watchdog_access.sh',readFileSync('scripts/watchdog_access.sh','utf8'),0o755);
  for(const command of ['systemctl','curl','docker','ufw']) write(`test-bin/${command}`,`#!/usr/bin/env python3
import json,sys,os
with open(os.environ['WATCHDOG_ROOT']+'/calls','a') as f:f.write(json.dumps([os.path.basename(sys.argv[0]),*sys.argv[1:]])+'\\n')
`,0o755);
  const run=(args:string[])=>spawnSync('bash',['scripts/watchdogctl.sh',...args],{env:{...process.env,WATCHDOG_ROOT:root,PATH:path.join(root,'test-bin')+':'+process.env.PATH},encoding:'utf8',timeout:15000});
  const calls=()=>existsSync(path.join(root,'calls'))?readFileSync(path.join(root,'calls'),'utf8').trim().split('\n').map(x=>JSON.parse(x) as string[]):[];
  try {
    const refused=run(['enable-public','test.example']);assert.notEqual(refused.status,0);assert.match(refused.stderr,/enable accounts first/);
    assert.deepEqual(calls(),[]);assert.equal(existsSync(path.join(root,'etc/watchdog/Caddyfile')),false);
    const enabled=run(['enable-accounts','new@lab.example','--no-link']);assert.equal(enabled.status,0,enabled.stderr);
    const env=readFileSync(path.join(root,'etc/watchdog/app.env'),'utf8');assert.match(env,/WATCHDOG_AUTH=accounts/);assert.doesNotMatch(env,/ALLOW_OPEN_INSTANCE/);
    const grants=JSON.parse(env.split('\n').find(l=>l.startsWith('WATCHDOG_GRANTS='))!.split('=').slice(1).join('='));
    assert.deepEqual(grants,{'previous@lab.example':'researcher','new@lab.example':'developer'});
    const published=run(['enable-public','test.example']);assert.equal(published.status,0,published.stderr);
    assert.match(readFileSync(path.join(root,'etc/watchdog/Caddyfile'),'utf8'),/reverse_proxy 127\.0\.0\.1:8080/);
    assert.ok(calls().some(c=>c.join(' ')==='systemctl restart watchdog-proxy.service'));
    const disabled=run(['disable-public']);assert.equal(disabled.status,0,disabled.stderr);
    assert.doesNotMatch(readFileSync(path.join(root,'etc/watchdog/app.env'),'utf8'),/WATCHDOG_PUBLIC_URL=/);
    assert.equal(existsSync(path.join(root,'etc/watchdog/public-host')),false);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('E3.17 recovery marker blocks every database-backed access command before Docker',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'watchdog-access-recovery-'));
  const write=(name:string,text:string,mode=0o600)=>{mkdirSync(path.dirname(path.join(root,name)),{recursive:true});writeFileSync(path.join(root,name),text,{mode});};
  const marker='Failed migration; preserve pre-update backup.\n';
  const config='WATCHDOG_AUTH=accounts\n';
  write('etc/watchdog/recovery-required',marker);
  write('etc/watchdog/app.env',config);
  write('usr/local/lib/watchdog/watchdog_access.sh',readFileSync('scripts/watchdog_access.sh','utf8'),0o755);
  write('test-bin/docker',`#!/usr/bin/env python3
import os
with open(os.environ['WATCHDOG_ROOT']+'/docker-reached','w') as f:f.write('database process started')
`,0o755);
  const run=(args:string[])=>spawnSync('bash',['scripts/watchdogctl.sh',...args],{env:{...process.env,WATCHDOG_ROOT:root,PATH:path.join(root,'test-bin')+':'+process.env.PATH},encoding:'utf8',timeout:15000});
  try {
    for(const args of [['people'],['grant','fixture@example.test','viewer'],['invite','fixture@example.test','viewer'],['open-link','viewer'],['signin-link','fixture@example.test']]) {
      const result=run(args);
      assert.notEqual(result.status,0,`${args[0]} must not start the CLI while recovery is required`);
      assert.match(result.stderr,/Recover the installation/);
      assert.equal(existsSync(path.join(root,'docker-reached')),false,'even people imports the database and may run migrations');
      assert.equal(readFileSync(path.join(root,'etc/watchdog/recovery-required'),'utf8'),marker);
      assert.equal(readFileSync(path.join(root,'etc/watchdog/app.env'),'utf8'),config);
    }
    rmSync(path.join(root,'etc/watchdog/recovery-required'));
    const healthy=run(['people']);assert.equal(healthy.status,0,healthy.stderr);
    assert.equal(existsSync(path.join(root,'docker-reached')),true,'after recovery the ordinary CLI remains reachable');
  } finally {rmSync(root,{recursive:true,force:true});}
});
