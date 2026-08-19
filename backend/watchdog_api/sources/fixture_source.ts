import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  SourceAdapter, RawFetchResult, Observation, ProvenanceMetadata, ValidatedParams,
  SourceCapability, SourceRequest, assertValidSourceRequest, baseObservationFields
} from './base';
import { parseResultCount } from './count_parser';
import { QualityFlag } from '../domain/observation';

/**
 * The only source E1 ships (`01_ARCHITECTURE.md`): frozen JSON read from
 * `fixtures/jh2016/`. No network anywhere in E1.
 *
 * Fixtures carry `dimension` as stored index metadata and the adapter is told
 * which query to serve — it never guesses from the fixture's query string, so
 * the neutrality constraint is exercised even though nothing here calls out.
 */

export interface FixtureIndexEntry {
  entity_id: string;
  dimension: string;
  rendered_query: string;
  file: string;
}

export interface FixtureIndex {
  set_key: string;
  language?: string;
  query_expansion_mode?: string;
  observed_at?: string;
  queries: FixtureIndexEntry[];
}

export const DEFAULT_FIXTURE_ROOT = path.join(process.cwd(), 'fixtures', 'jh2016');

export class FixtureSourceAdapter implements SourceAdapter {
  readonly adapter_id = 'fixture_jh2016';
  readonly adapter_version = '1.0.0';

  constructor(private root: string = DEFAULT_FIXTURE_ROOT) {}

  capabilities(): SourceCapability[] {
    return ['result_count'];
  }

  validate_params(params: Record<string, any>): ValidatedParams {
    const errors: string[] = [];
    const set = params.fixture_set;
    if (!set || typeof set !== 'string') errors.push("Missing 'fixture_set'");
    else if (!fs.existsSync(path.join(this.root, set, 'index.json'))) {
      errors.push(`Unknown fixture set '${set}' (no index.json under ${this.root})`);
    }
    return {
      valid: errors.length === 0,
      normalized_params: { fixture_set: String(set ?? '') },
      errors: errors.length ? errors : undefined,
    };
  }

  loadIndex(fixtureSet: string): FixtureIndex {
    const file = path.join(this.root, fixtureSet, 'index.json');
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  }

  /** Every (entity, dimension) pair the set can answer, deterministically ordered. */
  listQueries(fixtureSet: string): FixtureIndexEntry[] {
    return [...this.loadIndex(fixtureSet).queries]
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id) || a.dimension.localeCompare(b.dimension));
  }

  async fetch(request: SourceRequest): Promise<RawFetchResult> {
    assertValidSourceRequest(request);

    const fixtureSet = String(request.params?.fixture_set ?? '');
    const index = this.loadIndex(fixtureSet);

    // Matched on the identity the preset declared, not by sniffing the query.
    const entry = index.queries.find(
      q => q.entity_id === request.entityId && q.dimension === request.dimension
    );

    if (!entry) {
      return {
        payload: null,
        status: 'NOT_FOUND',
        metadata: { fixture_set: fixtureSet, reason: 'no fixture for this entity/dimension' },
        request,
      };
    }

    const payload = fs.readFileSync(path.join(this.root, fixtureSet, entry.file));
    return {
      payload,
      status: 'SUCCESS',
      http_status: 200,
      metadata: { fixture_set: fixtureSet, fixture_file: entry.file },
      request,
    };
  }

  normalize(raw: RawFetchResult): Observation[] {
    assertValidSourceRequest(raw.request);
    const base = baseObservationFields(raw, this.adapter_id, this.adapter_version);

    if (!raw.payload) {
      return [{ ...base, isMissing: true, numericValue: null, missingReason: 'NOT_FETCHED', qualityFlags: [] }];
    }

    const parsed = JSON.parse(raw.payload.toString('utf-8'));
    const result = parseResultCount(parsed.result_stats);

    if (result.ok === false) {
      // Unparseable and absent are both missing, with the reason preserved so
      // a reader can tell which happened.
      return [{
        ...base,
        isMissing: true,
        numericValue: null,
        missingReason: 'PARSE_FAILED',
        qualityFlags: result.reason === 'UNPARSEABLE' ? ['COUNT_PARSE_UNCERTAIN'] : [],
      }];
    }

    const flags: QualityFlag[] = [];
    // A provider that says "about N" is estimating, and 03_JH2016_CONTRACT.md
    // requires that be visible on the observation.
    if (result.approximate) flags.push('PROVIDER_ESTIMATE');

    return [{ ...base, isMissing: false, numericValue: result.count, qualityFlags: flags }];
  }

  provenance(_raw: RawFetchResult): ProvenanceMetadata {
    return {
      retention_policy: 'infinite',
      license: 'derived_from_published_tables',
      attribution: 'Jankowski & Hoffmann 2016, doi:10.2196/jmir.4033, Tables 1 and 3',
    };
  }
}
