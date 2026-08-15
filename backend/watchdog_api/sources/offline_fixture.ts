import { SourceAdapter, RawFetchResult, Observation, ProvenanceMetadata, ValidatedParams, SourceCapability } from './base';

export class OfflineFixtureAdapter implements SourceAdapter {
  adapter_id = 'offline_fixture';
  adapter_version = '1.0.0';

  capabilities(): SourceCapability[] {
    return ['result_count', 'numeric_reference_table'];
  }

  validate_params(params: Record<string, any>): ValidatedParams {
    if (!params.fixture_name) {
      return { valid: false, normalized_params: {}, errors: ["Missing 'fixture_name'"] };
    }
    return { valid: true, normalized_params: { fixture_name: String(params.fixture_name) } };
  }

  async fetch(params: Record<string, any>): Promise<RawFetchResult> {
    const fixtureName = params.fixture_name;
    // Simulate fetching a frozen JSON fixture
    const fakePayload = JSON.stringify({
      data: [
        { query: "alcohol", count: 1000000 },
        { query: "alcohol harm", count: 50000 }
      ]
    });
    
    return {
      payload: Buffer.from(fakePayload, 'utf-8'),
      status: 'SUCCESS',
      http_status: 200,
      metadata: { fixture: fixtureName }
    };
  }

  normalize(raw: RawFetchResult, params: Record<string, any>): Observation[] {
    if (!raw.payload) return [];
    try {
      const parsed = JSON.parse(raw.payload.toString('utf-8'));
      if (!parsed.data || !Array.isArray(parsed.data)) return [];

      return parsed.data.map((item: any) => {
        const isHarm = item.query.includes('harm');
        return {
          entity_id: item.query.replace(' harm', ''), // simplistic mapping for fixture
          dimension: isHarm ? 'harm' : 'popularity',
          query_text: item.query,
          result_count: item.count,
          retrieved_at: new Date().toISOString(),
          source_id: 'offline_fixture',
          source_adapter_version: this.adapter_version,
          raw_artifact_id: raw.raw_blob_id
        } as Observation;
      });
    } catch (e) {
      throw new Error("Normalization error: Invalid JSON payload in fixture");
    }
  }

  provenance(raw: RawFetchResult): ProvenanceMetadata {
    return {
      retention_policy: 'infinite',
      license: 'public_domain',
      attribution: 'Offline testing fixture'
    };
  }
}
