import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RunSubmissionSchema } from '../../backend/watchdog_api/api/schemas';

const before = JSON.parse(readFileSync('tests/fixtures/run-submission-before.json', 'utf8'));

test('A4-WD-001: known UI fields keep baseline JSON bytes and optionality', () => {
  assert.equal(JSON.stringify(RunSubmissionSchema.parse(before.input)), before.schemaOutputJson);
  for (const type of ['ACQUISITION', 'ANALYSIS', 'PIPELINE'])
    assert.deepEqual(RunSubmissionSchema.parse({ type, config: {} }), { type, config: {} });
  for (const config of [{ source_id: 'offline_fixture' }, { method_id: 'jh16_faithful' }])
    assert.deepEqual(RunSubmissionSchema.parse({ type: 'ANALYSIS', config }), { type: 'ANALYSIS', config });
});

test('A4-WD-001: unsupported controls and unknown envelope keys fail explicitly instead of disappearing', () => {
  const controls = { method_spec_id: 'unreviewed', method_spec_hash: 'unreviewed-hash', personal_credentials: true,
    plan: [{ entityId: 'public-only', dimension: 'custom', renderedQuery: 'synthetic-only' }] };
  for (const config of [...Object.entries(controls).map(([key, value]) => ({ [key]: value })), controls, { extra: null }]) {
    const result = RunSubmissionSchema.safeParse({ type: 'ANALYSIS', config });
    assert.equal(result.success, false);
    if (!result.success) assert.deepEqual(result.error.issues.map(issue => [issue.code, issue.path]), [['unrecognized_keys', ['config']]]);
  }
  const unknown = RunSubmissionSchema.safeParse({ type: 'ANALYSIS', config: {}, method_spec_id: 'unreviewed' });
  assert.equal(unknown.success, false);
  if (!unknown.success) assert.deepEqual(unknown.error.issues.map(issue => [issue.code, issue.path]), [['unrecognized_keys', []]]);
});

test('A4-WD-001: nested parameter bags stay open; existing typed values are not coerced', () => {
  const source_params = { vendor_new_option: [1, null, { keep: true }], method_spec_id: 'opaque provider data' };
  const method_params = { future_method: { values: ['a', 'b'] }, plan: { keep: 'opaque method data' } };
  const input = { type: 'PIPELINE', config: { source_params, method_params, query_templates: { custom: '{entity} test' } } };
  assert.deepEqual(RunSubmissionSchema.parse(input), input);
  for (const config of [{ source_params: [] }, { method_params: null }, { source_run_id: 1 },
    { language: false }, { entities: [1] }, { query_templates: { custom: 1 } }, { query_expansion_mode: 'unknown' }])
    assert.equal(RunSubmissionSchema.safeParse({ type: 'PIPELINE', config }).success, false);
});
