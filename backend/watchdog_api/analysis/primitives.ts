import { TypedSeries, MissingPolicy, SemanticType, JsonValue } from '../domain/method_spec';
import { pearson as pearsonFn, spearman as spearmanFn } from '../analytics/stats';

/**
 * The primitive registry (E1.11, `04_METHOD_COMPILER_AND_APPROVAL.md`).
 *
 * Small, total, deterministic functions with declared contracts. E1 needs only
 * these seven; more are added when a method requires them, never speculatively.
 *
 * Every primitive declares its parameter schema, accepted input shapes and
 * units, output unit, missing-value behaviour, and whether it can fail and how.
 * That declaration is what E1.12's validator checks a MethodSpec against, so it
 * has to be data rather than prose.
 */

export type PrimitiveValue = number | null;

export interface ScalarResult { kind: 'scalar'; value: PrimitiveValue; unit: string; metadata?: Record<string, JsonValue>; }
export interface SeriesResult { kind: 'series'; series: TypedSeries; metadata?: Record<string, JsonValue>; }
export interface RecordResult { kind: 'record'; record: Record<string, PrimitiveValue>; unit: string; metadata?: Record<string, JsonValue>; }
export type PrimitiveResult = ScalarResult | SeriesResult | RecordResult;

export type InputShape = 'series' | 'scalar';

export interface ParamSpec {
  name: string;
  type: 'number' | 'string' | 'boolean';
  required: boolean;
}

export interface PrimitiveContract {
  readonly name: string;
  readonly version: string;
  /** Named inputs and the shape each accepts. */
  readonly inputs: { name: string; shape: InputShape }[];
  readonly params: ParamSpec[];
  /** Semantic types this primitive will accept on its series inputs. */
  readonly acceptsSemanticTypes: SemanticType[] | 'any';
  readonly outputKind: PrimitiveResult['kind'];
  /** How the output unit is derived; `inherit` copies the first input's unit. */
  readonly outputUnit: string | 'inherit' | 'dimensionless';
  readonly outputSemanticType: SemanticType | 'inherit';
  /** Missing-value behaviour must be declared at every step that can meet one. */
  readonly missingPolicies: MissingPolicy[];
  readonly canFail: boolean;
  readonly failureModes: string[];
  readonly describe: string;
}

export class PrimitiveError extends Error {
  readonly code = 'analysis_error';
  constructor(primitive: string, detail: string) {
    super(`Primitive '${primitive}' failed: ${detail}`);
    this.name = 'PrimitiveError';
  }
}

export interface PrimitiveContext {
  missingPolicy: MissingPolicy;
  params: Record<string, JsonValue>;
}

export interface Primitive {
  contract: PrimitiveContract;
  run(inputs: Record<string, TypedSeries | ScalarResult>, ctx: PrimitiveContext): PrimitiveResult;
}

function asSeries(v: TypedSeries | ScalarResult | undefined, primitive: string, name: string): TypedSeries {
  if (!v || !('values' in v)) throw new PrimitiveError(primitive, `input '${name}' must be a series`);
  return v;
}

function asScalarNumber(v: TypedSeries | ScalarResult | undefined, primitive: string, name: string): PrimitiveValue {
  if (!v) throw new PrimitiveError(primitive, `input '${name}' is missing`);
  if ('values' in v) throw new PrimitiveError(primitive, `input '${name}' must be a scalar`);
  return v.value;
}

/**
 * Applies the declared missing policy to a series, returning aligned values
 * and the indices kept. `propagate` keeps nulls so downstream sees them;
 * `exclude` drops them; `fail` refuses.
 */
function applyMissing(series: TypedSeries, policy: MissingPolicy, primitive: string) {
  const idx: number[] = [];
  for (let i = 0; i < series.values.length; i++) {
    const v = series.values[i];
    if (v === null || Number.isNaN(v as number)) {
      if (policy === 'fail') {
        throw new PrimitiveError(primitive, `missing value at index ${i} and policy is 'fail'`);
      }
      if (policy === 'exclude') continue;
    }
    idx.push(i);
  }
  return { idx, values: idx.map(i => series.values[i]) };
}

// --------------------------------------------------------------------------
// max
// --------------------------------------------------------------------------
const maxPrimitive: Primitive = {
  contract: {
    name: 'max', version: '1.0.0',
    inputs: [{ name: 'series', shape: 'series' }],
    params: [],
    acceptsSemanticTypes: 'any',
    outputKind: 'scalar', outputUnit: 'inherit', outputSemanticType: 'inherit',
    missingPolicies: ['exclude', 'fail'],
    canFail: true,
    failureModes: ['no valid value in the comparison set'],
    describe: 'Maximum of a numeric series. Fails explicitly if no valid value exists — it does not return zero.',
  },
  run(inputs, ctx) {
    const s = asSeries(inputs.series, 'max', 'series');
    const { values } = applyMissing(s, ctx.missingPolicy, 'max');
    const valid = values.filter((v): v is number => v !== null && !Number.isNaN(v));
    if (valid.length === 0) {
      // 03_JH2016_CONTRACT.md: if no valid positive Ni exists the analysis
      // fails explicitly rather than returning zeros.
      throw new PrimitiveError('max', 'no valid value in the comparison set');
    }
    return { kind: 'scalar', value: Math.max(...valid), unit: s.unit };
  },
};

// --------------------------------------------------------------------------
// ratio
// --------------------------------------------------------------------------
const ratioPrimitive: Primitive = {
  contract: {
    name: 'ratio', version: '1.0.0',
    inputs: [{ name: 'numerator', shape: 'series' }, { name: 'denominator', shape: 'scalar' }],
    params: [],
    acceptsSemanticTypes: 'any',
    outputKind: 'series', outputUnit: 'dimensionless', outputSemanticType: 'proportion',
    missingPolicies: ['propagate', 'exclude', 'fail'],
    canFail: false,
    failureModes: [],
    describe: 'Elementwise numerator / denominator. A denominator <= 0 yields undefined (null), never zero and never an epsilon.',
  },
  run(inputs, ctx) {
    const num = asSeries(inputs.numerator, 'ratio', 'numerator');
    const denRaw = inputs.denominator;

    // The denominator may be a scalar or an aligned series.
    const denValues: PrimitiveValue[] = denRaw && 'values' in denRaw
      ? [...denRaw.values]
      : new Array(num.values.length).fill(asScalarNumber(denRaw, 'ratio', 'denominator'));

    const out: PrimitiveValue[] = num.values.map((n, i) => {
      const d = denValues[i];
      if (n === null || d === null) {
        if (ctx.missingPolicy === 'fail') throw new PrimitiveError('ratio', `missing operand at index ${i}`);
        return null;
      }
      // Never divide by zero, never substitute an epsilon, never return zero.
      if (d <= 0) return null;
      return n / d;
    });

    return {
      kind: 'series',
      series: { name: `${num.name}_ratio`, unit: 'dimensionless', semanticType: 'proportion',
                values: out, entityIds: num.entityIds },
    };
  },
};

// --------------------------------------------------------------------------
// scale
// --------------------------------------------------------------------------
const scalePrimitive: Primitive = {
  contract: {
    name: 'scale', version: '1.0.0',
    inputs: [{ name: 'series', shape: 'series' }],
    params: [{ name: 'factor', type: 'number', required: true }, { name: 'unit', type: 'string', required: false }],
    acceptsSemanticTypes: 'any',
    outputKind: 'series', outputUnit: 'inherit', outputSemanticType: 'inherit',
    missingPolicies: ['propagate', 'fail'],
    canFail: false,
    failureModes: [],
    describe: 'Multiplies a series by a constant factor. Missing stays missing.',
  },
  run(inputs, ctx) {
    const s = asSeries(inputs.series, 'scale', 'series');
    const factor = Number(ctx.params.factor);
    const unit = typeof ctx.params.unit === 'string' ? ctx.params.unit : s.unit;
    const semanticType: SemanticType = unit === '%' ? 'percentage' : s.semanticType;

    const values = s.values.map(v => {
      if (v === null) {
        if (ctx.missingPolicy === 'fail') throw new PrimitiveError('scale', 'missing value and policy is fail');
        return null;
      }
      return v * factor;
    });

    return { kind: 'series', series: { name: `${s.name}_scaled`, unit, semanticType, values, entityIds: s.entityIds } };
  },
};

// --------------------------------------------------------------------------
// align
// --------------------------------------------------------------------------
const alignPrimitive: Primitive = {
  contract: {
    name: 'align', version: '1.0.0',
    inputs: [{ name: 'left', shape: 'series' }, { name: 'right', shape: 'series' }],
    params: [],
    acceptsSemanticTypes: 'any',
    outputKind: 'record', outputUnit: 'dimensionless', outputSemanticType: 'count',
    missingPolicies: ['exclude', 'propagate', 'fail'],
    canFail: false,
    failureModes: [],
    describe: 'Aligns two series on entity id, returning an alignment report. Under `exclude`, only entities valid in both are kept.',
  },
  run(inputs, ctx) {
    const left = asSeries(inputs.left, 'align', 'left');
    const right = asSeries(inputs.right, 'align', 'right');

    const rightByEntity = new Map(right.entityIds.map((e, i) => [e, right.values[i]]));
    // Deterministic ordering: sorted, never map insertion order.
    const shared = [...left.entityIds].filter(e => rightByEntity.has(e)).sort();

    let dropped = 0;
    const kept: string[] = [];
    for (const e of shared) {
      const l = left.values[left.entityIds.indexOf(e)];
      const r = rightByEntity.get(e)!;
      const anyMissing = l === null || r === null;
      if (anyMissing && ctx.missingPolicy === 'fail') throw new PrimitiveError('align', `missing value for '${e}'`);
      if (anyMissing && ctx.missingPolicy === 'exclude') { dropped++; continue; }
      kept.push(e);
    }

    return {
      kind: 'record',
      unit: 'dimensionless',
      record: {
        left_length: left.values.length,
        right_length: right.values.length,
        aligned_length: kept.length,
        dropped_for_missing: dropped,
        only_in_left: left.entityIds.filter(e => !rightByEntity.has(e)).length,
        only_in_right: right.entityIds.filter(e => !left.entityIds.includes(e)).length,
      },
      metadata: { aligned_entities: kept as unknown as JsonValue },
    };
  },
};

// --------------------------------------------------------------------------
// pearson / spearman
// --------------------------------------------------------------------------
function correlationPrimitive(name: 'pearson' | 'spearman'): Primitive {
  const fn = name === 'pearson' ? pearsonFn : spearmanFn;
  return {
    contract: {
      name, version: '1.0.0',
      inputs: [{ name: 'x', shape: 'series' }, { name: 'y', shape: 'series' }],
      params: [],
      acceptsSemanticTypes: 'any',
      outputKind: 'scalar', outputUnit: 'dimensionless', outputSemanticType: 'coefficient',
      missingPolicies: ['exclude', 'fail'],
      canFail: true,
      failureModes: ['fewer than two aligned pairs', 'zero variance in an input'],
      describe: `${name} correlation over entity-aligned pairs. Returns null when undefined (zero variance), never zero.`,
    },
    run(inputs, ctx) {
      const x = asSeries(inputs.x, name, 'x');
      const y = asSeries(inputs.y, name, 'y');

      const yByEntity = new Map(y.entityIds.map((e, i) => [e, y.values[i]]));
      // Aligned on entity id and sorted, so the result cannot depend on
      // input ordering.
      const pairs: [number, number][] = [];
      for (const e of [...x.entityIds].sort()) {
        const xv = x.values[x.entityIds.indexOf(e)];
        const yv = yByEntity.get(e);
        if (xv === null || yv === null || yv === undefined || Number.isNaN(xv) || Number.isNaN(yv)) {
          if (ctx.missingPolicy === 'fail') throw new PrimitiveError(name, `missing value for '${e}'`);
          continue;
        }
        pairs.push([xv, yv]);
      }

      if (pairs.length < 2) throw new PrimitiveError(name, `fewer than two aligned pairs (${pairs.length})`);

      const coefficient = fn(pairs.map(p => p[0]), pairs.map(p => p[1]));
      return {
        kind: 'scalar',
        value: coefficient,
        unit: 'dimensionless',
        metadata: { n: pairs.length, statistic: name },
      };
    },
  };
}

// --------------------------------------------------------------------------
// describe
// --------------------------------------------------------------------------
const describePrimitive: Primitive = {
  contract: {
    name: 'describe', version: '1.0.0',
    inputs: [{ name: 'series', shape: 'series' }],
    params: [],
    acceptsSemanticTypes: 'any',
    outputKind: 'record', outputUnit: 'inherit', outputSemanticType: 'inherit',
    missingPolicies: ['propagate'],
    canFail: false,
    failureModes: [],
    describe: 'Count, valid count, missing count, min, max, mean, median, sd. Missing counts are reported, never dropped silently.',
  },
  run(inputs) {
    const s = asSeries(inputs.series, 'describe', 'series');
    const valid = s.values.filter((v): v is number => v !== null && !Number.isNaN(v));
    const n = valid.length;

    if (n === 0) {
      return { kind: 'record', unit: s.unit, record: {
        count: s.values.length, valid_count: 0, missing_count: s.values.length,
        min: null, max: null, mean: null, median: null, sd: null } };
    }

    const sorted = [...valid].sort((a, b) => a - b);
    const mean = valid.reduce((a, b) => a + b, 0) / n;
    const median = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const sd = n > 1
      ? Math.sqrt(valid.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1))
      : null;

    return { kind: 'record', unit: s.unit, record: {
      count: s.values.length, valid_count: n, missing_count: s.values.length - n,
      min: sorted[0], max: sorted[n - 1], mean, median, sd } };
  },
};

export const PRIMITIVES: Record<string, Primitive> = {
  max: maxPrimitive,
  ratio: ratioPrimitive,
  scale: scalePrimitive,
  align: alignPrimitive,
  pearson: correlationPrimitive('pearson'),
  spearman: correlationPrimitive('spearman'),
  describe: describePrimitive,
};

export function getPrimitive(name: string): Primitive | undefined {
  return PRIMITIVES[name];
}

export function listPrimitives(): PrimitiveContract[] {
  return Object.values(PRIMITIVES).map(p => p.contract).sort((a, b) => a.name.localeCompare(b.name));
}
