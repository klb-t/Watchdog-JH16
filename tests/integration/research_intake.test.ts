import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { ResearchRepository } from '../../backend/watchdog_api/db/repositories/research';
import { SettingsRepository } from '../../backend/watchdog_api/db/repositories/settings';
import { AutomationRepository } from '../../backend/watchdog_api/db/repositories/automation';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { UserVault } from '../../backend/watchdog_api/secrets/user_vault';
import { loadAssistantProfile } from '../../backend/watchdog_api/config/assistant';
import { loadAutomationProfile } from '../../backend/watchdog_api/config/automation';
import { AssistantService } from '../../backend/watchdog_api/services/assistant';
import { normalizeModelCatalog } from '../../backend/watchdog_api/llm/routing';
import { PaperIntakeService,anchorQuote } from '../../backend/watchdog_api/services/paper_intake';
import { ExtractionWorkshop } from '../../backend/watchdog_api/services/extraction_workshop';
import { copySource,sourceStructure } from '../../backend/watchdog_api/sources/copy_plan';
import { CopyPlanSchema } from '../../shared/research';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';
import express from 'express';
import { AutomationService } from '../../backend/watchdog_api/services/automation';
import { PrincipalRepository } from '../../backend/watchdog_api/db/repositories/principals';
import { buildResearchRouter } from '../../backend/watchdog_api/api/research_routes';
import { buildAutomationRouter } from '../../backend/watchdog_api/api/automation_routes';
import { errorHandler } from '../../backend/watchdog_api/api/middleware';
const TEXT='Fictional test protocol. We compare ranked observations using Spearman correlation. Expert ratings are collected from an independent panel. All missing values remain missing.';
const answer=()=>({methodology:[{statement:'Rank association',quote:'We compare ranked observations using Spearman correlation.'}],
  dataRequirements:[{id:'ratings',statement:'Expert panel data',quote:'Expert ratings are collected from an independent panel.',construct:'Expert ratings',unit:null,sourceLocator:null,acquisition:'requires_experts'}],
  operations:[{name:'spearman',quote:'using Spearman correlation.'}],ambiguities:['Panel membership and scoring rubric are not supplied.'],hypotheses:['A new independent panel may rank items differently.'],
  alternatives:[{requirementId:'ratings',kind:'prior_dataset',proposal:'Evaluate an existing rating dataset',constructDifference:'Panel and collection time differ',validationNeeded:'Verify the construct and sampling frame'}]});
const plan={version:'copy-plan-1',name:'Fixture scalar copier',format:'json',rowsPointer:'/rows',fields:[{name:'value',selector:'/value',required:true},{name:'note',selector:'/note',required:false}]} as const;
async function setup() {
  const dir=mkdtempSync(path.join(tmpdir(),'watchdog-research-')),db=new Database(path.join(dir,'db.sqlite'));db.pragma('foreign_keys=ON');runMigrations(db);
  const store=new LocalFileSystemStore(path.join(dir,'store')),repo=new ResearchRepository(db),settings=new SettingsRepository(db,store),profile=loadAssistantProfile(),vault=new UserVault(settings,path.join(dir,'vault/key'),{}),owner='local-user';
  const record=settings.get(owner,profile.defaults);settings.save(owner,{...record.value,assistant:{...record.value.assistant,enabled:true}},record.hash,profile.defaults);vault.save(owner,'openrouter','sk-or-fixture-research-928419');
  const raw=Buffer.from(JSON.stringify({data:[{id:'fixture/model',context_length:128000,architecture:{input_modalities:['text'],output_modalities:['text']},pricing:{prompt:'0.000001',completion:'0.000002'},supported_parameters:[]}]}));
  await settings.saveCatalog(normalizeModelCatalog(raw,profile),raw);
  const requests:any[]=[];let output:any=answer(),onRequest=()=>{};
  const assistant=new AssistantService(settings,vault,profile,async(_url,init)=>{const b=JSON.parse(String(init?.body));requests.push(b);onRequest();return new Response(JSON.stringify({model:b.model,choices:[{message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:200}}));});
  const automation=new AutomationRepository(db,store);automation.archiveProfile(loadAutomationProfile());
  const paper=new PaperIntakeService(repo,assistant,automation),extract=new ExtractionWorkshop(repo,assistant);
  const worker=new AutomationService(automation,loadAutomationProfile());worker.handlers.set('paper_review',(job,checkpoint)=>paper.reviewJob(job,checkpoint));
  return {dir,db,repo,settings,assistant,automation,paper,extract,worker,owner,requests,setOnRequest:(fn:()=>void)=>{onRequest=fn;},setOutput:(v:any)=>{output=v;},close:()=>{worker.stop();db.close();rmSync(dir,{recursive:true,force:true});}};
}
test('paper intake preserves arbitrary text versions, source coverage and owner isolation',async()=>{
  const h=await setup();try{
    const a=h.repo.saveDocument(h.owner,{title:'Arbitrary discipline',source:'doi:fixture',text:TEXT,coverage:'excerpt',language:'en',geography:['NL']});
    assert.equal(h.repo.saveDocument(h.owner,a.body).id,a.id);assert.equal(h.repo.document('other',a.id),null);
    const b=h.repo.saveDocument(h.owner,{...a.body,text:TEXT+' Revised.'});assert.notEqual(a.hash,b.hash);
    assert.throws(()=>h.db.prepare('UPDATE research_documents SET body_json=?').run('{}'),/WORM/);
    const id=h.repo.saveDocument(h.owner,{...a.body,text:'',coverage:'identifier_only'}).id;
    await assert.rejects(()=>h.paper.assess(h.owner,id),/Add source text/);assert.equal(h.requests.length,0);
  }finally{h.close();}
});
test('paper assessment runs the owned LLM, verifies each source span, records missing inputs and never declares replication',async()=>{
  const h=await setup();try{
    const d=h.repo.saveDocument(h.owner,{title:'Fictional protocol',source:'fixture:test',text:TEXT,coverage:'full_text',language:null,geography:[]});
    const a:any=await h.paper.assess(h.owner,d.id);assert.equal(a.status,'PROPOSED');assert.equal(a.body.executionEnabled,false);assert.equal(a.body.replicability,'NOT_YET_ESTABLISHED');
    const anchor=a.body.assessment.methodology[0].anchor;assert.equal(TEXT.slice(anchor.startUtf16,anchor.endUtf16),anchor.quote);
    assert.equal(a.body.assessment.operations[0].implementedPrimitive,true);assert.equal(a.body.assessment.dataRequirements[0].availabilityVerified,false);
    await h.paper.assess(h.owner,d.id);assert.equal(h.requests.length,1,'duplicate jobs do not duplicate paid analysis');
    await assert.rejects(()=>h.paper.assess('other',d.id),/not found/);
    const input={assessmentId:a.id,assessmentHash:a.hash,requirementId:'ratings',kind:'original_data_reuse',source:'Archived source dataset',sourceHash:'a'.repeat(64),constructDifference:'Reusing original data',validationNeeded:'Reanalysis only'};
    const substitution=h.repo.substitution(h.owner,input);assert.equal(substitution.body.meaning,'REANALYSIS_NOT_INDEPENDENT_REPLICATION');
    assert.equal(h.repo.substitution(h.owner,{...input,kind:'synthetic_scenario'}).body.meaning,'SIMULATION_NOT_EMPIRICAL_EVIDENCE');
    assert.throws(()=>h.repo.substitution('other',input),/missing/);assert.equal(h.repo.substitutions('other').length,0);
  }finally{h.close();}
});
test('hallucinated/ambiguous quotations fail closed; failed attempts persist and only explicit retries call again',async()=>{
  const h=await setup();try{
    assert.throws(()=>anchorQuote('repeat repeat','repeat'),/ambiguous/);
    const d=h.repo.saveDocument(h.owner,{title:'Protocol',source:'fixture:test',text:TEXT,coverage:'abstract',language:null,geography:[]});
    const a=answer();a.methodology[0].quote='Invented text';h.setOutput(a);
    await assert.rejects(()=>h.paper.assess(h.owner,d.id),/could not be verified/);assert.equal(h.repo.assessments(h.owner)[0].status,'FAILED');
    await h.paper.assess(h.owner,d.id);assert.equal(h.requests.length,1);
    h.setOutput(answer());const good:any=await h.paper.assess(h.owner,d.id,()=>{},true);assert.equal(good.status,'PROPOSED');assert.equal(h.requests.length,2);
  }finally{h.close();}
});
test('JSON copying preserves large numeric lexemes, explicit null, absent fields, exact spans and escaped pointers',()=>{
  const raw='{"rows":[{"value":900719925474099312345},{"value":null},{"value":"0","note":"x"}]}';
  const r=copySource(raw,plan);assert.equal(r.records[0].value,'900719925474099312345');assert.equal(r.records[1].value,null);assert.equal(r.records[2].value,'0');
  assert.equal(r.provenance[0].note.missing,true);assert.equal(r.provenance[1].value.explicitNull,true);
  assert.equal(raw.slice(r.provenance[0].value.startUtf16,r.provenance[0].value.endUtf16),r.provenance[0].value.rawLiteral);
  assert.deepEqual(copySource(raw,plan),r);
  assert.equal(copySource('{"rows":[{"a/b":{"~x":1.2300e+04}}]}',{...plan,fields:[{name:'x',selector:'/a~1b/~0x',required:true}]}).records[0].x,'1.2300e+04');
  assert.throws(()=>copySource('{"rows":[{"value":1,"value":2}]}',plan),/Duplicate/);
  assert.throws(()=>copySource('{"rows":[{}]}',plan),/Required field/);
  assert.throws(()=>CopyPlanSchema.parse({...plan,code:'return 42'}));
});
test('CSV copying preserves blank records, quoted multiline content and explicit missing columns',()=>{
  const p={...plan,format:'csv',rowsPointer:'',fields:[{name:'value',selector:'v',required:true},{name:'note',selector:'missing',required:false}]};
  const r=copySource('v,other\n,\n"line\nnext",x\n0,z\n',p);assert.equal(r.records.length,3);assert.equal(r.records[0].value,'');assert.equal(r.records[1].value,'line\nnext');assert.equal(r.records[2].value,'0');assert.equal(r.records[2].note,null);
  assert.throws(()=>copySource('v,v\n1,2',p),/unique headers/);assert.throws(()=>copySource('v,other\n1',p),/row width/);
});
test('extractor proposal sends structure without cell values, needs exact-output validation and executes without LLM',async()=>{
  const h=await setup();try{
    const raw='{"rows":[{"value":98765432123456789,"note":"DO_NOT_SEND_THIS_CELL"}]}';h.setOutput(plan);
    const structure=sourceStructure(raw,'json');assert.ok(!JSON.stringify(structure).includes('DO_NOT_SEND'));assert.ok(!JSON.stringify(structure).includes('987654'));
    const c=await h.extract.propose(h.owner,raw,'json','Copy source value and note');assert.equal(c.approvalState,'PROPOSED');
    assert.ok(!JSON.stringify(h.requests).includes('DO_NOT_SEND'));assert.equal(h.requests.length,1);
    assert.throws(()=>h.extract.run(h.owner,c.id,raw),/activate/);assert.throws(()=>h.repo.approveExtractor(h.owner,c.id,c.hash),/passing/);
    const wrong=h.extract.test(h.owner,c.id,raw,[{value:'42',note:null}]);assert.equal((wrong.body as any).passed,false);
    assert.throws(()=>h.repo.approveExtractor(h.owner,c.id,c.hash),/passing/);
    const good=h.extract.test(h.owner,c.id,raw,[{value:'98765432123456789',note:'DO_NOT_SEND_THIS_CELL'}]);assert.equal((good.body as any).passed,true);
    h.repo.approveExtractor(h.owner,c.id,c.hash);const result=h.extract.run(h.owner,c.id,raw);assert.equal((result.body as any).llmCalls,0);assert.equal(h.requests.length,1);
    assert.equal(h.repo.extractor('other',c.id),null);assert.throws(()=>h.extract.run('other',c.id,raw),/activate/);
    assert.equal((result.body as any).result.planHash,canonicalHash(plan));
  }finally{h.close();}
});

test('scheduled methodology review is bounded, skips attempted documents and abstracts by default, and records actual outcomes',async()=>{
  const h=await setup();try{
    const doc={title:'Scheduled fictional protocol',source:'fixture:schedule',text:TEXT,coverage:'excerpt',language:'en',geography:[]};
    h.repo.saveDocument(h.owner,doc);h.repo.saveDocument(h.owner,{...doc,title:'Second protocol'});
    h.repo.saveDocument(h.owner,{...doc,title:'Abstract only',coverage:'abstract'});h.repo.saveDocument('other',{...doc,title:'Private other paper'});
    const request={kind:'paper_review',documentId:null,includeDiscoveredAbstracts:false,maxRequests:1};
    assert.throws(()=>h.automation.saveSchedule(h.owner,{name:'Invalid automatic rebill',enabled:true,recurrence:{kind:'interval',minutes:15},request:{...request,documentId:'one-document',retryFailed:true}},h.worker.profile.contentHash),/one-off/);
    h.automation.saveSchedule(h.owner,{name:'Daily methodology',enabled:true,recurrence:{kind:'interval',minutes:15},request},h.worker.profile.contentHash,new Date(Date.now()-3600000));
    await h.worker.tick();assert.equal(h.requests.length,1);assert.equal(h.repo.assessments(h.owner).length,1);
    assert.equal(h.automation.jobs(h.owner)[0].status,'SUCCEEDED');
    h.automation.enqueue(h.owner,request,h.worker.profile.contentHash);await h.worker.tick();assert.equal(h.requests.length,2);
    h.automation.enqueue(h.owner,request,h.worker.profile.contentHash);await h.worker.tick();assert.equal(h.requests.length,2,'completed assessments are not replayed');
    assert.equal(h.repo.assessments('other').length,0);
    h.setOutput({...answer(),methodology:[{statement:'Invalid fixture',quote:'absent quote'}]});
    const bad=h.automation.enqueue(h.owner,{...request,includeDiscoveredAbstracts:true},h.worker.profile.contentHash);await h.worker.tick();
    assert.equal(h.automation.job(bad.id,h.owner)!.status,'PARTIAL');assert.equal(h.requests.length,3);
  }finally{h.close();}
});

test('discovered abstract revisions at the same URL retain source receipt lineage and deduplicate unchanged content',async()=>{
  const h=await setup();try{
    const job=h.automation.enqueue(h.owner,h.worker.profile.defaults.paperJob,h.worker.profile.contentHash);
    const receipt=await h.automation.receipt(job.id,'europe_pmc','https://www.ebi.ac.uk/europepmc/webservices/rest/search',200,Buffer.from('{"fixture":true}'),'fixture');
    const common={provider:'europe_pmc' as const,sourceId:'fixture-revision',title:'Fictional revision',authors:[],doi:null,url:'https://example.org/fixture-revision',publishedAt:null,updatedAt:null,categories:[],sourceLanguage:'en',geography:null,receiptId:receipt.id,
      screening:{version:'fixture',hints:[],blockers:[],state:'DISCOVERED' as const,clinicalUse:false as const}};
    const first=h.automation.paper(h.owner,{...common,abstract:TEXT}),second=h.automation.paper(h.owner,{...common,abstract:TEXT+' Source revision.'});
    const a=h.paper.intakeDiscovery(h.owner,first),b=h.paper.intakeDiscovery(h.owner,second);
    assert.notEqual(a.hash,b.hash);assert.equal(a.body.source,b.body.source);assert.equal(a.body.coverage,'abstract');
    assert.equal(a.origins![0].receiptId,receipt.id);assert.equal(a.origins![0].discoveryId,first);
    assert.equal(h.paper.intakeDiscovery(h.owner,first).id,a.id);assert.equal(h.repo.documents(h.owner).length,2);
    assert.equal(h.repo.document(h.owner,a.id)!.origins!.length,1);assert.throws(()=>h.paper.intakeDiscovery('other',first),/not found/);
    await h.paper.reviewPending(h.owner,1,true,()=>{});assert.equal(h.repo.documents(h.owner).length,2);
    assert.equal(h.repo.assessments(h.owner)[0].body.sourceOrigins[0].receiptId,receipt.id);
  }finally{h.close();}
});

test('canceling a paid methodology attempt stops the batch and preserves the interrupted record and reservation',async()=>{
  const h=await setup();try{
    const doc={title:'Cancel fixture',source:'fixture:cancel',text:TEXT,coverage:'excerpt',language:null,geography:[]};
    h.repo.saveDocument(h.owner,doc);h.repo.saveDocument(h.owner,{...doc,title:'Second cancel fixture'});
    const job=h.automation.enqueue(h.owner,{kind:'paper_review',documentId:null,includeDiscoveredAbstracts:false,maxRequests:2},h.worker.profile.contentHash);
    h.setOnRequest(()=>h.automation.cancel(job.id,h.owner));await h.worker.tick();
    assert.equal(h.automation.job(job.id,h.owner)!.status,'CANCELED');assert.equal(h.requests.length,1);
    const attempt=h.repo.assessments(h.owner)[0];assert.equal(attempt.status,'FAILED');assert.equal(attempt.body.error,'ASSESSMENT_INTERRUPTED');
    assert.equal(h.repo.assessments(h.owner).length,1,'batch stops before the second request');
    await h.paper.assess(h.owner,attempt.documentId);assert.equal(h.requests.length,1,'default enqueue does not rebill interrupted work');
  }finally{h.close();}
});

test('lost worker lease recovers the linked assessment; only explicit retry may create another attempt',async()=>{
  const h=await setup();try{
    const d=h.repo.saveDocument(h.owner,{title:'Lease fixture',source:'fixture:lease',text:TEXT,coverage:'excerpt',language:null,geography:[]});
    const job=h.automation.enqueue(h.owner,{kind:'paper_review',documentId:d.id,includeDiscoveredAbstracts:false,maxRequests:1},h.worker.profile.contentHash);
    const now=new Date(),claim=h.automation.claim(now,60000)!;
    h.repo.claimAssessment(h.owner,d.id,h.assistant.profile.contentHash,job.id);
    assert.throws(()=>h.repo.claimAssessment('other',d.id,'different',job.id),/not found/);
    h.automation.claim(new Date(now.getTime()+60001),60000);
    assert.equal(h.automation.job(job.id,h.owner)!.status,'INTERRUPTED');
    const attempt=h.repo.assessments(h.owner)[0];assert.equal(attempt.status,'FAILED');assert.equal(attempt.body.retryAutomatically,false);
    h.automation.finish(job.id,claim.token,'SUCCEEDED',{});assert.equal(h.automation.job(job.id,h.owner)!.status,'INTERRUPTED');
    await h.paper.assess(h.owner,d.id);assert.equal(h.requests.length,0);
    const retry:any=await h.paper.assess(h.owner,d.id,()=>{},true);assert.equal(retry.status,'PROPOSED');assert.equal(h.requests.length,1);
  }finally{h.close();}
});

test('research API gates owners and mutation origins, retains readable trial history and rejects oversized input',async()=>{
  const h=await setup();let server:ReturnType<express.Express['listen']>|undefined;try{
    let owner=h.owner,roles=['dev'];const app=express();app.use(express.json({limit:'2mb'}));
    app.use((req,_res,next)=>{req.principal={id:owner,roles,email:null,identityProvenance:'test'};next();});
    app.use('/api/research',buildResearchRouter(h.repo,h.paper,h.extract,h.automation,h.worker));
    app.use('/api/automation',buildAutomationRouter(h.automation,h.worker));app.use(errorHandler);
    server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server!.once('listening',resolve));
    const base=`http://127.0.0.1:${(server.address() as any).port}`;
    const call=(p:string,body?:unknown,headers={})=>fetch(base+p,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
    const doc={title:'API fixture',source:'fixture:api',text:TEXT,coverage:'excerpt',language:null,geography:[]};
    assert.equal((await call('/api/research/papers',doc,{Origin:'https://foreign.example'})).status,403);
    const d=(await (await call('/api/research/papers',doc)).json()).document;
    const list=await call('/api/research');assert.equal(list.headers.get('Cache-Control'),'no-store');
    assert.equal((await list.json()).documents[0].body.text,undefined,'index does not duplicate full source texts');
    assert.equal((await (await call(`/api/research/papers/${d.id}`)).json()).document.body.text,TEXT);
    assert.equal((await call(`/api/research/papers/${d.id}/assess`,{consent:false})).status,400);
    const c=(await (await call('/api/research/extractors',plan)).json()).extractor;
    assert.equal((await call(`/api/research/extractors/${c.id}/approve`,{expectedHash:c.hash})).status,409);
    const t=(await (await call(`/api/research/extractors/${c.id}/test`,{raw:'{"rows":[{"value":12345678901234567890}]}',expected:[{value:'12345678901234567890',note:null}]})).json()).trial;
    assert.equal(t.body.passed,true);
    assert.equal((await call(`/api/research/extractors/${c.id}/approve`,{expectedHash:c.hash})).status,200);
    assert.equal((await (await call(`/api/research/trials/${t.id}`)).json()).trial.hash,t.hash);
    assert.equal((await (await call(`/api/research/extractors/${c.id}/trials`)).json()).trials.length,1);
    assert.equal((await call('/api/research/papers',{...doc,text:'x'.repeat(2200000)})).status,413);
    owner='other';assert.equal((await call(`/api/research/papers/${d.id}`)).status,404);assert.equal((await call(`/api/research/trials/${t.id}`)).status,404);
    assert.equal((await call(`/api/research/extractors/${c.id}/trials`)).status,404);
    roles=['responder'];assert.equal((await call('/api/research')).status,403);
    assert.equal((await call('/api/automation/jobs',{consent:true,profileHash:h.worker.profile.contentHash,request:{kind:'paper_review',documentId:d.id,includeDiscoveredAbstracts:false,maxRequests:1}})).status,403);
    assert.equal(h.requests.length,0);
  }finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));h.close();}
});

test('recorded research survives supported local-to-account ownership transfer without modifying source or trial hashes',async()=>{
  const h=await setup();try{
    const d=h.repo.saveDocument(h.owner,{title:'Transfer fixture',source:'fixture:transfer',text:TEXT,coverage:'excerpt',language:null,geography:[]});
    const a:any=await h.paper.assess(h.owner,d.id);
    const s=h.repo.substitution(h.owner,{assessmentId:a.id,assessmentHash:a.hash,requirementId:'ratings',kind:'prior_dataset',source:'Fixture dataset',sourceHash:null,constructDifference:'Different sampling',validationNeeded:'Review sampling frame'});
    const c=h.repo.saveExtractor(h.owner,plan,{kind:'fixture'}),t=h.extract.test(h.owner,c.id,'{"rows":[{"value":1}]}',[{value:'1',note:null}]);
    const principals=new PrincipalRepository(h.db);principals.upsertOnSignIn({id:'signed-in',email:null,displayName:null,role:'researcher',identityProvenance:'test',at:new Date().toISOString()});
    principals.migrateLocalUserRows('signed-in');
    assert.equal(h.repo.document(h.owner,d.id),null);assert.equal(h.repo.document('signed-in',d.id)!.hash,d.hash);
    assert.equal(h.repo.assessment('signed-in',a.id)!.hash,a.hash);assert.equal(h.repo.substitutions('signed-in')[0].hash,s.hash);
    assert.equal(h.repo.trial('signed-in',t.id)!.hash,t.hash);assert.equal(h.repo.approveExtractor('signed-in',c.id,c.hash).approvalState,'APPROVED');
  }finally{h.close();}
});
