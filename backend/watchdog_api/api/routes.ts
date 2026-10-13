import { Router } from 'express';
import { createHash } from 'node:crypto';
import { requireCapability } from './auth_routes';
import { sourceRegistry } from '../sources/registry';
import { analyzerRegistry } from '../analytics/registry';
import { RunOrchestrator } from '../services/run_orchestrator';
import { RunRepository } from '../db/repositories/runs';
import { AnalysisResultRepository } from '../db/repositories/data';
import { ArtifactRepository } from '../db/repositories/artifacts';
import { AcquisitionRepository } from '../db/repositories/acquisition';
import type { ObjectStore } from '../storage/object_store';
import { z } from 'zod';
import { AuditRepository } from '../db/repositories/audit';
import { tracer } from '../utils/tracer';
import { RunSubmissionSchema } from './schemas';
import { MethodSpecRepository } from '../db/repositories/method_specs';
import { capabilityRegistry } from '../sources/provider_registry';
import { buildPiChart, buildHiChart, buildHiVsReferenceChart } from '../services/charts';
import { exportCsv, exportJson } from '../services/export';
import { generateNarrative, generateNarrativeWithProvider, hashNarrativePayload, type Narrative } from '../services/narrative';
import { loadNarrativeCatalog, selectNarrativeRecipe } from '../config/narrative';
import { canonicalHash, canonicalizeJson } from '../domain/canonical';
import { readAnalysisInput, assertAnalysisInputAccess } from '../services/analysis_inputs';
import { buildTextGenerationRegistry } from '../llm';
import { buildSearchProviderRegistry } from '../sources/search_providers';
import { validateMethodSpec, hashMethodSpec } from '../analysis/method_spec_validation';
import { MethodSpec } from '../domain/method_spec';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AssistantService } from '../services/assistant';
import { sameOriginMutation } from './automation_routes';

export function buildApiRouter(db: ConstructorParameters<typeof RunRepository>[0], store: ObjectStore, audit: AuditRepository, assistant?: AssistantService) {
const apiRouter = Router();

const orchestrator = new RunOrchestrator(db, store);
const runRepo = new RunRepository(db);
const anRepo = new AnalysisResultRepository(db);
const artRepo = new ArtifactRepository(db);
const acqRepo = new AcquisitionRepository(db, store);
const specRepo = new MethodSpecRepository(db);

// All descendants, including exports and provider narratives, share the owner gate.
apiRouter.use('/runs/:id', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!req.principal || !runRepo.getOwnedRun(req.params.id, req.principal.id)) return res.status(404).json({ error: 'NOT_FOUND' });
  next();
});

function readConfig(...p: string[]) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), ...p), 'utf-8'));
}

apiRouter.get('/sources', requireCapability('run.view'), (req, res) => {
  const sources = sourceRegistry.listSources();
  res.json({ sources });
});

apiRouter.get('/analyzers', requireCapability('run.view'), (req, res) => {
  res.json({ analyzers: analyzerRegistry.listAnalyzers() }); 
});

apiRouter.get('/runs', requireCapability('run.view'), (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ runs: runRepo.getRuns(limit, req.principal!.id) });
});

apiRouter.post('/runs', requireCapability('run.create'), (req, res, next) => {
  try {
    const parsed = RunSubmissionSchema.parse(req.body);
    if (parsed.config.source_run_id && !runRepo.getOwnedRun(parsed.config.source_run_id, req.principal!.id)) return res.status(404).json({ error: 'NOT_FOUND' });
    const runId = orchestrator.submitJob(parsed.type, parsed.config, req.principal!.id);
    res.status(202).json({ run_id: runId, status: 'QUEUED' });
  } catch (e) {
    next(e);
  }
});

apiRouter.get('/runs/:id', requireCapability('run.view'), (req, res) => {
  const run = runRepo.getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ run });
});

apiRouter.get('/runs/:id/results', requireCapability('run.view'), async (req, res, next) => {
  try {
  const run = runRepo.getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'NOT_FOUND' });
  const input = await readAnalysisInput(db, store, req.params.id, req.principal!.id);
  if (!runRepo.getOwnedRun(req.params.id, req.principal!.id)) return res.status(404).json({ error: 'NOT_FOUND' });
  const results = anRepo.getByRunId(req.params.id);
  
  res.json({
    run_id: req.params.id,
    observations: input.observations,
    input_evidence: input.evidence,
    analysis_results: results
  });
  } catch (error) { next(error); }
});

apiRouter.get('/runs/:id/manifest', requireCapability('run.view'), (req, res) => {
  const manifest = artRepo.getManifest(req.params.id);
  if (!manifest) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ manifest });
});

apiRouter.get('/runs/:id/fetch-events', requireCapability('run.view'), (req, res) => {
  const events = acqRepo.getFetchEvents(req.params.id);
  res.json({ events });
});

apiRouter.get('/artifacts/:id', requireCapability('run.view'), async (req, res, next) => {
  try {
    const blob = acqRepo.getOwnedRawBlob(req.params.id, req.principal!.id);
    if (!blob) return res.status(404).json({ error: 'NOT_FOUND' });
    
    const data = await store.get(blob.object_uri);
    if (!acqRepo.getOwnedRawBlob(req.params.id, req.principal!.id)) return res.status(404).json({ error: 'NOT_FOUND' });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(data);
  } catch (e) {
    next(e);
  }
});



// --------------------------------------------------------------------------
// Method review (E1.22) — propose, inspect, approve.
// --------------------------------------------------------------------------

/** The shipped JH2016 spec, rendered step by step with its per-step rationale. */
apiRouter.get('/method-specs/jh2016-faithful', requireCapability('run.view'), (req, res, next) => {
  try {
    const spec: MethodSpec = readConfig('config', 'methods', 'jh2016-faithful.methodspec.json');
    const id = specRepo.upsert(spec, { id: 'jh2016-faithful' });
    res.json({
      id,
      spec,
      spec_hash: hashMethodSpec(spec),
      // Derived from the hash on every read, never read off a stored flag.
      approval_state: specRepo.readApprovalState(id),
      issues: validateMethodSpec(spec),
      steps: spec.steps.map(s => ({
        id: s.id, primitive: s.primitive, params: s.params,
        inputs: s.inputs, missing_policy: s.missingPolicy,
        rationale: s.rationale ?? null, ambiguous: s.ambiguous === true,
      })),
    });
  } catch (e) { next(e); }
});

/** The legacy review surface owns only the shipped JH2016 method.
 * Workbench methods must pass their dataset/selection and expected-hash gate. */
apiRouter.post('/method-specs/:id/approve', requireCapability('method.approve'), (req, res, next) => {
  try {
    if (req.params.id !== 'jh2016-faithful') return res.status(404).json({ error: 'NOT_FOUND' });
    const body = z.object({ expectedHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'validation_error', message: 'Review requires the displayed expectedHash; the actor comes from the signed-in session.' });
    const row = specRepo.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    if (row.spec_hash !== body.data.expectedHash || hashMethodSpec(JSON.parse(row.spec_json)) !== body.data.expectedHash)
      return res.status(409).json({ error: 'stale_review', message: 'Reload the method before approving its changed content.' });
    specRepo.approve(req.params.id, req.principal!.id, new Date().toISOString(), body.data.expectedHash);
    audit.append(req.principal!.id, 'method.approve', 'method_spec', req.params.id,
      tracer.getContext()?.request_id ?? 'legacy-review', { expectedHash: body.data.expectedHash });
    res.json({ id: req.params.id, approval_state: specRepo.readApprovalState(req.params.id) });
  } catch (e) { next(e); }
});

// --------------------------------------------------------------------------
// Results surfaces (E1.23).
// --------------------------------------------------------------------------

apiRouter.get('/runs/:id/charts', requireCapability('run.view'), async (req, res, next) => {
  try {
    const input = await readAnalysisInput(db, store, req.params.id, req.principal!.id);
    if (!runRepo.getOwnedRun(req.params.id, req.principal!.id)) return res.status(404).json({ error: 'NOT_FOUND' });
    const results = anRepo.getByRunId(req.params.id);
    const flags = input.observations === null ? null : [...new Set(input.observations.flatMap(o => [...o.qualityFlags]))].sort();
    // Diagnostic legend vocabulary, not a fabricated scientific quality flag.
    const legend = flags ?? ['INPUT_EVIDENCE_UNAVAILABLE'];
    const charts = [buildPiChart(results, legend), buildHiChart(results, legend)];
    const references = input.receipts.map(record => record.receipt.execution.parameters?.reference_scores);
    const reference = references.length === 1 ? references[0] : undefined;
    const usableReference = reference && typeof reference === 'object' && !Array.isArray(reference) &&
      Object.values(reference).every(value => typeof value === 'number' && Number.isFinite(value));
    if (usableReference) charts.push(buildHiVsReferenceChart(results, reference as Record<string, number>, legend));
    res.json({ charts: charts.map(chart => ({ ...chart, input_evidence: input.evidence })),
      quality_flags: flags, input_evidence: input.evidence,
      omissions: usableReference ? [] : [{ projection: 'hi-vs-reference-scatter', reason: 'consumed_reference_scores_unavailable' }] });
  } catch (e) { next(e); }
});

const NarrativeSelection = z.object({ templateId: z.string().min(1).optional(), templateVersion: z.string().min(1).optional() }).strict();
const ProviderNarrativeSelection = NarrativeSelection.extend({ provider: z.string().min(1).optional(), model: z.string().min(1).optional() }).strict();
const AutomaticNarrativeSelection = NarrativeSelection.extend({ consent: z.literal(true) }).strict();
async function narrativeInput(runId: string, owner: string) {
  const run = runRepo.getRun(runId)!;
  const input = await readAnalysisInput(db, store, runId, owner);
  if (input.observations === null) return { evidence: input.evidence, payload: null };
  const results = anRepo.getByRunId(runId), observations = input.observations;
  return { evidence: input.evidence, payload: { presetId: run.preset_id,
    results: results.map(r => ({ metricKey: r.metricKey, entityId: r.entityId, valueNumeric: r.valueNumeric, unit: r.unit })),
    missingCount: observations.filter(o => o.isMissing).length,
    qualityFlags: [...new Set(observations.flatMap(o => [...o.qualityFlags]))].sort() } };
}
async function archiveNarrative(narrative: Narrative, owner: string, sourceIds: readonly string[]) {
  try { assertAnalysisInputAccess(db, narrative.runId, owner, sourceIds); }
  catch { return null; }
  const bytes = Buffer.from(canonicalizeJson(narrative)), sha256 = canonicalHash(narrative);
  const uri = await store.put(`narratives/${sha256}.json`, bytes);
  try { assertAnalysisInputAccess(db, narrative.runId, owner, sourceIds); }
  catch { return null; }
  const artifactId = artRepo.recordArtifact({ runId: narrative.runId, kind: 'narrative', objectUri: uri,
    sha256, byteSize: bytes.length, mediaType: 'application/json',
    metadata: { schema: 'watchdog.narrative_artifact/1', contentHash: narrative.contentHash,
      inputPayloadHash: narrative.inputPayloadHash, producedBy: narrative.producedBy, approvalState: narrative.approvalState } });
  return { artifactId, sha256 };
}

apiRouter.get('/runs/:id/narrative', requireCapability('run.view'), async (req, res, next) => {
  try {
    const catalog = loadNarrativeCatalog();
    const recipe = selectNarrativeRecipe(catalog, NarrativeSelection.parse(req.query));
    const input = await narrativeInput(req.params.id, req.principal!.id);
    if (!runRepo.getOwnedRun(req.params.id, req.principal!.id)) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!input.payload) return res.status(409).json({ error: 'input_evidence_unavailable', input_evidence: input.evidence });
    const payload = input.payload;
    res.json({ narrative: generateNarrative({ runId: req.params.id, payload, payloadHash: hashNarrativePayload(payload),
      templateId: recipe.id, templateVersion: recipe.version, providerId: null, model: null }, catalog) });
  } catch (error) { next(error); }
});

// Explicit local generation archives the proposal in the existing artifact
// store. A preview GET never writes and no finalised run manifest is edited.
apiRouter.post('/runs/:id/narrative', requireCapability('narrative.approve'), sameOriginMutation, async (req, res, next) => {
  try {
    const catalog = loadNarrativeCatalog();
    const recipe = selectNarrativeRecipe(catalog, NarrativeSelection.parse(req.body));
    const input = await narrativeInput(req.params.id, req.principal!.id);
    if (!runRepo.getOwnedRun(req.params.id, req.principal!.id)) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!input.payload) return res.status(409).json({ error: 'input_evidence_unavailable', input_evidence: input.evidence });
    const payload = input.payload;
    const narrative = generateNarrative({ runId: req.params.id, payload, payloadHash: hashNarrativePayload(payload),
      templateId: recipe.id, templateVersion: recipe.version, providerId: null, model: null }, catalog);
    const artifact = await archiveNarrative(narrative, req.principal!.id, input.evidence.receipts.map(row => row.source_run_id));
    if (!artifact) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ narrative, artifact });
  } catch (error) { next(error); }
});

// Historical proposals are read from their immutable artifact, never generated
// again using today's catalog. Recheck ownership after asynchronous storage I/O.
apiRouter.get('/runs/:id/narratives/:artifactId', requireCapability('run.view'), async (req, res, next) => {
  try {
    const record = artRepo.getArtifacts(req.params.id).find(row => row.id === req.params.artifactId && row.kind === 'narrative');
    if (!record) return res.status(404).json({ error: 'NOT_FOUND' });
    const bytes = await store.get(record.object_uri);
    if (!runRepo.getOwnedRun(req.params.id, req.principal!.id)) return res.status(404).json({ error: 'NOT_FOUND' });
    if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) throw new Error('Narrative artifact content hash mismatch');
    res.json({ narrative: JSON.parse(bytes.toString('utf8')), artifact: { artifactId: record.id, sha256: record.sha256 } });
  } catch (error) { next(error); }
});

apiRouter.get('/runs/:id/export', requireCapability('export.download'), async (req, res, next) => {
  try {
    const format = String(req.query.format ?? 'json');
    const results = anRepo.getByRunId(req.params.id);
    const disclosure = await readAnalysisInput(db, store, req.params.id, req.principal!.id);
    if (!runRepo.getOwnedRun(req.params.id, req.principal!.id)) return res.status(404).json({ error: 'NOT_FOUND' });
    const observations = disclosure.observations;
    const input = {
      runId: req.params.id, results,
      inputEvidence: disclosure.evidence,
      missingObservations: observations === null ? null : observations.filter(o => o.isMissing).map(o => ({
        entity_id: o.entityId, query_role: o.queryRole,
        missing_reason: (o as any).missingReason,
      })),
      qualityFlags: observations === null ? null : [...new Set(observations.flatMap(o => [...o.qualityFlags]))].sort(),
    };

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      return res.send(exportCsv(input));
    }
    res.setHeader('Content-Type', 'application/json');
    res.send(exportJson(input));
  } catch (e) { next(e); }
});

apiRouter.get('/providers', requireCapability('provider.view'), (req, res) => {
  // Providers are a stack-settings concern and never appear on the Sources
  // page; this endpoint exists for the settings surface, not study design.
  res.json({ providers: capabilityRegistry.listProviders(), capabilities: capabilityRegistry.listCapabilities() });
});

/**
 * Readiness: which providers could actually run right now, and for each one
 * that cannot, the single thing that would fix it.
 *
 * The remediation string is the point. A settings page that reports
 * "unavailable" leaves the operator guessing between a missing key, a rejected
 * key, an unset endpoint and an unimplemented adapter — four different actions
 * behind one word.
 */
apiRouter.get('/providers/readiness', requireCapability('provider.view'), async (req, res, next) => {
  try {
    const [text, search, sources] = await Promise.all([
      buildTextGenerationRegistry().listAvailability(),
      buildSearchProviderRegistry().listAvailability(),
      sourceRegistry.listWithLiveStatus(),
    ]);

    // Derived on every read from credential state, so removing a key takes a
    // provider out of service without any invalidation step.
    res.json({
      capabilities: {
        'text.generate': text.map(a => ({
          provider_key: a.providerKey, display_name: a.displayName, status: a.status,
          credential_status: a.credentialStatus, remediation: a.remediation,
          default_model: a.defaultModel, allowed_models: a.allowedModels,
        })),
        'search.result_count': search.map(a => ({
          provider_key: a.providerKey, display_name: a.displayName, status: a.status,
          credential_status: a.credentialStatus, remediation: a.remediation,
        })),
      },
      sources,
      ready: {
        text_generate: text.some(a => a.status === 'implemented'),
        live_acquisition: search.some(a => a.status === 'implemented'),
      },
    });
  } catch (e) { next(e); }
});

/**
 * Generates the narrative through a language provider (E2.1).
 *
 * Separate from `GET /runs/:id/narrative`, which is deterministic when its
 * consumed-input evidence is available. A POST because it spends money and produces a new
 * artifact, and because a GET that bills the maintainer is a GET that a link
 * prefetcher can bill them for.
 */
apiRouter.post('/runs/:id/narrative/generate',
  requireCapability('narrative.approve'), async (req, res, next) => {
  try {
    const body = ProviderNarrativeSelection.parse(req.body ?? {});
    const catalog = loadNarrativeCatalog();
    const recipe = selectNarrativeRecipe(catalog, body);
    const run = runRepo.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'NOT_FOUND' });
    const input = await narrativeInput(req.params.id, req.principal!.id);
    if (!runRepo.getOwnedRun(req.params.id, req.principal!.id)) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!input.payload) return res.status(409).json({ error: 'input_evidence_unavailable', input_evidence: input.evidence });

    const providerKey = body.provider ?? 'openrouter';
    const registry = buildTextGenerationRegistry();
    const availability = await registry.availability(providerKey);
    if (availability.status !== 'implemented') {
      // 409, not 500: the instance is working correctly and is telling the
      // operator what to configure.
      return res.status(409).json({
        error: { code: 'provider_unavailable', message: availability.remediation, provider: providerKey },
      });
    }

    const payload = input.payload;
    const generationParams = await registry.defaultParams(providerKey);
    const generator = await registry.get(providerKey);
    if (!runRepo.getOwnedRun(req.params.id, req.principal!.id)) return res.status(404).json({ error: 'NOT_FOUND' });
    try { assertAnalysisInputAccess(db, req.params.id, req.principal!.id, input.evidence.receipts.map(row => row.source_run_id)); }
    catch { return res.status(409).json({ error: 'input_evidence_unavailable', input_evidence: {
      schema: 'watchdog.analysis_input_evidence/1', status: 'unavailable', reason: 'input_access_changed', receipts: [] } }); }
    const narrative = await generateNarrativeWithProvider({
      runId: req.params.id, payload, payloadHash: hashNarrativePayload(payload),
      templateId: recipe.id, templateVersion: recipe.version,
      providerId: providerKey,
      model: String(body.model ?? availability.defaultModel),
      generationParams,
      generator,
    }, catalog);

    // PROPOSED, always. The gate is unchanged by the text having come from a
    // model rather than a template.
    const artifact = await archiveNarrative(narrative, req.principal!.id, input.evidence.receipts.map(row => row.source_run_id));
    if (!artifact) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ narrative, artifact });
  } catch (e) { next(e); }
});

apiRouter.post('/runs/:id/narrative/automatic', requireCapability('narrative.approve'), sameOriginMutation, async (req, res, next) => {
  let inputAccessChanged = false;
  try {
    const body = AutomaticNarrativeSelection.parse(req.body);
    const catalog = loadNarrativeCatalog();
    const recipe = selectNarrativeRecipe(catalog, body);
    if (!assistant) return res.status(409).json({ error: 'Personal assistant is not configured' });
    const input = await narrativeInput(req.params.id, req.principal!.id);
    if (!runRepo.getOwnedRun(req.params.id, req.principal!.id)) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!input.payload) return res.status(409).json({ error: 'input_evidence_unavailable', input_evidence: input.evidence });
    const payload = input.payload;
    const narrative = await generateNarrativeWithProvider({ runId: req.params.id, payload, payloadHash: hashNarrativePayload(payload),
      templateId: recipe.id, templateVersion: recipe.version, providerId: assistant.provider(req.principal!.id, 'narrative').id, model: 'automatic',
      generator: assistant.generator(req.principal!.id, 'narrative', () => {
        try { assertAnalysisInputAccess(db, req.params.id, req.principal!.id, input.evidence.receipts.map(row => row.source_run_id)); }
        catch (error) { inputAccessChanged = true; throw error; }
        return undefined;
      }) }, catalog);
    const artifact = await archiveNarrative(narrative, req.principal!.id, input.evidence.receipts.map(row => row.source_run_id));
    if (!artifact) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ narrative, artifact });
  } catch (error) {
    if (inputAccessChanged) return res.status(409).json({ error: 'input_evidence_unavailable', input_evidence: {
      schema: 'watchdog.analysis_input_evidence/1', status: 'unavailable', reason: 'input_access_changed', receipts: [] } });
    next(error);
  }
});

return apiRouter;
}
