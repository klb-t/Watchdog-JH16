import {
  SourceAdapter, RawFetchResult, Observation, ProvenanceMetadata, ValidatedParams,
  SourceCapability, SourceRequest, assertValidSourceRequest, baseObservationFields,
  MissingReason, QualityFlag,
} from './base';
import { parseResultCount } from './count_parser';
import { SecretHandle } from '../secrets';
import { redact } from '../utils/redaction';

/**
 * SerpApi as a real `search.result_count` provider (E3.2).
 *
 * Three things distinguish this from the fixture adapter it replaces, and each
 * is a place a live provider quietly corrupts a dataset if it is not handled:
 *
 *  1. **Failure is not absence of data, it is a *kind* of absence.** A throttle,
 *     an exhausted quota and an unparseable body are three different operator
 *     actions, so they are three different `missing_reason` values rather than
 *     one `FETCH_FAILED`.
 *  2. **The API key travels in the URL.** SerpApi takes `api_key` as a query
 *     parameter, and this adapter's output is archived byte-for-byte into a
 *     write-once blob store. A key that reaches that store is permanent. Every
 *     URL recorded here is redacted, and the payload is scrubbed by value
 *     before it is returned.
 *  3. **Retries must terminate.** `max_attempts` is finite and comes from
 *     configuration, so a run against a dead quota fails as a run rather than
 *     spinning.
 */

export interface SerpApiProviderConfig {
  readonly provider_key: string;
  readonly endpoint: string;
  readonly engine: string;
  readonly api_key_param: string;
  readonly count_path: string;
  readonly zero_result_policy: 'treat_as_missing' | 'treat_as_measurement';
  readonly request_params: Readonly<Record<string, string | number | boolean>>;
  readonly pacing: { min_interval_ms: number; max_attempts: number; backoff_ms: number[] };
}

export type HttpGet = (url: string) => Promise<{
  ok: boolean; status: number; text(): Promise<string>;
}>;

/** Injected so tests do not spend wall-clock time on backoff. */
export type Sleep = (ms: number) => Promise<void>;

export type FetchStatus =
  | 'SUCCESS' | 'PROVIDER_ZERO' | 'RATE_LIMIT' | 'QUOTA_EXHAUSTED'
  | 'CREDENTIAL_UNAVAILABLE' | 'FETCH_FAILED';

/** One place, so a new status cannot be added without deciding its missingness. */
const MISSING_REASON_FOR: Record<Exclude<FetchStatus, 'SUCCESS'>, MissingReason> = {
  PROVIDER_ZERO: 'PROVIDER_ZERO_RESULTS_UNRELIABLE',
  RATE_LIMIT: 'RATE_LIMITED',
  QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
  CREDENTIAL_UNAVAILABLE: 'CREDENTIAL_UNAVAILABLE',
  FETCH_FAILED: 'FETCH_FAILED',
};

function readPath(obj: any, dotted: string): unknown {
  return dotted.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

export class SerpApiAdapter implements SourceAdapter {
  readonly adapter_id = 'serpapi';
  readonly adapter_version = '1.0.0';
  private lastRequestAt = 0;

  constructor(
    private readonly config: SerpApiProviderConfig,
    private readonly credential: SecretHandle,
    private readonly httpGet: HttpGet,
    private readonly sleep: Sleep = (ms) => new Promise(r => setTimeout(r, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {}

  capabilities(): SourceCapability[] { return ['result_count']; }

  validate_params(params: Record<string, any>): ValidatedParams {
    return {
      valid: true,
      normalized_params: {
        locale: params.locale ? String(params.locale) : 'en',
        safe_search: params.safe_search !== undefined ? Boolean(params.safe_search) : false,
      },
    };
  }

  /** The URL actually sent. Never logged, never stored, never returned. */
  private buildUrl(request: SourceRequest, key: string): string {
    const u = new URL(this.config.endpoint);
    u.searchParams.set('engine', this.config.engine);
    u.searchParams.set('q', request.renderedQuery);
    // D15: the language belongs to the query plan, so it is sent, not defaulted
    // by the provider's IP geolocation.
    u.searchParams.set('hl', request.language.split('-')[0]);
    for (const [k, v] of Object.entries(this.config.request_params)) u.searchParams.set(k, String(v));
    u.searchParams.set(this.config.api_key_param, key);
    return u.toString();
  }

  /** The same URL with the credential removed — this is the one that is recorded. */
  private safeUrl(request: SourceRequest): string {
    const u = new URL(this.buildUrl(request, 'placeholder'));
    u.searchParams.set(this.config.api_key_param, '[REDACTED]');
    return u.toString();
  }

  private async pace(): Promise<void> {
    const wait = this.config.pacing.min_interval_ms - (this.now() - this.lastRequestAt);
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = this.now();
  }

  async fetch(request: SourceRequest): Promise<RawFetchResult> {
    assertValidSourceRequest(request);

    const base = {
      request,
      metadata: {
        provider: this.config.provider_key,
        engine: this.config.engine,
        // Redacted at construction, not at logging time: there is no moment at
        // which the credentialled URL exists as recorded data.
        request_url: this.safeUrl(request),
      },
    };

    if (!this.credential.isPresent) {
      return { ...base, payload: null, status: 'CREDENTIAL_UNAVAILABLE',
        metadata: { ...base.metadata, detail: this.credential.detail } };
    }

    const url = this.credential.use(k => this.buildUrl(request, k));
    const { max_attempts, backoff_ms } = this.config.pacing;
    let last: { status: FetchStatus; http: number; detail: string } =
      { status: 'FETCH_FAILED', http: 0, detail: 'no attempt was made' };

    for (let attempt = 1; attempt <= max_attempts; attempt++) {
      await this.pace();

      let res: Awaited<ReturnType<HttpGet>>;
      try {
        res = await this.httpGet(url);
      } catch (e) {
        // A transport error is scrubbed too: an agent or proxy can echo the URL.
        last = { status: 'FETCH_FAILED', http: 0, detail: redact(e instanceof Error ? e.message : String(e)) };
        if (attempt < max_attempts) { await this.sleep(backoff_ms[attempt - 1] ?? 0); continue; }
        break;
      }

      const body = redact(await res.text());

      if (res.ok) {
        // A 2xx is not automatically a success. SerpApi reports an exhausted
        // plan and several other conditions as HTTP 200 with an `error` field,
        // and reading that as data yields PARSE_FAILED — which tells the
        // operator to go looking at the parser instead of at their billing.
        const upstreamError = this.errorInSuccessBody(body);
        if (upstreamError !== null) {
          last = this.looksLikeQuotaExhaustion(res.status, upstreamError)
            ? { status: 'QUOTA_EXHAUSTED', http: res.status, detail: upstreamError.slice(0, 200) }
            : { status: 'FETCH_FAILED', http: res.status, detail: upstreamError.slice(0, 200) };
          break;
        }
        return { ...base, payload: Buffer.from(body, 'utf-8'), status: 'SUCCESS', http_status: res.status,
          metadata: { ...base.metadata, attempts: attempt } };
      }

      if (res.status === 429) {
        last = { status: 'RATE_LIMIT', http: 429, detail: body.slice(0, 200) };
        // Retried, because a throttle is transient. Not retried forever.
        if (attempt < max_attempts) { await this.sleep(backoff_ms[attempt - 1] ?? 0); continue; }
      } else if (res.status === 401 || res.status === 403) {
        // Retrying a rejected key just burns the remaining attempts.
        last = { status: 'CREDENTIAL_UNAVAILABLE', http: res.status,
          detail: 'The provider rejected the credential. The key is present but not accepted.' };
        break;
      } else if (this.looksLikeQuotaExhaustion(res.status, body)) {
        last = { status: 'QUOTA_EXHAUSTED', http: res.status, detail: body.slice(0, 200) };
        break;
      } else {
        last = { status: 'FETCH_FAILED', http: res.status, detail: body.slice(0, 200) };
        if (attempt < max_attempts && res.status >= 500) { await this.sleep(backoff_ms[attempt - 1] ?? 0); continue; }
        break;
      }
    }

    return { ...base, payload: null, status: last.status, http_status: last.http,
      metadata: { ...base.metadata, detail: last.detail, attempts: max_attempts } };
  }

  /**
   * The upstream error message carried inside a 2xx response, or null if the
   * body is an ordinary result. A body that is not JSON at all is *not* an
   * error here — that is a parse problem, and `normalize` reports it as one.
   */
  private errorInSuccessBody(body: string): string | null {
    let parsed: any;
    try {
      parsed = JSON.parse(body);
    } catch {
      // Not JSON. Some gateways return a bare text error; only treat it as one
      // when it is recognisably a quota message, so ordinary malformed bodies
      // keep reaching PARSE_FAILED rather than being relabelled.
      return this.looksLikeQuotaExhaustion(200, body) ? body : null;
    }
    if (typeof parsed?.error === 'string') return parsed.error;
    if (typeof parsed?.error?.message === 'string') return parsed.error.message;
    return null;
  }

  private looksLikeQuotaExhaustion(status: number, body: string): boolean {
    if (status === 402) return true;
    // SerpApi answers an exhausted plan with 401/403 or a 200-shaped error
    // mentioning the search limit; matching the text is unavoidable, so it is
    // narrow and it fails towards FETCH_FAILED rather than towards a guess.
    return /run out of searches|exceeded your .*(quota|plan|searches)|account limit/i.test(body);
  }

  normalize(raw: RawFetchResult): Observation[] {
    assertValidSourceRequest(raw.request);
    const base = baseObservationFields(raw, this.adapter_id, this.adapter_version);
    // E3.3: which vendor served this number is part of the observation, not of
    // the surrounding log line.
    const stamped = {
      ...base,
      providerId: this.config.provider_key,
      providerVersion: this.adapter_version,
    };

    const missing = (reason: MissingReason, flags: QualityFlag[] = []): Observation[] => ([{
      ...stamped, isMissing: true, numericValue: null, missingReason: reason, qualityFlags: flags,
    }]);

    if (raw.status !== 'SUCCESS' || !raw.payload) {
      const reason = MISSING_REASON_FOR[(raw.status as Exclude<FetchStatus, 'SUCCESS'>)] ?? 'FETCH_FAILED';
      return missing(reason);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw.payload.toString('utf-8'));
    } catch {
      return missing('PARSE_FAILED', ['COUNT_PARSE_UNCERTAIN']);
    }

    const count = parseResultCount(readPath(parsed, this.config.count_path) as any);
    if (!count.ok) {
      // "I could not tell what the provider said" is not "the provider said 0".
      return missing('PARSE_FAILED', ['COUNT_PARSE_UNCERTAIN']);
    }

    if (count.count === 0 && this.config.zero_result_policy === 'treat_as_missing') {
      return missing('PROVIDER_ZERO_RESULTS_UNRELIABLE');
    }

    const flags: QualityFlag[] = ['PROVIDER_ESTIMATE'];
    if (count.approximate || count.grouped) flags.push('COUNT_PARSE_UNCERTAIN');
    if (this.config.request_params.safe === undefined) flags.push('SAFESEARCH_UNKNOWN');

    return [{
      ...stamped, isMissing: false, numericValue: count.count,
      qualityFlags: [...new Set(flags)].sort() as QualityFlag[],
    }];
  }

  provenance(_raw: RawFetchResult): ProvenanceMetadata {
    return {
      retention_policy: 'cache_only_as_permitted_by_terms',
      license: 'serpapi_terms_of_service',
      attribution: `SerpApi (${this.config.engine})`,
    };
  }
}
