import { test } from 'node:test';
import * as assert from 'node:assert';
import { sourceRegistry } from '../../backend/watchdog_api/sources/registry';
import { OfflineFixtureAdapter } from '../../backend/watchdog_api/sources/offline_fixture';
import { SerpAdapter } from '../../backend/watchdog_api/sources/serp';
import { GoogleTrendsAdapter } from '../../backend/watchdog_api/sources/google_trends';
import { NotImplementedError } from '../../backend/watchdog_api/utils/errors';
import {
  SourceAdapter, SourceRequest, InvalidSourceRequestError
} from '../../backend/watchdog_api/sources/base';

function request(over: Partial<SourceRequest> = {}): SourceRequest {
  return {
    renderedQuery: '"alcohol"',
    dimension: 'popularity',
    entityId: 'alcohol',
    presetId: 'jh2016-faithful',
    presetVersion: '1.0',
    ...over,
  };
}

test('SourceRegistry - Retrieves executable adapters and blocks planned', () => {
  assert.ok(sourceRegistry.getAdapter('offline_fixture') instanceof OfflineFixtureAdapter);
  assert.ok(sourceRegistry.getAdapter('serp_generic') instanceof SerpAdapter);
  assert.ok(sourceRegistry.getAdapter('google_trends') instanceof GoogleTrendsAdapter);

  assert.throws(() => sourceRegistry.getAdapter('pubchem'), NotImplementedError);
});

test('OfflineFixtureAdapter - normalizes to a domain observation', async () => {
  const adapter = new OfflineFixtureAdapter();
  const v = adapter.validate_params({ fixture_name: 'jh16_test' });
  assert.strictEqual(v.valid, true);

  const raw = await adapter.fetch(request({ params: v.normalized_params }));
  assert.strictEqual(raw.status, 'SUCCESS');

  const obs = adapter.normalize(raw);
  assert.strictEqual(obs.length, 1);
  assert.strictEqual(obs[0].entityId, 'alcohol');
  assert.strictEqual(obs[0].queryRole, 'popularity');
  assert.strictEqual(obs[0].isMissing, false);
  assert.strictEqual(obs[0].isMissing === false && obs[0].numericValue, 1000000);
});

test('SerpAdapter - validation and normalization', async () => {
  const adapter = new SerpAdapter();
  const valid = adapter.validate_params({});
  assert.strictEqual(valid.valid, true);
  assert.strictEqual(valid.normalized_params.safe_search, false);

  const raw = await adapter.fetch(request({ renderedQuery: '"alcohol" "harm" OR "harmful"', dimension: 'harm' }));
  const obs = adapter.normalize(raw);

  assert.strictEqual(obs.length, 1);
  assert.strictEqual(obs[0].queryRole, 'harm');
  assert.strictEqual(obs[0].isMissing === false && obs[0].numericValue, 42000);
  assert.strictEqual(obs[0].queryText, '"alcohol" "harm" OR "harmful"');
  // Estimated counts must be flagged as such.
  assert.ok(obs[0].qualityFlags.includes('PROVIDER_ESTIMATE'));
});

test('GoogleTrendsAdapter - interest is not a result count', async () => {
  const adapter = new GoogleTrendsAdapter();
  assert.deepStrictEqual(adapter.capabilities(), ['interest_over_time']);

  const raw = await adapter.fetch(request({ entityId: 'cannabis', renderedQuery: 'cannabis', dimension: 'interest_index' }));
  const obs = adapter.normalize(raw);

  assert.strictEqual(obs.length, 1);
  assert.strictEqual(obs[0].queryRole, 'interest_index');
  assert.strictEqual(obs[0].isMissing === false && obs[0].numericValue, 67);
});

// -------------------------------------------------------------------------
// Adapter neutrality — 09_TESTS.md §Adapter neutrality, 01_ARCHITECTURE.md
// §SourceAdapter. Runs against every registered adapter, present and future.
// -------------------------------------------------------------------------

function executableAdapters(): [string, SourceAdapter][] {
  return sourceRegistry.listSources()
    .filter(s => s.status === 'implemented' || s.status === 'fixture')
    .map(s => [s.source_id, sourceRegistry.getAdapter(s.source_id)] as [string, SourceAdapter]);
}

test('Adapter neutrality: dimension comes from the request, never from query text', async () => {
  const adapters = executableAdapters();
  assert.ok(adapters.length >= 3, 'expected several executable adapters to exercise');

  for (const [id, adapter] of adapters) {
    // Two requests whose rendered queries BOTH contain the word "harm", but
    // whose declared dimensions differ. An adapter that sniffs the text would
    // return the same dimension for both.
    const asHarm = await adapter.fetch(request({
      renderedQuery: '"alcohol" "harm" OR "harmful"', dimension: 'harm'
    }));
    const asPopularity = await adapter.fetch(request({
      renderedQuery: '"alcohol" "harm" OR "harmful"', dimension: 'popularity'
    }));

    const harmObs = adapter.normalize(asHarm);
    const popObs = adapter.normalize(asPopularity);

    assert.strictEqual(harmObs[0].queryRole, 'harm',
      `${id}: must carry the dimension it was given`);
    assert.strictEqual(popObs[0].queryRole, 'popularity',
      `${id}: identical query text with a different declared dimension must not be re-derived from the text`);
  }
});

test('Adapter neutrality: a missing dimension fails validation, never falls back to text', async () => {
  for (const [id, adapter] of executableAdapters()) {
    const broken = { ...request(), dimension: '' } as SourceRequest;

    await assert.rejects(
      async () => adapter.fetch(broken),
      InvalidSourceRequestError,
      `${id}: fetch must reject a request with no dimension`
    );

    // And normalize must refuse too, in case a result is assembled by hand.
    const good = await adapter.fetch(request());
    assert.throws(
      () => adapter.normalize({ ...good, request: broken }),
      InvalidSourceRequestError,
      `${id}: normalize must reject a result whose request lost its dimension`
    );
  }
});
