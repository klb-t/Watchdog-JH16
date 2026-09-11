import { createHash } from 'node:crypto';
import type { CatalogModel, ModelCatalog, ModelRoute, PersonalSettings, AssistantTask } from '../../../shared/settings';
import type { AssistantProfile } from '../config/assistant';
import { canonicalHash } from '../domain/canonical';
import { AutomationError } from '../db/repositories/automation';
const price = (v: unknown): number | null => {
  if (typeof v !== 'string' && typeof v !== 'number' || String(v).trim() === '') return null;
  const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null;
};
export function normalizeModelCatalog(raw: Buffer, profile: AssistantProfile, now = new Date()): ModelCatalog {
  const json = JSON.parse(raw.toString('utf8'));
  if (!Array.isArray(json.data) || json.data.length > profile.catalog.maxModels) throw new AutomationError('Model catalog has an invalid or oversized collection');
  const models: CatalogModel[] = [], ids = new Set<string>(); let rejected = 0;
  for (const m of json.data) {
    const rates = m.pricing, input = price(rates?.prompt), output = price(rates?.completion), request = rates?.request === undefined ? 0 : price(rates.request);
    if (typeof m.id !== 'string' || !/^[A-Za-z0-9_./:+-]{1,160}$/.test(m.id) || ids.has(m.id) || !Number.isSafeInteger(m.context_length) || m.context_length < 1 ||
      !m.architecture?.input_modalities?.includes('text') || !m.architecture?.output_modalities?.includes('text') || input === null || output === null || request === null) { rejected++; continue; }
    let inputMax = input, outputMax = output, invalid = false;
    if (rates.overrides !== undefined) {
      if (!Array.isArray(rates.overrides)) invalid = true;
      else for (const tier of rates.overrides) { const a = price(tier.prompt), b = price(tier.completion);
        if (a === null || b === null) invalid = true; else { inputMax = Math.max(inputMax, a); outputMax = Math.max(outputMax, b); } }
    }
    if (invalid) { rejected++; continue; }
    ids.add(m.id); models.push({ id: m.id, name: typeof m.name === 'string' ? m.name : m.id, contextTokens: m.context_length,
      maxOutputTokens: Number.isSafeInteger(m.top_provider?.max_completion_tokens) && m.top_provider.max_completion_tokens > 0 ? m.top_provider.max_completion_tokens : null,
      inputUsdPerToken: inputMax, outputUsdPerToken: outputMax, requestUsd: request,
      parameters: Array.isArray(m.supported_parameters) ? m.supported_parameters.filter((s: unknown) => typeof s === 'string') : [], pricePolicy: 'maximum-listed-tier' });
  }
  if (!models.length) throw new AutomationError('No usable priced text models in the catalog');
  models.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const body = { provider: 'openrouter' as const, models, rejected, source: profile.catalog.url, fetchedAt: now.toISOString(), rawHash: createHash('sha256').update(raw).digest('hex') };
  return { ...body, hash: canonicalHash(body) };
}
export function routeModel(task: AssistantTask, prompt: string, system: string, settings: PersonalSettings, catalog: ModelCatalog, profile: AssistantProfile, now = new Date()): ModelRoute {
  const rule = profile.tasks.find(t => t.id === task); if (!rule) throw new AutomationError('Unknown assistant task');
  const age = now.getTime() - Date.parse(catalog.fetchedAt);
  if (!Number.isFinite(age) || age < -60000 || age > profile.catalog.maxAgeHours * 3600000) throw new AutomationError('Model prices are stale; refresh the catalog before making a paid call');
  // UTF-8 bytes conservatively bound ordinary text tokenization; overhead is separately reserved.
  const inputTokenAllowance = Buffer.byteLength(prompt + system, 'utf8') + profile.transport.inputOverheadTokens;
  const candidates = catalog.models.filter(m => m.contextTokens >= Math.max(rule.minimumContext, inputTokenAllowance + rule.maxOutputTokens) &&
    (m.maxOutputTokens === null || m.maxOutputTokens >= rule.maxOutputTokens) &&
    (settings.assistant.allowFree || m.inputUsdPerToken + m.outputUsdPerToken + m.requestUsd > 0))
    .map(model => ({ model, reserveMicroUsd: Math.ceil(1000000 * (model.inputUsdPerToken * inputTokenAllowance + model.outputUsdPerToken * rule.maxOutputTokens + model.requestUsd)) }))
    .filter(c => Number.isSafeInteger(c.reserveMicroUsd) && c.reserveMicroUsd <= Math.floor(settings.assistant.requestBudgetUsd * 1000000))
    .sort((a, b) => a.reserveMicroUsd - b.reserveMicroUsd || a.model.id.localeCompare(b.model.id, 'en'));
  const pin = settings.assistant.modelPins[task];
  const chosen = pin ? candidates.find(c => c.model.id === pin) : candidates[Math.floor((candidates.length - 1) * rule.maxCostQuantile * settings.assistant.economy / 100)];
  if (!chosen) throw new AutomationError(pin ? 'Pinned model is unavailable or outside the token/cost limits' : 'No model fits this task and request budget');
  return { task, ...chosen, catalogHash: catalog.hash, routingProfileHash: profile.contentHash, settingsHash: canonicalHash(settings), inputTokenAllowance, maxOutputTokens: rule.maxOutputTokens,
    reason: pin ? 'Explicit task model profile' : `Task-specific cost quantile among ${candidates.length} compatible models; price preference is not a quality score` };
}
