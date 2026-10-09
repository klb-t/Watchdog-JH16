import type { PersonalProvider } from '../config/personal_providers';
import type { SecretHandle } from '../secrets';
import { OpenAiCompatibleGenerator } from './openai_compatible';
import { TextGenerationError, type HttpPost, type TextGenerator, type TextGenerationRequest } from './base';
import { effectiveGenerationParameters } from './generation_parameters';
import { canonicalHash } from '../domain/canonical';

/** Protocol translation; vendor-specific URLs, flags and limits remain data. */
export class ProfileGenerator implements TextGenerator {
  readonly providerKey: string;
  constructor(private readonly profile: PersonalProvider, private readonly credential: SecretHandle, private readonly post: HttpPost,
    private readonly modelId: string, private readonly maxOutputTokens: number,
    private readonly supportedParameters: readonly string[] | null = null,
    private readonly requestDefaults: Readonly<Record<string, unknown>> = {}) { this.providerKey = profile.id; }
  prepare(request: TextGenerationRequest) {
    if (request.model !== this.modelId) throw new TextGenerationError('model_not_permitted', this.profile.id, 'Model differs from the reserved route');
    return { ...effectiveGenerationParameters(this.profile, request.params, this.maxOutputTokens, this.supportedParameters, this.requestDefaults),
      credentialRef: this.credential.ref };
  }
  async generate(request: TextGenerationRequest) {
    const p = this.profile;
    const effective = this.prepare(request);
    if (!this.credential.isPresent) throw new TextGenerationError('credential_absent', p.id, this.credential.detail);
    if (p.protocol !== 'anthropic') {
      let requestBodyHash = '';
      const generator = new OpenAiCompatibleGenerator(p.id, p.endpoint, this.credential, async (url, init) => {
        requestBodyHash = canonicalHash(JSON.parse(init.body));
        return this.post(url, init);
      }, p.headers, [this.modelId]);
      const result = await generator.generate({ ...request, params: effective.parameters });
      return { ...result, generation: { ...effective, requestBodyHash } };
    }
    const body = { ...effective.parameters, model: this.modelId,
      ...(request.system ? { system: request.system } : {}), messages: [{ role: 'user', content: request.prompt }] };
    const response = await this.credential.use(key => this.post(p.endpoint, { method: 'POST', headers: {
      ...p.headers, 'Content-Type': 'application/json', 'x-api-key': key }, body: JSON.stringify(body) }));
    if (!response.ok) throw new TextGenerationError(response.status === 401 || response.status === 403 ? 'credential_invalid' : response.status === 429 ? 'rate_limited' : 'upstream_error', p.id, `HTTP ${response.status}`);
    let value: any; try { value = JSON.parse(await response.text()); } catch { throw new TextGenerationError('malformed_response', p.id, 'Invalid JSON'); }
    const parts = Array.isArray(value?.content) ? value.content.filter((b: any) => b.type === 'text' && typeof b.text === 'string') : [];
    const text = parts.map((b: any) => b.text).join('\n');
    if (value?.error || !text.trim()) throw new TextGenerationError('malformed_response', p.id, 'No response text');
    const usage = value.usage ?? {};
    return { text, providerKey: p.id, model: typeof value.model === 'string' ? value.model : request.model,
      generation: { ...effective, requestBodyHash: canonicalHash(body) },
      upstreamId: typeof value.id === 'string' ? value.id : null, nondeterministic: true as const,
      usage: { promptTokens: typeof usage.input_tokens === 'number' && !usage.cache_creation_input_tokens && !usage.cache_read_input_tokens ? usage.input_tokens : null,
        completionTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : null } };
  }
}
