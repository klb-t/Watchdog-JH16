import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireCapability } from './auth_routes';
import { AutomationError, AutomationRepository } from '../db/repositories/automation';
import { AutomationService } from '../services/automation';
import { JobRequestSchema, ScheduleSchema } from '../../../shared/automation';
import { can } from '../../../shared/authorization';
import { SourceHistoryError } from '../../../shared/source_history';
import { loadSourceHistoryProfile } from '../config/source_history';
import { tracer } from '../utils/tracer';
import { loadCollectionProfile } from '../config/collection';
import { loadSourceWatchProfile } from '../config/source_watch';
const route = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve().then(() => fn(req, res)).catch(error => error instanceof AutomationError || error instanceof SourceHistoryError ? res.status(error.status).json({ error: error.code, message: error.message }) : next(error));
};
/** Also used by the writable key surface; cross-site callers cannot mutate local-mode state. */
export function sameOriginMutation(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin, fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite === 'cross-site' || (origin && (() => { try { return new URL(origin).host !== req.headers.host; } catch { return true; } })()))
    return res.status(403).json({ error: 'CROSS_ORIGIN_MUTATION' });
  if (!req.is('application/json')) return res.status(415).json({ error: 'JSON_REQUIRED' });
  next();
}
export function buildAutomationRouter(repo: AutomationRepository, service: AutomationService) {
  const router = Router(); router.use(requireCapability('run.create')); router.use(sameOriginMutation);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/profile', (_req, res) => res.json(service.profile));
  router.get('/collection-profile', (_req,res) => res.json({profile:loadCollectionProfile()}));
  router.get('/status', (_req, res) => res.json(service.state));
  router.get('/jobs', (req, res) => res.json({ jobs: repo.jobs(req.principal!.id) }));
  router.post('/jobs', route((req, res) => {
    const body = z.object({ request: JobRequestSchema, consent: z.literal(true), profileHash: z.string() }).strict().parse(req.body);
    if (body.profileHash !== service.profile.contentHash) throw new AutomationError('Source profile changed; reload the displayed plan');
    if (body.request.kind === 'catalog_refresh' && !service.handlers.has(body.request.kind)) throw new AutomationError('Catalog refresh is not configured');
    if (body.request.kind === 'substance_refresh' && !can(req.principal!.roles, 'evidence.import')) return res.status(403).json({ error: 'FORBIDDEN' });
    if (body.request.kind === 'paper_review' && !can(req.principal!.roles, 'method.propose')) return res.status(403).json({ error: 'FORBIDDEN' });
    const job = repo.enqueue(req.principal!.id, body.request, body.profileHash);
    res.status(202).json({ job }); void service.tick();
  }));
  router.get('/jobs/:id', route((req, res) => {
    const job = repo.job(req.params.id, req.principal!.id); if (!job) throw new AutomationError('Job not found', 404);
    res.json({ job, receipts: repo.receipts(job.id, req.principal!.id) });
  }));
  router.post('/jobs/:id/cancel', route((req, res) => { z.object({}).strict().parse(req.body); res.json({ job: repo.cancel(req.params.id, req.principal!.id) }); }));
  router.get('/schedules', (req, res) => res.json({ schedules: repo.schedules(req.principal!.id) }));
  const scheduleBody = z.object({ schedule: ScheduleSchema, consent: z.literal(true), profileHash: z.string(), expectedHash: z.string().optional() }).strict();
  const save = (edit: boolean) => route((req, res) => {
    const body = scheduleBody.parse(req.body); if (body.profileHash !== service.profile.contentHash) throw new AutomationError('Source profile changed');
    if (body.schedule.request.kind === 'substance_refresh' && !can(req.principal!.roles, 'evidence.import')) return res.status(403).json({ error: 'FORBIDDEN' });
    if (body.schedule.request.kind === 'paper_review' && !can(req.principal!.roles, 'method.propose')) return res.status(403).json({ error: 'FORBIDDEN' });
    res.status(edit ? 200 : 201).json({ schedule: repo.saveSchedule(req.principal!.id, body.schedule, body.profileHash, new Date(), edit ? req.params.id : undefined, body.expectedHash) });
  });
  router.post('/schedules', save(false)); router.post('/schedules/:id', save(true));
  router.get('/papers', (req, res) => res.json({ papers: repo.papers(req.principal!.id) }));
  return router;
}
export function buildMemoryRouter(repo: AutomationRepository) {
  const router = Router();
  const historyProfile = loadSourceHistoryProfile();
  const watchProfile = loadSourceWatchProfile();
  const sequence = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
  router.use((req, res, next) => {
    if (!req.principal) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    if (!can(req.principal.roles, 'responder.lookup') && !can(req.principal.roles, 'evidence.review')) return res.status(403).json({ error: 'FORBIDDEN' });
    res.setHeader('Cache-Control', 'no-store'); next();
  });
  router.use(sameOriginMutation);
  router.get('/watches/profile',(_req,res)=>res.json({profile:watchProfile,collectionProfile:loadCollectionProfile()}));
  router.get('/watches',route((req,res)=>res.json({watches:repo.watches.summaries(req.principal!.id)})));
  router.post('/watches',route((req,res)=>{
    const b=z.object({substanceId:z.string().min(1).max(160),anchor:sequence,contextHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);
    res.status(201).json({watch:repo.watches.subscribe(req.principal!.id,b.substanceId,b.anchor,b.contextHash,watchProfile.limits.watches)});
  }));
  router.get('/watches/:id',route((req,res)=>{
    const batch=repo.watches.batch(req.principal!.id,req.params.id,watchProfile.limits.changes);
    tracer.emit('SOURCE_WATCH_CHANGE_BATCH',{watchId:batch.watch.id,contextHash:batch.watch.contextHash,
      through:batch.through,changes:batch.entries.length,hasMore:batch.hasMore});
    res.json(batch);
  }));
  router.post('/watches/:id/read',route((req,res)=>{
    const b=z.object({revision:sequence,through:sequence}).strict().parse(req.body);
    res.json({watch:repo.watches.update(req.principal!.id,req.params.id,b)});
  }));
  router.post('/watches/:id/enabled',route((req,res)=>{
    const b=z.object({revision:sequence,enabled:z.boolean()}).strict().parse(req.body);
    res.json({watch:repo.watches.update(req.principal!.id,req.params.id,b)});
  }));
  router.get('/substances', (req, res) => res.json({ substances: repo.substanceList(String(req.query.q ?? '').slice(0, 160)) }));
  router.get('/history/profile', (_req,res) => res.json({ profile: historyProfile, collectionProfile:loadCollectionProfile() }));
  router.get('/substances/:id/history', route((req,res) => {
    const q = z.object({ offset: z.coerce.number().int().min(0).max(1000000).optional() }).strict().parse(req.query);
    res.json(repo.history.groups(req.params.id,historyProfile.limits.groups,q.offset));
  }));
  router.get('/substances/:id/history/:anchor', route((req,res) => {
    const q = z.object({ before: sequence.optional() }).strict().parse(req.query);
    res.json(repo.history.page(req.params.id,sequence.parse(req.params.anchor),historyProfile.limits.observations,q.before));
  }));
  router.get('/substances/:id/compare', route((req,res) => {
    const q = z.object({ from: sequence, to: sequence, context: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.query);
    const comparison = repo.history.compare(req.params.id,q.from,q.to,q.context,historyProfile);
    tracer.emit('MEMORY_SOURCE_COMPARISON', { contextHash: comparison.body.contextHash, comparisonHash: comparison.contentHash,
      from: q.from, to: q.to, equal: comparison.body.equal, truncated: comparison.body.difference.truncated });
    res.setHeader('X-Content-SHA256',comparison.contentHash); res.json(comparison);
  }));
  router.get('/substances/:id', route((req, res) => {
    const substance = repo.substance(req.params.id); if (!substance) throw new AutomationError('Substance not found', 404);
    res.json({ substance });
  }));
  router.get('/receipts/:id/raw', route(async (req, res) => {
    res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Disposition', 'attachment; filename="source-response.txt"');
    res.send(await repo.raw(req.params.id));
  }));
  return router;
}
