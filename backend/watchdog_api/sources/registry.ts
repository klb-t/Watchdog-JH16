import { SourceAdapter } from './base';
import { OfflineFixtureAdapter } from './offline_fixture';
import { FixtureSourceAdapter } from './fixture_source';
import { NotImplementedError } from '../utils/errors';
import type { Source } from '../../../src/types';

export interface SourceRegistryEntry {
  adapter?: SourceAdapter;
  status: 'implemented' | 'fixture' | 'planned' | 'blocked' | 'blocked-by-license/auth';
  /** Test-only data: resolvable for tests, never listed in the product (no trace in normal use). */
  internal?: boolean;
  capabilities: string[];
  description: string;
  /**
   * Live sources build their adapter per call, because it needs a credential
   * that is resolved at request time rather than at module load. Present only
   * for sources that reach the network.
   */
  resolve?: () => Promise<SourceAdapter>;
  /**
   * Derives the *current* status. A live source is `implemented` only while
   * its credential resolves, so status cannot be a value fixed at
   * registration — that is the stored-flag mistake D5 warns about, applied to
   * sources instead of providers.
   */
  liveStatus?: () => Promise<LiveStatus>;
}

/** `remediation_code`/`remediation_params` identify the English `remediation` so an interface can show it in the reader's language. */
export interface LiveStatus {
  status: SourceRegistryEntry['status'];
  remediation: string;
  remediation_code?: string;
  remediation_params?: Record<string, string>;
}

export class SourceRegistry {
  private sources: Map<string, SourceRegistryEntry> = new Map();

  constructor() {
    // The only source E1 actually runs on: frozen JSON, no network.
    this.register('fixture_jh2016', {
      adapter: new FixtureSourceAdapter(),
      status: 'fixture',
      capabilities: ['result_count'],
      description: 'Liczby wyników z Tabel 1 i 3 publikacji JH16 (2014), zapisane w repozytorium — do przeliczenia i kontroli obliczeń, nie nowy pomiar.'
    });

    this.register('offline_fixture', {
      adapter: new OfflineFixtureAdapter(),
      status: 'fixture',
      internal: true,
      capabilities: ['result_count', 'numeric_reference_table'],
      description: 'Test-only frozen data for reproducibility tests; not listed in the product.'
    });

    // Formerly a 'fixture' adapter that answered every query with the same
    // invented count (42000) and could be selected for a run. A constant that
    // ignores its input is a fabricated measurement, so it is no longer
    // executable. Live counts come from serp_result_count.
    this.register('serp_generic', {
      status: 'planned',
      capabilities: ['result_count'],
      description: 'Generic SERP adapter: not implemented. Live search result counts are the serp_result_count source.'
    });

    // Named for what is measured, not for who serves it: 'google_trends' is a
    // PROVIDER key and lives in the provider registry. Using the vendor's name
    // as a source id is exactly the Source/Provider conflation D5 forbids, and
    // a test in tests/contract/providers.test.ts now fails if it reappears.
    this.register('trends_interest_index', {
      status: 'blocked',
      capabilities: ['interest_over_time'],
      description: 'Google Trends interest over time via SerpApi. Relative search interest, a distinct signal from SERP result counts — never a substitute for JH16 FAITHFUL Ni/Ni_harm.',
      resolve: async () => {
        const { GoogleTrendsAdapter, loadTrendsProviderConfig } = await import('./google_trends');
        const { secretStore } = await import('../secrets');
        const provider = loadTrendsProviderConfig().provider;
        return new GoogleTrendsAdapter(provider, await secretStore.resolve(provider.secret_ref));
      },
      liveStatus: async () => {
        const { loadTrendsProviderConfig } = await import('./google_trends');
        const { secretStore } = await import('../secrets');
        const provider = loadTrendsProviderConfig().provider, cred = await secretStore.resolve(provider.secret_ref);
        return cred.isPresent ? { status: 'implemented' as const, remediation: '' }
          : { status: 'blocked' as const, remediation: `Set ${provider.secret_ref} for the installation, or use a personal SerpApi key in the settings wizard.`,
            remediation_code: 'set_secret_or_personal_key', remediation_params: { ref: provider.secret_ref } };
      },
    });

    this.register('trends_interest_by_region', {
      status: 'blocked',
      capabilities: ['interest_by_region'],
      description: 'Google Trends interest by region (one query per request) via SerpApi. Relative search interest scaled 0-100 within the request, never a count.',
      resolve: async () => {
        const { GoogleTrendsAdapter, loadTrendsProviderConfig, TRENDS_BY_REGION_CONFIG_PATH } = await import('./google_trends');
        const { secretStore } = await import('../secrets');
        const provider = loadTrendsProviderConfig(TRENDS_BY_REGION_CONFIG_PATH).provider;
        return new GoogleTrendsAdapter(provider, await secretStore.resolve(provider.secret_ref));
      },
      liveStatus: async () => {
        const { loadTrendsProviderConfig, TRENDS_BY_REGION_CONFIG_PATH } = await import('./google_trends');
        const { secretStore } = await import('../secrets');
        const provider = loadTrendsProviderConfig(TRENDS_BY_REGION_CONFIG_PATH).provider, cred = await secretStore.resolve(provider.secret_ref);
        return cred.isPresent ? { status: 'implemented' as const, remediation: '' }
          : { status: 'blocked' as const, remediation: `Set ${provider.secret_ref} for the installation, or use a personal SerpApi key (replication measurements use it).`,
            remediation_code: 'set_secret_or_personal_key_replication', remediation_params: { ref: provider.secret_ref } };
      },
    });

    // Honest status for planned/blocked sources
    // Again named for the measurement, not the vendor: PubChem, DrugBank and
    // Wikipedia are interchangeable PROVIDERS of this one source.
    this.register('chemical_reference', {
      status: 'planned',
      capabilities: ['chemical_properties', 'entity_reference'],
      description: 'Chemical and pharmacological reference record for a substance'
    });

    // The live SERP source (E3.2). Named for what it measures, not for the
    // vendor: SerpApi, Serper and DataForSEO are interchangeable *providers*
    // of this one source, and using a vendor name as a source id is the
    // Source/Provider conflation D5 forbids.
    this.register('serp_result_count', {
      status: 'blocked',
      capabilities: ['result_count'],
      description: 'Live estimated result counts from a search engine, via a configured SERP provider',
      resolve: async () => (await import('./search_providers'))
        .buildSearchProviderRegistry().adapter('serpapi'),
      liveStatus: async () => {
        const a = await (await import('./search_providers'))
          .buildSearchProviderRegistry().availability('serpapi');
        return {
          status: a.status === 'implemented' ? 'implemented' as const : 'blocked' as const,
          remediation: a.remediation,
          ...(a.remediationCode ? { remediation_code: a.remediationCode, remediation_params: a.remediationParams } : {}),
        };
      },
    });

    this.register('scientific_literature', {
      status: 'planned',
      capabilities: ['scientific_literature', 'entity_reference'],
      description: 'DOI/Crossref bibliographic metadata'
    });

    this.register('erowid', {
      status: 'blocked-by-license/auth',
      capabilities: ['free_text_reports'],
      description: 'Erowid trip reports - pending authorized access'
    });
    
    this.register('drug_checking', {
      status: 'planned',
      capabilities: ['lab_sample'],
      description: 'Laboratory drug checking results'
    });
    
    this.register('manual_dataset', {
      status: 'planned',
      capabilities: ['manual_dataset'],
      description: 'User uploaded CSV/Parquet data'
    });
  }

  public register(id: string, entry: SourceRegistryEntry) {
    this.sources.set(id, entry);
  }

  /**
   * Resolves an adapter, including live ones that need a credential.
   *
   * `getAdapter` stays for the offline sources every existing caller uses; this
   * is the path a live run takes. Two methods rather than making the old one
   * async, because turning a synchronous call async across the codebase to
   * serve one new case is a change with a wide blast radius and no benefit to
   * the callers it touches.
   */
  public async resolveAdapter(id: string): Promise<SourceAdapter> {
    const entry = this.sources.get(id);
    if (!entry) throw new Error(`Source adapter not found: ${id}`);

    if (entry.resolve) {
      const live = entry.liveStatus ? await entry.liveStatus() : { status: entry.status, remediation: '' };
      if (live.status !== 'implemented' && live.status !== 'fixture') {
        throw new NotImplementedError(id, `${live.status}. ${live.remediation}`);
      }
      return entry.resolve();
    }
    return this.getAdapter(id);
  }

  /** Status as it is right now, credentials included. */
  public async describe(id: string): Promise<{ status: string; remediation: string; remediation_code?: string; remediation_params?: Record<string, string> }> {
    const entry = this.sources.get(id);
    if (!entry) throw new Error(`Source adapter not found: ${id}`);
    if (entry.liveStatus) return entry.liveStatus();
    return { status: entry.status, remediation: '' };
  }

  public async listWithLiveStatus(includeInternal = false) {
    return Promise.all(this.listSources(includeInternal).map(async s => ({
      ...s,
      ...(await this.describe(s.source_id)),
    })));
  }

  public getAdapter(id: string): SourceAdapter {
    const entry = this.sources.get(id);
    if (!entry) throw new Error(`Source adapter not found: ${id}`);
    if (!entry.adapter || entry.status !== 'implemented' && entry.status !== 'fixture') {
      throw new NotImplementedError(id, entry.status);
    }
    return entry.adapter;
  }
  
  public getEntry(id: string): SourceRegistryEntry | undefined {
    return this.sources.get(id);
  }

  public listSources(includeInternal = false): Source[] {
    return Array.from(this.sources.entries()).filter(([, entry]) => includeInternal || !entry.internal).map(([id, entry]) => ({
      source_id: id,
      adapter: entry.adapter ? entry.adapter.constructor.name : 'Unknown',
      status: entry.status,
      capabilities: entry.capabilities,
      description: entry.description
    }));
  }
}

export const sourceRegistry = new SourceRegistry();
