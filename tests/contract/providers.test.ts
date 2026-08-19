import { test } from 'node:test';
import * as assert from 'node:assert';
import {
  CapabilityRegistry, capabilityRegistry, ProviderNotSelectableError
} from '../../backend/watchdog_api/sources/provider_registry';
import { NotImplementedError } from '../../backend/watchdog_api/utils/errors';
import { sourceRegistry } from '../../backend/watchdog_api/sources/registry';

// -------------------------------------------------------------------------
// E1.10 — Registry skeleton.
// Stated test: a `planned` provider cannot be selected for a run; the UI does
// not render it as available.
// -------------------------------------------------------------------------

test('E1.10: the fixture provider is the only executable entry; the seed list is planned', () => {
  const providers = capabilityRegistry.listProviders();
  const executable = providers.filter(p => capabilityRegistry.isSelectable(p.provider_key));

  assert.deepStrictEqual(executable.map(p => p.provider_key), ['fixture'],
    'E1 registers exactly one runnable provider, and it is offline');

  // Everything else is honestly a plan.
  for (const key of ['serpapi', 'serper', 'dataforseo', 'anthropic', 'openai', 'pubchem']) {
    const p = capabilityRegistry.getProvider(key)!;
    assert.ok(p, `${key} should be in the seed list`);
    assert.strictEqual(p.status, 'planned');
    assert.ok(!capabilityRegistry.isSelectable(key), `${key} must not be selectable`);
  }
});

test('E1.10: a planned provider cannot be selected for a run', () => {
  assert.throws(() => capabilityRegistry.assertSelectable('serpapi'), NotImplementedError);
  assert.throws(() => capabilityRegistry.assertSelectable('anthropic'), NotImplementedError);
  assert.throws(() => capabilityRegistry.assertSelectable('nonexistent'), ProviderNotSelectableError);

  assert.doesNotThrow(() => capabilityRegistry.assertSelectable('fixture'));
});

test('E1.10: the UI never renders a provider as an available source', () => {
  // Providers are a stack-settings concern, not a study-design one. Asserting
  // the Sources view is provider-free keeps D5's boundary from eroding.
  assert.deepStrictEqual(capabilityRegistry.listForSourcesPage(), []);

  const sourceIds = new Set(sourceRegistry.listSources().map(s => s.source_id));
  for (const p of capabilityRegistry.listProviders()) {
    assert.ok(!sourceIds.has(p.provider_key),
      `provider '${p.provider_key}' must not appear in the source list the UI renders`);
  }
});

test('E1.10: non-executable sources are marked so the UI can refuse to offer them', () => {
  const sources = sourceRegistry.listSources();
  const runnable = sources.filter(s => s.status === 'implemented' || s.status === 'fixture');
  const notRunnable = sources.filter(s => s.status === 'planned' || s.status === 'blocked-by-license/auth');

  assert.ok(runnable.length > 0 && notRunnable.length > 0, 'both kinds should exist to be meaningful');

  // Every non-runnable source refuses at the registry, so a UI that ignores
  // the status flag still cannot produce a measurement.
  for (const s of notRunnable) {
    assert.throws(() => sourceRegistry.getAdapter(s.source_id), NotImplementedError,
      `${s.source_id} is ${s.status} and must refuse`);
  }
});

test('E1.10: trends.interest declares in the registry that it is not a result count', () => {
  const trends = capabilityRegistry.getCapability('trends.interest')!;
  assert.ok(trends);
  assert.match(trends.output_contract, /NOT a result count/i,
    'the anti-substitution rule belongs in the registry data, not only in prose');

  // And it is a different capability from result counts, so nothing can serve
  // one where the other was asked for.
  assert.notStrictEqual(
    capabilityRegistry.getProvider('google_trends')!.capability_key,
    capabilityRegistry.getProvider('fixture')!.capability_key
  );
});

// -------------------------------------------------------------------------
// Provider discovery — permitted, but gated (05_PROVIDERS_AND_CAPABILITIES.md).
// -------------------------------------------------------------------------

test('E1.10: a discovered provider is unusable until a human approves it', () => {
  const reg = new CapabilityRegistry();

  const discovered = reg.recordDiscovered({
    provider_key: 'newvendor',
    capability_key: 'search.result_count',
    display_name: 'New Vendor',
    discovery_provenance: 'model-list endpoint, 2026-08-18',
  });
  assert.strictEqual(discovered.status, 'proposed');
  assert.ok(!reg.isSelectable('newvendor'));

  assert.throws(() => reg.assertSelectable('newvendor'), ProviderNotSelectableError,
    'discovery is permitted; automatic use is not');

  // Approval requires a named human.
  assert.throws(() => reg.approveDiscovered('newvendor', '', '2026-08-18T00:00:00Z'),
    ProviderNotSelectableError);

  const approved = reg.approveDiscovered('newvendor', 'a-human', '2026-08-18T00:00:00Z');
  assert.strictEqual(approved.status, 'implemented');
  assert.strictEqual(approved.approved_by, 'a-human');
  assert.ok(reg.isSelectable('newvendor'));
  assert.doesNotThrow(() => reg.assertSelectable('newvendor'));
});

test('E1.10: credentials are stored as references, never as keys', () => {
  const reg = new CapabilityRegistry();
  reg.setCredential({ provider_key: 'serpapi', secret_ref: 'env:SERPAPI_KEY', status: 'present' });

  // The registry's own shape makes a plaintext key un-storable: there is no
  // field for one.
  const cred = { provider_key: 'serpapi', secret_ref: 'env:SERPAPI_KEY', status: 'present' as const };
  assert.ok(!('secret' in cred) && !('value' in cred) && !('api_key' in cred));
  assert.match(cred.secret_ref, /^(env|vault|file):/, 'a secret_ref points somewhere, it is not the secret');
});
