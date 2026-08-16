import { SourceAdapter, RawFetchResult, Observation, ProvenanceMetadata, ValidatedParams, SourceCapability } from './base';

export class GoogleTrendsAdapter implements SourceAdapter {
  adapter_id = 'google_trends';
  adapter_version = '1.0.0';

  capabilities(): SourceCapability[] {
    return ['interest_over_time'];
  }

  validate_params(params: Record<string, any>): ValidatedParams {
    const errors: string[] = [];
    if (!params.query) errors.push("Missing 'query'");

    return {
      valid: errors.length === 0,
      normalized_params: {
        query: String(params.query || ''),
        geo: params.geo ? String(params.geo) : 'US',
        timeframe: params.timeframe ? String(params.timeframe) : 'today 12-m'
      },
      errors: errors.length > 0 ? errors : undefined
    };
  }

  async fetch(params: Record<string, any>): Promise<RawFetchResult> {
    // In a real implementation, this would call the Google Trends API (via a
    // proxy such as SerpApi, since Trends has no official public API). For
    // this environment, we return a simulated interest-over-time response.
    const fakeResponse = {
      interest_over_time: {
        averages: [{ value: 67 }]
      }
    };

    return {
      payload: Buffer.from(JSON.stringify(fakeResponse), 'utf-8'),
      status: 'SUCCESS',
      http_status: 200,
      metadata: { provider: 'google_trends_mock' }
    };
  }

  normalize(raw: RawFetchResult, params: Record<string, any>): Observation[] {
    if (!raw.payload) return [];

    try {
      const parsed = JSON.parse(raw.payload.toString('utf-8'));

      let avgInterest: number | null = null;
      const averages = parsed.interest_over_time?.averages;
      if (Array.isArray(averages) && typeof averages[0]?.value === 'number') {
        avgInterest = averages[0].value;
      }

      const q = String(params.query || '');

      // Deliberately NOT 'popularity'/'harm': Trends interest is a distinct
      // metric from SERP-style result counts and must never be silently
      // substituted into JH16 FAITHFUL Ni/Ni_harm computation.
      return [{
        entity_id: params.entity_id || 'unknown_entity', // Generic, should be resolved upstream
        dimension: params.dimension || 'interest_index',
        query_text: q,
        result_count: avgInterest,
        retrieved_at: new Date().toISOString(),
        source_id: 'google_trends',
        source_adapter_version: this.adapter_version,
        locale: String(params.geo || 'US'),
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
      attribution: 'Google Trends (mocked pending real HTTP integration)'
    };
  }
}
