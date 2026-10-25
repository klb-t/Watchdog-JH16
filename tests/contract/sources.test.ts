import { test } from 'node:test';
import * as assert from 'node:assert';
import { sourceRegistry } from '../../backend/watchdog_api/sources/registry';
import { OfflineFixtureAdapter } from '../../backend/watchdog_api/sources/offline_fixture';
import { GoogleTrendsAdapter } from '../../backend/watchdog_api/sources/google_trends';
import { SerpApiAdapter } from '../../backend/watchdog_api/sources/serpapi';
import { loadSearchProviderConfig } from '../../backend/watchdog_api/sources/search_providers';
import { SecretStore, EnvSecretProvider } from '../../backend/watchdog_api/secrets';
import { NotImplementedError } from '../../backend/watchdog_api/utils/errors';
import {
  SourceAdapter, SourceRequest, InvalidSourceRequestError
} from '../../backend/watchdog_api/sources/base';

function request(over: Partial<SourceRequest> = {}): SourceRequest {
  return {
    renderedQuery: '"alcohol"',
    dimension: 'popularity',
    entityId: 'alcohol',
    language: 'en',
    queryExpansionMode: 'STRICT_CANONICAL',
    presetId: 'jh2016-faithful',
    presetVersion: '1.0',
    ...over,
  };
}

test('SourceRegistry - Retrieves executable adapters and blocks planned', () => {
  assert.ok(sourceRegistry.getAdapter('offline_fixture') instanceof OfflineFixtureAdapter);
  assert.throws(() => sourceRegistry.getAdapter('serp_generic'), NotImplementedError);
  assert.throws(() => sourceRegistry.getAdapter('trends_interest_index'), NotImplementedError);

  assert.throws(() => sourceRegistry.getAdapter('chemical_reference'), NotImplementedError);
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

test('GoogleTrendsAdapter - unimplemented transport never invents a measurement', async () => {
  const adapter = new GoogleTrendsAdapter();
  assert.deepStrictEqual(adapter.capabilities(), ['interest_over_time']);

  await assert.rejects(() => adapter.fetch(request({ entityId: 'cannabis', renderedQuery: 'cannabis', dimension: 'interest_index' })), NotImplementedError);
  assert.strictEqual(sourceRegistry.getEntry('trends_interest_index')?.status, 'planned');
});

// -------------------------------------------------------------------------
// Adapter neutrality — 09_TESTS.md §Adapter neutrality, 01_ARCHITECTURE.md
// §SourceAdapter. Runs against every registered adapter, present and future.
// -------------------------------------------------------------------------

/** Params each adapter legitimately requires, so neutrality is tested on a valid request. */
function paramsFor(id: string): Record<string, any> {
  if (id === 'fixture_jh2016') return { fixture_set: 'faithful_2014-06-20' };
  if (id === 'offline_fixture') return { fixture_name: 'jh16_test' };
  return {};
}

/** The live SERP adapter, credentialled and with a recorded-shape response instead of the network. */
async function stubbedSerpApi(): Promise<SourceAdapter> {
  const config = loadSearchProviderConfig().config.providers.find(p => p.provider_key === 'serpapi')!;
  const credential = await new SecretStore([new EnvSecretProvider({ SERPAPI_API_KEY: 'neutrality-test-key-0123' })]).resolve(config.secret_ref);
  const body = JSON.stringify({ search_metadata: { id: 'srp-n', status: 'Success' }, search_information: { total_results: 1234567 } });
  return new SerpApiAdapter(config, credential, async () => ({ ok: true, status: 200, text: async () => body }), async () => {});
}

async function executableAdapters(): Promise<[string, SourceAdapter][]> {
  return [...sourceRegistry.listSources()
    .filter(s => s.status === 'implemented' || s.status === 'fixture')
    .map(s => [s.source_id, sourceRegistry.getAdapter(s.source_id)] as [string, SourceAdapter]),
    ['serp_result_count', await stubbedSerpApi()]];
}

test('Adapter neutrality: dimension comes from the request, never from query text', async () => {
  const adapters = await executableAdapters();
  assert.ok(adapters.length >= 3, 'expected several executable adapters to exercise');

  for (const [id, adapter] of adapters) {
    // Two requests whose rendered queries BOTH contain the word "harm", but
    // whose declared dimensions differ. An adapter that sniffs the text would
    // return the same dimension for both.
    const asHarm = await adapter.fetch(request({
      renderedQuery: '"alcohol" "harm" OR "harmful"', dimension: 'harm', params: paramsFor(id)
    }));
    const asPopularity = await adapter.fetch(request({
      renderedQuery: '"alcohol" "harm" OR "harmful"', dimension: 'popularity', params: paramsFor(id)
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
  for (const [id, adapter] of await executableAdapters()) {
    const broken = { ...request({ params: paramsFor(id) }), dimension: '' } as SourceRequest;

    await assert.rejects(
      async () => adapter.fetch(broken),
      InvalidSourceRequestError,
      `${id}: fetch must reject a request with no dimension`
    );

    // And normalize must refuse too, in case a result is assembled by hand.
    const good = await adapter.fetch(request({ params: paramsFor(id) }));
    assert.throws(
      () => adapter.normalize({ ...good, request: broken }),
      InvalidSourceRequestError,
      `${id}: normalize must reject a result whose request lost its dimension`
    );
  }
});

test('Query-plan identity: language and expansion mode are required, never defaulted (D15)', async () => {
  for (const [id, adapter] of await executableAdapters()) {
    const noLanguage = { ...request({ params: paramsFor(id) }), language: '' } as SourceRequest;
    await assert.rejects(async () => adapter.fetch(noLanguage), InvalidSourceRequestError,
      `${id}: a query plan with no language must be rejected, not assumed`);

    const noMode = { ...request({ params: paramsFor(id) }), queryExpansionMode: undefined } as unknown as SourceRequest;
    await assert.rejects(async () => adapter.fetch(noMode), InvalidSourceRequestError,
      `${id}: a query plan with no expansion mode must be rejected, not assumed`);

    const badMode = { ...request({ params: paramsFor(id) }), queryExpansionMode: 'GUESS' } as unknown as SourceRequest;
    await assert.rejects(async () => adapter.fetch(badMode), InvalidSourceRequestError,
      `${id}: an unknown expansion mode must be rejected`);

    // Same discipline on the normalize side.
    const good = await adapter.fetch(request({ params: paramsFor(id) }));
    assert.throws(() => adapter.normalize({ ...good, request: noLanguage }), InvalidSourceRequestError);
  }
});
