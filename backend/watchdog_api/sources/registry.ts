import { SourceAdapter } from './base';
import { OfflineFixtureAdapter } from './offline_fixture';
import { SerpAdapter } from './serp';
import { GoogleTrendsAdapter } from './google_trends';
import { FixtureSourceAdapter } from './fixture_source';
import { NotImplementedError } from '../utils/errors';
import type { Source } from '../../../src/types';

export interface SourceRegistryEntry {
  adapter?: SourceAdapter;
  status: 'implemented' | 'fixture' | 'planned' | 'blocked' | 'blocked-by-license/auth';
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
  liveStatus?: () => Promise<{ status: SourceRegistryEntry['status']; remediation: string }>;
}

export class SourceRegistry {
  private sources: Map<string, SourceRegistryEntry> = new Map();

  constructor() {
    // The only source E1 actually runs on: frozen JSON, no network.
    this.register('fixture_jh2016', {
      adapter: new FixtureSourceAdapter(),
      status: 'fixture',
      capabilities: ['result_count'],
      description: 'Frozen JH2016 fixtures read from fixtures/jh2016/ — the E1 offline source'
    });

    this.register('offline_fixture', {
      adapter: new OfflineFixtureAdapter(),
      status: 'fixture',
      capabilities: ['result_count', 'numeric_reference_table'],
      description: 'Frozen offline data for reproducibility testing'
    });

    this.register('serp_generic', {
      adapter: new SerpAdapter(),
      status: 'fixture',
      capabilities: ['result_count'],
      description: 'SERP API fixture (mocked until real HTTP fetch is implemented)'
    });

    // Named for what is measured, not for who serves it: 'google_trends' is a
    // PROVIDER key and lives in the provider registry. Using the vendor's name
    // as a source id is exactly the Source/Provider conflation D5 forbids, and
    // a test in tests/contract/providers.test.ts now fails if it reappears.
    this.register('trends_interest_index', {
      adapter: new GoogleTrendsAdapter(),
      status: 'fixture',
      capabilities: ['interest_over_time'],
      description: 'Google Trends interest-over-time index (mocked until real HTTP fetch is implemented). A distinct signal from SERP result counts — not a substitute for JH16 FAITHFUL Ni/Ni_harm.'
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
  public async describe(id: string): Promise<{ status: string; remediation: string }> {
    const entry = this.sources.get(id);
    if (!entry) throw new Error(`Source adapter not found: ${id}`);
    if (entry.liveStatus) return entry.liveStatus();
    return { status: entry.status, remediation: '' };
  }

  public async listWithLiveStatus() {
    return Promise.all(this.listSources().map(async s => ({
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

  public listSources(): Source[] {
    return Array.from(this.sources.entries()).map(([id, entry]) => ({
      source_id: id,
      adapter: entry.adapter ? entry.adapter.constructor.name : 'Unknown',
      status: entry.status,
      capabilities: entry.capabilities,
      description: entry.description
    }));
  }
}

export const sourceRegistry = new SourceRegistry();
