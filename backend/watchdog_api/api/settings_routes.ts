import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { sameOriginMutation } from './automation_routes';
import { requireCapability } from './auth_routes';
import { SettingsRepository } from '../db/repositories/settings';
import { AutomationError } from '../db/repositories/automation';
import { AssistantService } from '../services/assistant';
import { UserVault } from '../secrets/user_vault';
import { ResearchPlans } from '../services/research_plans';
import { AssistantTaskSchema, SettingsSchema, ModelCeilingSchema, BenchmarkSchema } from '../../../shared/settings';
import { can } from '../../../shared/authorization';
import { redact, registerSecretValue } from '../utils/redaction';

const route = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve().then(() => fn(req, res)).catch(e => e instanceof AutomationError ? res.status(e.status).json(redact({ error: e.code, message: e.message })) : next(e));
};
export function buildSettingsRouter(repo: SettingsRepository, service: AssistantService, vault: UserVault, plans: ResearchPlans) {
  const router = Router(); router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); if (!req.principal) return res.status(401).json({ error: 'UNAUTHENTICATED' }); next();
  }); router.use(sameOriginMutation);
  router.get('/', route((req, res) => res.json({ settings: repo.get(req.principal!.id, service.profile.defaults), profile: service.profile,
    providers: service.providers,
    credentials: can(req.principal!.roles, 'provider.view') ? [...service.providers.providers.map(p => p.id), 'serpapi'].map(p => vault.status(req.principal!.id, p)) : [],
    modelCeilings: repo.ceilings(req.principal!.id, service.provider(req.principal!.id).id),
    budget: repo.budget(req.principal!.id), routes: service.preview(req.principal!.id), catalog: service.catalog(req.principal!.id) })));
  router.post('/', route((req, res) => {
    const body = z.object({ value: SettingsSchema, expectedHash: z.string() }).strict().parse(req.body);
    if ([body.value.assistant.provider, ...Object.values(body.value.assistant.taskProviders ?? {})].some(id => !service.providers.providers.some(p => p.id === id))) throw new AutomationError('Unknown provider profile');
    res.json({ settings: repo.save(req.principal!.id, body.value, body.expectedHash, service.profile.defaults) });
  }));
  router.post('/credentials', requireCapability('provider.view'), route((req, res) => {
    if (typeof req.body?.apiKey === 'string') registerSecretValue(req.body.apiKey);
    const body = z.object({ provider: z.string(), apiKey: z.string(), consent: z.literal(true) }).strict().parse(req.body);
    if (body.provider !== 'serpapi' && !service.providers.providers.some(p => p.id === body.provider)) throw new AutomationError('Unknown provider profile');
    res.json(vault.save(req.principal!.id, body.provider, body.apiKey));
  }));
  router.post('/credentials/remove', requireCapability('provider.view'), route((req, res) => {
    const { provider } = z.object({ provider: z.string().max(40) }).strict().parse(req.body); res.json(vault.remove(req.principal!.id, provider));
  }));
  router.post('/catalog/refresh', requireCapability('provider.view'), route(async (req, res) => {
    const b = z.object({ consent: z.literal(true), provider: z.string().optional() }).strict().parse(req.body); res.json({ catalog: await service.refreshCatalog(req.principal!.id, b.provider) });
  }));
  router.post('/assistant', requireCapability('method.propose'), route(async (req, res) => {
    const body = z.object({ task: AssistantTaskSchema, prompt: z.string().trim().min(1).max(16000), consent: z.literal(true) }).strict().parse(req.body);
    res.json({ proposal: await service.propose(req.principal!.id, body.task, body.prompt) });
  }));
  router.post('/model-ceilings', requireCapability('provider.view'), route(async (req, res) => {
    const b = z.object({ profile: ModelCeilingSchema, consent: z.literal(true) }).strict().parse(req.body);
    if (!service.providers.providers.some(p => p.id === b.profile.provider) || b.profile.provider === 'openrouter') throw new AutomationError('Choose a direct provider; OpenRouter uses its own live price catalog');
    const profile = repo.saveModelCeiling(req.principal!.id, b.profile); await service.buildPersonalCatalog(req.principal!.id, b.profile.provider); res.status(201).json({ profile });
  }));
  router.post('/benchmarks', requireCapability('provider.view'), route((req, res) => {
    const b = z.object({ benchmark: BenchmarkSchema, reviewed: z.literal(true) }).strict().parse(req.body);
    if (!service.providers.providers.some(p => p.id === b.benchmark.provider)) throw new AutomationError('Unknown provider');
    res.status(201).json(repo.saveBenchmark(req.principal!.id, b.benchmark));
  }));
  router.get('/generations', requireCapability('method.propose'), (req, res) => res.json({ generations: repo.generations(req.principal!.id) }));
  router.get('/plans', requireCapability('run.create'), (req, res) => res.json({ plans: repo.plans(req.principal!.id) }));
  router.post('/plans', requireCapability('run.create'), route((req, res) => res.status(201).json({ plan: plans.prepare(req.principal!.id, req.body) })));
  router.post('/plans/:id/launch', requireCapability('run.create'), route((req, res) => {
    const b = z.object({ expectedHash: z.string(), approvedMethodHash: z.string().nullable(), consent: z.literal(true) }).strict().parse(req.body);
    const p = repo.plan(req.principal!.id, req.params.id); if (!p) throw new AutomationError('Plan not found', 404);
    if (p.body.baseline && !can(req.principal!.roles, 'method.approve') || p.body.jobs.some((j: any) => j.kind === 'substance_refresh') && !can(req.principal!.roles, 'evidence.import')) return res.status(403).json({ error: 'FORBIDDEN' });
    res.json({ launch: plans.launch(req.principal!.id, req.params.id, b.expectedHash, b.approvedMethodHash) });
  }));
  return router;
}
