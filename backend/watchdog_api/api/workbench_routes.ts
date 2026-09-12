import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { can } from '../../../shared/authorization';
import { FigureSchema, validateDataset, csvExport } from '../../../shared/workbench';
import { requireCapability } from './auth_routes';
import { WorkbenchRepository, WorkbenchError } from '../db/repositories/workbench';
import { WorkbenchService } from '../workbench/service';
import { checkProviderProfile, checkFigureProfile, validateWorkbenchProfile } from '../config/workbench';
import { bundledWorldLayer } from '../config/geography';
import { publicationSvg, researchPackage } from '../workbench/publication';
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
  router.get('/profiles/:hash', boundary('profile_restore', (req, res) => {
    const hash = z.string().regex(/^[a-f0-9]{64}$/).parse(req.params.hash), profile = repo.getProfile(hash);
    if (!profile) throw new WorkbenchError('Archived visualization profile not found.', 404);
    res.json(profile);
  }));
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
  router.get('/geometry-layers', boundary('geometry_list', async (req, res) => res.json({ records: await repo.geography.list(req.principal!.id, can(req.principal!.roles, 'dataset.review')) })));
  router.get('/geometry-catalog/world', requireCapability('dataset.import'), boundary('geometry_catalog', (_req, res) => res.json({ document: bundledWorldLayer() })));
  router.post('/geometry-layers', requireCapability('dataset.import'), boundary('geometry_import', async (req, res) => {
    const record = await repo.geography.import(req.body, req.principal!.id, requestId());
    tracer.result({ geometryId: record.id, hash: record.contentHash, featureCount: record.document.features.length });
    res.status(201).json({ record });
  }));
  router.post('/geometry-layers/:id/approve', requireCapability('dataset.approve'), boundary('geometry_approve', async (req, res) => {
    const body = approval.extend({ shareAggregate: z.boolean() }).parse(req.body);
    res.json({ record: await repo.geography.approve(req.params.id, req.principal!.id, body.expectedHash, body.shareAggregate, requestId()) });
  }));
  router.post('/geometry-layers/:id/revoke', requireCapability('dataset.approve'), boundary('geometry_revoke', async (req, res) => {
    await repo.geography.revoke(req.params.id, req.principal!.id, requestId()); res.json({ revoked: true });
  }));
  router.get('/figures', boundary('figures', (req, res) => res.json({ figures: repo.figures(req.principal!.id) })));
  router.post('/figures', requireCapability('figure.manage'), boundary('figure_save', async (req, res) => {
    const { spec, favorite } = z.object({ spec: FigureSchema, favorite: z.boolean() }).strict().parse(req.body);
    service.profileForFigure(spec); res.status(201).json({ figure: await repo.saveFigure(req.principal!.id, spec, favorite, requestId()) });
  }));
  router.post('/figures/restore', requireCapability('figure.manage'), boundary('figure_restore', async (req, res) => {
    const body = z.object({ figure: FigureSchema, profile: z.unknown() }).strict().parse(req.body);
    const profile = validateWorkbenchProfile(body.profile); checkFigureProfile(body.figure, profile);
    // Uploaded receipts or results never grant access or approve a dataset.
    const verified = await repo.requireFigure(body.figure, req.principal!.id);
    repo.archiveProfile(profile);
    repo.audit(req.principal!.id, 'figure.restore', verified.record.id, requestId(), { profileHash: profile.contentHash, datasetHash: verified.record.contentHash });
    res.json({ figure: verified.spec, profile, dataset: verified.record, geometry: verified.geometry });
  }));
  router.post('/export', boundary('figure_export', async (req, res) => {
    const { figure, format } = z.object({ figure: FigureSchema, format: z.enum(['csv', 'json', 'svg', 'analysis', 'zip']) }).strict().parse(req.body);
    const profile = service.profileForFigure(figure), { record, spec, result, geometry } = await repo.requireFigure(figure, req.principal!.id);
    if (format === 'analysis' && !result) throw new WorkbenchError('The figure has no verified analysis result.', 409);
    if (format === 'zip') {
      const bundle = researchPackage(record, spec, profile, result, geometry);
      repo.audit(req.principal!.id, 'figure.export', record.id, requestId(), { datasetHash: record.contentHash, format, manifestHash: bundle.manifestHash, archiveHash: bundle.sha256 });
      tracer.result({ format, manifestHash: bundle.manifestHash, bytes: bundle.bytes.length });
      res.setHeader('X-Package-Manifest-SHA256', bundle.manifestHash); res.setHeader('X-Package-SHA256', bundle.sha256);
      res.attachment('watchdog-research-package.zip').type('application/zip').send(bundle.bytes); return;
    }
    const svg = format === 'svg' ? publicationSvg(record, spec, profile, geometry) : null;
    repo.audit(req.principal!.id, 'figure.export', record.id, requestId(), { datasetHash: record.contentHash, profileHash: profile.contentHash, format });
    if (format === 'csv') res.type('text/csv').send(csvExport(record, spec));
    else if (format === 'svg') res.type('image/svg+xml').send(svg);
    else if (format === 'analysis') res.json(result);
    else res.json({ figure: spec, dataset: record, profile, analysis: result, geometry });
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
