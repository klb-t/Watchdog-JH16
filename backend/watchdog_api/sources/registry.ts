import { SourceAdapter } from './base';
import { OfflineFixtureAdapter } from './offline_fixture';
import { SerpAdapter } from './serp';
import { GoogleTrendsAdapter } from './google_trends';
import { FixtureSourceAdapter } from './fixture_source';
import { NotImplementedError } from '../utils/errors';
import type { Source } from '../../../src/types';

export interface SourceRegistryEntry {
  adapter?: SourceAdapter;
  status: 'implemented' | 'fixture' | 'planned' | 'blocked-by-license/auth';
  capabilities: string[];
  description: string;
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
