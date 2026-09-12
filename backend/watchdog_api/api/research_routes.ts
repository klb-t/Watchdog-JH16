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
export function buildResearchRouter(repo: ResearchRepository, paper: PaperIntakeService, extraction: ExtractionWorkshop, automation: AutomationRepository, worker: AutomationService, datasets?:ExtractionDatasetService) {
  const router = Router(); router.use(requireCapability('method.propose')); router.use(sameOriginMutation);
  router.use((_req,res,next) => { res.setHeader('Cache-Control','no-store'); next(); });
  router.get('/', route((req,res) => res.json({ datasetProfile: loadExtractionDatasetProfile(), documents: repo.documents(req.principal!.id).map(d=>({ ...d, body:{...d.body,text:undefined}, characterCount:d.body.text.length })), assessments: repo.assessments(req.principal!.id),
    substitutions: repo.substitutions(req.principal!.id), extractors: repo.extractors(req.principal!.id), jobs:automation.jobs(req.principal!.id).filter(j=>j.request.kind==='paper_review') })));
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
