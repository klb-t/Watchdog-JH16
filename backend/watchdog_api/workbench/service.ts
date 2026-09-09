import { canonicalHash } from '../domain/canonical';
import type { MethodSpec, TypedSeries, SemanticType } from '../domain/method_spec';
import { TypeScriptMethodExecutor } from '../analysis/executor';
import { assertValidMethodSpec } from '../analysis/method_spec_validation';
import { WorkbenchRepository, WorkbenchError } from '../db/repositories/workbench';
import { filterRows, selectionIdentity, type FigureSpec, type WorkbenchProfile } from '../../../shared/workbench';
import { checkFigureProfile } from '../config/workbench';
import { tracer } from '../utils/tracer';

export class WorkbenchService {
  readonly profile: WorkbenchProfile;
  constructor(readonly repo: WorkbenchRepository, profile: WorkbenchProfile) {
    this.profile = repo.archiveProfile(profile);
  }
  profileForFigure(figure: FigureSpec) {
    const profile = this.repo.getProfile(figure.profileHash);
    if (!profile) throw new WorkbenchError('The pinned visualization profile is unavailable. Restore its verified configuration snapshot before opening this figure.', 409);
    checkFigureProfile(figure, profile);
    return profile;
  }
  async prepare(actor: string, figure: FigureSpec, method: string, requestId: string) {
    const profile = this.profileForFigure(figure);
    const { record, spec: f } = await this.repo.requireFigure(figure, actor);
    if (!['describe', 'pearson', 'spearman'].includes(method) || !profile.methods.some(m => m.id === method)) throw new WorkbenchError('Unknown method profile.');
    const names = method === 'describe' ? [f.channels.y] : [f.channels.x, f.channels.y];
    const columns = names.map(name => record.document.columns.find(c => c.key === name)!);
    if (columns.some(c => c.type !== 'number' || !c.unit || c.semanticType === 'dimension'))
      throw new WorkbenchError('Statistics require numeric columns with explicitly declared units and numeric semantics.');
    const inputs = columns.map((c, i) => ({ name: i === 0 ? 'a' : 'b', unit: c.unit!, semanticType: c.semanticType as SemanticType }));
    const selection = { ...f, analysis: null }; // Exact filters/selection are pinned; styling is not an analysis input.
    const methodSpec: MethodSpec = { specVersion: '1.0', name: `${method} / ${record.document.name}`, inputs,
      steps: [{ id: 'statistic', primitive: method, inputs: method === 'describe' ? { series: 'a' } : { x: 'a', y: 'b' }, params: {}, missingPolicy: method === 'describe' ? 'propagate' : 'exclude',
        rationale: profile.methods.find(m => m.id === method)!.description }],
      outputs: [{ name: method, unit: method === 'describe' ? columns[0].unit! : 'dimensionless', semanticType: method === 'describe' ? inputs[0].semanticType : 'coefficient', fromStep: 'statistic' }],
      assumptions: [`dataset_id=${record.id}`, `dataset_sha256=${record.contentHash}`, `selection_sha256=${canonicalHash(selectionIdentity(f, names))}`,
        `comparison_scope=${record.document.comparisonScope}`, `normalization=${record.document.normalization}`,
        'Exploratory description or association only. This does not establish causation, population prevalence or distribution routes.'] };
    assertValidMethodSpec(methodSpec);
    return this.repo.proposeMethod(actor, record.id, methodSpec, { figure: selection, columns: names }, requestId);
  }
  async execute(actor: string, methodId: string, requestId: string) {
    const method = this.repo.method(methodId);
    if (!method || method.approvalState !== 'APPROVED') throw new WorkbenchError('An individually approved method is required.', 409);
    const { record, spec: figure } = await this.repo.requireFigure(method.selection.figure, actor);
    const profile = this.profileForFigure(figure);
    const runId = this.repo.createRun(actor, { methodId, methodHash: method.hash, datasetHash: record.contentHash, selection: method.selection });
    return tracer.runWithSpan('workbench', 'analysis', async () => {
      try {
        this.repo.transitionRun(runId, 'VALIDATING'); assertValidMethodSpec(method.spec);
        this.repo.transitionRun(runId, 'QUEUED', { scheduler: 'inprocess' }); await Promise.resolve();
        this.repo.transitionRun(runId, 'RUNNING');
        this.repo.transitionRun(runId, 'NORMALIZING');
        const rows = filterRows(record.document, figure).filter(r => !figure.selectedIds.length || figure.selectedIds.includes(r.id));
        const series: TypedSeries[] = method.selection.columns.map((name: string, index: number) => ({ ...method.spec.inputs[index],
          values: rows.map(r => r.values[name] as number | null), entityIds: rows.map(r => r.id),
          qualityFlags: [...new Set(rows.flatMap(r => r.qualityFlags))] }));
        tracer.validation(true, { rowCount: rows.length, datasetHash: record.contentHash, methodHash: method.hash });
        this.repo.transitionRun(runId, 'ANALYZING');
        const artifact = await new TypeScriptMethodExecutor().execute(method.spec, series, { approvable: {
          id: method.id, kind: 'method_spec', content: method.spec, approvedHash: method.approvedHash, approvedBy: method.approvedBy, approvedAt: method.approvedAt } });
        this.repo.transitionRun(runId, 'EXPORTING');
        const result = { version: 'workbench-result-1', runId, datasetHash: record.contentHash, methodId, methodHash: method.hash,
          selection: method.selection, methodSpec: method.spec, inputs: series, source: record.document.source, comparisonScope: record.document.comparisonScope,
          profile,
          artifact, inputHash: canonicalHash(series), inputRowIds: rows.map(r => r.id), traceId: tracer.getContext()?.trace_id };
        const saved = await this.repo.persistResult(runId, actor, result);
        this.repo.transitionRun(runId, 'COMPLETED'); this.repo.audit(actor, 'workbench.analysis', runId, requestId, { resultHash: saved.hash, methodHash: method.hash });
        tracer.result({ runId, resultHash: saved.hash, resultCount: artifact.results.length });
        return { ...result, hash: saved.hash };
      } catch (error) {
        this.repo.transitionRun(runId, 'FAILED', { error: (error as Error).name }); throw error;
      }
    }, { run_id: runId, actor_id: actor, request_id: requestId });
  }
}
