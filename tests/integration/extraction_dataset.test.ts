import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { ResearchRepository } from '../../backend/watchdog_api/db/repositories/research';
import { WorkbenchRepository } from '../../backend/watchdog_api/db/repositories/workbench';
import { SettingsRepository } from '../../backend/watchdog_api/db/repositories/settings';
import { AutomationRepository } from '../../backend/watchdog_api/db/repositories/automation';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { UserVault } from '../../backend/watchdog_api/secrets/user_vault';
import { loadAssistantProfile } from '../../backend/watchdog_api/config/assistant';
import { loadWorkbenchProfile } from '../../backend/watchdog_api/config/workbench';
import { loadAutomationProfile } from '../../backend/watchdog_api/config/automation';
import { AssistantService } from '../../backend/watchdog_api/services/assistant';
import { AutomationService } from '../../backend/watchdog_api/services/automation';
import { PaperIntakeService } from '../../backend/watchdog_api/services/paper_intake';
import { ExtractionWorkshop } from '../../backend/watchdog_api/services/extraction_workshop';
import { ExtractionDatasetService } from '../../backend/watchdog_api/services/extraction_dataset';
import { WorkbenchService } from '../../backend/watchdog_api/workbench/service';
import { sourceNumber, verifyDatasetExtraction } from '../../backend/watchdog_api/workbench/extraction_data';
import { researchPackage } from '../../backend/watchdog_api/workbench/publication';
import { readZip } from '../../backend/watchdog_api/utils/zip';
import { canonicalHash, canonicalizeJson } from '../../backend/watchdog_api/domain/canonical';
import { buildResearchRouter } from '../../backend/watchdog_api/api/research_routes';
import { errorHandler } from '../../backend/watchdog_api/api/middleware';
import { defaultFigure } from '../../shared/workbench';
import type { ExtractionDatasetInput } from '../../shared/research_dataset';
import type { CopyPlan } from '../../shared/research';
import { loadExtractionDatasetProfile } from '../../backend/watchdog_api/config/extraction_dataset';
import { PrincipalRepository } from '../../backend/watchdog_api/db/repositories/principals';

const owner = 'local-user';
const plan: CopyPlan = { version: 'copy-plan-1', name: 'Fictional numeric fixture', format: 'json', rowsPointer: '/rows', fields: [
  { name: 'x', selector: '/x', required: false }, { name: 'y', selector: '/y', required: false }] };
const raw = '{"rows":[{"x":1.00,"y":2},{"x":2,"y":4},{"x":3,"y":6},{"x":null}]}';
const expected = [{ x: '1.00', y: '2' }, { x: '2', y: '4' }, { x: '3', y: '6' }, { x: null, y: null }];
function input(hash: string): ExtractionDatasetInput {
  return { expectedTrialHash: hash, name: 'Fictional source-copy data', description: 'Test fixture only, not scientific evidence.',
    source: { url: '', title: 'Fictional local fixture', publisher: 'Test harness', license: 'Test fixture', sourceRecordId: 'fixture:copy' },
    measure: 'Fictional scores', normalization: 'none', comparisonScope: 'Fictional paired observations only', languageMeaning: 'unknown', evidenceTier: 'UNKNOWN',
    columns: ['x', 'y'].map(key => ({ key, label: key, type: 'number', semanticType: 'score', unit: 'dimensionless', description: 'Fictional score', sourceField: key, emptyAsMissing: false })) };
}
function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'watchdog-copy-dataset-')), db = new Database(':memory:'); db.pragma('foreign_keys=ON'); runMigrations(db);
  const store = new LocalFileSystemStore(path.join(dir, 'store')), research = new ResearchRepository(db), wb = new WorkbenchRepository(db, store);
  const settings = new SettingsRepository(db, store), profile = loadAssistantProfile(); let llmCalls = 0;
  const assistant = new AssistantService(settings, new UserVault(settings, path.join(dir, 'vault/key'), {}), profile, async () => { llmCalls++; throw new Error('This keyless path must not call an LLM'); });
  const extract = new ExtractionWorkshop(research, assistant), bridge = new ExtractionDatasetService(research, wb), statistics = new WorkbenchService(wb, loadWorkbenchProfile());
  const automation = new AutomationRepository(db, store), worker = new AutomationService(automation, loadAutomationProfile());
  const paper = new PaperIntakeService(research, assistant, automation);
  const candidate = research.saveExtractor(owner, plan, { kind: 'manual_profile', actor: owner });
  const trial = extract.test(owner, candidate.id, raw, expected); assert.equal((trial.body as { passed: boolean }).passed, true);
  research.approveExtractor(owner, candidate.id, candidate.hash);
  const execution = extract.run(owner, candidate.id, raw);
  return { dir, db, store, research, wb, extract, bridge, statistics, candidate, trial, execution, worker, automation, paper,
    close() { assert.equal(llmCalls, 0); worker.stop(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('source-copy handoff preserves raw lexemes, provenance, distinct missingness and review gates through actual statistics', async () => {
  const h = setup(); try {
    const proposed = await h.bridge.create(owner, h.execution.id, input(h.execution.hash));
    assert.equal(proposed.approvalState, 'PROPOSED'); assert.equal(proposed.visibility, 'private');
    assert.equal(proposed.document.source.url, `urn:sha256:${createHash('sha256').update(raw).digest('hex')}`);
    assert.equal(proposed.document.sourceCopy!.raw, raw); assert.equal(proposed.document.sourceCopy!.trialHash, h.execution.hash);
    assert.deepEqual(proposed.document.rows.map(r => r.values), [{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }, { x: null, y: null }]);
    assert.equal(proposed.document.rows[3].missingReasons.x, 'Explicit source null');
    assert.equal(proposed.document.rows[3].missingReasons.y, 'Source field is absent');
    const copied = verifyDatasetExtraction(proposed.document)!;
    assert.equal(copied.provenance[0].x.rawLiteral, '1.00');
    assert.equal(raw.slice(copied.provenance[0].x.startUtf16, copied.provenance[0].x.endUtf16), '1.00');
    assert.equal((await h.bridge.create(owner, h.execution.id, input(h.execution.hash))).id, proposed.id);
    const figure = defaultFigure(proposed, h.statistics.profile); figure.channels.x = 'x'; figure.channels.y = 'y';
    await assert.rejects(() => h.statistics.prepare(owner, figure, 'pearson', 'test'), /approved dataset/);
    const approved = (await h.wb.approveDataset(proposed.id, owner, proposed.contentHash, false, 'test'))!;
    assert.ok(approved.document.rows.every(r => r.evidenceTier === 'UNKNOWN'), 'approval never upgrades evidence');
    const method = await h.statistics.prepare(owner, figure, 'pearson', 'test');
    await assert.rejects(() => h.statistics.execute(owner, method.id, 'test'), /approved method/);
    h.wb.approveMethod(method.id, owner, method.hash, 'test');
    const result = await h.statistics.execute(owner, method.id, 'test');
    assert.equal(result.artifact.results[0].valueNumeric, 1); assert.equal(result.artifact.results[0].statisticMetadata.n, 3);
    assert.deepEqual(result.inputs[0].values, [1, 2, 3, null]); assert.equal(result.datasetHash, proposed.contentHash);
    const missingUnits = input(h.execution.hash); missingUnits.columns[0].unit = null;
    const u = await h.bridge.create(owner, h.execution.id, missingUnits); await h.wb.approveDataset(u.id, owner, u.contentHash, false, 'test');
    const f = defaultFigure(u, h.statistics.profile); f.channels.x = 'x'; f.channels.y = 'y';
    await assert.rejects(() => h.statistics.prepare(owner, f, 'pearson', 'test'), /explicitly declared units/);
  } finally { h.close(); }
});

test('numeric source mapping refuses rounded decimals, unsafe integers, underflow and guessed locale; text retains them', async () => {
  for (const value of ['9007199254740993', '0.10000000000000001', '1e-999', '1e999', '1,234', '', '0x10', 'NaN']) assert.throws(() => sourceNumber(value));
  for (const [value, number] of [['1.2300e+04', 12300], ['.1', 0.1], ['1e-7', 1e-7], [' 2.50 ', 2.5]] as const) assert.equal(sourceNumber(value), number);
  assert.ok(Object.is(sourceNumber('-0'), -0));
  const h = setup(); try {
    const exact = '{"rows":[{"x":900719925474099312345,"y":"żółć 🧪"}]}';
    const trial = h.extract.run(owner, h.candidate.id, exact), settings = input(trial.hash);
    await assert.rejects(() => h.bridge.create(owner, trial.id, settings), /precision or range/);
    assert.equal((await h.wb.listDatasets(owner, true)).length, 0);
    settings.columns.forEach(c => { c.type = 'text'; c.unit = null; c.semanticType = 'dimension'; });
    const record = await h.bridge.create(owner, trial.id, settings);
    assert.equal(record.document.rows[0].values.x, '900719925474099312345'); assert.equal(record.document.rows[0].values.y, 'żółć 🧪');
    assert.equal(record.document.sourceCopy!.rawHash, createHash('sha256').update(exact).digest('hex'));
    assert.equal(verifyDatasetExtraction(record.document)!.provenance[0].y.rawLiteral, '"żółć 🧪"');
  } finally { h.close(); }
});

test('CSV empty-text policy and generated row metadata stay explicit and cannot create empirical values', async () => {
  const h = setup(); try {
    const p: CopyPlan = { ...plan, name: 'CSV fixture', format: 'csv', rowsPointer: '', fields: [{ name: 'x', selector: 'x', required: true }] };
    const c = h.research.saveExtractor(owner, p, { kind: 'manual_profile' });
    const csv = 'x\n""\n2\n'; h.extract.test(owner, c.id, csv, [{ x: '' }, { x: '2' }]); h.research.approveExtractor(owner, c.id, c.hash);
    const t = h.extract.run(owner, c.id, csv), s = input(t.hash);
    s.columns[1] = { ...s.columns[1], key: 'source_row', type: 'text', unit: null, semanticType: 'dimension', sourceField: null };
    await assert.rejects(() => h.bridge.create(owner, t.id, s), /decimal value/);
    s.columns[0].emptyAsMissing = true;
    const d = await h.bridge.create(owner, t.id, s);
    assert.equal(d.document.rows[0].values.x, null); assert.match(d.document.rows[0].missingReasons.x, /declared policy/);
    assert.equal(d.document.rows[1].values.source_row, 'source-row-2');
    s.columns[1].type = 'number'; await assert.rejects(() => h.bridge.create(owner, t.id, s), /text metadata/);
    s.columns[1].type = 'text'; s.columns[0].sourceField = 'missing'; await assert.rejects(() => h.bridge.create(owner, t.id, s), /Unknown copied/);
  } finally { h.close(); }
});

test('extraction references require owned execution and exact hashes; generic dataset import cannot forge lineage', async () => {
  const h = setup(); try {
    const s = input(h.execution.hash);
    await assert.rejects(() => h.bridge.create('other', h.execution.id, s), /missing/);
    await assert.rejects(() => h.bridge.create(owner, h.execution.id, { ...s, expectedTrialHash: 'f'.repeat(64) }), /hash changed/);
    await assert.rejects(() => h.bridge.create(owner, h.trial.id, input(h.trial.hash)), /execution of an activated/);
    const d = await h.bridge.create(owner, h.execution.id, s), altered = structuredClone(d.document);
    altered.rows[0].values.x = 7; await assert.rejects(() => h.wb.importDataset(altered, owner, 'test'), /do not reproduce/);
    const forged = structuredClone(d.document); forged.sourceCopy!.candidateId = 'other';
    await assert.rejects(() => h.wb.importDataset(forged, owner, 'test'), /owned, exact extraction/);
    await assert.rejects(() => h.wb.importDataset(d.document, 'other', 'test'), /owned, exact extraction/);
    const badReason = structuredClone(d.document); badReason.rows[3].missingReasons.x = 'Invented reason';
    await assert.rejects(() => h.wb.importDataset(badReason, owner, 'test'), /do not reproduce/);
    const originalPut = h.store.put.bind(h.store);
    h.store.put = async (...args) => { const uri = await originalPut(...args); h.db.prepare('UPDATE extraction_candidates SET owner_principal_id=? WHERE id=?').run('other', h.candidate.id); return uri; };
    await assert.rejects(() => h.bridge.create(owner, h.execution.id, { ...s, name: 'Concurrent owner transfer' }), /owned, exact extraction/);
    assert.equal((await h.wb.listDatasets(owner, true)).length, 1, 'no dataset mutation after ownership changes during blob I/O');
  } finally { h.close(); }
});

test('source-copy publication replays offline without installed dependencies and detects rehashed false source spans', async () => {
  const h = setup(); try {
    const source = await h.bridge.create(owner, h.execution.id, input(h.execution.hash));
    const template=await h.bridge.saveTemplate(owner,source.id,source.contentHash,'Portable mapping fixture');
    const d = await h.bridge.create(owner, h.execution.id, {...input(h.execution.hash),template:{id:template.id,expectedHash:template.hash}});
    const approved = (await h.wb.approveDataset(d.id, owner, d.contentHash, false, 'test'))!;
    const figure = defaultFigure(approved, h.statistics.profile); figure.channels.x = 'x'; figure.channels.y = 'y';
    const method = await h.statistics.prepare(owner, figure, 'pearson', 'test'); h.wb.approveMethod(method.id, owner, method.hash, 'test');
    const result = await h.statistics.execute(owner, method.id, 'test'); figure.analysis = { methodId: method.id, methodHash: method.hash, resultHash: result.hash };
    const verified = await h.wb.requireFigure(figure, owner), exported = researchPackage(approved, figure, h.statistics.profile, verified.result);
    const directory = path.join(h.dir, 'publication'); mkdirSync(directory);
    const entries = readZip(exported.bytes);
    assert.match(entries.find(e => e.name === 'figure.svg')!.content.toString(), /; copied /, 'copy execution date is not remote source retrieval');
    assert.equal(JSON.parse(entries.find(e=>e.name==='dataset.json')!.content.toString()).sourceCopy.mappingTemplate.hash,template.hash);
    for (const entry of entries) { const f = path.join(directory, entry.name); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, entry.content); }
    const run = (hash = exported.manifestHash) => spawnSync(process.execPath, [path.join(directory, 'verify.mjs'), directory, hash], { cwd: directory, encoding: 'utf8', timeout: 10000 });
    const replay = run(); assert.equal(replay.status, 0, replay.stderr); assert.match(replay.stdout, /Matches the independently supplied/);
    assert.equal(entries.find(e => e.name === 'extraction/source.json')!.content.toString(), raw);
    const copied = JSON.parse(entries.find(e => e.name === 'extraction/copied.json')!.content.toString());
    copied.provenance[0].x.startUtf16++;
    const bytes = Buffer.from(canonicalizeJson(copied)), manifest = structuredClone(exported.manifest);
    writeFileSync(path.join(directory, 'extraction/copied.json'), bytes);
    const item = manifest.files.find(f => f.path === 'extraction/copied.json')!; item.bytes = bytes.length; item.sha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(path.join(directory, 'package-manifest.json'), canonicalizeJson(manifest));
    const failed = run(canonicalHash(manifest)); assert.equal(failed.status, 1); assert.match(failed.stderr, /does not replay from source/);
  } finally { h.close(); }
});

test('source-copy API enforces capabilities, origins, stale review and numeric validation status', async () => {
  const h = setup(); let server: ReturnType<express.Express['listen']> | undefined;
  try {
    let actor = owner, roles = ['researcher']; const app = express(); app.use(express.json({ limit: '2mb' }));
    app.use((req, _res, next) => { req.principal = { id: actor, roles, email: null, identityProvenance: 'test' }; next(); });
    app.use('/api/research', buildResearchRouter(h.research, h.paper, h.extract, h.automation, h.worker, h.bridge)); app.use(errorHandler);
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server!.once('listening', r));
    const url = `http://127.0.0.1:${(server.address() as any).port}/api/research/trials/${h.execution.id}/dataset`;
    const metadata = await (await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/research`)).json();
    assert.deepEqual(metadata.datasetProfile, loadExtractionDatasetProfile());
    const { contentHash, ...profileDocument } = metadata.datasetProfile; assert.equal(contentHash, canonicalHash(profileDocument));
    const call = (body = input(h.execution.hash), headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await call(undefined, { Origin: 'https://unrelated.example' })).status, 403);
    actor = 'other'; assert.equal((await call()).status, 409);
    actor = owner; roles = ['responder']; assert.equal((await call()).status, 403);
    roles = ['researcher']; assert.equal((await call({ ...input(h.execution.hash), expectedTrialHash: '0'.repeat(64) })).status, 409);
    const invalid = input(h.execution.hash); invalid.columns[0].sourceField = 'missing'; assert.equal((await call(invalid)).status, 400);
    const response = await call(); assert.equal(response.status, 201); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const record=(await response.json()).record;assert.equal(record.approvalState, 'PROPOSED');
    const base=`http://127.0.0.1:${(server.address() as any).port}/api/research`;
    const save=(headers={})=>fetch(base+'/mapping-templates',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({datasetId:record.id,expectedHash:record.contentHash,name:'API template'})});
    assert.equal((await save({Origin:'https://unrelated.example'})).status,403);
    const saved=await save();assert.equal(saved.status,201);const {template}=await saved.json();
    const templates=()=>fetch(base+`/trials/${h.execution.id}/templates`);
    assert.equal((await (await templates()).json()).templates[0].hash,template.hash);
    actor='other';assert.equal((await templates()).status,409);assert.equal((await save()).status,409);
    actor=owner;roles=['responder'];assert.equal((await save()).status,403);
  } finally { if (server) await new Promise<void>(r => server!.close(() => r())); h.close(); }
});

test('mapping templates reuse settings with new source values, never old observations, citations, evidence or approval',async()=>{
  const h=setup();try{
    const first=input(h.execution.hash);first.evidenceTier='PRIMARY_EMPIRICAL';first.source.url='https://example.org/fictional-old-source';
    const d=await h.bridge.create(owner,h.execution.id,first);
    const t=await h.bridge.saveTemplate(owner,d.id,d.contentHash,'Fictional reusable mapping');
    assert.equal(t.hash,canonicalHash(t.body));assert.equal(t.body.sourceDatasetHash,d.contentHash);
    assert.equal((await h.bridge.saveTemplate(owner,d.id,d.contentHash,t.body.name)).id,t.id);
    for(const key of ['rows','raw','source','evidenceTier','expectedTrialHash','approvalState'])assert.ok(!(key in t.body.mapping));
    const fresh=h.extract.run(owner,h.candidate.id,'{"rows":[{"x":9,"y":18}]}');
    const applied=h.bridge.applyTemplate(owner,fresh.id,t.id,t.hash);
    const settings={...input(fresh.hash),...applied.body.mapping,template:{id:t.id,expectedHash:t.hash}};
    const next=await h.bridge.create(owner,fresh.id,settings);
    assert.equal(next.approvalState,'PROPOSED');assert.equal(next.document.rows[0].values.x,9);assert.equal(next.document.rows[0].evidenceTier,'UNKNOWN');
    assert.notEqual(next.document.source.url,first.source.url);assert.notEqual(next.document.sourceCopy!.rawHash,d.document.sourceCopy!.rawHash);
    assert.deepEqual(next.document.sourceCopy!.mappingTemplate,{id:t.id,hash:t.hash,modified:false});
    settings.columns[0].unit='mg';const modified=await h.bridge.create(owner,fresh.id,settings);
    assert.equal(modified.document.sourceCopy!.mappingTemplate!.modified,true);
    const forged=structuredClone(modified.document);forged.sourceCopy!.mappingTemplate!.modified=false;
    await assert.rejects(()=>h.wb.importDataset(forged,owner,'test'),/modification flag/);
    const renamed=await h.bridge.saveTemplate(owner,d.id,d.contentHash,'Second immutable version');assert.notEqual(renamed.id,t.id);
    assert.equal(h.bridge.templates(owner,fresh.id).length,2);
  }finally{h.close();}
});

test('mapping templates reject foreign/stale/parser-changed references and still enforce source precision',async()=>{
  const h=setup();try{
    const d=await h.bridge.create(owner,h.execution.id,input(h.execution.hash)),t=await h.bridge.saveTemplate(owner,d.id,d.contentHash,'Bound fixture');
    await assert.rejects(()=>h.bridge.saveTemplate('other',d.id,d.contentHash,'Foreign'),/Owned/);
    await assert.rejects(()=>h.bridge.saveTemplate(owner,d.id,'f'.repeat(64),'Stale'),/exact hash/);
    assert.throws(()=>h.bridge.applyTemplate(owner,h.execution.id,t.id,'f'.repeat(64)),/review hash/);
    assert.throws(()=>h.bridge.applyTemplate('other',h.execution.id,t.id,t.hash),/owned execution/);
    assert.throws(()=>h.bridge.templates(owner,h.trial.id),/owned execution/);
    const other=h.research.saveExtractor(owner,plan,{kind:'different-parser-version'});
    h.extract.test(owner,other.id,raw,expected);h.research.approveExtractor(owner,other.id,other.hash);
    const different=h.extract.run(owner,other.id,raw);
    assert.throws(()=>h.bridge.applyTemplate(owner,different.id,t.id,t.hash),/exact parser/);
    const huge=h.extract.run(owner,h.candidate.id,'{"rows":[{"x":1e999,"y":2}]}');
    await assert.rejects(()=>h.bridge.create(owner,huge.id,{...input(huge.hash),...t.body.mapping,template:{id:t.id,expectedHash:t.hash}}),/precision or range/);
    const forged=structuredClone(d.document);forged.sourceCopy!.mappingTemplate={id:t.id,hash:'f'.repeat(64),modified:false};
    await assert.rejects(()=>h.wb.importDataset(forged,owner,'test'),/template lineage/);
    h.db.prepare('UPDATE extraction_candidates SET approved_hash=NULL WHERE id=?').run(h.candidate.id);
    assert.throws(()=>h.bridge.applyTemplate(owner,h.execution.id,t.id,t.hash),/activated parser/);
  }finally{h.close();}
});

test('mapping templates persist across repository restart and supported account transfer without changing hashes',async()=>{
  const h=setup();let reopened:Database.Database|undefined;try{
    const d=await h.bridge.create(owner,h.execution.id,input(h.execution.hash)),t=await h.bridge.saveTemplate(owner,d.id,d.contentHash,'Durable fixture');
    assert.throws(()=>h.db.prepare('UPDATE extraction_mapping_templates SET body_json=? WHERE id=?').run('{}',t.id),/WORM/);
    const filename=path.join(h.dir,'restart.sqlite');await h.db.backup(filename);reopened=new Database(filename);reopened.pragma('foreign_keys=ON');
    const research=new ResearchRepository(reopened);assert.deepEqual(research.mappingTemplate(owner,t.id),t);
    const principals=new PrincipalRepository(reopened);principals.upsertOnSignIn({id:'signed-in',email:null,displayName:null,role:'researcher',identityProvenance:'test',at:new Date().toISOString()});
    const moved=principals.migrateLocalUserRows('signed-in');assert.equal(moved.extraction_mapping_templates,1);
    assert.equal(research.mappingTemplate(owner,t.id),null);assert.equal(research.mappingTemplate('signed-in',t.id)!.hash,t.hash);
    const bridge=new ExtractionDatasetService(research,new WorkbenchRepository(reopened,h.store));
    assert.equal(bridge.applyTemplate('signed-in',h.execution.id,t.id,t.hash).hash,t.hash);
    assert.equal((await bridge.saveTemplate('signed-in',d.id,d.contentHash,t.body.name)).id,t.id,'transfer does not duplicate the immutable profile');
  }finally{reopened?.close();h.close();}
});
