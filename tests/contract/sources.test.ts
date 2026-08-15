import { test } from 'node:test';
import * as assert from 'node:assert';
import { sourceRegistry } from '../../backend/watchdog_api/sources/registry';
import { OfflineFixtureAdapter } from '../../backend/watchdog_api/sources/offline_fixture';
import { SerpAdapter } from '../../backend/watchdog_api/sources/serp';

test('SourceRegistry - Retrieves implemented adapters and blocks planned', () => {
  const offline = sourceRegistry.getAdapter('offline_fixture');
  assert.ok(offline instanceof OfflineFixtureAdapter);

  const serp = sourceRegistry.getAdapter('serp_generic');
  assert.ok(serp instanceof SerpAdapter);

  assert.throws(() => {
    sourceRegistry.getAdapter('google_trends');
  }, /cannot be executed\. Status: planned/);
});

test('OfflineFixtureAdapter - Normalizes JSON properly', async () => {
  const adapter = new OfflineFixtureAdapter();
  
  const v = adapter.validate_params({ fixture_name: 'jh16_test' });
  assert.strictEqual(v.valid, true);

  const raw = await adapter.fetch(v.normalized_params);
  assert.strictEqual(raw.status, 'SUCCESS');
  
  const obs = adapter.normalize(raw, v.normalized_params);
  assert.strictEqual(obs.length, 2);
  assert.strictEqual(obs[0].entity_id, 'alcohol');
  assert.strictEqual(obs[0].dimension, 'popularity');
  assert.strictEqual(obs[0].result_count, 1000000);
  
  assert.strictEqual(obs[1].entity_id, 'alcohol');
  assert.strictEqual(obs[1].dimension, 'harm');
  assert.strictEqual(obs[1].result_count, 50000);
});

test('SerpAdapter - Validation and normalization', async () => {
  const adapter = new SerpAdapter();
  
  const invalid = adapter.validate_params({});
  assert.strictEqual(invalid.valid, false);
  
  const valid = adapter.validate_params({ query: '"alcohol" harm' });
  assert.strictEqual(valid.valid, true);
  assert.strictEqual(valid.normalized_params.query, '"alcohol" harm');
  assert.strictEqual(valid.normalized_params.safe_search, false);

  const raw = await adapter.fetch(valid.normalized_params);
  const obs = adapter.normalize(raw, valid.normalized_params);
  
  assert.strictEqual(obs.length, 1);
  assert.strictEqual(obs[0].dimension, 'harm'); // should detect 'harm' in query
  assert.strictEqual(obs[0].result_count, 42000);
  assert.strictEqual(obs[0].query_text, '"alcohol" harm');
});
