import { test } from 'node:test';
import * as assert from 'node:assert';
import { JH16Analyzer } from '../../backend/watchdog_api/analytics/jh16';
import { calculateRatio, normalizeMax, pearson, spearman } from '../../backend/watchdog_api/analytics/stats';
import { Observation } from '../../backend/watchdog_api/sources/base';

test('Generic Stats: normalizeMax', () => {
  const result = normalizeMax([100, 50, 0, -1], true);
  assert.strictEqual(result[0], 100);
  assert.strictEqual(result[1], 50);
  assert.strictEqual(result[2], 0);
  assert.ok(Number.isNaN(result[3]));
  
  assert.throws(() => normalizeMax([-1, -2]), /No valid positive values found/);
});

test('Generic Stats: calculateRatio', () => {
  assert.strictEqual(calculateRatio(50, 100, true), 50);
  assert.strictEqual(calculateRatio(50, 100, false), 0.5);
  assert.strictEqual(calculateRatio(50, 0, true), null);
});

test('Generic Stats: Pearson and Spearman Correlation', () => {
  // A simple monotonic sequence
  const x = [1, 2, 3, 4, 5];
  const y = [2, 4, 6, 8, 10];
  // Deal with floating point inaccuracies
  assert.ok(Math.abs(pearson(x, y) - 1) < 0.0001);
  assert.ok(Math.abs(spearman(x, y) - 1) < 0.0001);
  
  // Inverse
  const y_inv = [10, 8, 6, 4, 2];
  assert.ok(Math.abs(pearson(x, y_inv) - (-1)) < 0.0001);
  assert.ok(Math.abs(spearman(x, y_inv) - (-1)) < 0.0001);
});

test('JH16 Analyzer execution', () => {
  const analyzer = new JH16Analyzer();
  const inputs: Observation[] = [
    { entity_id: 'alcohol', dimension: 'popularity', query_text: '', result_count: 1000, retrieved_at: '', source_id: '', source_adapter_version: '' },
    { entity_id: 'alcohol', dimension: 'harm', query_text: '', result_count: 50, retrieved_at: '', source_id: '', source_adapter_version: '' },
    { entity_id: 'cannabis', dimension: 'popularity', query_text: '', result_count: 500, retrieved_at: '', source_id: '', source_adapter_version: '' },
    { entity_id: 'cannabis', dimension: 'harm', query_text: '', result_count: 10, retrieved_at: '', source_id: '', source_adapter_version: '' },
    { entity_id: 'heroin', dimension: 'popularity', query_text: '', result_count: 100, retrieved_at: '', source_id: '', source_adapter_version: '' },
    { entity_id: 'heroin', dimension: 'harm', query_text: '', result_count: 20, retrieved_at: '', source_id: '', source_adapter_version: '' },
  ];

  const config = {
    method_id: 'jh16',
    method_version: '1.0',
    parameters: {
      reference_scores: {
        'alcohol': 72,
        'cannabis': 20,
        'heroin': 55
      }
    }
  };

  const results = analyzer.analyze(inputs, config);

  // Expected Pi:
  // max pop is alcohol = 1000.
  // alcohol Pi = 100%
  // cannabis Pi = 50%
  // heroin Pi = 10%
  const piAlc = results.find(r => r.entity_id === 'alcohol' && r.metric_key === 'Pi');
  assert.strictEqual(piAlc?.value_numeric, 100);

  const piCan = results.find(r => r.entity_id === 'cannabis' && r.metric_key === 'Pi');
  assert.strictEqual(piCan?.value_numeric, 50);
  
  const piHer = results.find(r => r.entity_id === 'heroin' && r.metric_key === 'Pi');
  assert.strictEqual(piHer?.value_numeric, 10);

  // Expected Hi: (harm / pop * 100)
  // alcohol = 50 / 1000 * 100 = 5%
  // cannabis = 10 / 500 * 100 = 2%
  // heroin = 20 / 100 * 100 = 20%
  const hiAlc = results.find(r => r.entity_id === 'alcohol' && r.metric_key === 'Hi');
  assert.strictEqual(hiAlc?.value_numeric, 5);
  
  const hiCan = results.find(r => r.entity_id === 'cannabis' && r.metric_key === 'Hi');
  assert.strictEqual(hiCan?.value_numeric, 2);

  const hiHer = results.find(r => r.entity_id === 'heroin' && r.metric_key === 'Hi');
  assert.strictEqual(hiHer?.value_numeric, 20);

  // Correlations
  const p_pi = results.find(r => r.metric_key === 'pearson_pi_ref');
  assert.ok(p_pi !== undefined);
  
  const s_hi = results.find(r => r.metric_key === 'spearman_hi_ref');
  assert.ok(s_hi !== undefined);
});
