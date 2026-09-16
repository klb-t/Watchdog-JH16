import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PRIMITIVES, getPrimitive, listPrimitives, PrimitiveError } from '../../backend/watchdog_api/analysis/primitives';
import {
  validateMethodSpec, assertValidMethodSpec, hashMethodSpec, MethodSpecInvalidError
} from '../../backend/watchdog_api/analysis/method_spec_validation';
import { TypeScriptMethodExecutor } from '../../backend/watchdog_api/analysis/executor';
import { MethodSpec, TypedSeries } from '../../backend/watchdog_api/domain/method_spec';
import { approve, Approvable, ApprovalRequiredError } from '../../backend/watchdog_api/domain/approval';

const series = (name: string, unit: string, entityIds: string[], values: (number | null)[]): TypedSeries =>
  ({ name, unit, semanticType: 'count', entityIds, values });

// -------------------------------------------------------------------------
// E1.11 — Primitive registry. Each primitive against hand-computed values,
// including its missing and failure cases.
// -------------------------------------------------------------------------

test('E1.11: the seven primitives are registered with declared contracts', () => {
  const names = listPrimitives().map(p => p.name);
  assert.deepStrictEqual(names, ['align', 'describe', 'max', 'pearson', 'ratio', 'scale', 'spearman']);

  for (const c of listPrimitives()) {
    assert.ok(c.version, `${c.name} declares a version`);
    assert.ok(c.missingPolicies.length > 0, `${c.name} declares its missing-value behaviour`);
    assert.ok(c.describe.length > 0, `${c.name} declares what it does`);
    if (c.canFail) assert.ok(c.failureModes.length > 0, `${c.name} says how it can fail`);
  }
});

test('E1.11 max: hand-computed, and fails explicitly with no valid value', () => {
  const run = (values: (number | null)[], policy: any = 'exclude') =>
    PRIMITIVES.max.run({ series: series('s', 'count', ['a', 'b', 'c'], values) },
      { missingPolicy: policy, params: {} });

  assert.strictEqual((run([10, 50, 30]) as any).value, 50);
  assert.strictEqual((run([10, null, 30]) as any).value, 30, 'missing excluded, not treated as zero');

  // No valid value must fail loudly rather than return 0.
  assert.throws(() => run([null, null, null]), PrimitiveError);
  assert.throws(() => run([1, null, 3], 'fail'), PrimitiveError, "policy 'fail' refuses a missing value");
});

test('E1.11 ratio: denominator <= 0 is undefined, never zero and never an epsilon', () => {
  const out = PRIMITIVES.ratio.run(
    { numerator: series('n', 'count', ['a', 'b', 'c', 'd'], [50, 10, 5, null]),
      denominator: series('d', 'count', ['a', 'b', 'c', 'd'], [100, 0, -3, 20]) },
    { missingPolicy: 'propagate', params: {} }) as any;

  assert.strictEqual(out.series.values[0], 0.5);
  assert.strictEqual(out.series.values[1], null, 'zero denominator is undefined');
  assert.strictEqual(out.series.values[2], null, 'negative denominator is undefined');
  assert.strictEqual(out.series.values[3], null, 'missing numerator propagates');
  for (const v of out.series.values) assert.notStrictEqual(v, 0);
});

test('E1.11 scale: multiplies and keeps missing missing', () => {
  const out = PRIMITIVES.scale.run(
    { series: series('s', 'dimensionless', ['a', 'b'], [0.5, null]) },
    { missingPolicy: 'propagate', params: { factor: 100, unit: '%' } }) as any;

  assert.deepStrictEqual(out.series.values, [50, null]);
  assert.strictEqual(out.series.unit, '%');
});

test('E1.11 pearson/spearman: hand-computed, and undefined on zero variance', () => {
  const x = series('x', 'd', ['a', 'b', 'c', 'd', 'e'], [1, 2, 3, 4, 5]);
  const yUp = series('y', 'd', ['a', 'b', 'c', 'd', 'e'], [2, 4, 6, 8, 10]);
  const yDown = series('y', 'd', ['a', 'b', 'c', 'd', 'e'], [10, 8, 6, 4, 2]);
  const flat = series('y', 'd', ['a', 'b', 'c', 'd', 'e'], [7, 7, 7, 7, 7]);

  const p = (a: TypedSeries, b: TypedSeries) =>
    (PRIMITIVES.pearson.run({ x: a, y: b }, { missingPolicy: 'exclude', params: {} }) as any).value;

  assert.ok(Math.abs(p(x, yUp) - 1) < 1e-9);
  assert.ok(Math.abs(p(x, yDown) + 1) < 1e-9);
  assert.strictEqual(p(x, flat), null, 'zero variance is undefined, not zero');

  // Fewer than two aligned pairs is a failure, not a fabricated coefficient.
  assert.throws(() => PRIMITIVES.pearson.run(
    { x: series('x', 'd', ['a'], [1]), y: series('y', 'd', ['a'], [2]) },
    { missingPolicy: 'exclude', params: {} }), PrimitiveError);
});

test('E1.11 align and describe: report what was dropped rather than dropping it silently', () => {
  const a = series('a', 'd', ['x', 'y', 'z'], [1, null, 3]);
  const b = series('b', 'd', ['y', 'z', 'w'], [1, 2, 3]);

  const rep = PRIMITIVES.align.run({ left: a, right: b }, { missingPolicy: 'exclude', params: {} }) as any;
  assert.strictEqual(rep.record.aligned_length, 1, 'only z is valid in both');
  assert.strictEqual(rep.record.dropped_for_missing, 1);
  assert.strictEqual(rep.record.only_in_left, 1);
  assert.strictEqual(rep.record.only_in_right, 1);

  const d = PRIMITIVES.describe.run(
    { series: series('s', 'count', ['a', 'b', 'c', 'd'], [2, 4, null, 6]) },
    { missingPolicy: 'propagate', params: {} }) as any;
  assert.strictEqual(d.record.count, 4);
  assert.strictEqual(d.record.valid_count, 3);
  assert.strictEqual(d.record.missing_count, 1, 'missing is counted, not hidden');
  assert.strictEqual(d.record.mean, 4);
  assert.strictEqual(d.record.median, 4);
});

// -------------------------------------------------------------------------
// E1.12 — MethodSpec validation and hashing.
// -------------------------------------------------------------------------

const goodSpec = (): MethodSpec => ({
  specVersion: '1.0', name: 'test',
  inputs: [{ name: 'Ni', unit: 'count', semanticType: 'count' }],
  steps: [
    { id: 'm', primitive: 'max', params: {}, inputs: { series: 'Ni' }, missingPolicy: 'exclude' },
    { id: 'r', primitive: 'ratio', params: {}, inputs: { numerator: 'Ni', denominator: 'm' }, missingPolicy: 'propagate' },
  ],
  outputs: [{ name: 'Pi', unit: 'dimensionless', semanticType: 'proportion', fromStep: 'r' }],
  assumptions: [],
});

test('E1.12: a valid spec passes and each invalid case is rejected precisely', () => {
  assert.deepStrictEqual(validateMethodSpec(goodSpec()), []);

  const cases: [string, (s: any) => void, string][] = [
    ['unknown primitive', s => { s.steps[0].primitive = 'invented'; }, 'unknown_primitive'],
    ['unresolved reference', s => { s.steps[1].inputs.numerator = 'nope'; }, 'unresolved_reference'],
    ['cycle / forward reference', s => { s.steps[0].inputs.series = 'r'; }, 'cycle'],
    ['undeclared missing policy', s => { delete s.steps[0].missingPolicy; }, 'undeclared_missing_policy'],
    ['unsupported missing policy', s => { s.steps[0].missingPolicy = 'propagate'; }, 'unsupported_missing_policy'],
    ['missing required param', s => { s.steps.push({ id: 'sc', primitive: 'scale', params: {}, inputs: { series: 'r' }, missingPolicy: 'propagate' }); }, 'required_param'],
    ['unknown param', s => { s.steps[0].params = { nope: 1 }; }, 'unknown_param'],
    ['output names no step', s => { s.outputs[0].fromStep = 'ghost'; }, 'unresolved_reference'],
    ['duplicate step id', s => { s.steps[1].id = 'm'; }, 'unique'],
  ];

  for (const [label, mutate, expectedRule] of cases) {
    const spec: any = goodSpec();
    mutate(spec);
    const issues = validateMethodSpec(spec);
    assert.ok(issues.some(i => i.rule === expectedRule),
      `${label}: expected rule '${expectedRule}', got ${JSON.stringify(issues)}`);
    assert.ok(issues.every(i => i.path.length > 0), `${label}: every issue names a path`);
    assert.throws(() => assertValidMethodSpec(spec), MethodSpecInvalidError);
  }
});

test('E1.12: semantically equal specs hash equally regardless of key order', () => {
  const a = goodSpec();
  const b = JSON.parse(JSON.stringify(goodSpec(), Object.keys(goodSpec()).reverse()));
  assert.strictEqual(hashMethodSpec(a), hashMethodSpec(JSON.parse(JSON.stringify(a))));

  const reordered: any = { outputs: a.outputs, steps: a.steps, name: a.name, inputs: a.inputs,
                           specVersion: a.specVersion, assumptions: a.assumptions };
  assert.strictEqual(hashMethodSpec(a), hashMethodSpec(reordered), 'key order must not change the hash');

  const changed = goodSpec();
  (changed.steps[0] as any).missingPolicy = 'fail';
  assert.notStrictEqual(hashMethodSpec(a), hashMethodSpec(changed), 'a real change must change the hash');
  void b;
});

// -------------------------------------------------------------------------
// E1.13 — Approval gate at the executor entry.
// -------------------------------------------------------------------------

test('E1.13: a PROPOSED spec reaching the executor throws', async () => {
  const executor = new TypeScriptMethodExecutor();
  const spec = goodSpec();
  const inputs = [series('Ni', 'count', ['a', 'b'], [100, 50])];

  const proposed: Approvable = { id: 'm1', kind: 'method_spec', content: spec };
  await assert.rejects(
    () => executor.execute(spec, inputs, { approvable: proposed }),
    ApprovalRequiredError
  );

  const approved = approve(proposed, 'a-human', '2026-01-01T00:00:00.000Z');
  await assert.doesNotReject(() => executor.execute(spec, inputs, { approvable: approved }));

  // Editing after approval reverts it, with no action taken.
  const edited = { ...approved, content: { ...spec, name: 'tweaked' } };
  await assert.rejects(() => executor.execute(spec, inputs, { approvable: edited }), ApprovalRequiredError);
});

test('E1.13: an ambiguous step blocks execution until a human chooses', async () => {
  const executor = new TypeScriptMethodExecutor();
  const spec: any = goodSpec();
  spec.steps[0].ambiguous = true;

  await assert.rejects(() => executor.execute(spec, [series('Ni', 'count', ['a'], [1])]),
    MethodSpecInvalidError);
});

// -------------------------------------------------------------------------
// E1.14 — Deterministic executor.
// -------------------------------------------------------------------------

test('E1.14: two executions of the same spec on the same inputs are byte-identical', async () => {
  const executor = new TypeScriptMethodExecutor();
  const spec = goodSpec();
  const mk = () => [series('Ni', 'count', ['cannabis', 'alcohol', 'heroin'], [500, 1000, 100])];

  const a = await executor.execute(spec, mk());
  const b = await executor.execute(spec, mk());

  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  // And ordering is explicit, not incidental to input order.
  assert.deepStrictEqual(a.results.map(r => r.entityId), ['alcohol', 'cannabis', 'heroin']);
});

// -------------------------------------------------------------------------
// E1.15 — JH2016 FAITHFUL preset and its MethodSpec, against the paper.
// -------------------------------------------------------------------------

function loadJson(...p: string[]) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), ...p), 'utf-8'));
}

test('E1.15: the locked preset is exactly the sixteen substances with the exact queries', () => {
  const preset = loadJson('config', 'presets', 'jh2016-faithful.json');

  assert.strictEqual(preset.locked, true);
  assert.strictEqual(preset.substances.length, 16);
  assert.strictEqual(preset.queries.alias_expansion, false);
  assert.strictEqual(preset.search_method.safe_search, 'off');
  assert.strictEqual(preset.queries.popularity_template, '"{query_label}"');
  assert.strictEqual(preset.queries.harm_template, '"{query_label}" "harm" OR "harmful"');

  // No extra harm word may creep into FAITHFUL.
  for (const banned of ['dangerous', 'risk', 'death', 'side effects']) {
    assert.ok(!preset.queries.harm_template.includes(banned), `'${banned}' must not appear in FAITHFUL`);
  }
});

test('E1.15: the preset MethodSpec is valid and computes Pi and Hi over primitives', async () => {
  const spec: MethodSpec = loadJson('config', 'methods', 'jh2016-faithful.methodspec.json');
  assert.deepStrictEqual(validateMethodSpec(spec), [], 'the shipped spec must validate');

  // No bespoke arithmetic: every step is a registered primitive.
  for (const step of spec.steps) {
    assert.ok(getPrimitive(step.primitive), `step '${step.id}' uses a registered primitive`);
  }

  const executor = new TypeScriptMethodExecutor();
  const out = await executor.execute(spec, [
    series('Ni', 'count', ['alcohol', 'cannabis', 'heroin'], [1000, 500, 100]),
    series('Ni_harm', 'count', ['alcohol', 'cannabis', 'heroin'], [50, 10, 20]),
  ]);

  const get = (metric: string, entity: string) =>
    out.results.find(r => r.metricKey === metric && r.entityId === entity)!.valueNumeric;

  assert.strictEqual(get('Pi', 'alcohol'), 100);
  assert.strictEqual(get('Pi', 'cannabis'), 50);
  assert.strictEqual(get('Pi', 'heroin'), 10);
  assert.strictEqual(get('Hi', 'alcohol'), 5);
  assert.strictEqual(get('Hi', 'cannabis'), 2);
  assert.strictEqual(get('Hi', 'heroin'), 20);
});

test('E1.15 golden: the MethodSpec reproduces every Pi and Hi the paper published', async () => {
  const spec: MethodSpec = loadJson('config', 'methods', 'jh2016-faithful.methodspec.json');
  const paper = loadJson('fixtures', 'jh2016', 'paper_reported.json');

  const subs = [...paper.substances].sort((a: any, b: any) => a.canonical.localeCompare(b.canonical));
  const entityIds = subs.map((s: any) => s.canonical);

  const out = await new TypeScriptMethodExecutor().execute(spec, [
    series('Ni', 'count', entityIds, subs.map((s: any) => s.Ni)),
    series('Ni_harm', 'count', entityIds, subs.map((s: any) => s.Ni_harm)),
  ]);

  for (const s of subs) {
    const pi = out.results.find(r => r.metricKey === 'Pi' && r.entityId === s.canonical)!.valueNumeric!;
    const hi = out.results.find(r => r.metricKey === 'Hi' && r.entityId === s.canonical)!.valueNumeric!;
    // The paper rounds to one decimal; agreement within that is exact agreement.
    assert.ok(Math.abs(pi - s.Pi_percent) < 0.06, `${s.canonical} Pi: ${pi.toFixed(2)} vs published ${s.Pi_percent}`);
    assert.ok(Math.abs(hi - s.Hi_percent) < 0.06, `${s.canonical} Hi: ${hi.toFixed(2)} vs published ${s.Hi_percent}`);
  }
});

test('E1.15: zero Ni yields an undefined Hi and the run does not crash', async () => {
  const spec: MethodSpec = loadJson('config', 'methods', 'jh2016-faithful.methodspec.json');
  const out = await new TypeScriptMethodExecutor().execute(spec, [
    series('Ni', 'count', ['alcohol', 'khat'], [1000, 0]),
    series('Ni_harm', 'count', ['alcohol', 'khat'], [50, 5]),
  ]);

  const hiKhat = out.results.find(r => r.metricKey === 'Hi' && r.entityId === 'khat')!;
  assert.strictEqual(hiKhat.valueNumeric, null);
  assert.strictEqual(hiKhat.isMissing, true);

  // Pi for a zero count is a real zero, not missing — the two must not merge.
  const piKhat = out.results.find(r => r.metricKey === 'Pi' && r.entityId === 'khat')!;
  assert.strictEqual(piKhat.valueNumeric, 0);
  assert.strictEqual(piKhat.isMissing, false);
});

test('E1.15: a missing count propagates as missing through Pi and Hi', async () => {
  const spec: MethodSpec = loadJson('config', 'methods', 'jh2016-faithful.methodspec.json');
  const out = await new TypeScriptMethodExecutor().execute(spec, [
    series('Ni', 'count', ['alcohol', 'ghb'], [1000, null]),
    series('Ni_harm', 'count', ['alcohol', 'ghb'], [50, 7]),
  ]);

  for (const metric of ['Pi', 'Hi']) {
    const row = out.results.find(r => r.metricKey === metric && r.entityId === 'ghb')!;
    assert.strictEqual(row.valueNumeric, null, `${metric} must be missing, never 0`);
    assert.strictEqual(row.isMissing, true);
  }
});
