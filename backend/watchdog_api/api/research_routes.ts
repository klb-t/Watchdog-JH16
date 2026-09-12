import { randomUUID } from 'node:crypto';
import { tracer } from '../utils/tracer';
import { PaperOperationService, loadPaperOperationProfile } from '../services/paper_operations';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireCapability } from './auth_routes';
import { sameOriginMutation } from './automation_routes';
import { AutomationError, AutomationRepository } from '../db/repositories/automation';
import { AutomationService } from '../services/automation';
import { ResearchRepository } from '../db/repositories/research';
import { PaperIntakeService } from '../services/paper_intake';
import { ExtractionWorkshop } from '../services/extraction_workshop';
import { CopyPlanSchema, SubstitutionSchema } from '../../../shared/research';
import { copySource } from '../sources/copy_plan';
import { ExtractionDatasetService } from '../services/extraction_dataset';
import { WorkbenchError } from '../db/repositories/workbench';
import { loadExtractionDatasetProfile } from '../config/extraction_dataset';
const route = (fn: (req: Request,res: Response) => unknown) => (req: Request,res: Response,next: NextFunction) => {
  Promise.resolve().then(() => fn(req,res)).catch(e => e instanceof AutomationError || e instanceof WorkbenchError ? res.status(e.status).json({ error: e.code, message: e.message }) : next(e));
};
export function buildResearchRouter(repo: ResearchRepository, paper: PaperIntakeService, extraction: ExtractionWorkshop, automation: AutomationRepository, worker: AutomationService, datasets?:ExtractionDatasetService, operations?:PaperOperationService) {
  const router = Router(); router.use(requireCapability('method.propose')); router.use(sameOriginMutation);
  router.use((_req,res,next) => { res.setHeader('Cache-Control','no-store'); next(); });
  router.get('/', route((req,res) => res.json({ datasetProfile: loadExtractionDatasetProfile(), documents: repo.documents(req.principal!.id).map(d=>({ ...d, body:{...d.body,text:undefined}, characterCount:d.body.text.length })), assessments: repo.assessments(req.principal!.id),
    substitutions: repo.substitutions(req.principal!.id), extractors: repo.extractors(req.principal!.id), jobs:automation.jobs(req.principal!.id).filter(j=>j.request.kind==='paper_review') })));
  const op = () => { if (!operations) throw new WorkbenchError('Paper operations are not configured.', 503); return operations; };
  router.get('/operations', route((req,res) => res.json({profile:loadPaperOperationProfile(),operations:op().list(req.principal!.id)})));
  router.get('/operations/:id', route((req,res) => res.json({operation:op().get(req.principal!.id,req.params.id)})));
  router.post('/operations',requireCapability('workbench.analyze'),route(async(req,res)=>res.status(201).json({operation:await op().prepare(req.principal!.id,req.body,tracer.getContext()?.request_id??randomUUID())})));
  router.post('/operations/:id/approve',requireCapability('method.approve'),route(async(req,res)=>{
    const b=z.object({expectedHash:z.string(),methodHash:z.string()}).strict().parse(req.body);
    res.json({operation:await op().approve(req.principal!.id,req.params.id,b.expectedHash,b.methodHash,tracer.getContext()?.request_id??randomUUID())});
  }));
  router.post('/operations/:id/execute',requireCapability('workbench.analyze'),route(async(req,res)=>{
    const b=z.object({expectedHash:z.string()}).strict().parse(req.body);
    res.json({result:await op().execute(req.principal!.id,req.params.id,b.expectedHash,tracer.getContext()?.request_id??randomUUID())});
  }));
  router.get('/operations/:id/runs/:runId',route(async(req,res)=>res.json(await op().result(req.principal!.id,req.params.id,req.params.runId))));
  router.get('/operations/:id/runs/:runId/export',route(async(req,res)=>{
    const bundle=await op().export(req.principal!.id,req.params.id,req.params.runId);
    res.setHeader('X-Package-Manifest-SHA256',bundle.manifestHash);res.setHeader('X-Package-SHA256',bundle.sha256);
    res.attachment('watchdog-paper-analysis.zip').type('application/zip').send(bundle.bytes);
  }));
  router.post('/papers', route((req,res) => res.status(201).json({ document: repo.saveDocument(req.principal!.id,req.body) })));
  router.get('/papers/:id', route((req,res) => { const document=repo.document(req.principal!.id,req.params.id);if(!document)throw new AutomationError('Document not found',404);res.json({document}); }));
  router.post('/papers/discovery', route((req,res) => { const b = z.object({ id: z.string() }).strict().parse(req.body); res.status(201).json({ document: paper.intakeDiscovery(req.principal!.id,b.id) }); }));
  router.post('/papers/:id/assess', requireCapability('run.create'), route((req,res) => {
    const b=z.object({ consent: z.literal(true),retryFailed:z.boolean().optional() }).strict().parse(req.body); const id = req.params.id;
    if (!repo.document(req.principal!.id,id)) throw new AutomationError('Document not found',404);
    const job = automation.enqueue(req.principal!.id,{ kind:'paper_review', documentId:id, includeDiscoveredAbstracts:false, maxRequests:1, retryFailed:b.retryFailed??false },worker.profile.contentHash);
    res.status(202).json({ job }); void worker.tick();
  }));
  router.post('/substitutions', route((req,res) => res.status(201).json({ substitution: repo.substitution(req.principal!.id,SubstitutionSchema.parse(req.body)) })));
  router.post('/extractors', route((req,res) => res.status(201).json({ extractor: repo.saveExtractor(req.principal!.id,CopyPlanSchema.parse(req.body),{ kind:'manual_profile',actor:req.principal!.id }) })));
  router.get('/extractors/:id/trials',route((req,res)=>res.json({trials:repo.trials(req.principal!.id,req.params.id)})));
  router.get('/trials/:id',route((req,res)=>{const trial=repo.trial(req.principal!.id,req.params.id);if(!trial)throw new AutomationError('Trial not found',404);res.json({trial});}));
  router.post('/trials/:id/dataset',requireCapability('dataset.import'),route(async(req,res)=>{
    if(!datasets)throw new AutomationError('Dataset handoff is not configured');
    res.status(201).json({record:await datasets.create(req.principal!.id,req.params.id,req.body)});
  }));
  router.get('/trials/:id/templates',route((req,res)=>{
    if(!datasets)throw new AutomationError('Dataset handoff is not configured');res.json({templates:datasets.templates(req.principal!.id,req.params.id)});
  }));
  router.post('/trials/:id/template',requireCapability('dataset.import'),route((req,res)=>{
    const b=z.object({id:z.string().min(1),expectedHash:z.string()}).strict().parse(req.body);
    if(!datasets)throw new AutomationError('Dataset handoff is not configured');res.json({template:datasets.applyTemplate(req.principal!.id,req.params.id,b.id,b.expectedHash)});
  }));
  router.post('/mapping-templates',requireCapability('dataset.import'),route(async(req,res)=>{
    const b=z.object({datasetId:z.string().min(1),expectedHash:z.string(),name:z.string().trim().min(1).max(100)}).strict().parse(req.body);
    if(!datasets)throw new AutomationError('Dataset handoff is not configured');res.status(201).json({template:await datasets.saveTemplate(req.principal!.id,b.datasetId,b.expectedHash,b.name)});
  }));
  router.post('/extractors/propose', route(async (req,res) => {
    const b = z.object({ raw: z.string().max(2000000),format:z.enum(['json','csv']),goal:z.string().trim().min(1).max(2000),consent:z.literal(true) }).strict().parse(req.body);
    res.status(201).json({ extractor: await extraction.propose(req.principal!.id,b.raw,b.format,b.goal) });
  }));
  router.post('/extractors/:id/test', route((req,res) => {
    const b=z.object({raw:z.string().max(2000000),expected:z.array(z.record(z.string(),z.string().nullable())).max(10000)}).strict().parse(req.body);
    res.json({ trial:extraction.test(req.principal!.id,req.params.id,b.raw,b.expected) });
  }));
  router.post('/extractors/:id/approve',requireCapability('dataset.approve'),route((req,res) => {
    const b=z.object({expectedHash:z.string()}).strict().parse(req.body);res.json({extractor:repo.approveExtractor(req.principal!.id,req.params.id,b.expectedHash)});
  }));
  router.post('/extractors/:id/run',requireCapability('dataset.import'),route((req,res) => {
    const b=z.object({raw:z.string().max(2000000)}).strict().parse(req.body);res.json({trial:extraction.run(req.principal!.id,req.params.id,b.raw)});
  }));
  router.post('/extractors/preview', route((req,res) => { const b = z.object({raw:z.string().max(2000000),plan:CopyPlanSchema}).strict().parse(req.body);res.json(copySource(b.raw,b.plan)); }));
  return router;
}
