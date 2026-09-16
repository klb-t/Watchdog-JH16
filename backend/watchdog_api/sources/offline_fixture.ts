import {
  SourceAdapter, RawFetchResult, Observation, ProvenanceMetadata, ValidatedParams,
  SourceCapability, SourceRequest, assertValidSourceRequest, baseObservationFields
} from './base';

/**
 * Offline fixture source.
 *
 * E1.3 moved this onto the `SourceRequest` contract. E1.8/E1.9 replace the
 * inline payload below with frozen JSON read from `fixtures/jh2016/`.
 */
export class OfflineFixtureAdapter implements SourceAdapter {
  readonly adapter_id = 'offline_fixture';
  readonly adapter_version = '2.0.0';

  capabilities(): SourceCapability[] {
    return ['result_count', 'numeric_reference_table'];
  }

  validate_params(params: Record<string, any>): ValidatedParams {
    if (!params.fixture_name) {
      return { valid: false, normalized_params: {}, errors: ["Missing 'fixture_name'"] };
    }
    return { valid: true, normalized_params: { fixture_name: String(params.fixture_name) } };
  }

  async fetch(request: SourceRequest): Promise<RawFetchResult> {
    assertValidSourceRequest(request);

    // Count depends on the entity and dimension the preset asked for — never
    // on inspecting the query text.
    const counts: Record<string, Record<string, number>> = {
      alcohol: { popularity: 1000000, harm: 50000 },
      cannabis: { popularity: 500000, harm: 10000 },
      heroin: { popularity: 100000, harm: 20000 },
    };
    const count = counts[request.entityId]?.[request.dimension];

    return {
      payload: Buffer.from(JSON.stringify({ query: request.renderedQuery, count: count ?? null }), 'utf-8'),
      status: 'SUCCESS',
      http_status: 200,
      metadata: { fixture: request.params?.fixture_name ?? 'inline' },
      request
    };
  }

  normalize(raw: RawFetchResult): Observation[] {
    assertValidSourceRequest(raw.request);
    if (!raw.payload) return [];

    try {
      const parsed = JSON.parse(raw.payload.toString('utf-8'));
      const base = baseObservationFields(raw, this.adapter_id, this.adapter_version);

      if (typeof parsed.count !== 'number') {
        return [{ ...base, isMissing: true, numericValue: null, missingReason: 'NOT_FETCHED', qualityFlags: [] }];
      }

      return [{ ...base, isMissing: false, numericValue: parsed.count, qualityFlags: [] }];
    } catch {
      throw new Error('Normalization error: Invalid JSON payload in fixture');
    }
  }

  provenance(_raw: RawFetchResult): ProvenanceMetadata {
    return {
      retention_policy: 'infinite',
      license: 'public_domain',
      attribution: 'Offline testing fixture'
    };
  }
}
