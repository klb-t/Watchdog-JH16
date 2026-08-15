import { SourceAdapter, RawFetchResult, Observation, ProvenanceMetadata, ValidatedParams, SourceCapability } from './base';

export class SerpAdapter implements SourceAdapter {
  adapter_id = 'serp_generic';
  adapter_version = '1.0.0';

  capabilities(): SourceCapability[] {
    return ['result_count'];
  }

  validate_params(params: Record<string, any>): ValidatedParams {
    const errors: string[] = [];
    if (!params.query) errors.push("Missing 'query'");
    
    return {
      valid: errors.length === 0,
      normalized_params: {
        query: String(params.query || ''),
        locale: params.locale ? String(params.locale) : 'en',
        safe_search: params.safe_search !== undefined ? Boolean(params.safe_search) : false
      },
      errors: errors.length > 0 ? errors : undefined
    };
  }

  async fetch(params: Record<string, any>): Promise<RawFetchResult> {
    // In a real implementation, this would make an HTTP call to SerpApi or similar.
    // For this environment, we return a simulated network response.
    const fakeResponse = {
      search_metadata: {
        id: "mock_req_123",
        status: "Success",
        created_at: new Date().toISOString()
      },
      search_information: {
        total_results: 42000
      }
    };

    return {
      payload: Buffer.from(JSON.stringify(fakeResponse), 'utf-8'),
      status: 'SUCCESS',
      http_status: 200,
      metadata: { provider: 'serp_generic_mock' }
    };
  }

  normalize(raw: RawFetchResult, params: Record<string, any>): Observation[] {
    if (!raw.payload) return [];
    
    try {
      const parsed = JSON.parse(raw.payload.toString('utf-8'));
      
      let count = null;
      if (parsed.search_information && typeof parsed.search_information.total_results === 'number') {
        count = parsed.search_information.total_results;
      }

      const q = String(params.query || '');
      const q = String(params.query || '');
      return [{
        entity_id: params.entity_id || 'unknown_entity', // Generic, should be resolved upstream
        dimension: params.dimension || 'popularity',
        query_text: q,
        result_count: count,
        retrieved_at: new Date().toISOString(),
        source_id: 'serp_generic',
        source_adapter_version: this.adapter_version,
        locale: String(params.locale || 'en'),
        safe_search: Boolean(params.safe_search),
        raw_artifact_id: raw.raw_blob_id
      }];
    } catch (e) {
      throw new Error(`Normalization error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  provenance(raw: RawFetchResult): ProvenanceMetadata {
    return {
      retention_policy: 'cache_only_as_permitted_by_terms',
      license: 'fair_use_research',
      attribution: 'Generic SERP Provider'
    };
  }
}
