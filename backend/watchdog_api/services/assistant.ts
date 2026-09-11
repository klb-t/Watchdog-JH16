import { SettingsRepository } from '../db/repositories/settings';
import { UserVault } from '../secrets/user_vault';
import type { AssistantProfile } from '../config/assistant';
import { AutomationError } from '../db/repositories/automation';
import { normalizeModelCatalog, routeModel } from '../llm/routing';
import { ProfileGenerator } from '../llm/profile_generator';
import { loadPersonalProviders } from '../config/personal_providers';
import { canonicalHash } from '../domain/canonical';
import { createHash } from 'node:crypto';
import type { TextGenerator, TextGenerationRequest } from '../llm/base';
import type { AssistantTask, ModelCatalog } from '../../../shared/settings';
import { redactText } from '../utils/redaction';

export class AssistantService {
  readonly providers = loadPersonalProviders();
  constructor(readonly repo: SettingsRepository, readonly vault: UserVault, readonly profile: AssistantProfile,
    private readonly transport: typeof fetch = fetch) { repo.archiveAssistantProfile(profile); repo.archiveAssistantProfile(this.providers); }
  provider(owner: string, task?: AssistantTask) {
    const s = this.repo.get(owner, this.profile.defaults).value.assistant, id = task ? s.taskProviders?.[task] ?? s.provider : s.provider;
    const p = this.providers.providers.find(p => p.id === id); if (!p) throw new AutomationError('Personal provider profile not configured'); return p;
  }
  async refreshCatalog(owner: string, providerId?: string) {
    const p = providerId ? this.providers.providers.find(p => p.id === providerId) : this.provider(owner);
    if (!p) throw new AutomationError('Unknown provider');
    if (!p.catalogUrl) return this.buildPersonalCatalog(owner, p.id);
    const url = new URL(p.catalogUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new AutomationError('Invalid catalog endpoint');
    const headers: Record<string,string> = { Accept: 'application/json', ...p.headers };
    if (p.catalogAuth) { const credential = this.vault.resolve(owner, p.id); if (!credential.isPresent) throw new AutomationError(credential.detail);
      credential.use(key => { headers[p.protocol === 'anthropic' ? 'x-api-key' : 'Authorization'] = p.protocol === 'anthropic' ? key : `Bearer ${key}`; }); }
    const response = await this.transport(url.href, { redirect: 'error', signal: AbortSignal.timeout(20000), headers });
    if (!response.ok) throw new AutomationError(`Catalog returned HTTP ${response.status}`);
    const raw = await this.boundedBody(response, this.profile.catalog.maxBytes);
    if (p.id !== 'openrouter') return this.buildPersonalCatalog(owner, p.id, raw);
    const catalog = normalizeModelCatalog(raw, this.profile); await this.repo.saveCatalog(catalog, raw);
    this.repo.audit(owner, 'catalog.refresh', catalog.hash, { count: catalog.models.length, rejected: catalog.rejected }); return catalog;
  }
  async buildPersonalCatalog(owner: string, provider: string, discovery?: Buffer) {
    if (provider === 'openrouter') throw new AutomationError('OpenRouter uses the public priced catalog');
    const p = this.providers.providers.find(p => p.id === provider); if (!p) throw new AutomationError('Unknown provider');
    const profiles = this.repo.ceilings(owner, provider).filter(c => Date.parse(c.value.validUntil) > Date.now());
    let discovered: string[] | null = null;
    if (discovery) {
      const json = JSON.parse(discovery.toString()), list = Array.isArray(json) ? json : json.data ?? json.models;
      if (!Array.isArray(list) || list.length > this.profile.catalog.maxModels) throw new AutomationError('Invalid model collection');
      discovered = [...new Set<string>(list.map(m => m.id ?? m.name).filter(id => typeof id === 'string' && /^[A-Za-z0-9_./:+-]{1,160}$/.test(id)))].sort();
    }
    const records = profiles.filter(c => !discovered || discovered.includes(c.value.id));
    const raw = Buffer.from(JSON.stringify({ providerProfileHash: this.providers.contentHash, discovery: discovery?.toString() ?? null, priceProfiles: profiles }));
    const body = { provider, models: records.map(({ value: v }) => ({ id: v.id, name: v.id, contextTokens: v.contextTokens, maxOutputTokens: v.maxOutputTokens,
      inputUsdPerToken: v.inputUsdPerMillion / 1000000, outputUsdPerToken: v.outputUsdPerMillion / 1000000, requestUsd: v.requestUsd, parameters: [], pricePolicy: 'owner-reviewed-ceiling' as const })),
      unpricedModels: (discovered ?? []).filter(id => !records.some(r => r.value.id === id)), rejected: 0, fetchedAt: new Date().toISOString(), source: p.catalogUrl ?? p.documentation,
      rawHash: createHash('sha256').update(raw).digest('hex'), priceProfiles: profiles };
    const catalog: ModelCatalog = { ...body, hash: canonicalHash(body) }; await this.repo.saveCatalog(catalog, raw, owner);
    this.repo.audit(owner, 'catalog.refresh', catalog.hash, { provider, priced: catalog.models.length, unpriced: catalog.unpricedModels?.length }); return catalog;
  }
  catalog(owner: string, task?: AssistantTask) { return this.repo.catalog(this.provider(owner, task).id, owner); }
  async ensureCatalog(owner: string, task: AssistantTask) {
    const p = this.provider(owner, task), catalog = this.catalog(owner, task);
    if (!catalog || Date.now() - Date.parse(catalog.fetchedAt) > this.profile.catalog.maxAgeHours * 3600000) await this.refreshCatalog(owner, p.id);
  }
  private async boundedBody(response: Response, maxBytes: number): Promise<Buffer> {
    const reader = response.body?.getReader(), parts: Uint8Array[] = []; let bytes = 0;
    if (reader) while (true) { const { done, value } = await reader.read(); if (done) break;
      bytes += value.length; if (bytes > maxBytes) { await reader.cancel(); throw new AutomationError('Provider response exceeds the configured byte limit'); } parts.push(value); }
    return Buffer.concat(parts);
  }
  preview(owner: string) {
    const settings = this.repo.get(owner, this.profile.defaults).value;
    return this.profile.tasks.map(t => {
      try { const p = this.provider(owner, t.id), catalog = this.catalog(owner, t.id); if (!catalog) throw new AutomationError('Refresh the model catalog or add a reviewed model price profile');
        return { task: t.id, route: routeModel(t.id, 'Example task input', t.instruction, settings, catalog, this.profile, new Date(), this.repo.routingEvidence(owner, p.id, t.id, this.profile.routingEvidence.maximumAgeDays)) }; }
      catch (e) { return { task: t.id, blocked: (e as Error).message }; }
    });
  }
  /** Used both by free-form proposal requests and the existing checked narrative path. */
  generator(owner: string, task: AssistantTask): TextGenerator {
    return { providerKey: this.provider(owner, task).id, generate: request => this.generateRequest(owner, task, request) };
  }
  private async generateRequest(owner: string, task: AssistantTask, request: TextGenerationRequest) {
    const settings = this.repo.get(owner, this.profile.defaults).value;
    if (!settings.assistant.enabled) throw new AutomationError('Enable assistant calls in your personal settings first');
    const provider = this.provider(owner, task), credential = this.vault.resolve(owner, provider.id);
    if (!credential.isPresent) throw new AutomationError(credential.detail);
    await this.ensureCatalog(owner, task);
    const catalog = this.catalog(owner, task); if (!catalog) throw new AutomationError('Refresh the model catalog first');
    if (provider.id !== 'openrouter') {
      const active = this.repo.ceilings(owner, provider.id).filter(c => Date.parse(c.value.validUntil) > Date.now());
      if (catalog.models.some(m => !active.some(c => c.value.id === m.id))) throw new AutomationError('A reviewed model price profile expired; refresh the catalog');
    }
    const rule = this.profile.tasks.find(t => t.id === task)!, system = request.system ?? rule.instruction;
    const route = { ...routeModel(task, request.prompt, system, settings, catalog, this.profile, new Date(), this.repo.routingEvidence(owner, provider.id, task, this.profile.routingEvidence.maximumAgeDays)), providerProfileHash: this.providers.contentHash };
    if (this.repo.get(owner, this.profile.defaults).hash !== canonicalHash(settings) || !this.vault.resolve(owner, provider.id).isPresent)
      throw new AutomationError('Settings or credential changed during catalog discovery; retry with the current configuration');
    const endpoint = new URL(provider.endpoint);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new AutomationError('A secure provider profile is required');
    const reservation = this.repo.reserve(owner, route, settings.assistant.dailyBudgetUsd);
    const started = Date.now();
    try {
      const generator = new ProfileGenerator(provider, credential, async (url, init) => {
        const response = await this.transport(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(this.profile.transport.timeoutMs) });
        const raw = await this.boundedBody(response, this.profile.transport.maxResponseBytes);
        return { ok: response.ok, status: response.status, text: async () => raw.toString('utf8') };
      }, route.model.id, route.maxOutputTokens);
      const generated = await generator.generate({ prompt: request.prompt, system, model: route.model.id,
        params: { max_tokens: route.maxOutputTokens, ...(route.model.parameters.includes('temperature') ? { temperature: 0 } : {}),
          provider: { allow_fallbacks: false }, plugins: [] } });
      // Secret-shaped property names (including "tokens") are intentionally
      // scrubbed by the generic redactor. Preserve these typed usage counters
      // while redacting every upstream string before persistence or display.
      const result: typeof generated = { ...generated, text: redactText(generated.text),
        providerKey: redactText(generated.providerKey), model: redactText(generated.model),
        upstreamId: generated.upstreamId === null ? null : redactText(generated.upstreamId),
        usage: { promptTokens: Number.isSafeInteger(generated.usage.promptTokens) && generated.usage.promptTokens! >= 0 ? generated.usage.promptTokens : null,
          completionTokens: Number.isSafeInteger(generated.usage.completionTokens) && generated.usage.completionTokens! >= 0 ? generated.usage.completionTokens : null } };
      const { promptTokens, completionTokens } = result.usage;
      const count = (n: number | null) => Number.isSafeInteger(n) && n! >= 0;
      const estimate = result.model === route.model.id && count(promptTokens) && count(completionTokens)
        ? Math.ceil(1000000 * (promptTokens! * route.model.inputUsdPerToken + completionTokens! * route.model.outputUsdPerToken + route.model.requestUsd)) : null;
      const details = { ...result, route, latencyMs: Date.now() - started, approvalState: 'PROPOSED', nondeterministic: true, costMeaning: 'Provider-listed price estimate or held reservation; not an invoice',
        usageExceededReservation: estimate !== null && estimate > route.reserveMicroUsd };
      this.repo.settle(owner, reservation, details, estimate);
      return { ...result, route, reservationId: reservation };
    } catch {
      // A timeout may already have incurred a charge. Keep its reservation; never auto-retry.
      this.repo.settle(owner, reservation, { error: 'PROVIDER_CALL_FAILED', retryAutomatically: false }, null, true);
      throw new AutomationError('Provider call failed. Its budget reservation is retained; inspect the usage record before retrying.');
    }
  }
  async propose(owner: string, task: AssistantTask, prompt: string) {
    const result = await this.generateRequest(owner, task, { prompt, model: 'automatic', params: {} });
    return { ...result, approvalState: 'PROPOSED', nondeterministic: true };
  }
}
