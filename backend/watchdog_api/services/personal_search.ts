import { UserVault } from '../secrets/user_vault';
import { SettingsRepository } from '../db/repositories/settings';
import type { AssistantProfile } from '../config/assistant';
import { loadSearchProviderConfig } from '../sources/search_providers';
import { SerpApiAdapter } from '../sources/serpapi';
import { sourceRegistry } from '../sources/registry';
import { AutomationError } from '../db/repositories/automation';
export class PersonalSearch {
  constructor(private readonly repo: SettingsRepository, private readonly vault: UserVault, private readonly profile: AssistantProfile, private readonly transport: typeof fetch = fetch) {}
  async resolve(source: string, owner: string, personal = false) {
    if (source !== 'serp_result_count' || !personal) return sourceRegistry.resolveAdapter(source);
    const config = loadSearchProviderConfig().config.providers.find(p => p.provider_key === 'serpapi')!;
    const credential = this.vault.resolve(owner, 'serpapi');
    if (!credential.isPresent) throw new AutomationError(credential.detail);
    return new SerpApiAdapter(config, credential, async url => {
      if (!this.vault.resolve(owner, 'serpapi').isPresent) throw new AutomationError('The personal SERP key was removed');
      this.repo.reserveSearch(owner, this.repo.get(owner, this.profile.defaults).value.searchDailyRequestLimit);
      const response = await this.transport(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
      const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
      if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length;
        if (bytes > 5000000) { await reader.cancel(); throw new AutomationError('SERP response exceeds the byte limit'); } chunks.push(value); }
      return { ok: response.ok, status: response.status, text: async () => Buffer.concat(chunks).toString('utf8') };
    });
  }
}
