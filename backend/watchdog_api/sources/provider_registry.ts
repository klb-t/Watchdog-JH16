import { NotImplementedError } from '../utils/errors';

/**
 * Capability / Provider / Credential, per D5 and
 * `05_PROVIDERS_AND_CAPABILITIES.md`.
 *
 * Three orthogonal concepts that are commonly and damagingly conflated:
 *
 *  - a **source** is an epistemic entity — what is being measured;
 *  - a **capability** is an abstract service contract, e.g. `search.result_count`;
 *  - a **provider** is a commercial instance that serves a capability.
 *
 * Providers are configured in stack settings and **never appear on the Sources
 * page**: which vendor is billed is an operational concern, not a study-design
 * one. `listForSourcesPage()` exists to make that boundary enforceable rather
 * than merely documented.
 */

export type RegistryStatus = 'implemented' | 'fixture' | 'planned' | 'blocked' | 'proposed';

export interface Capability {
  capability_key: string;
  display_name: string;
  input_contract: string;
  output_contract: string;
}

export interface Provider {
  provider_key: string;
  capability_key: string;
  display_name: string;
  adapter_id?: string;
  adapter_version?: string;
  status: RegistryStatus;
  /** Set when a provider was discovered at runtime rather than configured. */
  discovery_provenance?: string;
  approved_by?: string;
  approved_at?: string;
}

export interface Credential {
  provider_key: string;
  /** A pointer into the secret store. Never a key. */
  secret_ref: string;
  status: 'present' | 'absent' | 'invalid';
}

export class ProviderNotSelectableError extends Error {
  readonly code = 'validation_error';
  constructor(providerKey: string, status: RegistryStatus, detail: string) {
    super(`Provider '${providerKey}' cannot be selected for a run (status: ${status}). ${detail}`);
    this.name = 'ProviderNotSelectableError';
  }
}

export class CapabilityRegistry {
  private capabilities = new Map<string, Capability>();
  private providers = new Map<string, Provider>();
  private credentials = new Map<string, Credential>();

  constructor() {
    this.registerCapability({
      capability_key: 'search.result_count',
      display_name: 'Estimated result count for a quoted query',
      input_contract: 'rendered query string, locale, safe-search setting',
      output_contract: 'integer count >= 0, or missing with a reason',
    });
    this.registerCapability({
      capability_key: 'text.generate',
      display_name: 'Language model text generation',
      input_contract: 'prompt, generation parameters',
      output_contract: 'text, PROPOSED until a human approves it',
    });
    this.registerCapability({
      capability_key: 'trends.interest',
      display_name: 'Normalised relative search interest',
      input_contract: 'term, geography, timeframe',
      // Stated in the registry itself, not only in prose, because this is the
      // substitution D5 exists to prevent.
      output_contract: 'relative interest index 0-100 — NOT a result count, and never substitutable for one in a JH2016 run',
    });
    this.registerCapability({
      capability_key: 'reference.chemical',
      display_name: 'Chemical and pharmacological reference data',
      input_contract: 'substance identifier',
      output_contract: 'structured reference record',
    });

    // The only provider E1 can actually run.
    this.registerProvider({
      provider_key: 'fixture',
      capability_key: 'search.result_count',
      display_name: 'Frozen offline fixtures',
      adapter_id: 'fixture_jh2016',
      adapter_version: '1.0.0',
      status: 'fixture',
    });

    // Seed list, registered honestly as plans. Registry entries are not
    // capabilities: none of these may be selected, counted as available, or
    // rendered by the UI as though it worked.
    for (const key of ['serpapi', 'serper', 'dataforseo', 'google_custom_search']) {
      this.registerProvider({
        provider_key: key, capability_key: 'search.result_count',
        display_name: key, status: 'planned',
      });
    }
    for (const key of ['anthropic', 'openai', 'google_gemini', 'xai', 'mistral', 'openrouter',
                       'together', 'openai_compatible_manual']) {
      this.registerProvider({
        provider_key: key, capability_key: 'text.generate', display_name: key, status: 'planned',
      });
    }
    this.registerProvider({
      provider_key: 'google_trends', capability_key: 'trends.interest',
      display_name: 'Google Trends', status: 'planned',
    });
    for (const key of ['pubchem', 'drugbank', 'wikipedia']) {
      this.registerProvider({
        provider_key: key, capability_key: 'reference.chemical', display_name: key, status: 'planned',
      });
    }
  }

  registerCapability(c: Capability) { this.capabilities.set(c.capability_key, c); }
  registerProvider(p: Provider) { this.providers.set(p.provider_key, p); }
  setCredential(c: Credential) { this.credentials.set(c.provider_key, c); }

  getCapability(key: string): Capability | undefined { return this.capabilities.get(key); }
  getProvider(key: string): Provider | undefined { return this.providers.get(key); }

  listCapabilities(): Capability[] {
    return [...this.capabilities.values()].sort((a, b) => a.capability_key.localeCompare(b.capability_key));
  }

  listProviders(): Provider[] {
    return [...this.providers.values()].sort((a, b) => a.provider_key.localeCompare(b.provider_key));
  }

  /**
   * Deliberately empty and deliberately present. Providers never appear on the
   * Sources page; a test asserts this stays true, so the boundary cannot erode
   * by someone wiring `listProviders()` into that view.
   */
  listForSourcesPage(): never[] { return []; }

  /** Only `implemented` and `fixture` may run, and `fixture` is offline-only. */
  isSelectable(key: string): boolean {
    const p = this.providers.get(key);
    return !!p && (p.status === 'implemented' || p.status === 'fixture');
  }

  /**
   * The gate every run passes through. A `planned`, `blocked` or `proposed`
   * provider throws rather than returning anything a caller might use.
   */
  assertSelectable(key: string): Provider {
    const p = this.providers.get(key);
    if (!p) throw new ProviderNotSelectableError(key, 'planned', 'No such provider is registered.');

    if (p.status === 'proposed') {
      throw new ProviderNotSelectableError(key, p.status,
        'Discovered providers require human approval before use — a system that can silently ' +
        'start using a new vendor can silently change its own measurement instrument.');
    }
    if (p.status === 'planned' || p.status === 'blocked') {
      throw new NotImplementedError(key, p.status);
    }
    return p;
  }

  /**
   * Runtime discovery is permitted; automatic use is not. A discovered
   * provider enters as `proposed` and stays unusable until approved.
   */
  recordDiscovered(p: Omit<Provider, 'status' | 'approved_by' | 'approved_at'>): Provider {
    const provider: Provider = { ...p, status: 'proposed' };
    this.registerProvider(provider);
    return provider;
  }

  approveDiscovered(key: string, approvedBy: string, approvedAt: string): Provider {
    const p = this.providers.get(key);
    if (!p) throw new ProviderNotSelectableError(key, 'planned', 'No such provider is registered.');
    if (!approvedBy || approvedBy.trim() === '') {
      throw new ProviderNotSelectableError(key, p.status, 'Approval requires an identified human actor.');
    }
    const approved: Provider = { ...p, status: 'implemented', approved_by: approvedBy, approved_at: approvedAt };
    this.registerProvider(approved);
    return approved;
  }
}

export const capabilityRegistry = new CapabilityRegistry();
