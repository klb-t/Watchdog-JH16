import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TypeScriptMethodExecutor } from '../../backend/watchdog_api/analysis/executor';
import { validateMethodSpec, MethodSpecInvalidError } from '../../backend/watchdog_api/analysis/method_spec_validation';
import { PRIMITIVES, PrimitiveError } from '../../backend/watchdog_api/analysis/primitives';
import { approve, ApprovalRequiredError } from '../../backend/watchdog_api/domain/approval';
import type { MethodSpec, TypedSeries } from '../../backend/watchdog_api/domain/method_spec';

const maxSpec = (): MethodSpec => ({
  specVersion: '1.0', name: 'maximum',
  inputs: [{ name: 'counts', unit: 'count', semanticType: 'count' }],
  steps: [{ id: 'maximum', primitive: 'max', params: {}, inputs: { series: 'counts' }, missingPolicy: 'exclude' }],
  outputs: [{ name: 'maximum', fromStep: 'maximum', unit: 'count', semanticType: 'count' }],
  assumptions: [],
});
const series = (name = 'counts', entityIds = ['a', 'b'], values: (number | null)[] = [100, 10]): TypedSeries =>
  ({ name, unit: 'count', semanticType: 'count', entityIds, values });
const faithful = (): MethodSpec => JSON.parse(readFileSync('config/methods/jh2016-faithful.methodspec.json', 'utf8'));

test('Method integrity: graph references must resolve to earlier distinct symbols of the accepted shape', () => {
  const cases: [string, (spec: any) => void, string][] = [
    ['self-edge', spec => { spec.steps[0].inputs.series = 'maximum'; }, 'cycle'],
    ['input/step collision', spec => { spec.steps[0].id = 'counts'; }, 'unique'],
    ['duplicate input', spec => { spec.inputs.push({ ...spec.inputs[0] }); }, 'unique'],
    ['scalar into series', spec => { spec.steps.push({ id: 'scaled', primitive: 'scale', params: { factor: 2 }, inputs: { series: 'maximum' }, missingPolicy: 'propagate' }); }, 'shape_mismatch'],
    ['record into series', spec => { spec.steps[0].primitive = 'describe'; spec.steps[0].missingPolicy = 'propagate'; spec.steps.push({ id: 'scaled', primitive: 'scale', params: { factor: 2 }, inputs: { series: 'maximum' }, missingPolicy: 'propagate' }); }, 'shape_mismatch'],
    ['record into denominator', spec => { spec.steps[0].primitive = 'describe'; spec.steps[0].missingPolicy = 'propagate'; spec.steps.push({ id: 'ratio', primitive: 'ratio', params: {}, inputs: { numerator: 'counts', denominator: 'maximum' }, missingPolicy: 'propagate' }); }, 'shape_mismatch'],
    ['unused undeclared edge', spec => { spec.steps[0].inputs.unused = 'counts'; }, 'unknown_input'],
    ['nonfinite factor', spec => { spec.steps[0] = { id: 'maximum', primitive: 'scale', params: { factor: Infinity }, inputs: { series: 'counts' }, missingPolicy: 'propagate' }; }, 'nonfinite_param'],
    ...['constructor', 'toString', '__proto__'].map(name => [name, (spec: any) => { spec.steps[0].primitive = name; }, 'unknown_primitive'] as [string, (spec: any) => void, string]),
  ];
  for (const [label, mutate, rule] of cases) {
    const spec = maxSpec(); mutate(spec);
    assert.ok(validateMethodSpec(spec).some(issue => issue.rule === rule), label);
  }
  assert.deepEqual(validateMethodSpec(maxSpec()), []);
  assert.deepEqual(validateMethodSpec(faithful()), [], 'existing scalar and series ratio inputs remain valid');
});

test('Method integrity: JH16 ratios follow entity identity when input series have different orders', async () => {
  const executor = new TypeScriptMethodExecutor();
  const spec = faithful();
  const expected = await executor.execute(spec, [series('Ni'), series('Ni_harm', ['a', 'b'], [20, 5])]);
  const reordered = await executor.execute(spec, [series('Ni'), series('Ni_harm', ['b', 'a'], [5, 20])]);
  assert.deepEqual(reordered, expected, 'input ordering cannot change entity-bound results');
  assert.deepEqual(reordered.results.filter(result => result.metricKey === 'Hi').map(result => [result.entityId, result.valueNumeric]), [['a', 20], ['b', 50]]);
  assert.equal(reordered.executorVersion, '1.0.1');
});

test('Method integrity: ratio refuses unreviewed joins and ambiguous entity identity', () => {
  const cases = [
    series('denominator', ['a'], [2]),
    series('denominator', ['a', 'c'], [2, 3]),
    series('denominator', ['a', 'b', 'c'], [2, 3, 4]),
    series('denominator', ['a', 'a'], [2, 3]),
    series('denominator', ['a', 'b'], [2]),
  ];
  for (const denominator of cases) {
    for (const missingPolicy of ['propagate', 'exclude', 'fail'] as const) {
      assert.throws(() => PRIMITIVES.ratio.run({ numerator: series(), denominator }, { missingPolicy, params: {} }), PrimitiveError);
    }
  }
  assert.throws(() => PRIMITIVES.ratio.run({ numerator: series('numerator', ['a', 'a'], [2, 3]), denominator: series() }, { missingPolicy: 'propagate', params: {} }), PrimitiveError);
  const result = PRIMITIVES.ratio.run({ numerator: series('numerator', ['b', 'a'], [null, 5]), denominator: series() }, { missingPolicy: 'propagate', params: {} });
  assert.equal(result.kind, 'series');
  if (result.kind === 'series') assert.deepEqual(result.series.values, [null, 0.05], 'explicit null stays a missing measurement on the correct entity');
});

test('Method integrity: runtime inputs cannot substitute units, semantics, identities or malformed values', async () => {
  const cases: [string, (inputs: any[]) => void, string][] = [
    ['wrong units', inputs => { inputs[0].unit = 'kg'; }, 'unit_mismatch'],
    ['wrong semantics', inputs => { inputs[0].semanticType = 'score'; }, 'semantic_type_mismatch'],
    ['duplicate input', inputs => { inputs.push({ ...inputs[0] }); }, 'unique'],
    ['undeclared input', inputs => { inputs.push(series('extra')); }, 'undeclared_input'],
    ['missing input', inputs => { inputs.length = 0; }, 'missing_input'],
    ['different array lengths', inputs => { inputs[0].values = [1]; }, 'input_shape'],
    ['values are not an array', inputs => { inputs[0].values = {}; }, 'input_shape'],
    ['duplicate entity', inputs => { inputs[0].entityIds = ['a', 'a']; }, 'unique'],
    ['empty entity', inputs => { inputs[0].entityIds = ['a', '']; }, 'entity_identity'],
    ['invalid quality flags', inputs => { inputs[0].qualityFlags = 'measured'; }, 'input_shape'],
    ...[NaN, Infinity, -Infinity, undefined, '3'].map(value => [String(value), (inputs: any[]) => { inputs[0].values[0] = value; }, 'nonfinite_input'] as [string, (inputs: any[]) => void, string]),
  ];
  for (const [label, mutate, rule] of cases) {
    const inputs = [series()]; mutate(inputs);
    await assert.rejects(() => new TypeScriptMethodExecutor().execute(maxSpec(), inputs),
      (error: unknown) => error instanceof MethodSpecInvalidError && error.issues.some(issue => issue.rule === rule), label);
  }
  const result = await new TypeScriptMethodExecutor().execute(maxSpec(), [{ ...series('counts', ['a', 'b'], [null, 10]), qualityFlags: ['PROVIDER_ESTIMATE'] }]);
  assert.equal(result.results[0].valueNumeric, 10);
  assert.deepEqual(result.qualityFlags, ['PROVIDER_ESTIMATE']);
});

test('Method integrity: a supplied approval authorizes only its exact MethodSpec', async () => {
  const spec = maxSpec();
  const approvable = approve({ id: 'reviewed', kind: 'method_spec', content: spec }, 'reviewer', '2026-09-30T00:00:00.000Z');
  await assert.rejects(() => new TypeScriptMethodExecutor().execute({ ...spec, name: 'another spec' }, [series()], { approvable }), ApprovalRequiredError);
  await assert.rejects(() => new TypeScriptMethodExecutor().execute(spec, [series()], { approvable: { ...approvable, kind: 'narrative' } }), ApprovalRequiredError);
  await assert.doesNotReject(() => new TypeScriptMethodExecutor().execute(spec, [series()], { approvable }));
});

test('Method integrity: numerical overflow fails before JSON can disguise it as missing', async () => {
  const spec: MethodSpec = { ...maxSpec(), steps: [{ id: 'maximum', primitive: 'scale', params: { factor: 2 }, inputs: { series: 'counts' }, missingPolicy: 'propagate' }] };
  await assert.rejects(() => new TypeScriptMethodExecutor().execute(spec, [series('counts', ['a'], [Number.MAX_VALUE])]), PrimitiveError);
});
