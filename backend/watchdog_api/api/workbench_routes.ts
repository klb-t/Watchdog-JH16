import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { can } from '../../../shared/authorization';
import { FigureSchema, validateDataset, csvExport, filterRows } from '../../../shared/workbench';
import { requireCapability } from './auth_routes';
import { WorkbenchRepository, WorkbenchError } from '../db/repositories/workbench';
import { WorkbenchService } from '../workbench/service';
import { checkProviderProfile, checkFigureProfile } from '../config/workbench';
import { tracer } from '../utils/tracer';
const requestId = () => tracer.getContext()?.request_id ?? randomUUID();
const boundary = (operation: string, fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  void tracer.runWithSpan('workbench', operation, () => fn(req, res), { actor_id: req.principal?.id, request_id: requestId() }).catch(next);
};
const approval = z.object({ expectedHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export function buildWorkbenchRouter(repo: WorkbenchRepository, service: WorkbenchService) {
  const router = Router(); router.use(requireCapability('workbench.view'));
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/profile', boundary('profile', (_req, res) => res.json(service.profile)));
  router.get('/datasets', boundary('datasets', async (req, res) => res.json({ records: await repo.listDatasets(req.principal!.id, can(req.principal!.roles, 'dataset.review')) })));
  router.post('/datasets', requireCapability('dataset.import'), boundary('dataset_import', async (req, res) => {
    const document = validateDataset(req.body); checkProviderProfile(document, service.profile);
    const record = await repo.importDataset(document, req.principal!.id, requestId());
    tracer.result({ datasetId: record.id, hash: record.contentHash, rowCount: document.rows.length }); res.status(201).json({ record });
  }));
  router.post('/datasets/:id/approve', requireCapability('dataset.approve'), boundary('dataset_approve', async (req, res) => {
    const body = approval.extend({ shareAggregate: z.boolean() }).parse(req.body);
    res.json({ record: await repo.approveDataset(req.params.id, req.principal!.id, body.expectedHash, body.shareAggregate, requestId()) });
  }));
  router.post('/datasets/:id/revoke', requireCapability('dataset.approve'), boundary('dataset_revoke', async (req, res) => {
    await repo.revokeDataset(req.params.id, req.principal!.id, requestId()); res.json({ revoked: true });
  }));
  router.get('/figures', boundary('figures', (req, res) => res.json({ figures: repo.figures(req.principal!.id) })));
  router.post('/figures', requireCapability('figure.manage'), boundary('figure_save', async (req, res) => {
    const { spec, favorite } = z.object({ spec: FigureSchema, favorite: z.boolean() }).strict().parse(req.body);
    checkFigureProfile(spec, service.profile); res.status(201).json({ figure: await repo.saveFigure(req.principal!.id, spec, favorite, requestId()) });
  }));
  router.post('/export', boundary('figure_export', async (req, res) => {
    const { figure, format } = z.object({ figure: FigureSchema, format: z.enum(['csv', 'json', 'svg', 'analysis']) }).strict().parse(req.body);
    checkFigureProfile(figure, service.profile); const { record, spec, result } = await repo.requireFigure(figure, req.principal!.id);
    if (format === 'svg' && spec.channels.facet && new Set(filterRows(record.document, spec).map(r => r.values[spec.channels.facet!])).size > 12) throw new WorkbenchError('SVG export supports up to 12 panels. Narrow the facet filter, or export the complete JSON/CSV.');
    if (format === 'analysis' && !result) throw new WorkbenchError('The figure has no verified analysis result.', 409);
    repo.audit(req.principal!.id, 'figure.export', record.id, requestId(), { datasetHash: record.contentHash, format });
    if (format === 'csv') res.type('text/csv').send(csvExport(record, spec));
    else if (format === 'analysis') res.json(result);
    else res.json({ figure: spec, dataset: record, profile: service.profile, analysis: result });
  }));
  router.post('/methods', requireCapability('workbench.analyze'), boundary('method_prepare', async (req, res) => {
    const { figure, method } = z.object({ figure: FigureSchema, method: z.string() }).strict().parse(req.body);
    res.status(201).json({ method: await service.prepare(req.principal!.id, figure, method, requestId()) });
  }));
  router.post('/methods/:id/approve', requireCapability('method.approve'), boundary('method_approve', async (req, res) => {
    const body = approval.parse(req.body), method = repo.method(req.params.id);
    if (!method || !await repo.getDataset(method.datasetId, req.principal!.id)) throw new WorkbenchError('Dataset access is required.', 403);
    res.json({ method: repo.approveMethod(method.id, req.principal!.id, body.expectedHash, requestId()) });
  }));
  router.post('/methods/:id/execute', requireCapability('workbench.analyze'), boundary('method_execute', async (req, res) => {
    res.json(await service.execute(req.principal!.id, req.params.id, requestId()));
  }));
  router.use((error: any, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof WorkbenchError) return res.status(error.status).json({ error: error.code, message: error.message });
    next(error);
  });
  return router;
}
