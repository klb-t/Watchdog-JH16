import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runMigrations,MIGRATIONS} from '../../backend/watchdog_api/db/migrations';
import {AutomationRepository} from '../../backend/watchdog_api/db/repositories/automation';
import {PrincipalRepository} from '../../backend/watchdog_api/db/repositories/principals';
import {LocalFileSystemStore} from '../../backend/watchdog_api/storage/object_store';
import {loadSourceHistoryProfile} from '../../backend/watchdog_api/config/source_history';
import {loadSourceWatchProfile} from '../../backend/watchdog_api/config/source_watch';
import {loadAutomationProfile} from '../../backend/watchdog_api/config/automation';
import {AutomationService} from '../../backend/watchdog_api/services/automation';
import {verifySourceComparison} from '../../backend/watchdog_api/services/source_comparison';
import {buildMemoryRouter} from '../../backend/watchdog_api/api/automation_routes';
import {errorHandler} from '../../backend/watchdog_api/api/middleware';
import {withCollectionPurpose} from '../../shared/collection';
import {sourceSnapshot} from '../fixtures/source_history';

function harness(legacy=false){
  const dir=mkdtempSync(path.join(tmpdir(),'watchdog-source-watch-')),filename=path.join(dir,'db.sqlite'),db=new Database(filename);db.pragma('foreign_keys=ON');
  if(legacy){db.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
    for(const m of MIGRATIONS.filter(m=>m.id<'018')){db.exec(m.sql);db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(m.id,'2026-09-01T00:00:00.000Z');}
  }else runMigrations(db);
  const store=new LocalFileSystemStore(path.join(dir,'store')),repo=new AutomationRepository(db,store);
  const principal=new PrincipalRepository(db);principal.upsertOnSignIn({id:'another',email:null,displayName:'Fictional reader',role:'responder',identityProvenance:'fixture',at:new Date().toISOString()});
  return {dir,filename,db,store,repo,principal,close:()=>{db.close();rmSync(dir,{recursive:true,force:true});}};
}
function watch(h:ReturnType<typeof harness>,a:Awaited<ReturnType<typeof sourceSnapshot>>,owner='local-user'){
  const context=h.repo.history.contextAt(a.id,a.sequence);
  return h.repo.watches.subscribe(owner,a.id,a.sequence,context.contextHash,100);
}

test('source watches start at subscription time, remain private and idempotent, and detect changes and reversions without duplicate-content alerts',async()=>{
  const h=harness();try{
    const a=await sourceSnapshot(h.db,h.repo,{fixture:true,value:'1.00'});
    await sourceSnapshot(h.db,h.repo,{fixture:true,value:'0.00'});
    const start=await sourceSnapshot(h.db,h.repo,{fixture:true,value:'1.00'}),w=watch(h,a);
    assert.equal(w.reviewedThrough,start.sequence);assert.equal(h.repo.watches.batch('local-user',w.id,1).entries.length,0);
    const same=await sourceSnapshot(h.db,h.repo,{value:'1.00',fixture:true});
    const b=await sourceSnapshot(h.db,h.repo,{fixture:true,value:'2.00'});
    const repeated=await sourceSnapshot(h.db,h.repo,{fixture:true,value:'2.00'});
    const reverted=await sourceSnapshot(h.db,h.repo,{fixture:true,value:'1.00'});
    h.repo.record(a.id,'pubchem','properties',{fixture:true,value:'1.00'},reverted.receipt);
    await h.repo.receipt(a.jobId,'pubchem',a.receipt.url,503,Buffer.from('fictional error'),'fixture');
    const batch=h.repo.watches.batch('local-user',w.id,10);
    assert.equal(batch.checksSinceReview,4);assert.equal(batch.changesSinceReview,2);assert.equal(batch.hasMore,false);
    assert.deepEqual(batch.entries.map(e=>[e.from.sequence,e.to.sequence]),[[same.sequence,b.sequence],[repeated.sequence,reverted.sequence]]);
    assert.deepEqual(watch(h,a),w,'a repeat subscribe preserves the unread cursor');
    assert.equal(h.repo.watches.summaries('local-user')[0].changesSinceReview,2);
    assert.deepEqual(h.repo.watches.list('another'),[]);assert.throws(()=>h.repo.watches.batch('another',w.id,10),/not found/);
    assert.equal(watch(h,a,'another').reviewedThrough,reverted.sequence,'another reader starts independently');
  }finally{h.close();}
});

test('bounded read batches cannot swallow later arrivals, reject stale tabs and retain backlog through pause and resume',async()=>{
  const h=harness();try{
    const a=await sourceSnapshot(h.db,h.repo,{fixture:1}),w=watch(h,a);
    const b=await sourceSnapshot(h.db,h.repo,{fixture:2}),c=await sourceSnapshot(h.db,h.repo,{fixture:3});
    const first=h.repo.watches.batch('local-user',w.id,1);assert.equal(first.hasMore,true);assert.equal(first.through,b.sequence);assert.equal(first.changesSinceReview,2);
    const later=await sourceSnapshot(h.db,h.repo,{fixture:4});
    const read=h.repo.watches.update('local-user',w.id,{revision:w.revision,through:first.through});
    assert.equal(read.reviewedThrough,b.sequence);assert.equal(h.repo.watches.batch('local-user',w.id,10).changesSinceReview,2);
    assert.throws(()=>h.repo.watches.update('local-user',w.id,{revision:w.revision,through:c.sequence}),/reload/);
    assert.throws(()=>h.repo.watches.update('local-user',w.id,{revision:read.revision,through:a.sequence}),/backward/);
    const other=await sourceSnapshot(h.db,h.repo,{fixture:5},{url:a.receipt.url+'?different=1'});
    assert.throws(()=>h.repo.watches.update('local-user',w.id,{revision:read.revision,through:other.sequence}),/different source context/);
    const paused=h.repo.watches.update('local-user',w.id,{revision:read.revision,enabled:false});
    assert.throws(()=>h.repo.watches.update('local-user',w.id,{revision:paused.revision,through:later.sequence}),/Resume/);
    const newest=await sourceSnapshot(h.db,h.repo,{fixture:6});
    assert.equal(watch(h,a).enabled,false,'subscribe does not undo an explicit pause');
    const resumed=h.repo.watches.update('local-user',w.id,{revision:paused.revision,enabled:true});
    const final=h.repo.watches.batch('local-user',w.id,10);assert.equal(final.changesSinceReview,3);assert.equal(final.through,newest.sequence);
    h.repo.watches.update('local-user',w.id,{revision:resumed.revision,through:final.through});
    assert.equal(h.repo.watches.batch('local-user',w.id,10).checksSinceReview,0);
  }finally{h.close();}
});

test('watched context excludes other purpose and acquisition plans, and append order retains late-linked older receipts',async()=>{
  const h=harness();try{
    const request=withCollectionPurpose(loadAutomationProfile().defaults.substanceJob,'monitoring');
    const a=await sourceSnapshot(h.db,h.repo,{value:'1.00'},{request,at:'2026-09-10T00:00:00.000Z'}),w=watch(h,a);
    await sourceSnapshot(h.db,h.repo,{value:'2.00'},{request:withCollectionPurpose(request,'research')});
    await sourceSnapshot(h.db,h.repo,{value:'3.00'},{request,adapterVersion:'fictional-changed-adapter'});
    await sourceSnapshot(h.db,h.repo,{value:'4.00'});
    assert.equal(h.repo.watches.batch('local-user',w.id,10).checksSinceReview,0);
    const old=await sourceSnapshot(h.db,h.repo,{value:'0.00'},{request,at:'2026-09-01T00:00:00.000Z'});
    const batch=h.repo.watches.batch('local-user',w.id,10);assert.equal(batch.entries.length,1);
    assert.deepEqual(batch.entries.map(e=>[e.from.sequence,e.to.sequence]),[[a.sequence,old.sequence]]);
    assert.ok(batch.entries[0].from.receipt.fetchedAt>batch.entries[0].to.receipt.fetchedAt);
    const comparison=h.repo.history.compare(a.id,a.sequence,old.sequence,w.contextHash,loadSourceHistoryProfile());
    assert.ok(verifySourceComparison(comparison,comparison.contentHash));
    assert.equal(loadSourceWatchProfile().ordering,'journal_sequence');
  }finally{h.close();}
});

test('watch state survives restart and ownership transfer while source snapshots and scientific review remain unchanged',async()=>{
  const h=harness();try{
    const a=await sourceSnapshot(h.db,h.repo,{fixture:1}),w=watch(h,a),b=await sourceSnapshot(h.db,h.repo,{fixture:2});
    const original=h.repo.history.compare(a.id,a.sequence,b.sequence,w.contextHash,loadSourceHistoryProfile());
    const paused=h.repo.watches.update('local-user',w.id,{revision:1,enabled:false});
    const reopened=new Database(h.filename);try{
      assert.deepEqual(new AutomationRepository(reopened,h.store).watches.get('local-user',w.id),paused);
    }finally{reopened.close();}
    watch(h,a,'another');
    const moved=h.principal.migrateLocalUserRows('another');assert.equal(moved.source_watches,1);
    assert.equal(h.repo.watches.list('local-user').length,0);assert.equal(h.repo.watches.list('another').length,2);
    assert.deepEqual(h.repo.watches.get('another',w.id),paused);
    assert.deepEqual(h.repo.history.compare(a.id,a.sequence,b.sequence,w.contextHash,loadSourceHistoryProfile()),original);
    assert.throws(()=>h.db.prepare('UPDATE source_watches SET context_anchor=? WHERE id=?').run(b.sequence,w.id),/WORM/);
    const enabled=h.repo.watches.update('another',w.id,{revision:paused.revision,enabled:true});
    h.repo.watches.update('another',w.id,{revision:enabled.revision,through:b.sequence});
    assert.throws(()=>h.db.prepare('UPDATE source_watches SET reviewed_through=? WHERE id=?').run(a.sequence,w.id),/backward/);
    assert.ok((h.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='source_watch.read'").get() as any).n>0);
  }finally{h.close();}
});

test('migration 018 creates no subscriptions or retroactive notifications for existing public records',async()=>{
  const h=harness(true);try{
    const a=await sourceSnapshot(h.db,h.repo,{fixture:1}),b=await sourceSnapshot(h.db,h.repo,{fixture:2});
    const before=h.repo.history.page(a.id,b.sequence,10);
    assert.deepEqual(runMigrations(h.db).applied,['018_source_watches']);assert.deepEqual(runMigrations(h.db).applied,[]);
    assert.deepEqual(h.repo.watches.list('local-user'),[]);assert.deepEqual(h.repo.history.page(a.id,b.sequence,10),before);
    assert.equal(watch(h,a).reviewedThrough,b.sequence);
    assert.throws(()=>h.repo.watches.subscribe('local-user',a.id,a.sequence,'0'.repeat(64),100),/context changed/);
    const other=await sourceSnapshot(h.db,h.repo,{fixture:1},{cid:999999992});
    assert.throws(()=>h.repo.watches.subscribe('local-user',other.id,other.sequence,h.repo.history.contextAt(other.id,other.sequence).contextHash,1),/limit reached/);
  }finally{h.close();}
});

test('real acquisition feeds a watch without a second collector or model path',async()=>{
  const h=harness();try{
    const profile=loadAutomationProfile();h.repo.archiveProfile(profile);let amount='1.00';
    const worker=new AutomationService(h.repo,profile,async url=>new Response(JSON.stringify(String(url).includes('/synonyms/')
      ?{InformationList:{Information:[{CID:999999991,Synonym:['FICTIONAL WATCH COMPOUND']}]}}
      :{PropertyTable:{Properties:[{CID:999999991,InChIKey:'AAAAAAAAAAAAAA-BBBBBBBBBB-C',IUPACName:'FICTIONAL WATCH COMPOUND',MolecularWeight:amount}]}})),async()=>{});
    const run=async()=>{const j=h.repo.enqueue('local-user',{kind:'substance_refresh',names:['fictional watch compound'],providers:['pubchem'],maxRequests:2,pageLimit:1},profile.contentHash);await worker.tick();assert.equal(h.repo.job(j.id,'local-user')!.status,'SUCCEEDED');};
    await run();const group=h.repo.history.groups('pubchem:999999991',10).groups.find(g=>g.context.kind==='properties')!;
    const w=h.repo.watches.subscribe('local-user',group.context.substanceId,group.anchor,group.contextHash,100);
    await run();assert.equal(h.repo.watches.batch('local-user',w.id,10).changesSinceReview,0);
    amount='2.00';await run();const batch=h.repo.watches.batch('local-user',w.id,10);assert.equal(batch.changesSinceReview,1);assert.equal(batch.checksSinceReview,2);
    const pair=batch.entries[0],comparison=h.repo.history.compare(group.context.substanceId,pair.from.sequence,pair.to.sequence,w.contextHash,loadSourceHistoryProfile());
    assert.ok(verifySourceComparison(comparison,comparison.contentHash));
  }finally{h.close();}
});

test('watch HTTP routes preserve memory access gates, private ownership, mutation origin checks and read-only GET behavior',async()=>{
  const h=harness();let server:ReturnType<express.Express['listen']>|undefined;
  try{
    const a=await sourceSnapshot(h.db,h.repo,{fixture:1});const ctx=h.repo.history.contextAt(a.id,a.sequence);
    let owner='local-user',roles=['responder'],signedIn=true;
    const app=express();app.use(express.json());app.use((req,_res,next)=>{if(signedIn)req.principal={id:owner,roles,email:null,identityProvenance:'fixture'};next();});
    app.use('/api/memory',buildMemoryRouter(h.repo));app.use(errorHandler);
    server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server!.once('listening',r));
    const base=`http://127.0.0.1:${(server.address() as any).port}/api/memory`;
    const call=(p:string,b?:unknown,headers:Record<string,string>={})=>fetch(base+p,{...(b===undefined?{}:{method:'POST',body:JSON.stringify(b)}),headers:{'Content-Type':'application/json',...headers}});
    const body={substanceId:a.id,anchor:a.sequence,contextHash:ctx.contextHash};
    assert.equal((await call('/watches',body,{Origin:'https://foreign.example'})).status,403);
    assert.equal((await call('/watches',{...body,ownerId:'another'})).status,400);
    const created=await call('/watches',body);assert.equal(created.status,201);const w=(await created.json()).watch;
    const audits=()=>((h.db.prepare('SELECT COUNT(*) AS n FROM audit_events').get() as any).n);
    const before=audits(),list=await call('/watches');assert.equal(list.headers.get('cache-control'),'no-store');
    assert.equal((await list.json()).watches.length,1);await call(`/watches/${w.id}`);assert.equal(audits(),before);
    const b=await sourceSnapshot(h.db,h.repo,{fixture:2});
    assert.equal((await call(`/watches/${w.id}/read`,{revision:1,through:b.sequence})).status,200);
    assert.equal((await call(`/watches/${w.id}/read`,{revision:1,through:b.sequence})).status,409);
    owner='another';assert.equal((await call(`/watches/${w.id}`)).status,404);
    assert.equal((await call(`/watches/${w.id}/enabled`,{revision:2,enabled:false})).status,404);
    assert.equal((await (await call('/watches')).json()).watches.length,0);
    roles=['viewer'];assert.equal((await call('/watches')).status,403);assert.equal((await call('/watches',body)).status,403);
    signedIn=false;assert.equal((await call('/watches')).status,401);
  }finally{if(server)await new Promise<void>(r=>server!.close(()=>r()));h.close();}
});
