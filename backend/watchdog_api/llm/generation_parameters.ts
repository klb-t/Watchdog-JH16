import { reservedGenerationParameters, type PersonalProvider } from '../config/personal_providers';
import { canonicalHash } from '../domain/canonical';
import { assertGenerationParameterRecord, TextGenerationError, type GenerationParameters } from './base';

export function validateGenerationOverrides(profile: PersonalProvider, requested: Readonly<Record<string, unknown>>,
  supportedParameters: readonly string[] | null = null): void {
  assertGenerationParameterRecord(requested, profile.id);
  for (const [key, value] of Object.entries(requested)) {
    const rule = profile.requestParameters && Object.hasOwn(profile.requestParameters, key) ? profile.requestParameters[key] : undefined;
    if (reservedGenerationParameters.has(key) || !rule || (supportedParameters !== null && !supportedParameters.includes(key)))
      throw new TextGenerationError('invalid_parameters', profile.id, `Parameter '${key}' is not permitted by the selected capability`);
    const valid = rule.type === 'boolean' ? typeof value === 'boolean'
      : typeof value === 'number' && Number.isFinite(value) && (rule.type !== 'integer' || Number.isSafeInteger(value))
        && (rule.minimum === undefined || value >= rule.minimum) && (rule.maximum === undefined || value <= rule.maximum);
    if (!valid) throw new TextGenerationError('invalid_parameters', profile.id, `Parameter '${key}' does not match its capability schema`);
  }
}

/** Resolve one provider profile and one request; no network, credential or ledger. */
export function effectiveGenerationParameters(profile: PersonalProvider, requested: Readonly<Record<string, unknown>>,
  maxOutputTokens: number, supportedParameters: readonly string[] | null = null,
  defaults: Readonly<Record<string, unknown>> = {}): GenerationParameters {
  const parameters: Record<string, unknown> = structuredClone(profile.parameters);
  const sources: Record<string, 'provider_profile' | 'task_profile' | 'request' | 'reservation'> = {};
  for (const key of Object.keys(parameters)) sources[key] = 'provider_profile';
  for (const [source, layer] of [['task_profile', defaults], ['request', requested]] as const) {
    validateGenerationOverrides(profile, layer, supportedParameters);
    for (const [key, value] of Object.entries(layer)) {
      parameters[key] = value;
      sources[key] = source;
    }
  }
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0)
    throw new TextGenerationError('invalid_parameters', profile.id, 'Output bound must be a positive safe integer');
  parameters[profile.outputParameter] = maxOutputTokens;
  parameters.stream = false;
  sources[profile.outputParameter] = sources.stream = 'reservation';
  const body = { schema: 'watchdog.generation_parameters/1' as const,
    providerProfileHash: canonicalHash(profile), parameters, sources };
  return { ...body, hash: canonicalHash(body) };
}
