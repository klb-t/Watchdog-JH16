import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireCapability } from './auth_routes';
import { sameOriginMutation } from './automation_routes';
import { ProjectResourceKindSchema } from '../../../shared/research_projects';
import { ResearchProjectsService } from '../services/research_projects';
import { ResearchProjectError } from '../db/repositories/research_projects';
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Pagination = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
const route = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve().then(() => fn(req, res)).catch(error => error instanceof ResearchProjectError
    ? res.status(error.status).json({ error: error.code, message: error.message }) : next(error));
};
export function buildResearchProjectsRouter(service: ResearchProjectsService) {
  const router = Router(); router.use(requireCapability('method.propose')); router.use(sameOriginMutation);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/', route((req, res) => { const page = Pagination.parse(req.query); res.json({ profile: service.profile, ...service.repo.list(req.principal!.id, page.limit, page.offset) }); }));
  router.get('/resources', route((req, res) => { const { kind, limit, offset } = Pagination.extend({ kind: ProjectResourceKindSchema }).parse(req.query);
    res.json(service.repo.resources(req.principal!.id, kind, limit, offset)); }));
  router.get('/resources/:kind/:id', route((req, res) => {
    const kind = ProjectResourceKindSchema.parse(req.params.kind), resource = service.repo.resource(req.principal!.id, kind, req.params.id);
    if (!resource) throw new ResearchProjectError('Owned resource not found', 404);
    if (req.query.expectedHash !== undefined && Hash.parse(req.query.expectedHash) !== resource.summary.hash)
      throw new ResearchProjectError('The resource no longer matches the pinned hash; inspect the saved project snapshot instead');
    res.json({ resource: { ...resource.summary, snapshot: resource.snapshot,
      files: resource.files.map(({ uri: _uri, ...file }) => file) } });
  }));
  router.post('/', route(async (req, res) => res.status(201).json({ revision: await service.save(req.principal!.id, req.body) })));
  router.get('/:id', route((req, res) => { const hash = req.query.revision === undefined ? undefined : Hash.parse(req.query.revision);
    res.json(service.get(req.principal!.id, req.params.id, hash)); }));
  router.get('/:id/history', route((req, res) => res.json({ revisions: service.repo.history(req.principal!.id, req.params.id)
    .map(r => ({ id: r.id, hash: r.hash, createdAt: r.createdAt, revision: r.body.revision, state: r.body.state, name: r.body.name, previousRevisionHash: r.body.previousRevisionHash })) })));
  router.post('/:id/revisions', route(async (req, res) => { const body = z.object({ expectedHash: Hash, draft: z.unknown() }).strict().parse(req.body);
    res.status(201).json({ revision: await service.save(req.principal!.id, body.draft, req.params.id, body.expectedHash) }); }));
  router.get('/:id/export', route(async (req, res) => { const hash = Hash.parse(req.query.revision), archive = await service.export(req.principal!.id, req.params.id, hash);
    res.setHeader('X-Package-SHA256', archive.sha256); res.setHeader('X-Package-Manifest-SHA256', archive.manifestHash);
    res.attachment(`watchdog-project-${req.params.id}.zip`).type('application/zip').send(archive.bytes); }));
  return router;
}
