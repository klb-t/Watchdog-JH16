import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import {
  SourceAdapter, RawFetchResult, Observation, ProvenanceMetadata, ValidatedParams,
  SourceCapability, SourceRequest, assertValidSourceRequest, baseObservationFields, MissingReason, QualityFlag,
} from './base';
import { SecretHandle } from '../secrets';
import { redact } from '../utils/redaction';
import type { HttpGet, Sleep } from './serpapi';
import { hashConfig } from '../config/canonicalize';

/**
 * Google Trends interest over time, served through SerpApi's google_trends engine.
 *
 * Registered separately from `search.result_count` on purpose:
 * `05_PROVIDERS_AND_CAPABILITIES.md` notes explicitly that normalised relative
 * interest is **not** a result count and must never be substituted for one in a
 * JH2016 run. Every observation carries RELATIVE_INTEREST_NOT_A_COUNT, and the
 * period it describes travels as `observedAt`.
 *
 * One request is one group of terms (`renderedQuery` = comma-separated terms);
 * Trends scales the group to its own maximum, so the request's dimension names
 * the group and an analysis may only compare groups through a shared anchor.
 */

const ProviderSchema = z.object({
  provider_key: z.string().min(1), display_name: z.string().min(1), endpoint: z.string().url(),
  secret_ref: z.string().regex(/^[a-z][a-z0-9-]*:.+$/), personal_credential_provider: z.string().min(1),
  engine: z.string().min(1), api_key_param: z.string().min(1), max_terms_per_request: z.number().int().min(1).max(5),
  request_params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  run_params_required: z.array(z.string()), run_params_allowed: z.array(z.string()),
  pacing: z.object({ min_interval_ms: z.number().int().nonnegative(), max_attempts: z.number().int().min(1).max(10), backoff_ms: z.array(z.number().int().nonnegative()) }),
});
const ConfigSchema = z.object({ schema_version: z.string(), capability: z.enum(['trends.interest', 'trends.interest_by_region']), providers: z.array(ProviderSchema).min(1) });
export type TrendsProviderConfig = z.infer<typeof ProviderSchema>;

export const DEFAULT_TRENDS_CONFIG_PATH = path.join(process.cwd(), 'config', 'providers', 'trends_interest.json');
export const TRENDS_BY_REGION_CONFIG_PATH = path.join(process.cwd(), 'config', 'providers', 'trends_interest_by_region.json');
export function loadTrendsProviderConfig(file = DEFAULT_TRENDS_CONFIG_PATH) {
  const config = ConfigSchema.parse(JSON.parse(fs.readFileSync(file, 'utf-8')));
  return { provider: config.providers[0], hash: hashConfig(config) };
}

type Status = 'SUCCESS' | 'RATE_LIMIT' | 'QUOTA_EXHAUSTED' | 'CREDENTIAL_UNAVAILABLE' | 'FETCH_FAILED' | 'REQUEST_LIMIT';
const MISSING: Record<Exclude<Status, 'SUCCESS'>, MissingReason> = {
  RATE_LIMIT: 'RATE_LIMITED', QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED', CREDENTIAL_UNAVAILABLE: 'CREDENTIAL_UNAVAILABLE',
  FETCH_FAILED: 'FETCH_FAILED', REQUEST_LIMIT: 'REQUEST_LIMIT_SETTING',
};

export class GoogleTrendsAdapter implements SourceAdapter {
  // Interest by region (GEO_MAP_0, one query, one value per region) is a separate
  // adapter identity, so the time-series adapter's version and history are untouched.
  readonly adapter_id: string;
  readonly adapter_version: string;
  private readonly byRegion: boolean;
  private lastRequestAt = 0;

  constructor(
    private readonly config: TrendsProviderConfig = loadTrendsProviderConfig().provider,
    private readonly credential: SecretHandle | null = null,
    private readonly httpGet: HttpGet = (url) => fetch(url) as any,
    private readonly sleep: Sleep = (ms) => new Promise(r => setTimeout(r, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {
    this.byRegion = config.request_params.data_type === 'GEO_MAP_0';
    this.adapter_id = this.byRegion ? 'google_trends_region_adapter' : 'google_trends_adapter';
    this.adapter_version = this.byRegion ? '1.0.0' : '4.0.0';
  }

  capabilities(): SourceCapability[] { return [this.byRegion ? 'interest_by_region' : 'interest_over_time']; }

  /**
   * `provider_params` must name the measurement window (`date`) — it is never
   * defaulted — and may set the other allowed Trends parameters. `term_entities`
   * maps a query term to the entity it measures (from the preset).
   */
  validate_params(params: Record<string, any>): ValidatedParams {
    const errors: string[] = [], allowed = new Set(this.config.run_params_allowed);
    for (const key of Object.keys(params ?? {}).sort())
      if (key !== 'provider_params' && key !== 'term_entities') errors.push(`'${key}' has no effect on ${this.config.provider_key}`);
    const provider_params: Record<string, string> = {};
    for (const [k, v] of Object.entries(params?.provider_params ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (!allowed.has(k)) errors.push(`provider parameter '${k}' is not allowed (allowed: ${[...allowed].sort().join(', ')})`);
      else if (typeof v !== 'string' || !/^[A-Za-z0-9 :,._-]{1,80}$/.test(v)) errors.push(`provider parameter '${k}' must be a short plain string`);
      else provider_params[k] = v;
    }
    for (const k of this.config.run_params_required) if (!provider_params[k]) errors.push(`provider parameter '${k}' is required (the measurement window is never defaulted)`);
    const term_entities: Record<string, string> = {};
    for (const [k, v] of Object.entries(params?.term_entities ?? {})) if (typeof v === 'string') term_entities[k] = v;
    return errors.length ? { valid: false, normalized_params: {}, errors } : { valid: true, normalized_params: { provider_params, term_entities } };
  }

  private terms(request: SourceRequest): string[] {
    return request.renderedQuery.split(',').map(t => t.trim()).filter(Boolean);
  }

  private url(request: SourceRequest, key: string): string {
    const u = new URL(this.config.endpoint);
    u.searchParams.set('engine', this.config.engine);
    u.searchParams.set('q', this.terms(request).join(','));
    u.searchParams.set('hl', request.language.split('-')[0]);
    for (const [k, v] of Object.entries(this.config.request_params)) u.searchParams.set(k, String(v));
    for (const [k, v] of Object.entries((request.params?.provider_params ?? {}) as Record<string, string>)) u.searchParams.set(k, v);
    u.searchParams.set(this.config.api_key_param, key);
    return u.toString();
  }

  async fetch(request: SourceRequest): Promise<RawFetchResult> {
    assertValidSourceRequest(request);
    const safeUrl = (() => { const u = new URL(this.url(request, 'placeholder')); u.searchParams.set(this.config.api_key_param, '[REDACTED]'); return u.toString(); })();
    const base = { request, metadata: { provider: this.config.provider_key, engine: this.config.engine, request_url: safeUrl } };
    const n = this.terms(request).length;
    if (n === 0 || n > this.config.max_terms_per_request)
      return { ...base, payload: null, status: 'FETCH_FAILED', metadata: { ...base.metadata, detail: `a Trends request takes 1-${this.config.max_terms_per_request} terms, got ${n}` } };
    if (!this.credential?.isPresent)
      return { ...base, payload: null, status: 'CREDENTIAL_UNAVAILABLE', metadata: { ...base.metadata, detail: this.credential?.detail ?? 'No credential configured' } };
    const url = this.credential.use(k => this.url(request, k));
    const { max_attempts, backoff_ms } = this.config.pacing;
    let last: { status: Status; http: number; detail: string } = { status: 'FETCH_FAILED', http: 0, detail: 'no attempt was made' };
    for (let attempt = 1; attempt <= max_attempts; attempt++) {
      const wait = this.config.pacing.min_interval_ms - (this.now() - this.lastRequestAt);
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = this.now();
      let res: Awaited<ReturnType<HttpGet>>;
      try { res = await this.httpGet(url); } catch (e) {
        if ((e as any)?.requestLimit === true) { last = { status: 'REQUEST_LIMIT', http: 0, detail: redact((e as Error).message) }; break; }
        last = { status: 'FETCH_FAILED', http: 0, detail: redact(e instanceof Error ? e.message : String(e)) };
        if (attempt < max_attempts) { await this.sleep(backoff_ms[attempt - 1] ?? 0); continue; } break;
      }
      const body = redact(await res.text());
      if (res.ok) {
        let error: string | null = null;
        try { const d = JSON.parse(body); error = typeof d?.error === 'string' ? d.error : null; } catch { /* parse problem is normalize's */ }
        if (error) { last = { status: /run out of searches|exceeded/i.test(error) ? 'QUOTA_EXHAUSTED' : 'FETCH_FAILED', http: res.status, detail: error.slice(0, 200) }; break; }
        return { ...base, payload: Buffer.from(body, 'utf-8'), status: 'SUCCESS', http_status: res.status, metadata: { ...base.metadata, attempts: attempt } };
      }
      if (res.status === 429) { last = { status: 'RATE_LIMIT', http: 429, detail: body.slice(0, 200) }; if (attempt < max_attempts) { await this.sleep(backoff_ms[attempt - 1] ?? 0); continue; } }
      else if (res.status === 401 || res.status === 403) { last = { status: 'CREDENTIAL_UNAVAILABLE', http: res.status, detail: 'The provider rejected the credential.' }; break; }
      else if (res.status === 402) { last = { status: 'QUOTA_EXHAUSTED', http: 402, detail: body.slice(0, 200) }; break; }
      else { last = { status: 'FETCH_FAILED', http: res.status, detail: body.slice(0, 200) }; if (attempt < max_attempts && res.status >= 500) { await this.sleep(backoff_ms[attempt - 1] ?? 0); continue; } break; }
    }
    return { ...base, payload: null, status: last.status, http_status: last.http, metadata: { ...base.metadata, detail: last.detail, attempts: max_attempts } };
  }

  /** One observation per (term, period). A term the response lacks is missing for the whole request. */
  normalize(raw: RawFetchResult): Observation[] {
    assertValidSourceRequest(raw.request);
    const base = { ...baseObservationFields(raw, this.adapter_id, this.adapter_version), providerId: this.config.provider_key, providerVersion: this.adapter_version };
    const entity = (term: string) => (raw.request.params?.term_entities ?? {})[term] ?? term;
    const missing = (reason: MissingReason, flags: QualityFlag[] = []): Observation[] => this.terms(raw.request).sort().map(term => ({
      ...base, entityId: entity(term), queryText: term, isMissing: true, numericValue: null, missingReason: reason, qualityFlags: ['RELATIVE_INTEREST_NOT_A_COUNT', ...flags] }));
    if (raw.status !== 'SUCCESS' || !raw.payload) return missing(MISSING[raw.status as Exclude<Status, 'SUCCESS'>] ?? 'FETCH_FAILED');
    if (this.byRegion) return this.normalizeByRegion(raw, base, missing);
    let timeline: any[];
    try { timeline = JSON.parse(raw.payload.toString('utf-8'))?.interest_over_time?.timeline_data; } catch { return missing('PARSE_FAILED', ['COUNT_PARSE_UNCERTAIN']); }
    if (!Array.isArray(timeline) || timeline.length === 0) return missing('PARSE_FAILED', ['COUNT_PARSE_UNCERTAIN']);
    const out: Observation[] = [];
    for (const term of this.terms(raw.request).sort()) {
      const points = timeline.map(p => ({ p, v: (p.values ?? []).find((x: any) => x.query === term) }));
      if (points.some(x => !x.v)) { out.push(...missing('PARSE_FAILED', ['COUNT_PARSE_UNCERTAIN']).filter(o => o.queryText === term)); continue; }
      for (const { p, v } of points) {
        const ts = Number(p.timestamp), value = Number(v.extracted_value);
        const observedAt = Number.isFinite(ts) ? new Date(ts * 1000).toISOString().slice(0, 10) : null;
        if (!observedAt || !Number.isFinite(value) || value < 0) { out.push({ ...base, entityId: entity(term), queryText: term, isMissing: true, numericValue: null, missingReason: 'PARSE_FAILED', qualityFlags: ['RELATIVE_INTEREST_NOT_A_COUNT', 'COUNT_PARSE_UNCERTAIN'], ...(observedAt ? { observedAt } : {}) }); continue; }
        const flags: QualityFlag[] = ['RELATIVE_INTEREST_NOT_A_COUNT'];
        if (value === 0) flags.push('TRENDS_BELOW_RESOLUTION');
        if (p.partial_data === true) flags.push('TRENDS_PARTIAL_PERIOD');
        out.push({ ...base, entityId: entity(term), queryText: term, observedAt, isMissing: false, numericValue: value, qualityFlags: flags });
      }
    }
    return out;
  }

  /**
   * One observation per region for the request's single query. The entity is the
   * region code Trends returns (ISO 3166-2, e.g. US-FL); the period is the start of
   * the requested window. A region Trends does not list is not invented here: the
   * analysis decides what an absent region means.
   */
  private normalizeByRegion(raw: RawFetchResult, base: any, missing: (reason: MissingReason, flags?: QualityFlag[]) => Observation[]): Observation[] {
    let regions: any[];
    try { regions = JSON.parse(raw.payload!.toString('utf-8'))?.interest_by_region; } catch { return missing('PARSE_FAILED', ['COUNT_PARSE_UNCERTAIN']); }
    if (!Array.isArray(regions) || regions.length === 0) return missing('PARSE_FAILED', ['COUNT_PARSE_UNCERTAIN']);
    const window = String((raw.request.params?.provider_params ?? {}).date ?? '');
    const observedAt = /^\d{4}-\d{2}-\d{2}/.test(window) ? window.slice(0, 10) : undefined;
    const term = this.terms(raw.request)[0];
    const out: Observation[] = [], seen = new Set<string>();
    for (const r of [...regions].sort((a, b) => String(a?.geo).localeCompare(String(b?.geo)))) {
      const geo = typeof r?.geo === 'string' && /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(r.geo) ? r.geo : null, value = Number(r?.extracted_value);
      if (!geo || seen.has(geo)) return missing('PARSE_FAILED', ['COUNT_PARSE_UNCERTAIN']);
      seen.add(geo);
      const common = { ...base, entityId: geo, queryText: term, ...(observedAt ? { observedAt } : {}) };
      if (!Number.isFinite(value) || value < 0 || value > 100) { out.push({ ...common, isMissing: true, numericValue: null, missingReason: 'PARSE_FAILED', qualityFlags: ['RELATIVE_INTEREST_NOT_A_COUNT', 'COUNT_PARSE_UNCERTAIN'] }); continue; }
      const flags: QualityFlag[] = ['RELATIVE_INTEREST_NOT_A_COUNT'];
      if (value === 0) flags.push('TRENDS_BELOW_RESOLUTION');
      out.push({ ...common, isMissing: false, numericValue: value, qualityFlags: flags });
    }
    return out;
  }

  provenance(_raw: RawFetchResult): ProvenanceMetadata {
    return { retention_policy: 'cache_only_as_permitted_by_terms', license: 'serpapi_terms_of_service', attribution: 'Google Trends via SerpApi' };
  }
}
