import {
  SourceAdapter, RawFetchResult, Observation, ProvenanceMetadata, ValidatedParams,
  SourceCapability, SourceRequest, assertValidSourceRequest, baseObservationFields
} from './base';

export class SerpAdapter implements SourceAdapter {
  readonly adapter_id = 'serp_generic';
  readonly adapter_version = '2.0.0';

  capabilities(): SourceCapability[] {
    return ['result_count'];
  }

  validate_params(params: Record<string, any>): ValidatedParams {
    return {
      valid: true,
      normalized_params: {
        locale: params.locale ? String(params.locale) : 'en',
        safe_search: params.safe_search !== undefined ? Boolean(params.safe_search) : false
      }
    };
  }

  async fetch(request: SourceRequest): Promise<RawFetchResult> {
    assertValidSourceRequest(request);

    // A real implementation would call SerpApi or an equivalent here. This
    // adapter is registered with status 'fixture' precisely because it does
    // not, and it must never be reported as a live capability.
    const fakeResponse = {
      search_metadata: { id: 'mock_req_123', status: 'Success' },
      search_information: { total_results: 42000 }
    };

    return {
      payload: Buffer.from(JSON.stringify(fakeResponse), 'utf-8'),
      status: 'SUCCESS',
      http_status: 200,
      metadata: { provider: 'serp_generic_mock' },
      request
    };
  }

  normalize(raw: RawFetchResult): Observation[] {
    assertValidSourceRequest(raw.request);
    if (!raw.payload) return [];

    try {
      const parsed = JSON.parse(raw.payload.toString('utf-8'));
      const base = baseObservationFields(raw, this.adapter_id, this.adapter_version);

      const total = parsed?.search_information?.total_results;
      if (typeof total !== 'number') {
        // Unparseable is missing, never zero.
        return [{
          ...base,
          isMissing: true,
          numericValue: null,
          missingReason: 'PARSE_FAILED',
          qualityFlags: ['COUNT_PARSE_UNCERTAIN'],
        }];
      }

      return [{
        ...base,
        isMissing: false,
        numericValue: total,
        // Search engines report estimates that vary between requests.
        qualityFlags: ['PROVIDER_ESTIMATE'],
      }];
    } catch (e) {
      throw new Error(`Normalization error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  provenance(_raw: RawFetchResult): ProvenanceMetadata {
    return {
      retention_policy: 'cache_only_as_permitted_by_terms',
      license: 'fair_use_research',
      attribution: 'Generic SERP Provider'
    };
  }
}
