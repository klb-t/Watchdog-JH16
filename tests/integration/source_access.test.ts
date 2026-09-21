import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {runMigrations,MIGRATIONS} from '../../backend/watchdog_api/db/migrations';
import {AutomationRepository} from '../../backend/watchdog_api/db/repositories/automation';
import {PrincipalRepository} from '../../backend/watchdog_api/db/repositories/principals';
import {SourceAccessRepository} from '../../backend/watchdog_api/db/repositories/source_access';
import {SourceAccessService} from '../../backend/watchdog_api/services/source_access';
import {AutomationService} from '../../backend/watchdog_api/services/automation';
import {loadAutomationProfile} from '../../backend/watchdog_api/config/automation';
import {loadSourceAccessProfile} from '../../backend/watchdog_api/config/source_access';
import {LocalFileSystemStore} from '../../backend/watchdog_api/storage/object_store';
import {PublicHttp} from '../../backend/watchdog_api/sources/public_http';
import {canonicalHash} from '../../backend/watchdog_api/domain/canonical';
import {buildSourceAccessRouter} from '../../backend/watchdog_api/api/source_access_routes';
import {errorHandler} from '../../backend/watchdog_api/api/middleware';
import {SourceCandidateSchema,type AccessDecision} from '../../shared/source_access';

function harness(legacy=false){
  const dir=mkdtempSync(path.join(tmpdir(),'watchdog-access-')),filename=path.join(dir,'db.sqlite'),db=new Database(filename);db.pragma('foreign_keys=ON');
  if(legacy){db.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');for(const m of MIGRATIONS.filter(m=>m.id<'019')){db.exec(m.sql);db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(m.id,'2026-09-01T00:00:00.000Z');}}else runMigrations(db);
  const store=new LocalFileSystemStore(path.join(dir,'store')),automation=loadAutomationProfile(),catalog=loadSourceAccessProfile(),repo=new AutomationRepository(db,store);
  repo.archiveProfile(automation);const principals=new PrincipalRepository(db);principals.upsertOnSignIn({id:'another',email:null,displayName:'Fictional investigator',role:'researcher',identityProvenance:'fixture',at:new Date().toISOString()});
  const service=new SourceAccessService(repo.access,catalog,automation);
  const job=(owner='local-user')=>repo.enqueue(owner,{kind:'paper_scan',providers:['arxiv'],scope:'substances',lookbackDays:1,maxRequests:1,pageLimit:1},automation.contentHash);
  return {dir,filename,db,store,automation,catalog,repo,principals,service,job,close:()=>{db.close();rmSync(dir,{recursive:true,force:true});}};
}
const allowed:AccessDecision={status:'permitted',scope:'public_adapter',basis:'FICTIONAL test assessment covering the complete configured adapter',reference:'fixture-only-review',validUntil:null};
const candidate={label:'FICTIONAL community',family:'community' as const,homepage:'https://fictional.example/community',channels:['manual' as const],description:'FICTIONAL candidate used only in tests'};
function decide(h:ReturnType<typeof harness>,id:string,decision:AccessDecision=allowed,now?:Date,owner='local-user'){
  const snapshot=h.service.snapshot(owner,id);return h.repo.access.decide(owner,snapshot,canonicalHash(snapshot),h.repo.access.latest(owner,id)?.id??null,decision,now);
}

test('source inventory derives implementations, keeps terms and access independent, and reports owner-scoped HTTP receipts without implied scientific data',async()=>{
  const h=harness();try{
    const before=h.service.overview('local-user');assert.equal(before.stats.total,34);assert.equal(before.stats.implemented,5);assert.equal(before.stats.access.permitted,0);
    assert.equal(before.stats.acquisition.profile_default,5);assert.equal(before.stats.withData,0);
    assert.equal(before.rows.filter(r=>r.source.entry.family==='community').length,10);
    const reddit=before.rows.find(r=>r.source.entry.id==='reddit')!;assert.equal(reddit.accessState,'unreviewed');assert.equal(reddit.acquisition,'not_implemented');
    decide(h,'reddit',{...allowed,scope:'catalog_only'});assert.equal(h.service.overview('local-user').rows.find(r=>r.source.entry.id==='reddit')!.acquisition,'not_implemented');
    assert.throws(()=>decide(h,'reddit',allowed),/no implemented/);
    const j=h.job(),other=h.job('another');await h.repo.receipt(j.id,'arxiv','https://export.arxiv.org/api/query',200,Buffer.from('FICTIONAL content'),'fixture');
    await h.repo.receipt(j.id,'arxiv','https://export.arxiv.org/api/query',403,Buffer.from('fictional failure'),'fixture','HTTP_403');
    await h.repo.receipt(other.id,'arxiv','https://export.arxiv.org/api/query',200,Buffer.from('other private request'),'fixture');
    const row=h.service.overview('local-user').rows.find(r=>r.source.entry.id==='arxiv')!;
    assert.equal(row.activity.requests,2);assert.equal(row.activity.successful,1);assert.equal(row.activity.failed,1);assert.equal(row.activity.lastError,'HTTP_403');assert.ok(row.activity.lastSuccess);
    assert.equal(h.service.overview('another').rows.find(r=>r.source.entry.id==='arxiv')!.activity.requests,1);
    assert.equal(h.service.overview('another').stats.access.permitted,0);
  }finally{h.close();}
});

test('access assessments pin exact source scope, expire, detect stale tabs and profile changes, and remain append-only through ownership transfer',()=>{
  const h=harness();try{
    const first=decide(h,'pubchem',{...allowed,validUntil:'2027-01-01T00:00:00.000Z'},new Date('2026-09-20T00:00:00.000Z'));
    assert.equal(h.service.overview('local-user',new Date('2027-01-01')).rows.find(r=>r.source.entry.id==='pubchem')!.accessState,'expired');
    assert.throws(()=>h.service.assertAcquisition('local-user','pubchem',new Date('2027-01-01')),/HELD.*expired/);
    const changed=structuredClone(h.catalog);changed.sources.find(s=>s.id==='pubchem')!.description+=' Changed scope.';
    const s=new SourceAccessService(h.repo.access,changed,h.automation);assert.throws(()=>s.assertAcquisition('local-user','pubchem',new Date('2026-09-21')),/HELD.*stale/);
    assert.throws(()=>h.repo.access.decide('local-user',h.service.snapshot('local-user','pubchem'),first.sourceHash,null,allowed),/assessment changed/);
    assert.throws(()=>h.repo.access.decide('local-user',s.snapshot('local-user','pubchem'),first.sourceHash,first.id,allowed),/profile changed/);
    assert.throws(()=>decide(h,'pubchem',{...allowed,validUntil:'2020-01-01T00:00:00.000Z'}),/future/);
    const second=decide(h,'pubchem',{...allowed,status:'denied'});assert.equal(second.previousId,first.id);
    assert.throws(()=>h.db.prepare('UPDATE source_access_revisions SET body_json=? WHERE id=?').run('{}',first.id),/WORM/);
    assert.throws(()=>h.db.prepare('DELETE FROM source_access_revisions WHERE id=?').run(first.id),/WORM/);
    const history=h.repo.access.history('local-user','pubchem',1);assert.equal(history.moreHistory,true);assert.equal(history.history[0].id,second.id);
    const reopened=new Database(h.filename);try{assert.deepEqual(new SourceAccessRepository(reopened).latest('local-user','pubchem'),second);}finally{reopened.close();}
    h.principals.migrateLocalUserRows('another');assert.equal(h.repo.access.latest('local-user','pubchem'),null);assert.deepEqual(h.repo.access.latest('another','pubchem'),second);
  }finally{h.close();}
});

test('permission request drafts copy supplied context, remain unsent and cannot mark a source permitted or requested',()=>{
  const h=harness();try{
    const source=h.service.snapshot('local-user','erowid'),hash=canonicalHash(source);
    const input={purpose:'FICTIONAL metadata study',data:'Only agreed public excerpts',operations:'No model processing requested',retention:'Thirty days, pending approval',applicant:'FICTIONAL APPLICANT',commercial:'undecided' as const};
    const draft=h.service.draft('local-user','erowid',hash,input);assert.equal(draft.sent,false);assert.ok(draft.text.includes(input.applicant));assert.ok(draft.text.includes(h.catalog.commercial.undecided));
    const {contentHash,...body}=draft;assert.equal(canonicalHash(body),contentHash);assert.equal(h.repo.access.latest('local-user','erowid'),null);
    assert.equal(h.repo.access.history('local-user','erowid',100).drafts.length,1);assert.equal(h.repo.access.history('another','erowid',100).drafts.length,0);
    assert.equal(h.service.overview('local-user').stats.drafts,1);assert.equal(h.service.overview('local-user').stats.access.requested,0);
    assert.throws(()=>h.service.draft('local-user','erowid','0'.repeat(64),input),/profile changed/);
    assert.throws(()=>h.service.draft('local-user','erowid',hash,{...input,send:true}));
    assert.throws(()=>h.db.prepare('UPDATE source_access_drafts SET body_json=? WHERE id=?').run('{}',draft.id),/WORM/);
    h.principals.migrateLocalUserRows('another');assert.deepEqual(h.repo.access.history('another','erowid',100).drafts[0],draft);
  }finally{h.close();}
});

test('private candidates do not create network adapters or executable code and survive transfer',()=>{
  const h=harness();try{
    const c=h.repo.access.addCandidate('local-user',candidate,1);assert.ok(c.id.startsWith('custom-'));
    assert.equal(h.service.snapshot('local-user',c.id).adapter,null);assert.equal(h.service.overview('local-user').stats.implemented,5);
    assert.throws(()=>h.service.snapshot('another',c.id),/not found/);assert.throws(()=>h.repo.access.addCandidate('local-user',candidate,1),/limit/);
    assert.equal(SourceCandidateSchema.safeParse({...candidate,homepage:'javascript:alert(1)'}).success,false);
    assert.equal(SourceCandidateSchema.safeParse({...candidate,homepage:'https://secret:password@example.com'}).success,false);
    assert.equal(SourceCandidateSchema.safeParse({...candidate,implemented:true}).success,false);
    assert.throws(()=>decide(h,c.id,allowed),/no implemented/);
    h.principals.migrateLocalUserRows('another');assert.equal(h.service.snapshot('another',c.id).entry.id,c.id);
  }finally{h.close();}
});

test('public acquisition respects holds before network access and rechecks after source pacing without creating fake HTTP receipts',async()=>{
  const h=harness();try{
    const job=h.job();let calls=0;
    const transport=async()=>{calls++;return new Response('fictional');};
    const http=new PublicHttp(h.repo,job.id,h.automation,10,()=>{},transport,async()=>{});
    await http.get('arxiv','/api/query');assert.equal(calls,1,'existing public behavior survives upgrade');
    decide(h,'arxiv',{...allowed,status:'denied'});
    await assert.rejects(()=>http.get('arxiv','/api/query'),/SOURCE_ACCESS_HELD:arxiv:denied/);assert.equal(calls,1);assert.equal(h.repo.receipts(job.id,'local-user').length,1);
    decide(h,'arxiv',allowed);await http.get('arxiv','/api/query');assert.equal(calls,2);
    const slow=new PublicHttp(h.repo,job.id,h.automation,10,()=>{},transport,async()=>{decide(h,'arxiv',{...allowed,status:'requested'});});
    await assert.rejects(()=>slow.get('arxiv','/api/query'),/SOURCE_ACCESS_HELD:arxiv:requested/);assert.equal(calls,2);assert.equal(slow.requests,0);
    const row=h.db.prepare('SELECT lease_until FROM public_source_leases WHERE provider=?').get('arxiv') as any;assert.equal(row.lease_until,0);
    const otherJob=h.job('another'),other=new PublicHttp(h.repo,otherJob.id,h.automation,1,()=>{},transport,async()=>{});await other.get('arxiv','/api/query');assert.equal(calls,3);
  }finally{h.close();}
});

test('scheduled public work fails explicitly on a source hold rather than collecting under an expired assessment',async()=>{
  const h=harness();try{
    decide(h,'arxiv',{...allowed,validUntil:'2020-01-01T00:00:00.000Z'},new Date('2019-01-01'));
    h.repo.saveSchedule('local-user',{name:'FICTIONAL held schedule',request:{kind:'paper_scan',providers:['arxiv'],scope:'substances',lookbackDays:1,maxRequests:1,pageLimit:1},recurrence:{kind:'interval',minutes:15},enabled:true},h.automation.contentHash,new Date('2020-01-01'));
    let calls=0;const worker=new AutomationService(h.repo,h.automation,async()=>{calls++;throw new Error('must not fetch');},async()=>{});
    await worker.tick();assert.equal(calls,0);const j=h.repo.jobs('local-user')[0];assert.equal(j.status,'FAILED');assert.ok(JSON.stringify(j.result).includes('SOURCE_ACCESS_HELD:arxiv:expired'));
    assert.equal(h.repo.receipts(j.id,'local-user').length,0);
  }finally{h.close();}
});

test('migration 019 preserves previous jobs and creates no assessments, candidates or drafts automatically',()=>{
  const h=harness(true);try{
    const j=h.job();assert.deepEqual(runMigrations(h.db).applied,['019_source_access']);assert.deepEqual(runMigrations(h.db).applied,[]);
    assert.deepEqual(h.repo.job(j.id,'local-user'),j);assert.equal(h.service.overview('local-user').stats.access.permitted,0);assert.equal(h.service.overview('local-user').stats.drafts,0);
    assert.equal(h.service.overview('local-user').stats.acquisition.profile_default,5);
  }finally{h.close();}
});

test('catalog HTTP surface enforces capability, private history, strict input, no-store and same-origin mutation',async()=>{
  const h=harness();let server:ReturnType<express.Express['listen']>|undefined;
  try{
    let owner='local-user',roles=['researcher'],signedIn=true;
    const app=express();app.use(express.json());app.use((req,_res,next)=>{if(signedIn)req.principal={id:owner,roles,email:null,identityProvenance:'fixture'};next();});app.use('/api/source-access',buildSourceAccessRouter(h.service));app.use(errorHandler);
    server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server!.once('listening',r));const base=`http://127.0.0.1:${(server.address() as any).port}/api/source-access`;
    const call=(p:string,b?:unknown,headers:Record<string,string>={})=>fetch(base+p,{...(b===undefined?{}:{method:'POST',body:JSON.stringify(b)}),headers:{'Content-Type':'application/json',...headers}});
    const overview=await call('');assert.equal(overview.status,200);assert.equal(overview.headers.get('cache-control'),'no-store');
    assert.equal((await call('/candidates',candidate,{Origin:'https://foreign.example'})).status,403);
    assert.equal((await call('/candidates',{...candidate,ownerId:'another'})).status,400);
    const c=(await (await call('/candidates',candidate)).json()).source;
    const row=(await (await call('')).json()).rows.find((r:any)=>r.source.entry.id==='pubchem');
    const b={sourceHash:row.sourceHash,previousId:null,decision:{...allowed,status:'denied'}};
    assert.equal((await call('/pubchem/assessments',b)).status,201);assert.equal((await call('/pubchem/assessments',b)).status,409);
    owner='another';assert.deepEqual((await (await call('/pubchem/history')).json()).history,[]);assert.equal((await call(`/${c.id}/history`)).status,404);
    roles=['viewer'];assert.equal((await call('')).status,200);assert.equal((await call('/candidates',candidate)).status,403);assert.equal((await call('/pubchem/assessments',b)).status,403);
    roles=['responder'];assert.equal((await call('')).status,403);signedIn=false;assert.equal((await call('')).status,401);
  }finally{if(server)await new Promise<void>(r=>server!.close(()=>r()));h.close();}
});
