import {Router,type Request,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import {requireCapability} from './auth_routes';
import {sameOriginMutation} from './automation_routes';
import {SourceAccessService} from '../services/source_access';
import {SourceAccessError,AccessDecisionSchema,SourceCandidateSchema,SourceRequestSchema} from '../../../shared/source_access';
import {tracer} from '../utils/tracer';

export function buildSourceAccessRouter(service:SourceAccessService){
  const router=Router(),hash=z.string().regex(/^[a-f0-9]{64}$/);
  router.use(requireCapability('provider.view'),sameOriginMutation);
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  const route=(fn:(req:Request,res:Response)=>unknown)=>(req:Request,res:Response,next:NextFunction)=>{
    Promise.resolve().then(()=>fn(req,res)).catch(e=>e instanceof SourceAccessError?res.status(e.status).json({error:e.code,message:e.message}):next(e));
  };
  router.get('/',route((req,res)=>{
    const overview=service.overview(req.principal!.id);
    tracer.emit('SOURCE_ACCESS_OVERVIEW',{profileHash:overview.profile.contentHash,total:overview.stats.total,implemented:overview.stats.implemented});res.json(overview);
  }));
  router.post('/candidates',requireCapability('run.create'),route((req,res)=>{
    const input=SourceCandidateSchema.parse(req.body);
    res.status(201).json({source:service.repo.addCandidate(req.principal!.id,input,service.profile.limits.customSources)});
  }));
  router.get('/:id/history',route((req,res)=>{
    service.snapshot(req.principal!.id,req.params.id);
    res.json(service.repo.history(req.principal!.id,req.params.id,service.profile.limits.history));
  }));
  router.post('/:id/assessments',requireCapability('run.create'),route((req,res)=>{
    const b=z.object({sourceHash:hash,previousId:z.string().uuid().nullable(),decision:AccessDecisionSchema}).strict().parse(req.body);
    res.status(201).json({assessment:service.repo.decide(req.principal!.id,service.snapshot(req.principal!.id,req.params.id),b.sourceHash,b.previousId,b.decision)});
  }));
  router.post('/:id/drafts',requireCapability('run.create'),route((req,res)=>{
    const b=z.object({sourceHash:hash,request:SourceRequestSchema}).strict().parse(req.body);
    res.status(201).json({draft:service.draft(req.principal!.id,req.params.id,b.sourceHash,b.request)});
  }));
  return router;
}
