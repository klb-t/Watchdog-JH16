import { listPrimitives } from '../analysis/primitives';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PaperOperationInputSchema, PaperOperationProfileSchema } from '../../../shared/paper_operation';
import { defaultFigure } from '../../../shared/workbench';
import { canonicalHash } from '../domain/canonical';
import { WorkbenchService } from '../workbench/service';
import { WorkbenchError } from '../db/repositories/workbench';
import { PaperOperationsRepository } from '../db/repositories/paper_operations';
import { ResearchRepository } from '../db/repositories/research';
import { anchorQuote } from './paper_intake';
import { researchPackage } from '../workbench/publication';

export function loadPaperOperationProfile() {
  const profile = PaperOperationProfileSchema.parse(JSON.parse(readFileSync('config/paper-operation-ui.json','utf8')));
  for (const m of profile.methods) {
    const contract = listPrimitives().find(p => p.name === m.id);
    if (!contract || canonicalHash(m.missingPolicies) !== canonicalHash(contract.missingPolicies)) throw new WorkbenchError('Paper profile disagrees with the executor contract.', 409);
  }
  return { ...profile, contentHash: canonicalHash(profile) };
}
export class PaperOperationService {
  constructor(readonly repo: PaperOperationsRepository, readonly research: ResearchRepository, readonly workbench: WorkbenchService) {}
  list(owner: string) {
    return this.repo.list(owner).map(r => ({ id: r.id, hash: r.hash, title: r.body.document.body.title,
      method: r.body.method, meaning: r.body.meaning, createdAt: r.createdAt,
      approvalState: this.workbench.repo.method(r.methodId)?.approvalState, runs: this.repo.runs(owner, r.methodId) }));
  }
  get(owner: string, id: string) {
    const record = this.repo.get(owner, id);
    if (!record) throw new WorkbenchError('Paper operation not found.', 404);
    const method = this.workbench.repo.method(record.methodId);
    if (!method || !method.spec.assumptions.includes(`paper_binding_sha256=${record.hash}`)) throw new WorkbenchError('Paper method binding mismatch.', 409);
    return { ...record, method, runs: this.repo.runs(owner, record.methodId) };
  }
  async prepare(owner: string, raw: unknown, requestId: string) {
    const input = PaperOperationInputSchema.parse(raw), source = input.source;
    const assessment = source.kind === 'assessment_operation' ? this.research.assessment(owner, source.assessmentId) : null;
    if (source.kind === 'assessment_operation' && (!assessment || assessment.hash !== source.assessmentHash || assessment.status !== 'PROPOSED'))
      throw new WorkbenchError('The owned assessment version is required.', 409);
    const document = this.research.document(owner, source.kind === 'manual_quote' ? source.documentId : assessment!.documentId);
    if (!document || document.hash !== (source.kind === 'manual_quote' ? source.documentHash : assessment!.body.documentHash) || document.body.coverage === 'identifier_only')
      throw new WorkbenchError('The owned paper version with source text is required.', 409);
    const operation = source.kind === 'assessment_operation' ? assessment!.body.assessment.operations[source.operationIndex] : null;
    if (source.kind === 'assessment_operation' && (!operation || operation.name !== input.method))
      throw new WorkbenchError('Choose the exact supported operation; unsupported methods cannot be silently replaced.', 409);
    const excerptCharacters = assessment ? assessment.body.excerptCharacters : document.body.text.length;
    if (!Number.isInteger(excerptCharacters) || excerptCharacters < 1 || excerptCharacters > document.body.text.length) throw new WorkbenchError('Invalid source excerpt.', 409);
    const excerpt = document.body.text.slice(0, excerptCharacters), quote = source.kind === 'manual_quote' ? source.quote : operation.quote;
    const anchor = anchorQuote(excerpt, quote);
    if (assessment && (canonicalHash(excerpt) !== assessment.body.excerptHash || canonicalHash(anchor) !== canonicalHash(operation.anchor)))
      throw new WorkbenchError('Assessment source anchor mismatch.', 409);
    const dataset = await this.workbench.repo.getDataset(input.datasetId, owner);
    if (!dataset || dataset.contentHash !== input.datasetHash) throw new WorkbenchError('An accessible, approved dataset version is required.', 409);
    const requirements: any[] = assessment?.body.assessment.dataRequirements ?? [];
    const bindings = [...input.bindings].sort((a, b) => a.role.localeCompare(b.role)).map(b => {
      const column = dataset.document.columns.find(c => c.key === b.column);
      if (!column || column.type !== 'number' || !column.unit || column.semanticType === 'dimension') throw new WorkbenchError('Each input needs a numeric column with explicit units and semantics.');
      if (b.requirementId && !requirements.some(r => r.id === b.requirementId)) throw new WorkbenchError('Unknown data requirement.');
      const substitution = b.substitution ? this.research.substitutionRecord(owner, b.substitution.id) : null;
      if (b.substitution && (!substitution || substitution.hash !== b.substitution.hash || substitution.body.assessmentId !== assessment?.id || substitution.body.assessmentHash !== assessment?.hash || substitution.body.requirementId !== b.requirementId || substitution.body.kind !== b.origin))
        throw new WorkbenchError('Substitution must match this assessment, requirement, origin and exact reviewed version.', 409);
      const rawHash = dataset.document.sourceCopy?.rawHash ?? (dataset.document.rawInput ? createHash('sha256').update(dataset.document.rawInput.text).digest('hex') : null);
      if (substitution?.body.sourceHash && substitution.body.sourceHash !== rawHash)
        throw new WorkbenchError('Substitution file hash does not match the preserved raw dataset source.', 409);
      return { ...b, columnDefinition: column, substitution, sourceFileVerified: !!substitution?.body.sourceHash };
    });
    const origins = bindings.map(b => b.origin), evidenceTiers = [...new Set(dataset.document.rows.map(r => r.evidenceTier))];
    const meaning = origins.includes('synthetic_scenario') ? 'SIMULATION_NOT_EMPIRICAL_EVIDENCE'
      : origins.every(o => o === 'original_data_reuse') ? 'REANALYSIS_NOT_INDEPENDENT_REPLICATION'
      : origins.some(o => ['prior_dataset', 'proxy_measure', 'new_expert_panel'].includes(o)) ? 'EXPLORATORY_METHOD_VARIANT' : 'SCOPED_ANALYSIS_NOT_REPLICATION';
    const body = { version: 'paper-operation-1', source, document, assessment, anchor, excerptCharacters,
      method: input.method, datasetId: dataset.id, datasetHash: dataset.contentHash, bindings, missingPolicy: input.missingPolicy,
      scopeNote: input.scopeNote, meaning, scope: 'selected_operation_all_dataset_rows', replicability: 'NOT_YET_ESTABLISHED',
      interpretation: 'USER_REVIEWED_BINDING_NOT_AUTOMATIC_COMPILATION', originsVerified: false, evidenceTiers,
      unboundRequirements: requirements.filter(r => !bindings.some(b => b.requirementId === r.id)),
      otherOperations: assessment?.body.assessment.operations.filter((_: any, i: number) => source.kind !== 'assessment_operation' || i !== source.operationIndex) ?? [],
      ambiguities: assessment?.body.assessment.ambiguities ?? [], profile: loadPaperOperationProfile() };
    // Check source ownership again after asynchronous dataset reads.
    if (!this.research.document(owner, document.id)) throw new WorkbenchError('Source ownership changed.', 409);
    const figure = defaultFigure(dataset, this.workbench.profile);
    figure.renderer = body.profile.methods.find(m => m.id === input.method)!.renderer;
    figure.channels = { ...figure.channels, x: bindings[0].column, y: bindings[1]?.column ?? bindings[0].column, z: null };
    figure.style.title = document.body.title.slice(0, 250);
    figure.style.subtitle = `${body.profile.scopeLabel} ${meaning}`;
    const method = await this.workbench.prepare(owner, figure, input.method, requestId, {
      assumptions: [`paper_binding_sha256=${canonicalHash(body)}`, `paper_analysis_meaning=${meaning}`, 'All source ambiguities and unbound requirements remain in the paper context.'],
      rationale: 'A user-selected source quote and input interpretation are pinned in the paper context. This is one operation, not a compiled complete paper.', missingPolicy: input.missingPolicy,
    });
    if (!this.research.document(owner, document.id)) throw new WorkbenchError('Source ownership changed.', 409);
    const saved = this.repo.save(owner, body, method!.id);
    this.research.audit(owner, 'paper.operation.propose', saved.id, { hash: saved.hash, methodHash: method!.hash });
    return this.get(owner, saved.id);
  }
  async approve(owner: string, id: string, expectedHash: string, methodHash: string, requestId: string) {
    const r = this.get(owner, id);
    if (r.hash !== expectedHash || r.method.hash !== methodHash) throw new WorkbenchError('Paper operation review is stale.', 409);
    await this.workbench.repo.requireFigure(r.method.selection.figure, owner);
    this.get(owner, id);
    this.workbench.repo.approveMethod(r.method.id, owner, methodHash, requestId);
    return this.get(owner, id);
  }
  async execute(owner: string, id: string, expectedHash: string, requestId: string) {
    const r = this.get(owner, id);
    if (r.hash !== expectedHash) throw new WorkbenchError('Paper operation version changed.', 409);
    return this.workbench.execute(owner, r.method.id, requestId);
  }
  async result(owner: string, id: string, runId: string) {
    const r = this.get(owner, id), run = (this.repo.runs(owner, r.method.id) as any[]).find(x => x.id === runId);
    if (!run || run.status !== 'COMPLETED' || !run.resultHash) throw new WorkbenchError('An owned completed analysis is required.', 409);
    const figure = { ...r.method.selection.figure, analysis: { methodId: r.method.id, methodHash: r.method.hash, resultHash: run.resultHash } };
    const verified = await this.workbench.repo.requireFigure(figure, owner);
    this.get(owner, id);
    return { ...verified, profile: this.workbench.profileForFigure(figure) };
  }
  async export(owner: string, id: string, runId: string) {
    const v = await this.result(owner, id, runId);
    const bundle = researchPackage(v.record, v.spec, v.profile, v.result, v.geometry);
    this.research.audit(owner, 'paper.operation.export', id, { runId, manifestHash: bundle.manifestHash });
    return bundle;
  }
}
