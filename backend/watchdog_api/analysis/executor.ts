import {
  MethodSpec, TypedSeries, MethodExecutor, AnalysisArtifact, AnalysisResultValue, JsonValue
} from '../domain/method_spec';
import { Approvable, requireApproved } from '../domain/approval';
import { getPrimitive, PrimitiveResult, ScalarResult } from './primitives';
import { assertValidMethodSpec, hashMethodSpec, hasBlockingAmbiguity, MethodSpecInvalidError } from './method_spec_validation';

/**
 * The in-process TypeScript executor (E1.14).
 *
 * Pure with respect to its inputs: same spec, same series, same bytes out.
 * No clock reads, no random, no locale-dependent formatting, no unordered
 * iteration. Anything that would break that is a bug, not a preference —
 * `demo:jh16` is required to produce byte-identical output across runs.
 */

export class ApprovalRequiredForExecutionError extends Error {
  readonly code = 'approval_required';
  constructor(detail: string) {
    super(detail);
    this.name = 'ApprovalRequiredForExecutionError';
  }
}

export class TypeScriptMethodExecutor implements MethodExecutor {
  readonly executorId = 'typescript-inprocess';
  readonly executorVersion = '1.0.0';

  supports(spec: MethodSpec): boolean {
    return spec.steps.every(s => getPrimitive(s.primitive) !== undefined);
  }

  /**
   * Executes a validated, approved spec.
   *
   * The approval check lives here, at the executor's entry, rather than in a
   * caller — `04_METHOD_COMPILER_AND_APPROVAL.md` requires enforcement in the
   * domain layer so no code path can route around it by calling the executor
   * directly.
   */
  async execute(
    spec: MethodSpec,
    inputs: readonly TypedSeries[],
    options: { approvable?: Approvable } = {}
  ): Promise<AnalysisArtifact> {
    if (options.approvable) requireApproved(options.approvable);

    assertValidMethodSpec(spec);
    if (hasBlockingAmbiguity(spec)) {
      throw new MethodSpecInvalidError([{
        path: 'steps', rule: 'ambiguous',
        message: 'an ambiguous step blocks execution until a human chooses between the alternatives',
      }]);
    }

    const symbols = new Map<string, TypedSeries | ScalarResult | PrimitiveResult>();
    for (const series of inputs) symbols.set(series.name, series);

    for (const binding of spec.inputs) {
      if (!symbols.has(binding.name)) {
        throw new MethodSpecInvalidError([{
          path: `inputs.${binding.name}`, rule: 'missing_input',
          message: `declared input '${binding.name}' was not supplied to the executor`,
        }]);
      }
    }

    const qualityFlags = new Set<string>();
    for (const series of inputs) {
      // Flags on inputs must reach the output; an analysis that crosses a
      // discontinuity without disclosing it is a defect, not a cosmetic issue.
      const meta = series.qualityFlags;
      for (const f of meta ?? []) qualityFlags.add(f);
    }

    const results: AnalysisResultValue[] = [];

    for (const step of spec.steps) {
      const primitive = getPrimitive(step.primitive)!;

      const stepInputs: Record<string, any> = {};
      for (const { name } of primitive.contract.inputs) {
        const ref = step.inputs[name];
        const resolved = symbols.get(ref);
        stepInputs[name] = normaliseSymbol(resolved);
      }

      const out = primitive.run(stepInputs, {
        missingPolicy: step.missingPolicy,
        params: step.params ?? {},
      });

      symbols.set(step.id, out);
    }

    // Outputs are emitted in declared order, and entity rows within an output
    // are sorted, so two runs produce byte-identical artifacts.
    for (const binding of spec.outputs) {
      const value = symbols.get(binding.fromStep);
      if (!value) continue;
      results.push(...toResultValues(binding.name, binding.unit, value));
    }

    return {
      specHash: hashMethodSpec(spec),
      executorId: this.executorId,
      executorVersion: this.executorVersion,
      results,
      qualityFlags: [...qualityFlags].sort(),
    };
  }
}

function normaliseSymbol(v: unknown): unknown {
  if (v && typeof v === 'object' && 'kind' in (v as any)) {
    const r = v as PrimitiveResult;
    if (r.kind === 'series') return r.series;
    return r;
  }
  return v;
}

function toResultValues(name: string, unit: string, value: unknown): AnalysisResultValue[] {
  const v = value as PrimitiveResult | TypedSeries;

  if ('values' in (v as TypedSeries)) {
    const s = v as TypedSeries;
    return s.entityIds
      .map((entityId, i) => ({ entityId, value: s.values[i] }))
      .sort((a, b) => a.entityId.localeCompare(b.entityId))
      .map(({ entityId, value }) => ({
        entityId,
        metricKey: name,
        valueNumeric: value,
        unit,
        isMissing: value === null,
      }));
  }

  const r = v as PrimitiveResult;
  if (r.kind === 'series') return toResultValues(name, unit, r.series);

  if (r.kind === 'scalar') {
    return [{
      metricKey: name,
      valueNumeric: r.value,
      unit: unit || r.unit,
      isMissing: r.value === null,
      statisticMetadata: r.metadata as Record<string, JsonValue> | undefined,
    }];
  }

  // record
  return Object.entries(r.record)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => ({
      metricKey: `${name}.${key}`,
      valueNumeric: val,
      unit: unit || r.unit,
      isMissing: val === null,
    }));
}
