import { Router } from 'express';
import { sourceRegistry } from '../sources/registry';
import { analyzerRegistry } from '../analytics/registry';
import { RunOrchestrator } from '../services/run_orchestrator';
import { RunRepository } from '../db/repositories/runs';
import { ObservationRepository, AnalysisResultRepository } from '../db/repositories/data';
import { ArtifactRepository } from '../db/repositories/artifacts';
import { AcquisitionRepository } from '../db/repositories/acquisition';
import { db } from '../db/client';
import { store } from '../storage/client';
import { RunSubmissionSchema } from './schemas';

export const apiRouter = Router();

const orchestrator = new RunOrchestrator(db, store);
const runRepo = new RunRepository(db);
const obsRepo = new ObservationRepository(db);
const anRepo = new AnalysisResultRepository(db);
const artRepo = new ArtifactRepository(db);
const acqRepo = new AcquisitionRepository(db, store);

apiRouter.get('/sources', (req, res) => {
  const sources = sourceRegistry.listSources();
  res.json({ sources });
});

apiRouter.get('/analyzers', (req, res) => {
  res.json({ analyzers: analyzerRegistry.listAnalyzers() }); 
});

apiRouter.get('/runs', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  res.json({ runs: runRepo.getRuns(limit) });
});

apiRouter.post('/runs', (req, res, next) => {
  try {
    const parsed = RunSubmissionSchema.parse(req.body);
    const runId = orchestrator.submitJob(parsed.type, parsed.config);
    res.status(202).json({ run_id: runId, status: 'QUEUED' });
  } catch (e) {
    next(e);
  }
});

apiRouter.get('/runs/:id', (req, res) => {
  const run = runRepo.getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ run });
});

apiRouter.get('/runs/:id/results', (req, res) => {
  const run = runRepo.getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'NOT_FOUND' });
  
  const observations = obsRepo.getByRunId(req.params.id);
  const results = anRepo.getByRunId(req.params.id);
  
  res.json({
    run_id: req.params.id,
    observations,
    analysis_results: results
  });
});

apiRouter.get('/runs/:id/manifest', (req, res) => {
  const manifest = artRepo.getManifest(req.params.id);
  if (!manifest) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ manifest });
});

apiRouter.get('/runs/:id/fetch-events', (req, res) => {
  const events = acqRepo.getFetchEvents(req.params.id);
  res.json({ events });
});

apiRouter.get('/artifacts/:id', async (req, res, next) => {
  try {
    const blob = acqRepo.getRawBlob(req.params.id);
    if (!blob) return res.status(404).json({ error: 'NOT_FOUND' });
    
    const data = await store.get(blob.object_uri);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(data);
  } catch (e) {
    next(e);
  }
});

