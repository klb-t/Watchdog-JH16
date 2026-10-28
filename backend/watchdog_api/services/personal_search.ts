import { UserVault } from '../secrets/user_vault';
import { SettingsRepository } from '../db/repositories/settings';
import type { AssistantProfile } from '../config/assistant';
import { loadSearchProviderConfig } from '../sources/search_providers';
import { SerpApiAdapter, RequestLimitReachedError } from '../sources/serpapi';
import { GoogleTrendsAdapter, loadTrendsProviderConfig, TRENDS_BY_REGION_CONFIG_PATH } from '../sources/google_trends';
import { sourceRegistry } from '../sources/registry';
import { AutomationError } from '../db/repositories/automation';
export class PersonalSearch {
  constructor(private readonly repo: SettingsRepository, private readonly vault: UserVault, private readonly profile: AssistantProfile, private readonly transport: typeof fetch = fetch) {}
  async resolve(source: string, owner: string, personal = false) {
    if (!personal || !['serp_result_count', 'trends_interest_index', 'trends_interest_by_region'].includes(source)) return sourceRegistry.resolveAdapter(source);
    const credential = this.vault.resolve(owner, 'serpapi');
    if (!credential.isPresent) throw new AutomationError(credential.detail);
    // All three sources spend the same personal SerpApi key, so they share its daily request limit.
    if (source === 'trends_interest_index') return new GoogleTrendsAdapter(loadTrendsProviderConfig().provider, credential, url => this.send(owner, url));
    if (source === 'trends_interest_by_region') return new GoogleTrendsAdapter(loadTrendsProviderConfig(TRENDS_BY_REGION_CONFIG_PATH).provider, credential, url => this.send(owner, url));
    const config = loadSearchProviderConfig().config.providers.find(p => p.provider_key === 'serpapi')!;
    return new SerpApiAdapter(config, credential, url => this.send(owner, url));
  }
  private async send(owner: string, url: string) {
      if (!this.vault.resolve(owner, 'serpapi').isPresent) throw new AutomationError('The personal SERP key was removed');
      const limit = this.repo.get(owner, this.profile.defaults).value.searchDailyRequestLimit;
      try { this.repo.reserveSearch(owner, limit); }
      catch (e) { throw new RequestLimitReachedError(`WatchDog daily SERP request limit reached (${limit} per day, a personal setting); nothing was sent`); }
      const response = await this.transport(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
      const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
      if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length;
        if (bytes > 5000000) { await reader.cancel(); throw new AutomationError('SERP response exceeds the byte limit'); } chunks.push(value); }
      return { ok: response.ok, status: response.status, text: async () => Buffer.concat(chunks).toString('utf8') };
  }
}
