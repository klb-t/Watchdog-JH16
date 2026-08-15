import { SourceAdapter } from './base';
import { OfflineFixtureAdapter } from './offline_fixture';
import { SerpAdapter } from './serp';
import type { Source } from '../../../shared/types';
import type { Source } from '../../../shared/types';

export interface SourceRegistryEntry {
  adapter?: SourceAdapter;
  status: 'implemented' | 'fixture' | 'planned' | 'blocked-by-license/auth';
  capabilities: string[];
  description: string;
}

export class SourceRegistry {
  private sources: Map<string, SourceRegistryEntry> = new Map();

  constructor() {
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

    // Honest status for planned/blocked sources
    this.register('google_trends', {
      status: 'planned',
      capabilities: ['interest_over_time', 'interest_by_region'],
      description: 'Google Trends time-series index'
    });

    this.register('pubchem', {
      status: 'planned',
      capabilities: ['chemical_properties', 'entity_reference'],
      description: 'PubChem pharmacological reference'
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
      throw new Error(`Source adapter '${id}' cannot be executed. Status: ${entry.status}`);
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
