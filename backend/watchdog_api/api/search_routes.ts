import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { can } from '../../../shared/authorization';
import { SEARCH_CAPABILITIES, searchQuerySchema } from '../../../shared/search';
import { SearchRepository } from '../db/repositories/search';
import { SearchService } from '../services/search';
import { loadSearchProfile } from '../config/search';

export function buildSearchRouter(repository: SearchRepository, profile = loadSearchProfile()) {
  const router = Router(), service = new SearchService(repository, profile);
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!req.principal) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    if (!SEARCH_CAPABILITIES.some(capability => can(req.principal!.roles, capability))) return res.status(403).json({ error: 'FORBIDDEN' });
    next();
  });
  router.get('/', async (req, res, next) => {
    try {
      const query = searchQuerySchema(profile).parse(req.query);
      if (query.kind !== 'all' && !repository.availableKinds(req.principal!).includes(query.kind)) return res.status(403).json({ error: 'FORBIDDEN' });
      res.json(await service.search(req.principal!, query));
    } catch (error) { next(error); }
  });
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid search query or pagination.' });
    next(error);
  });
  return router;
}
