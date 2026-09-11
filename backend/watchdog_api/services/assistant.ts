import { SettingsRepository } from '../db/repositories/settings';
import { UserVault } from '../secrets/user_vault';
import type { AssistantProfile } from '../config/assistant';
import { AutomationError } from '../db/repositories/automation';
import { normalizeModelCatalog, routeModel } from '../llm/routing';
import { OpenAiCompatibleGenerator, loadTextGenerationConfig } from '../llm';
import type { TextGenerator, TextGenerationRequest } from '../llm/base';
import type { AssistantTask, ModelRoute } from '../../../shared/settings';
import { redactText } from '../utils/redaction';

export class AssistantService {
  constructor(readonly repo: SettingsRepository, readonly vault: UserVault, readonly profile: AssistantProfile,
    private readonly transport: typeof fetch = fetch) { repo.archiveAssistantProfile(profile); }
  async refreshCatalog(owner: string) {
    const url = new URL(this.profile.catalog.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new AutomationError('Invalid catalog endpoint');
    const response = await this.transport(url.href, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new AutomationError(`Catalog returned HTTP ${response.status}`);
    const raw = await this.boundedBody(response, this.profile.catalog.maxBytes);
    const catalog = normalizeModelCatalog(raw, this.profile); await this.repo.saveCatalog(catalog, raw);
    this.repo.audit(owner, 'catalog.refresh', catalog.hash, { count: catalog.models.length, rejected: catalog.rejected }); return catalog;
  }
  private async boundedBody(response: Response, maxBytes: number): Promise<Buffer> {
    const reader = response.body?.getReader(), parts: Uint8Array[] = []; let bytes = 0;
    if (reader) while (true) { const { done, value } = await reader.read(); if (done) break;
      bytes += value.length; if (bytes > maxBytes) { await reader.cancel(); throw new AutomationError('Provider response exceeds the configured byte limit'); } parts.push(value); }
    return Buffer.concat(parts);
  }
  preview(owner: string) {
    const settings = this.repo.get(owner, this.profile.defaults).value, catalog = this.repo.catalog();
    return this.profile.tasks.map(t => {
      try { if (!catalog) throw new AutomationError('Refresh the public model catalog'); return { task: t.id, route: routeModel(t.id, 'Example task input', t.instruction, settings, catalog, this.profile) }; }
      catch (e) { return { task: t.id, blocked: (e as Error).message }; }
    });
  }
  /** Used both by free-form proposal requests and the existing checked narrative path. */
  generator(owner: string, task: AssistantTask): TextGenerator {
    return { providerKey: 'openrouter', generate: request => this.generateRequest(owner, task, request) };
  }
  private async generateRequest(owner: string, task: AssistantTask, request: TextGenerationRequest) {
    const settings = this.repo.get(owner, this.profile.defaults).value;
    if (!settings.assistant.enabled) throw new AutomationError('Enable assistant calls in your personal settings first');
    const credential = this.vault.resolve(owner, settings.assistant.provider);
    if (!credential.isPresent) throw new AutomationError(credential.detail);
    const catalog = this.repo.catalog(); if (!catalog) throw new AutomationError('Refresh the model catalog first');
    const rule = this.profile.tasks.find(t => t.id === task)!, system = request.system ?? rule.instruction;
    const route = routeModel(task, request.prompt, system, settings, catalog, this.profile);
    const provider = loadTextGenerationConfig().config.providers.find(p => p.provider_key === settings.assistant.provider);
    if (!provider?.endpoint) throw new AutomationError('Configured provider endpoint is unavailable');
    const endpoint = new URL(provider.endpoint);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new AutomationError('A secure provider profile is required');
    const reservation = this.repo.reserve(owner, route, settings.assistant.dailyBudgetUsd);
    try {
      const generator = new OpenAiCompatibleGenerator(provider.provider_key, provider.endpoint, credential, async (url, init) => {
        const response = await this.transport(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(this.profile.transport.timeoutMs) });
        const raw = await this.boundedBody(response, this.profile.transport.maxResponseBytes);
        return { ok: response.ok, status: response.status, text: async () => raw.toString('utf8') };
      }, provider.attribution_headers, [route.model.id]);
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
      const details = { ...result, route, approvalState: 'PROPOSED', nondeterministic: true, costMeaning: 'Provider-listed price estimate or held reservation; not an invoice',
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
