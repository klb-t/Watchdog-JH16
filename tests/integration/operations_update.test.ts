import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import Database from 'better-sqlite3';

const repo=process.cwd(), oldId='sha256:'+'1'.repeat(64), newId='sha256:'+'2'.repeat(64);
function fixture(failure='') {
  const root=mkdtempSync(path.join(tmpdir(),'watchdog-update-'));
  function file(name:string, value:string|Buffer, mode=0o600) {
    const dest=path.join(root,name);mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});writeFileSync(dest,value,{mode});
  }
  file('etc/os-release','ID=debian\nVERSION_ID=12\nVERSION_CODENAME=bookworm\n');
  file('proc/meminfo','MemTotal: 8000000 kB\n');
  file('etc/watchdog/installer-v1','');
  file('etc/watchdog/app.env','NODE_ENV=production\nPORT=8080\nDB_PATH=/mnt/watchdog/watchdog.sqlite\nSTORE_BACKEND=local\nSTORE_PATH=/mnt/watchdog/object_store\nWATCHDOG_VAULT_KEY_FILE=/mnt/watchdog/secrets/master.key\nSESSION_SIGNING_KEY=fictional-session-only\n');
  file('etc/watchdog/release.env',`WATCHDOG_IMAGE=${oldId}\nWATCHDOG_COMMIT=${'a'.repeat(40)}\n`);
  file('etc/systemd/system/watchdog.service',readFileSync(path.join(repo,'deploy/watchdog.service')));
  file('var/lib/watchdog/secrets/master.key',Buffer.alloc(32,7));
  file('var/lib/watchdog/object_store/example','fictional blob');
  const db=new Database(path.join(root,'var/lib/watchdog/watchdog.sqlite'));
  db.exec("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT); INSERT INTO schema_migrations VALUES ('001_fixture','fixture'); CREATE TABLE fictional (value TEXT); INSERT INTO fictional VALUES ('old-data');");db.close();
  file('usr/local/sbin/watchdogctl',readFileSync(path.join(repo,'scripts/watchdogctl.sh')),0o700);
  file('usr/local/lib/watchdog/watchdog_backup.py',readFileSync(path.join(repo,'scripts/watchdog_backup.py')));
  file('service-active','yes');file('image-current',oldId);
  const cli=`#!/usr/bin/env python3
import os,sys,json,pathlib
r=pathlib.Path(os.environ['WATCHDOG_ROOT']); args=sys.argv[1:]; tool=pathlib.Path(sys.argv[0]).name; fail=os.environ.get('FAILURE','')
with (r/'calls').open('a') as f: f.write(json.dumps([tool,*args])+'\\n')
if tool=='df': print('Avail\\n99999999')
elif tool=='docker':
    if args[0]=='ps':
        if (r/'service-active').exists(): print('watchdog')
        if (r/'other-container').exists(): print('other-app')
    elif args[0]=='version': print('28.0.0')
    elif args[0]=='inspect':
        if not (r/'service-active').exists(): sys.exit(1)
        if 'State.Running' in ' '.join(args): print('true')
        else: print((r/'image-current').read_text())
    elif args[:2]==['image','inspect']: print((r/'image-current').read_text())
    elif args[0]=='build':
        if fail=='build': sys.exit(17)
        (r/'image-current').write_text('${newId}')
elif tool=='systemctl':
    if 'is-active' in args: sys.exit(0 if (r/'service-active').exists() else 3)
    elif args[0]=='stop':
        (r/'service-active').unlink(missing_ok=True)
        if fail=='stop': sys.exit(19)
    elif args[0]=='start' or (args[0]=='enable' and '--now' in args and 'watchdog.service' in args):
        if fail in ('start','health') and (r/'etc/watchdog/release.env').read_text().find('${newId}')>=0:
            import sqlite3
            db=sqlite3.connect(r/'var/lib/watchdog/watchdog.sqlite');db.execute("UPDATE fictional SET value='migrated'");db.commit();db.close()
            if fail=='start': sys.exit(23)
        (r/'service-active').write_text('yes')
elif tool=='curl':
    if fail=='health': sys.exit(22)
elif tool=='sleep': pass
`;
  for(const tool of ['systemctl','docker','apt-get','ufw','curl','sleep','df']) file('test-bin/'+tool,cli,0o700);
  const source=path.join(root,'source');mkdirSync(path.join(source,'deploy'),{recursive:true});mkdirSync(path.join(source,'scripts'));
  for(const name of ['watchdogctl.sh','watchdog_backup.py']) copyFileSync(path.join(repo,'scripts',name),path.join(source,'scripts',name));
  copyFileSync(path.join(repo,'deploy/watchdog.service'),path.join(source,'deploy/watchdog.service'));
  const archive=path.join(root,'source.tar.gz');const tar=spawnSync('tar',['-czf',archive,'-C',source,'.']);assert.equal(tar.status,0,tar.stderr?.toString());
  if(failure==='backup') file('var/lib/watchdog/secrets/master.key','broken');
  const env={...process.env,WATCHDOG_ROOT:root,PATH:path.join(root,'test-bin')+':'+process.env.PATH,FAILURE:failure};
  const run=(script='gcp_vm_bootstrap.sh',args=['--archive',archive,'--commit','b'.repeat(40)])=>spawnSync('bash',[path.join(repo,'scripts',script),...args],{env,encoding:'utf8',timeout:30_000});
  const calls=():string[][]=>existsSync(path.join(root,'calls'))?readFileSync(path.join(root,'calls'),'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
  return {root,run,calls,read:(f:string)=>readFileSync(path.join(root,f),'utf8'),has:(f:string)=>existsSync(path.join(root,f)),clean:()=>rmSync(root,{recursive:true,force:true})};
}

test('OPERATIONS update: failed build leaves previous service and release unchanged',()=>{
 const h=fixture('build');try{const before=h.read('etc/watchdog/release.env'),r=h.run();assert.notEqual(r.status,0,r.stdout);assert.ok(h.has('service-active'));assert.equal(h.read('etc/watchdog/release.env'),before);assert.ok(!h.calls().some(c=>c[0]==='systemctl'&&c[1]==='stop'));}finally{h.clean();}
});
test('OPERATIONS update: failed backup restarts previous service without changing release',()=>{
 const h=fixture('backup');try{const before=h.read('etc/watchdog/release.env'),r=h.run();assert.notEqual(r.status,0,r.stdout);assert.ok(h.has('service-active'),r.stderr);assert.equal(h.read('etc/watchdog/release.env'),before);const c=h.calls();assert.ok(c.some(a=>a[0]==='systemctl'&&a[1]==='stop'));assert.ok(c.some(a=>a[0]==='systemctl'&&a[1]==='start'));}finally{h.clean();}
});
for(const failure of ['start','health']) test(`OPERATIONS update: ${failure} failure stops new runtime and records recovery without downgrade`,()=>{
 const h=fixture(failure);try{const r=h.run();assert.notEqual(r.status,0,r.stdout);assert.ok(!h.has('service-active'),r.stderr);assert.ok(h.has('etc/watchdog/recovery-required'),r.stderr);assert.match(h.read('etc/watchdog/release.env'),new RegExp(newId));assert.ok(!h.calls().some(c=>c[0]==='systemctl'&&c[1]==='start'),'must not restart old image after mutation');assert.match(r.stderr,/recover|backup|failed/i);const db=new Database(path.join(h.root,'var/lib/watchdog/watchdog.sqlite'));assert.deepEqual(db.prepare('SELECT value FROM fictional').get(),{value:'migrated'});db.close();}finally{h.clean();}
});
test('OPERATIONS update: successful update uses immutable image and verified old-image backup',()=>{
 const h=fixture();try{const r=h.run();assert.equal(r.status,0,r.stderr);assert.ok(h.has('service-active'));assert.match(h.read('etc/watchdog/release.env'),new RegExp(newId));assert.ok(!h.has('etc/watchdog/recovery-required'));assert.match(r.stdout,/Pre-update backup:/);const backups=readdirSync(path.join(h.root,'var/backups/watchdog')).filter(x=>x.endsWith('.tar.gz'));assert.equal(backups.length,1);const check=spawnSync('python3',[path.join(repo,'scripts/watchdog_backup.py'),'verify','--archive',path.join(h.root,'var/backups/watchdog',backups[0])],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);assert.match(check.stdout,new RegExp(oldId));const c=h.calls();assert.ok(c.findIndex(a=>a[0]==='docker'&&a[1]==='build')<c.findIndex(a=>a[0]==='systemctl'&&a[1]==='stop'));}finally{h.clean();}
});
test('OPERATIONS backup: failure restores activity and preserves existing release',()=>{
 const h=fixture('backup');try{const before=h.read('etc/watchdog/release.env'),r=h.run('watchdogctl.sh',['backup']);assert.notEqual(r.status,0);assert.ok(h.has('service-active'),r.stderr);assert.equal(h.read('etc/watchdog/release.env'),before);}finally{h.clean();}
});

test('OPERATIONS update: partial stop failure is covered by restart trap',()=>{
 const h=fixture('stop');try{const before=h.read('etc/watchdog/release.env'),r=h.run();assert.notEqual(r.status,0);assert.ok(h.has('service-active'),r.stderr);assert.equal(h.read('etc/watchdog/release.env'),before);assert.ok(h.calls().some(c=>c[0]==='systemctl'&&c[1]==='start'));}finally{h.clean();}
});
test('OPERATIONS update: legacy installation without helper can create pre-update backup',()=>{
 const h=fixture();try{rmSync(path.join(h.root,'usr/local/lib/watchdog/watchdog_backup.py'));const r=h.run();assert.equal(r.status,0,r.stderr);assert.ok(h.has('usr/local/lib/watchdog/watchdog_backup.py'));assert.match(r.stdout,/Pre-update backup:/);}finally{h.clean();}
});
test('OPERATIONS recovery marker blocks retry, backup and restart before host mutation',()=>{
 const h=fixture();try{writeFileSync(path.join(h.root,'etc/watchdog/recovery-required'),'fictional recovery evidence');const before=h.read('etc/watchdog/release.env');for(const [script,args] of [['gcp_vm_bootstrap.sh',undefined],['watchdogctl.sh',['backup']],['watchdogctl.sh',['restart']]] as const){const r=h.run(script,args ? [...args] : undefined);assert.notEqual(r.status,0);assert.match(r.stderr,/Recovery required/);}assert.equal(h.read('etc/watchdog/release.env'),before);assert.ok(!h.calls().some(c=>['apt-get','ufw'].includes(c[0])||(c[0]==='systemctl'&&['start','restart','stop','enable'].includes(c[1]))));}finally{h.clean();}
});

test('E3.20 shared host: other containers block a dedicated install, but not --shared-host, which leaves the firewall alone',()=>{
 const h=fixture();try{
  writeFileSync(path.join(h.root,'other-container'),'x');
  const refused=h.run();assert.notEqual(refused.status,0);assert.match(refused.stderr,/--shared-host/);
  assert.ok(!h.calls().some(c=>c[0]==='systemctl'&&c[1]==='stop'),'nothing was stopped before the refusal');
  const archive=path.join(h.root,'source.tar.gz');
  const shared=h.run('gcp_vm_bootstrap.sh',['--archive',archive,'--commit','b'.repeat(40),'--shared-host']);assert.equal(shared.status,0,shared.stderr);
  const calls=h.calls();
  assert.ok(!calls.some(c=>c[0]==='ufw'&&(c.includes('deny')||c.includes('default')||c.includes('enable')||c.includes('--force'))),'no firewall policy is changed');
  assert.ok(!calls.some(c=>c[0]==='apt-get'&&c.includes('ufw')),'ufw is not installed for a machine that has its own arrangements');
  assert.ok(h.has('service-active'));
 }finally{h.clean();}
});
test('E3.20 port 8080 held by another service stops the install before anything is stopped; our own service does not',()=>{
 const h=fixture();try{
  mkdirSync(path.join(h.root,'proc/net'),{recursive:true});
  writeFileSync(path.join(h.root,'proc/net/tcp'),'  sl  local_address rem_address   st\n   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1\n');
  const ours=h.run();assert.equal(ours.status,0,'its own running service holds 8080: '+ours.stderr);
  rmSync(path.join(h.root,'service-active'));
  const taken=h.run();assert.notEqual(taken.status,0);assert.match(taken.stderr,/port 8080 is already in use/i);
  writeFileSync(path.join(h.root,'proc/net/tcp'),'  sl  local_address rem_address   st\n   0: 0100007F:1F91 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1\n');
  assert.equal(h.run().status,0,'another port is no obstacle');
 }finally{h.clean();}
});
test('E3.20 an unmanaged container called watchdog is never removed',()=>{
 const h=fixture();try{
  rmSync(path.join(h.root,'etc/watchdog/installer-v1'));rmSync(path.join(h.root,'etc/watchdog'),{recursive:true});rmSync(path.join(h.root,'etc/systemd/system/watchdog.service'));rmSync(path.join(h.root,'var/lib/watchdog'),{recursive:true});
  const r=h.run();assert.notEqual(r.status,0);assert.match(r.stderr,/not managed by this installer/);
 }finally{h.clean();}
});
