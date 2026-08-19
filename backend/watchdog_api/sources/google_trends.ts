import {
  SourceAdapter, RawFetchResult, Observation, ProvenanceMetadata, ValidatedParams,
  SourceCapability, SourceRequest, assertValidSourceRequest, baseObservationFields
} from './base';

/**
 * Google Trends interest-over-time.
 *
 * Registered separately from `search.result_count` on purpose:
 * `05_PROVIDERS_AND_CAPABILITIES.md` notes explicitly that normalised relative
 * interest is **not** a result count and must never be substituted for one in a
 * JH2016 run. The `trends.interest` capability and the `interest_index` unit
 * keep that distinction visible in the data rather than relying on convention.
 */
export class GoogleTrendsAdapter implements SourceAdapter {
  readonly adapter_id = 'google_trends_adapter';
  readonly adapter_version = '2.0.0';

  capabilities(): SourceCapability[] {
    return ['interest_over_time'];
  }

  validate_params(params: Record<string, any>): ValidatedParams {
    return {
      valid: true,
      normalized_params: {
        geo: params.geo ? String(params.geo) : 'US',
        timeframe: params.timeframe ? String(params.timeframe) : 'today 12-m'
      }
    };
  }

  async fetch(request: SourceRequest): Promise<RawFetchResult> {
    assertValidSourceRequest(request);

    const fakeResponse = { interest_over_time: { averages: [{ value: 67 }] } };

    return {
      payload: Buffer.from(JSON.stringify(fakeResponse), 'utf-8'),
      status: 'SUCCESS',
      http_status: 200,
      metadata: { provider: 'google_trends_mock' },
      request
    };
  }

  normalize(raw: RawFetchResult): Observation[] {
    assertValidSourceRequest(raw.request);
    if (!raw.payload) return [];

    try {
      const parsed = JSON.parse(raw.payload.toString('utf-8'));
      const base = baseObservationFields(raw, this.adapter_id, this.adapter_version);

      const averages = parsed?.interest_over_time?.averages;
      const value = Array.isArray(averages) && typeof averages[0]?.value === 'number'
        ? averages[0].value
        : null;

      if (value === null) {
        return [{ ...base, isMissing: true, numericValue: null, missingReason: 'PARSE_FAILED', qualityFlags: ['COUNT_PARSE_UNCERTAIN'] }];
      }

      return [{ ...base, isMissing: false, numericValue: value, qualityFlags: [] }];
    } catch (e) {
      throw new Error(`Normalization error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  provenance(_raw: RawFetchResult): ProvenanceMetadata {
    return {
      retention_policy: 'cache_only_as_permitted_by_terms',
      license: 'fair_use_research',
      attribution: 'Google Trends (mocked pending real HTTP integration)'
    };
  }
}
