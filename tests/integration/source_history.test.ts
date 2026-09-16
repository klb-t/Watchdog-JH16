import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runMigrations,MIGRATIONS } from '../../backend/watchdog_api/db/migrations';
import { AutomationRepository } from '../../backend/watchdog_api/db/repositories/automation';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { loadAutomationProfile } from '../../backend/watchdog_api/config/automation';
import { loadSourceHistoryProfile } from '../../backend/watchdog_api/config/source_history';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';
import { AutomationService } from '../../backend/watchdog_api/services/automation';
import { verifySourceComparison } from '../../backend/watchdog_api/services/source_comparison';
import { buildMemoryRouter } from '../../backend/watchdog_api/api/automation_routes';
import { errorHandler } from '../../backend/watchdog_api/api/middleware';
import { sourceSnapshot } from '../fixtures/source_history';

function harness(legacy = false) {
  const dir = mkdtempSync(path.join(tmpdir(),'watchdog-source-history-')), filename = path.join(dir,'db.sqlite');
  const db = new Database(filename); db.pragma('foreign_keys=ON');
  if (legacy) {
    db.exec('CREATE TABLE schema_migrations (id TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
    for (const m of MIGRATIONS.filter(m=>m.id<'016')) { db.exec(m.sql); db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(m.id,'2026-09-01T00:00:00.000Z'); }
  } else runMigrations(db);
  const store = new LocalFileSystemStore(path.join(dir,'store')), repo = new AutomationRepository(db,store), profile = loadSourceHistoryProfile();
  return {db,repo,dir,filename,store,profile,close:()=>{db.close();rmSync(dir,{recursive:true,force:true});}};
}
const at = (day: number) => `2026-09-${String(day).padStart(2,'0')}T12:00:00.000Z`;

test('source history retains repeated receipts, detects reversions, and paginates with whole-version ages across restart',async()=>{
  const h=harness();try{
    const a=await sourceSnapshot(h.db,h.repo,{amount:'1.00',unit:'fixture'},{at:at(1)});
    const repeated=await sourceSnapshot(h.db,h.repo,{unit:'fixture',amount:'1.00'},{at:at(2)});
    const changed=await sourceSnapshot(h.db,h.repo,{amount:'2.00',unit:'fixture'},{at:at(3)});
    const reverted=await sourceSnapshot(h.db,h.repo,{amount:'1.00',unit:'fixture'},{at:at(4)});
    h.repo.record(a.id,'pubchem','properties',{amount:'1.00',unit:'fixture'},reverted.receipt);
    const g=h.repo.history.groups(a.id,10).groups[0];
    assert.equal(g.observations,4);assert.equal(g.versions,2);assert.equal(g.firstObservedAt,at(1));assert.equal(g.lastObservedAt,at(4));
    assert.equal(h.repo.substance(a.id)!.records.length,2);assert.equal(a.recordId,repeated.recordId);assert.equal(a.recordId,reverted.recordId);
    const first=h.repo.history.page(a.id,g.anchor,2),second=h.repo.history.page(a.id,g.anchor,2,first.nextBefore!);
    assert.deepEqual([...first.entries,...second.entries].map(e=>e.transition),['CHANGED','CHANGED','UNCHANGED','FIRST_LINKED']);
    assert.equal(first.entries[0].versionObservations,3);assert.equal(first.entries[0].versionFirstObservedAt,at(1));assert.equal(first.entries[0].versionLastObservedAt,at(4));
    assert.equal(second.nextBefore,null);
    const equal=h.repo.history.compare(a.id,a.sequence,repeated.sequence,g.contextHash,h.profile);assert.equal(equal.body.equal,true);assert.deepEqual(equal.body.difference.changes,[]);
    const diff=h.repo.history.compare(a.id,changed.sequence,reverted.sequence,g.contextHash,h.profile);
    assert.equal(diff.body.difference.changes[0].before.present && diff.body.difference.changes[0].before.value,'2.00');
    assert.equal(diff.body.difference.changes[0].after.present && diff.body.difference.changes[0].after.value,'1.00');
    const reopened=new Database(h.filename);try{
      assert.deepEqual(new AutomationRepository(reopened,h.store).history.compare(a.id,changed.sequence,reverted.sequence,g.contextHash,h.profile),diff);
    }finally{reopened.close();}
    assert.equal((await h.repo.raw(repeated.receipt.id)).toString(),JSON.stringify({fixture:'FICTIONAL TEST DATA',value:{unit:'fixture',amount:'1.00'}}));
  }finally{h.close();}
});

test('source history separates changed URL, adapter, source profile, kind, provider and substance even when content deduplicates',async()=>{
  const h=harness();try{
    const a=await sourceSnapshot(h.db,h.repo,{amount:'1.00'});
    const {contentHash,...body}=loadAutomationProfile();const changed={...body,label:body.label+' fixture revision'};
    const otherProfile={...changed,contentHash:canonicalHash(changed)};h.repo.archiveProfile(otherProfile);
    const variants=[
      await sourceSnapshot(h.db,h.repo,{amount:'1.00'},{url:a.receipt.url+'?language=pl'}),
      await sourceSnapshot(h.db,h.repo,{amount:'1.00'},{adapterVersion:'fixture-parser-2'}),
      await sourceSnapshot(h.db,h.repo,{amount:'1.00'},{profileHash:otherProfile.contentHash}),
      await sourceSnapshot(h.db,h.repo,{amount:'1.00'},{kind:'another_kind'}),
      await sourceSnapshot(h.db,h.repo,{amount:'1.00'},{provider:'fixture-provider'}),
      await sourceSnapshot(h.db,h.repo,{amount:'1.00'},{cid:999999992}),
    ];
    const g=h.repo.history.groups(a.id,20).groups.find(g=>g.anchor===a.sequence)!;
    for(const other of variants) assert.throws(()=>h.repo.history.compare(a.id,a.sequence,other.sequence,g.contextHash,h.profile),/same substance|not found/);
    assert.throws(()=>h.repo.history.page(a.id,a.sequence,10,variants[0].sequence),/different source context/);
    assert.equal(h.repo.history.groups(a.id,2).nextOffset,2);assert.equal(h.repo.history.groups(a.id,20).groups.length,6);
    assert.equal(h.repo.substance(a.id)!.records.filter(r=>r.kind==='properties' && r.provider==='pubchem').length,1);
    // Changing mutable job state cannot rewrite the captured source-profile identity.
    h.db.prepare('UPDATE automation_jobs SET profile_hash=? WHERE id=?').run(otherProfile.contentHash,a.jobId);
    assert.equal(h.repo.history.page(a.id,a.sequence,10).contextHash,g.contextHash);
  }finally{h.close();}
});

test('source-history migration backfills only proven first receipts and never guesses earlier unchanged checks',async()=>{
  const h=harness(true);try{
    const profile=loadAutomationProfile();h.repo.archiveProfile(profile);
    const j=h.repo.enqueue('local-user',profile.defaults.substanceJob,profile.contentHash);
    const first=await h.repo.receipt(j.id,'pubchem','https://example.org/legacy-fixture',200,Buffer.from('fixture'),'test');
    await h.repo.receipt(j.id,'pubchem',first.url,200,Buffer.from('fixture'),'test');
    const id='pubchem:999999991',value={fixture:true,amount:'1.00'},hash=canonicalHash({id,provider:'pubchem',kind:'properties',value});
    h.db.prepare('INSERT INTO substances(id,canonical_name,normalized_name,created_at) VALUES (?,?,?,?)').run(id,'Legacy fictional fixture',id,first.fetchedAt);
    h.db.prepare('INSERT INTO substance_reference_records VALUES (?,?,?,?,?,?,?,?)').run(`reference-${hash}`,id,'pubchem','properties',JSON.stringify(value),hash,first.id,first.fetchedAt);
    assert.deepEqual(runMigrations(h.db).applied,MIGRATIONS.filter(m=>m.id>='016').map(m=>m.id));assert.deepEqual(runMigrations(h.db).applied,[]);
    const group=h.repo.history.groups(id,10).groups[0];assert.equal(group.observations,1);assert.equal(group.legacyObservations,1);
    assert.equal(h.repo.history.page(id,group.anchor,10).entries[0].origin,'legacy_first_receipt');
    const next=await h.repo.receipt(j.id,'pubchem',first.url,200,Buffer.from('fixture'),'test');h.repo.record(id,'pubchem','properties',value,next);
    const updated=h.repo.history.groups(id,10).groups[0];assert.equal(updated.observations,2);assert.equal(updated.versions,1);assert.equal(updated.legacyObservations,1);
  }finally{h.close();}
});

test('reference association is atomic, immutable and rejects forged, failed or conflicting receipts',async()=>{
  const h=harness();try{
    const a=await sourceSnapshot(h.db,h.repo,{amount:'1.00'});
    assert.throws(()=>h.repo.record(a.id,'pubchem','properties',{amount:'2.00'},{...a.receipt,fetchedAt:at(8)}),/stored acquisition/);
    assert.throws(()=>h.repo.record(a.id,'pubchem','properties',{amount:'2.00'},a.receipt),/conflicting/);
    assert.throws(()=>h.repo.record(a.id,'other-provider','properties',{amount:'2.00'},a.receipt),/matching source/);
    const failed=await h.repo.receipt(a.jobId,'pubchem',a.receipt.url,503,Buffer.from('unavailable fixture'),'test');
    assert.throws(()=>h.repo.record(a.id,'pubchem','properties',{amount:'2.00'},failed),/successful/);
    assert.equal(h.repo.substance(a.id)!.records.length,1);assert.equal(h.repo.history.groups(a.id,10).groups[0].observations,1);
    for(const sql of ["UPDATE substance_reference_observations SET origin='legacy_first_receipt'",'DELETE FROM substance_reference_observations',
      'DELETE FROM substance_reference_records',"UPDATE public_fetch_receipts SET url='https://example.org/changed' WHERE id=?",'DELETE FROM public_fetch_receipts WHERE id=?']){
      assert.throws(()=>h.db.prepare(sql).run(...(sql.includes('?')?[a.receipt.id]:[])),/WORM/);
    }
  }finally{h.close();}
});

test('comparison export preserves exact values, replays offline and rejects rehashed edits or source-context substitution',async()=>{
  const h=harness();try{
    const a=await sourceSnapshot(h.db,h.repo,{amount:'9007199254740993.00',missing:null,zero:0},{at:at(1)});
    const b=await sourceSnapshot(h.db,h.repo,{amount:'9007199254740993.01',added:null,zero:0},{at:at(2)});
    const g=h.repo.history.groups(a.id,10).groups[0],comparison=h.repo.history.compare(a.id,a.sequence,b.sequence,g.contextHash,h.profile);
    assert.deepEqual(verifySourceComparison(comparison,comparison.contentHash),comparison);
    const file=path.join(h.dir,'comparison.json');writeFileSync(file,JSON.stringify(comparison));
    const cli=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/verify_source_comparison.ts',file,comparison.contentHash],{encoding:'utf8'}));
    assert.equal(cli.verified,true);assert.equal(cli.rawResponsesIncluded,false);
    const tampered=structuredClone(comparison);tampered.body.difference.changes=[];tampered.contentHash=canonicalHash(tampered.body);
    assert.throws(()=>verifySourceComparison(tampered,comparison.contentHash),/expected export/);
    assert.throws(()=>verifySourceComparison(tampered,tampered.contentHash),/reproduce/);
    const altered=structuredClone(comparison);altered.body.to.receipt.url='https://example.org/other';altered.contentHash=canonicalHash(altered.body);
    assert.throws(()=>verifySourceComparison(altered,altered.contentHash),/source context/);
    const {contentHash,...p}=h.profile,small={...p,limits:{...p.limits,changes:1}};
    const partial=h.repo.history.compare(a.id,a.sequence,b.sequence,g.contextHash,{...small,contentHash:canonicalHash(small)});
    assert.equal(partial.body.equal,false);assert.equal(partial.body.difference.truncated,true);
    assert.equal((partial.body.to.value as any).added,null);assert.ok(verifySourceComparison(partial,partial.contentHash));
  }finally{h.close();}
});

test('public PubChem adapter records repeat checks and changed source properties through the real acquisition worker',async()=>{
  const h=harness();try{
    const profile=loadAutomationProfile();h.repo.archiveProfile(profile);let amount='1.00';
    const worker=new AutomationService(h.repo,profile,async url=>new Response(JSON.stringify(String(url).includes('/synonyms/')
      ? {InformationList:{Information:[{CID:999999991,Synonym:['FICTIONAL TEST COMPOUND']}]}}
      : {PropertyTable:{Properties:[{CID:999999991,InChIKey:'AAAAAAAAAAAAAA-BBBBBBBBBB-C',IUPACName:'FICTIONAL TEST COMPOUND',MolecularWeight:amount}]}})),async()=>{});
    for(const value of ['1.00','1.00','2.00']){amount=value;const job=h.repo.enqueue('local-user',{kind:'substance_refresh',names:['fictional compound'],providers:['pubchem'],maxRequests:2,pageLimit:1},profile.contentHash);
      await worker.tick();assert.equal(h.repo.job(job.id,'local-user')!.status,'SUCCEEDED');}
    const groups=h.repo.history.groups('pubchem:999999991',10).groups;
    assert.equal(groups.find(g=>g.context.kind==='properties')!.versions,2);
    assert.equal(groups.find(g=>g.context.kind==='properties')!.observations,3);
    assert.equal(groups.find(g=>g.context.kind==='synonyms')!.versions,1);
    assert.equal(groups.find(g=>g.context.kind==='synonyms')!.observations,3);
  }finally{h.close();}
});

test('memory history API keeps existing capability gates, bounded parameters, public-source scope and no-store responses',async()=>{
  const h=harness();let server:ReturnType<express.Express['listen']>|undefined;
  try{
    const a=await sourceSnapshot(h.db,h.repo,{fixture:1}),b=await sourceSnapshot(h.db,h.repo,{fixture:2});
    const group=h.repo.history.groups(a.id,10).groups[0];let roles=['responder'],signedIn=true;
    const app=express();app.use((req,_res,next)=>{if(signedIn)req.principal={id:'another-user',roles,email:null,identityProvenance:'test'};next();});
    app.use('/api/memory',buildMemoryRouter(h.repo));app.use(errorHandler);
    server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server!.once('listening',r));
    const base=`http://127.0.0.1:${(server.address() as any).port}/api/memory`;
    const query=`/substances/${a.id}/compare?from=${a.sequence}&to=${b.sequence}&context=${group.contextHash}`;
    const response=await fetch(base+query);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    const data=await response.json();assert.equal(response.headers.get('x-content-sha256'),data.contentHash);assert.ok(verifySourceComparison(data,data.contentHash));
    assert.equal((await fetch(base+`/substances/${a.id}/history?offset=-1`)).status,400);
    assert.equal((await fetch(base+`/substances/${a.id}/history/${a.sequence}?before=NaN`)).status,400);
    assert.equal((await fetch(base+query.replace(String(b.sequence)+'&context','9007199254740992&context'))).status,400);
    assert.equal((await fetch(base+query.replace(group.contextHash,'0'.repeat(64)))).status,409);
    assert.equal((await fetch(base+query.replace(a.id,'pubchem:999999990'))).status,404);
    roles=['viewer'];assert.equal((await fetch(base+query)).status,403);assert.equal((await fetch(base+'/history/profile')).status,403);
    signedIn=false;assert.equal((await fetch(base+query)).status,401);
  }finally{if(server)await new Promise<void>(r=>server!.close(()=>r()));h.close();}
});
