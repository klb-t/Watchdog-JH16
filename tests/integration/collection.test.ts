import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runMigrations,MIGRATIONS} from '../../backend/watchdog_api/db/migrations';
import {AutomationRepository} from '../../backend/watchdog_api/db/repositories/automation';
import {LocalFileSystemStore} from '../../backend/watchdog_api/storage/object_store';
import {loadAutomationProfile} from '../../backend/watchdog_api/config/automation';
import {loadSourceHistoryProfile} from '../../backend/watchdog_api/config/source_history';
import {loadCollectionProfile} from '../../backend/watchdog_api/config/collection';
import {canonicalHash} from '../../backend/watchdog_api/domain/canonical';
import {collectionContext} from '../../backend/watchdog_api/utils/collection_context';
import {withCollectionPurpose,CollectionIntentSchema} from '../../shared/collection';
import {JobRequestSchema} from '../../shared/automation';
import {sourceSnapshot} from '../fixtures/source_history';
import {verifySourceComparison} from '../../backend/watchdog_api/services/source_comparison';

function harness(legacy=false){
  const dir=mkdtempSync(path.join(tmpdir(),'watchdog-collection-')),db=new Database(path.join(dir,'db.sqlite'));db.pragma('foreign_keys=ON');
  if(legacy){db.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
    for(const m of MIGRATIONS.filter(m=>m.id<'017')){db.exec(m.sql);db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(m.id,'2026-09-01T00:00:00.000Z');}
  }else runMigrations(db);
  const repo=new AutomationRepository(db,new LocalFileSystemStore(path.join(dir,'store'))),profile=loadAutomationProfile();repo.archiveProfile(profile);
  return {db,dir,repo,profile,close:()=>{db.close();rmSync(dir,{recursive:true,force:true});}};
}

test('collection purposes stay optional and request signatures distinguish actual acquisition changes from intent',()=>{
  const p=loadAutomationProfile(),old=p.defaults.substanceJob;
  assert.ok(old.kind==='substance_refresh');
  const baseline=withCollectionPurpose(old,'baseline'),research=withCollectionPurpose(old,'research');
  assert.equal(collectionContext(old),undefined);assert.deepEqual(withCollectionPurpose(baseline,'unspecified'),old);
  assert.equal(canonicalHash(JobRequestSchema.parse(old)),canonicalHash(old));
  assert.equal(collectionContext(baseline)!.acquisitionHash,collectionContext(research)!.acquisitionHash);
  for(const changes of [{maxRequests:old.maxRequests+1},{pageLimit:1},{names:['another fictional query']},{providers:['pubchem']}]){
    assert.notEqual(collectionContext({...baseline,...changes})!.acquisitionHash,collectionContext(baseline)!.acquisitionHash);
  }
  const paper=withCollectionPurpose(p.defaults.paperJob,'monitoring');
  assert.notEqual(collectionContext({...paper,lookbackDays:1})!.acquisitionHash,collectionContext(paper)!.acquisitionHash);
  assert.equal(JobRequestSchema.safeParse({...p.defaults.paperJob,collection:{purpose:'monitoring'}}).success,false);
  assert.equal(JobRequestSchema.safeParse({kind:'catalog_refresh',provider:'openrouter',maxRequests:1,collection:baseline.collection}).success,false);
  assert.equal(CollectionIntentSchema.safeParse({version:'collection-purpose-1',purpose:'baseline',geography:'all'}).success,false);
  assert.equal(Object.keys(loadCollectionProfile().purposes).length,4);
});

test('a scheduled collection retains intent and frozen request context through dispatch, pause and success/error receipts',async()=>{
  const h=harness();try{
    const request=withCollectionPurpose(h.profile.defaults.paperJob,'monitoring'),start=new Date('2026-01-01T00:00:00Z');
    const schedule=h.repo.saveSchedule('local-user',{name:'Fictional monitoring plan',enabled:true,request,recurrence:{kind:'daily_utc',hour:6,minute:0}},h.profile.contentHash,start);
    assert.equal(h.repo.dispatchDue(new Date('2026-01-02T08:00:00Z')),1);
    const job=h.repo.jobs('local-user')[0];assert.deepEqual(job.request,request);assert.deepEqual(job.collection,collectionContext(request));
    for(const status of [200,429,0]){
      const receipt=await h.repo.receipt(job.id,'arxiv','https://example.org/fictional-collection',status,status?Buffer.from('fixture'):null,'fixture');
      assert.deepEqual(receipt.collection,job.collection);assert.deepEqual(h.repo.getReceipt(receipt.id),receipt);
      assert.throws(()=>h.db.prepare('UPDATE public_fetch_receipts SET collection_context_json=NULL WHERE id=?').run(receipt.id),/WORM/);
    }
    assert.throws(()=>h.db.prepare('UPDATE automation_jobs SET collection_context_json=NULL WHERE id=?').run(job.id),/WORM/);
    const paused=h.repo.saveSchedule('local-user',{name:schedule.name,enabled:false,request:schedule.request,recurrence:schedule.recurrence},h.profile.contentHash,new Date(),schedule.id,schedule.contentHash);
    assert.deepEqual(paused.request,request);assert.equal(h.repo.job(job.id,'local-user')!.status,'CANCELED');
  }finally{h.close();}
});

test('baseline, research and changed acquisition plans cannot silently merge histories while identical plans share exact content',async()=>{
  const h=harness();try{
    const job=h.profile.defaults.substanceJob;assert.ok(job.kind==='substance_refresh');
    const request=withCollectionPurpose(job,'baseline');
    const a=await sourceSnapshot(h.db,h.repo,{fictional:true,amount:'1.00'},{request});
    const b=await sourceSnapshot(h.db,h.repo,{fictional:true,amount:'2.00'},{request});
    const other=await sourceSnapshot(h.db,h.repo,{fictional:true,amount:'2.00'},{request:withCollectionPurpose(request,'research')});
    const changed=await sourceSnapshot(h.db,h.repo,{fictional:true,amount:'2.00'},{request:{...request,maxRequests:request.maxRequests+1}});
    const unclassified=await sourceSnapshot(h.db,h.repo,{fictional:true,amount:'2.00'});
    const groups=h.repo.history.groups(a.id,10).groups;assert.equal(groups.length,4);
    const group=groups.find(g=>g.anchor===b.sequence)!;assert.equal(group.observations,2);assert.equal(group.context.collection!.purpose,'baseline');
    const profile=loadSourceHistoryProfile(),comparison=h.repo.history.compare(a.id,a.sequence,b.sequence,group.contextHash,profile);
    assert.ok(verifySourceComparison(comparison,comparison.contentHash));
    for(const candidate of [other,changed,unclassified])assert.throws(()=>h.repo.history.compare(a.id,a.sequence,candidate.sequence,group.contextHash,profile),/collection context/);
    assert.equal(b.recordId,other.recordId);assert.equal(b.recordId,changed.recordId);assert.equal(b.recordId,unclassified.recordId);
    const tampered=structuredClone(comparison);tampered.body.to.receipt.collection!.purpose='research';tampered.contentHash=canonicalHash(tampered.body);
    assert.throws(()=>verifySourceComparison(tampered,tampered.contentHash),/context mismatch/);
    const originalContext=structuredClone(comparison.body.context);
    h.db.prepare('UPDATE automation_jobs SET request_json=? WHERE id=?').run(JSON.stringify(withCollectionPurpose(request,'research')),a.jobId);
    assert.deepEqual(h.repo.history.page(a.id,a.sequence,10).context,originalContext,'receipt retains the acquisition-time snapshot');
  }finally{h.close();}
});

test('migration 017 preserves old context hashes and leaves old jobs, receipts and comparison exports unclassified',async()=>{
  const h=harness(true);try{
    const a=await sourceSnapshot(h.db,h.repo,{fictional:true,amount:'1.00'}),b=await sourceSnapshot(h.db,h.repo,{fictional:true,amount:'2.00'});
    const expected={substanceId:a.id,provider:'pubchem',kind:'properties',url:a.receipt.url,adapterVersion:a.receipt.adapterVersion,sourceProfileHash:h.profile.contentHash};
    const oldJob=h.repo.job(a.jobId,'local-user')!;assert.equal('collection' in oldJob,false);
    assert.deepEqual(runMigrations(h.db).applied,MIGRATIONS.filter(m=>m.id>='017').map(m=>m.id));assert.deepEqual(runMigrations(h.db).applied,[]);
    assert.deepEqual(h.repo.getReceipt(a.receipt.id),a.receipt);assert.deepEqual(h.repo.job(a.jobId,'local-user'),oldJob);
    const group=h.repo.history.groups(a.id,10).groups[0];assert.deepEqual(group.context,expected);assert.equal(group.contextHash,canonicalHash(expected));
    const comparison=h.repo.history.compare(a.id,a.sequence,b.sequence,group.contextHash,loadSourceHistoryProfile());
    assert.equal('collection' in comparison.body.from.receipt,false);assert.ok(verifySourceComparison(comparison,comparison.contentHash));
  }finally{h.close();}
});

test('queued work cannot change its declared collection after snapshot creation even if the request checksum is rewritten',()=>{
  const h=harness();try{
    const request=withCollectionPurpose(h.profile.defaults.paperJob,'monitoring');
    const first=h.repo.enqueue('local-user',request,h.profile.contentHash);
    const replacement=withCollectionPurpose(request,'baseline');
    h.db.prepare('UPDATE automation_jobs SET request_json=?,request_hash=? WHERE id=?').run(JSON.stringify(replacement),canonicalHash({request:replacement,profileHash:h.profile.contentHash}),first.id);
    const next=h.repo.enqueue('local-user',request,h.profile.contentHash,new Date(Date.now()+1000));
    const claim=h.repo.claim(new Date(),60000)!;assert.equal(claim.job.id,next.id);
    assert.equal(h.repo.job(first.id,'local-user')!.error,'SNAPSHOT_INTEGRITY_MISMATCH');
  }finally{h.close();}
});
