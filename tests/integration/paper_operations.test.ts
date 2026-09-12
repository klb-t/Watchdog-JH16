import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { ResearchRepository } from '../../backend/watchdog_api/db/repositories/research';
import { PaperOperationsRepository } from '../../backend/watchdog_api/db/repositories/paper_operations';
import { WorkbenchRepository } from '../../backend/watchdog_api/db/repositories/workbench';
import { WorkbenchService } from '../../backend/watchdog_api/workbench/service';
import { PaperOperationService } from '../../backend/watchdog_api/services/paper_operations';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { loadWorkbenchProfile } from '../../backend/watchdog_api/config/workbench';
import { canonicalHash, canonicalizeJson } from '../../backend/watchdog_api/domain/canonical';
import { anchorQuote } from '../../backend/watchdog_api/services/paper_intake';
import { readZip } from '../../backend/watchdog_api/utils/zip';
import { TypeScriptMethodExecutor } from '../../backend/watchdog_api/analysis/executor';
import type { PaperOperationInput } from '../../shared/paper_operation';
import { testDataset } from '../helpers/workbench';

async function harness() {
  const dir=mkdtempSync(path.join(tmpdir(),'watchdog-paper-operation-')), db=new Database(':memory:');
  db.pragma('foreign_keys = ON'); runMigrations(db);
  const store=new LocalFileSystemStore(path.join(dir,'store')), wb=new WorkbenchRepository(db,store), workbench=new WorkbenchService(wb,loadWorkbenchProfile());
  const research=new ResearchRepository(db), repo=new PaperOperationsRepository(db), service=new PaperOperationService(repo,research,workbench);
  const paper=research.saveDocument('owner',{title:'Fictional methods for software testing',source:'https://example.org/method-fixture',text:'🧪 Method. Pearson correlation compared scores and counts. A separate expert panel was required.',coverage:'excerpt',language:'en',geography:[]});
  const dataset=await wb.importDataset(testDataset(),'owner','test'); await wb.approveDataset(dataset.id,'owner',dataset.contentHash,true,'test');
  const input:PaperOperationInput={source:{kind:'manual_quote',documentId:paper.id,documentHash:paper.hash,quote:'Pearson correlation compared scores and counts.'},method:'pearson',datasetId:dataset.id,datasetHash:dataset.contentHash,
    bindings:[{role:'a',column:'interest',rationale:'Fictional scores for a deterministic test.',origin:'synthetic_scenario',requirementId:null,substitution:null},
      {role:'b',column:'mentions',rationale:'Fictional counts; not real observations.',origin:'synthetic_scenario',requirementId:null,substitution:null}],missingPolicy:'exclude',scopeNote:'Software fixture, one association. Does not reproduce the expert panel or establish replication.'};
  const approve=async(r:any)=>service.approve('owner',r.id,r.hash,r.method.hash,'test');
  return {dir,db,store,wb,workbench,research,repo,service,paper,dataset,input,approve,close(){db.close();rmSync(dir,{recursive:true,force:true});}};
}
function assessment(h:Awaited<ReturnType<typeof harness>>, operationName='pearson') {
  const excerpt=h.paper.body.text, quote='Pearson correlation compared scores and counts.', requirement={id:'scores',statement:'The source measurement',quote,anchor:anchorQuote(excerpt,quote),construct:'score',unit:'index',availabilityVerified:false};
  const id=h.research.claimAssessment('owner',h.paper.id,canonicalHash(operationName))!;
  return h.research.finishAssessment('owner',id,{version:'paper-assessment-1',documentHash:h.paper.hash,sourceCoverage:'excerpt',excerptCharacters:excerpt.length,excerptHash:canonicalHash(excerpt),
    assessment:{methodology:[],dataRequirements:[requirement,{...requirement,id:'experts',construct:'expert judgments'}],operations:[{name:operationName,quote,anchor:anchorQuote(excerpt,quote),implementedPrimitive:true},{name:'unimplemented-panel',quote:'A separate expert panel was required.',anchor:anchorQuote(excerpt,'A separate expert panel was required.')}],ambiguities:['Expert panel composition is unknown.'],hypotheses:[],alternatives:[]},approvalState:'PROPOSED',replicability:'NOT_YET_ESTABLISHED'},'PROPOSED');
}

test('paper operation: keyless quote -> exact method approval -> real statistics -> history -> portable verification and recalculation',async()=>{
  const h=await harness();try{
    const plan=await h.service.prepare('owner',h.input,'test');assert.equal(plan.method.approvalState,'PROPOSED');
    assert.equal(plan.body.anchor.startUtf16,11);assert.equal(plan.body.meaning,'SIMULATION_NOT_EMPIRICAL_EVIDENCE');
    await assert.rejects(h.service.execute('owner',plan.id,plan.hash,'test'),/approved method/);
    await assert.rejects(h.service.approve('owner',plan.id,'0'.repeat(64),plan.method.hash,'test'),/stale/);
    await h.approve(plan);const result=await h.service.execute('owner',plan.id,plan.hash,'test');
    assert.equal(result.artifact.results[0].valueNumeric,1);assert.equal(result.artifact.results[0].statisticMetadata?.n,4);
    assert.deepEqual(result.inputs[0].values,[10,20,30,40,null]);assert.equal(result.paperBinding!.hash,plan.hash);
    assert.deepEqual((await new TypeScriptMethodExecutor().execute(result.methodSpec,result.inputs,{approvable:{id:plan.method.id,kind:'method_spec',content:result.methodSpec,approvedHash:plan.method.hash,approvedBy:'owner',approvedAt:new Date().toISOString()}})),result.artifact);
    const restarted=new PaperOperationService(new PaperOperationsRepository(h.db),h.research,h.workbench);assert.equal((restarted.get('owner',plan.id).runs[0] as any).status,'COMPLETED');
    const pkg=await restarted.export('owner',plan.id,result.runId), entries=readZip(pkg.bytes), exportDir=path.join(h.dir,'export');
    for(const e of entries){const f=path.join(exportDir,e.name);mkdirSync(path.dirname(f),{recursive:true});writeFileSync(f,e.content);}
    const verify=spawnSync(process.execPath,[path.join(exportDir,'verify.mjs'),exportDir,pkg.manifestHash],{encoding:'utf8'});
    assert.equal(verify.status,0,verify.stdout+verify.stderr);assert.ok(entries.some(e=>e.name==='research/paper-binding.json'));
    assert.match(entries.find(e=>e.name==='figure.svg')!.content.toString(),/SIMULATION_NOT_EMPIRICAL_EVIDENCE/);
    const binding=JSON.parse(entries.find(e=>e.name==='research/paper-binding.json')!.content.toString());assert.equal(binding.body.document.body.text,h.paper.body.text);
    // Even a rehashed internally consistent input edit must fail the source-column check.
    const json=(name:string)=>JSON.parse(entries.find(e=>e.name===name)!.content.toString());
    const put=(name:string,b:unknown)=>{entries.find(e=>e.name===name)!.content=Buffer.from(canonicalizeJson(b));};
    const r=json('analysis/result.json'), f=json('figure.json'), manifest=json('analysis/manifest.json');
    r.inputs[0].values[0]=999;r.inputHash=canonicalHash(r.inputs);put('analysis/inputs.json',r.inputs);put('analysis/result.json',r);
    f.analysis.resultHash=canonicalHash(r);put('figure.json',f);const workspace=json('workspace.json');workspace.figure=f;put('workspace.json',workspace);
    manifest.inputs.combinedHash=r.inputHash;manifest.outputs[0].sha256=canonicalHash(r);put('analysis/manifest.json',manifest);
    const packageManifest=json('package-manifest.json');packageManifest.identity.figureHash=canonicalHash(f);packageManifest.identity.resultHash=canonicalHash(r);packageManifest.identity.analysisManifestHash=canonicalHash(manifest);
    packageManifest.files=packageManifest.files.map((item:any)=>{const e=entries.find(e=>e.name===item.path)!;return {...item,bytes:e.content.length,sha256:createHash('sha256').update(e.content).digest('hex')};});put('package-manifest.json',packageManifest);
    for(const e of entries)writeFileSync(path.join(exportDir,e.name),e.content);
    const changed=spawnSync(process.execPath,[path.join(exportDir,'verify.mjs'),exportDir,canonicalHash(packageManifest)],{encoding:'utf8'});
    assert.notEqual(changed.status,0);assert.match(changed.stderr,/source columns/);
  }finally{h.close();}
});

test('paper operation: ownership, stale documents, ambiguous quotes and unapproved data block preparation',async()=>{
  const h=await harness();try{
    await assert.rejects(h.service.prepare('stranger',h.input,'test'),/owned paper/);
    await assert.rejects(h.service.prepare('owner',{...h.input,source:{...h.input.source,documentHash:'0'.repeat(64)}},'test'),/owned paper/);
    await assert.rejects(h.service.prepare('owner',{...h.input,source:{...h.input.source,quote:'not in the paper'}},'test'),/does not occur/);
    await assert.rejects(h.service.prepare('owner',{...h.input,source:{...h.input.source,quote:' ' }},'test'),/ambiguous/);
    await assert.rejects(h.service.prepare('owner',{...h.input,bindings:[h.input.bindings[0],{...h.input.bindings[1],column:'interest'}]},'test'),/distinct/);
    await assert.rejects(h.service.prepare('owner',{...h.input,bindings:[{...h.input.bindings[0],column:'longitude'},h.input.bindings[1]]},'test'),/numeric column/);
    await h.wb.revokeDataset(h.dataset.id,'owner','test');await assert.rejects(h.service.prepare('owner',h.input,'test'),/approved dataset/);
  }finally{h.close();}
});

test('paper operation: assessment operation stays exact; unresolved requirements, ambiguities and substitutions remain visible',async()=>{
  const h=await harness();try{
    const a=assessment(h), source={kind:'assessment_operation' as const,assessmentId:a.id,assessmentHash:a.hash,operationIndex:0};
    const s=h.research.substitution('owner',{assessmentId:a.id,assessmentHash:a.hash,requirementId:'scores',kind:'prior_dataset',source:'Fictional prior measurement',sourceHash:null,constructDifference:'Different measurement scale',validationNeeded:'Independent construct validation needed'});
    const input={...h.input,source,bindings:[{...h.input.bindings[0],origin:'prior_dataset' as const,requirementId:'scores',substitution:{id:s.id,hash:s.hash}},{...h.input.bindings[1],origin:'new_observations' as const}]};
    const p=await h.service.prepare('owner',input,'test');assert.equal(p.body.meaning,'EXPLORATORY_METHOD_VARIANT');assert.equal(p.body.unboundRequirements[0].id,'experts');assert.equal(p.body.otherOperations[0].name,'unimplemented-panel');assert.equal(p.body.ambiguities.length,1);assert.equal(p.body.bindings[0].sourceFileVerified,false);
    await assert.rejects(h.service.prepare('owner',{...input,method:'spearman'},'test'),/exact supported/);
    await assert.rejects(h.service.prepare('owner',{...input,source:{...source,operationIndex:1}},'test'),/exact supported/);
    await assert.rejects(h.service.prepare('owner',{...input,bindings:[{...input.bindings[0],requirementId:'unknown'},input.bindings[1]]},'test'),/Unknown data requirement/);
    const hashed=h.research.substitution('owner',{assessmentId:a.id,assessmentHash:a.hash,requirementId:'scores',kind:'prior_dataset',source:'data',sourceHash:'f'.repeat(64),constructDifference:'scale',validationNeeded:'validation'});
    await assert.rejects(h.service.prepare('owner',{...input,bindings:[{...input.bindings[0],substitution:{id:hashed.id,hash:hashed.hash}},input.bindings[1]]},'test'),/file hash/);
  }finally{h.close();}
});

test('paper operation: original-data reuse is reanalysis; current access gates generic execution and export',async()=>{
  const h=await harness();try{
    const p=await h.service.prepare('owner',{...h.input,bindings:h.input.bindings.map(b=>({...b,origin:'original_data_reuse'}))},'test');assert.equal(p.body.meaning,'REANALYSIS_NOT_INDEPENDENT_REPLICATION');await h.approve(p);
    await assert.rejects(h.workbench.execute('stranger',p.method.id,'test'),/owned paper context/);
    assert.throws(()=>h.wb.approveMethod(p.method.id,'stranger',p.method.hash,'test'),/owned paper context/);
    const result=await h.workbench.execute('owner',p.method.id,'test');assert.equal(result.paperBinding!.hash,p.hash);
    await h.wb.revokeDataset(h.dataset.id,'owner','test');await assert.rejects(h.service.export('owner',p.id,result.runId),/approved dataset/);
    assert.throws(()=>h.db.prepare('UPDATE paper_operations SET body_json=? WHERE id=?').run('{}',p.id),/WORM/);
  }finally{h.close();}
});

test('paper operation: explicit missing failure records a failed run; description retains valid and missing counts',async()=>{
  const h=await harness();try{
    const fail=await h.service.prepare('owner',{...h.input,missingPolicy:'fail'},'test');await h.approve(fail);
    await assert.rejects(h.service.execute('owner',fail.id,fail.hash,'test'),/missing/);assert.equal((h.repo.runs('owner',fail.method.id)[0] as any).status,'FAILED');
    const describe=await h.service.prepare('owner',{...h.input,method:'describe',bindings:[h.input.bindings[0]],missingPolicy:'propagate'},'test');await h.approve(describe);
    const r=await h.service.execute('owner',describe.id,describe.hash,'test');assert.ok(r.artifact.results.some(r=>r.metricKey.endsWith('missing_count')&&r.valueNumeric===1));
    await assert.rejects(h.service.prepare('owner',{...h.input,method:'pearson',missingPolicy:'propagate'},'test'),/missing.*policy|missingPolicy/i);
  }finally{h.close();}
});

for (const revoke of ['dataset','method'] as const) test(`workbench finalization: ${revoke} revocation during asynchronous manifest write leaves no finalized result`,async()=>{
  const h=await harness();try{
    const p=await h.service.prepare('owner',h.input,'test');await h.approve(p);
    const put=h.store.put.bind(h.store);h.store.put=async(key,bytes)=>{
      const uri=await put(key,bytes);
      if(key.includes('/manifest-'))h.db.prepare(revoke==='dataset'?'UPDATE datasets SET approved_hash=NULL WHERE id=?':'UPDATE method_specs SET approved_hash=NULL WHERE id=?').run(revoke==='dataset'?h.dataset.id:p.method.id);
      return uri;
    };
    await assert.rejects(h.service.execute('owner',p.id,p.hash,'test'),/approval changed/);
    assert.equal((h.repo.runs('owner',p.method.id)[0] as any).status,'FAILED');
    for(const table of ['artifacts','manifests','analysis_runs','analysis_results'])assert.equal((h.db.prepare(`SELECT count(*) n FROM ${table}`).get() as any).n,0);
  }finally{h.close();}
});


test('paper operation: a quote unique inside the assessed excerpt remains anchored there even when repeated later',async()=>{
  const h=await harness();try{
    const a=assessment(h), quote=h.paper.body.text;
    // A real assessment only sees its bounded excerpt, not the later duplicate.
    const doc=h.research.saveDocument('owner',{...h.paper.body,text:quote+' '+quote,coverage:'full_text'});
    const id=h.research.claimAssessment('owner',doc.id,canonicalHash('bounded-excerpt'))!;
    const bounded=h.research.finishAssessment('owner',id,{...a.body,documentHash:doc.hash,truncated:true},'PROPOSED');
    const input={...h.input,source:{kind:'assessment_operation',assessmentId:bounded.id,assessmentHash:bounded.hash,operationIndex:0}};
    const p=await h.service.prepare('owner',input,'test');assert.equal(p.body.excerptCharacters,quote.length);
    await h.approve(p);const r=await h.service.execute('owner',p.id,p.hash,'test');
    const bundle=await h.service.export('owner',p.id,r.runId), target=path.join(h.dir,'bounded');
    for(const e of readZip(bundle.bytes)){const f=path.join(target,e.name);mkdirSync(path.dirname(f),{recursive:true});writeFileSync(f,e.content);}
    const verify=spawnSync(process.execPath,[path.join(target,'verify.mjs'),target,bundle.manifestHash],{encoding:'utf8'});assert.equal(verify.status,0,verify.stderr);
    const changed=h.research.claimAssessment('owner',doc.id,canonicalHash('bad-anchor'))!;
    const body=structuredClone(bounded.body);body.assessment.operations[0].anchor.startUtf16++;
    const corrupted=h.research.finishAssessment('owner',changed,body,'PROPOSED');
    await assert.rejects(h.service.prepare('owner',{...input,source:{...input.source,assessmentId:corrupted.id,assessmentHash:corrupted.hash}},'test'),/anchor mismatch/);
  }finally{h.close();}
});

test('paper operation: revocation during result loading blocks historical output',async()=>{
  const h=await harness();try{
    const p=await h.service.prepare('owner',h.input,'test');await h.approve(p);const r=await h.service.execute('owner',p.id,p.hash,'test');
    const get=h.store.get.bind(h.store);h.store.get=async(uri)=>{const bytes=await get(uri);if(uri.includes('/manifest-'))h.db.prepare('UPDATE method_specs SET approved_hash=NULL WHERE id=?').run(p.method.id);return bytes;};
    await assert.rejects(h.service.result('owner',p.id,r.runId),/approval was revoked/);
  }finally{h.close();}
});
