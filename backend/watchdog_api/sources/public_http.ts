import type { AutomationProfile } from '../config/automation';
import type { AutomationRepository } from '../db/repositories/automation';
import { AutomationError } from '../db/repositories/automation';
export type PublicTransport = (url: string, init: RequestInit) => Promise<Response>;
export class AcquisitionStopped extends Error { constructor(readonly reason: string) { super(reason); } }
const defaultTransport: PublicTransport = (url, init) => fetch(url, init);

/** All requests go to versioned operator profiles, never to links from a paper or LLM. */
export class PublicHttp {
  requests = 0;
  constructor(readonly repo: AutomationRepository, readonly jobId: string, readonly profile: AutomationProfile,
    readonly maxRequests: number, readonly checkpoint: () => void, readonly transport = defaultTransport,
    readonly delay: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))) {}
  async get(provider: string, resource: string, params: Record<string, string | number> = {}) {
    this.checkpoint();
    if (this.requests >= this.maxRequests) throw new AcquisitionStopped('REQUEST_BUDGET_EXHAUSTED');
    const config = this.profile.sources.find(s => s.id === provider && s.implemented);
    if (!config?.origin || !config.pathPrefix) throw new AutomationError(`No implemented public adapter for ${provider}`);
    const url = new URL(resource, config.origin);
    if (url.origin !== config.origin || url.protocol !== 'https:' || url.username || url.password || !url.pathname.startsWith(config.pathPrefix)) throw new AutomationError('Source URL is outside the configured API');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const lease = this.repo.sourceLease(provider, config.minIntervalMs ?? 1000);
    try {
    if (lease.waitMs) await this.delay(lease.waitMs); this.checkpoint(); this.requests++;
    let response: Response;
    try { response = await this.transport(url.href, { redirect: 'error', signal: AbortSignal.timeout(this.profile.worker.requestTimeoutMs),
      headers: { Accept: 'application/json, application/atom+xml;q=0.9', 'User-Agent': 'Watchdog-JH16/1.0 (https://github.com/klb-t/Watchdog-JH16)' } }); }
    catch {
      await this.repo.receipt(this.jobId, provider, url.href, 0, null, config.license, 'NETWORK_OR_TIMEOUT');
      throw new AutomationError(`${provider}: network or timeout failure`);
    }
    const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      if (reader) while (true) { const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > this.profile.worker.maxResponseBytes) { await reader.cancel(); throw new Error('Response too large'); }
        chunks.push(value); }
    } catch {
      await this.repo.receipt(this.jobId, provider, url.href, response.status, null, config.license, 'BODY_LIMIT_OR_STREAM_FAILURE');
      throw new AutomationError(`${provider}: response body limit or stream failure`);
    }
    const bytes = Buffer.concat(chunks), receipt = await this.repo.receipt(this.jobId, provider, url.href, response.status, bytes, config.license,
      response.ok ? null : `HTTP_${response.status}`);
    this.checkpoint();
    if (!response.ok) throw new AutomationError(`${provider}: HTTP ${response.status}${response.status === 429 ? ' (rate limited; no immediate retry)' : ''}`);
    return { bytes, receipt };
    } finally { this.repo.releaseSource(provider, lease.token); }
  }
  async json(provider: string, resource: string, params: Record<string, string | number> = {}) {
    const result = await this.get(provider, resource, params);
    let data: any; try { data = JSON.parse(result.bytes.toString('utf8')); } catch { throw new AutomationError(`${provider}: invalid JSON response; raw bytes retained`); }
    return { data, receipt: result.receipt };
  }
}
