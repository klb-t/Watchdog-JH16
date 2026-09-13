import type { PersonalProvider } from '../config/personal_providers';
import type { SecretHandle } from '../secrets';
import { OpenAiCompatibleGenerator } from './openai_compatible';
import { TextGenerationError, type HttpPost, type TextGenerator, type TextGenerationRequest } from './base';

/** Protocol translation; vendor-specific URLs, flags and limits remain data. */
export class ProfileGenerator implements TextGenerator {
  readonly providerKey: string;
  constructor(private readonly profile: PersonalProvider, private readonly credential: SecretHandle, private readonly post: HttpPost,
    private readonly modelId: string, private readonly maxOutputTokens: number) { this.providerKey = profile.id; }
  async generate(request: TextGenerationRequest) {
    const p = this.profile;
    if (request.model !== this.modelId) throw new TextGenerationError('model_not_permitted', p.id, 'Model differs from the reserved route');
    if (!this.credential.isPresent) throw new TextGenerationError('credential_absent', p.id, this.credential.detail);
    if (p.protocol !== 'anthropic') {
      const generator = new OpenAiCompatibleGenerator(p.id, p.endpoint, this.credential, this.post, p.headers, [this.modelId]);
      return generator.generate({ ...request, params: { ...p.parameters, [p.outputParameter]: this.maxOutputTokens, stream: false } });
    }
    const response = await this.credential.use(key => this.post(p.endpoint, { method: 'POST', headers: {
      ...p.headers, 'Content-Type': 'application/json', 'x-api-key': key }, body: JSON.stringify({ ...p.parameters,
      model: this.modelId, max_tokens: this.maxOutputTokens, stream: false,
      ...(request.system ? { system: request.system } : {}), messages: [{ role: 'user', content: request.prompt }] }) }));
    if (!response.ok) throw new TextGenerationError(response.status === 401 || response.status === 403 ? 'credential_invalid' : response.status === 429 ? 'rate_limited' : 'upstream_error', p.id, `HTTP ${response.status}`);
    let value: any; try { value = JSON.parse(await response.text()); } catch { throw new TextGenerationError('malformed_response', p.id, 'Invalid JSON'); }
    const parts = Array.isArray(value?.content) ? value.content.filter((b: any) => b.type === 'text' && typeof b.text === 'string') : [];
    const text = parts.map((b: any) => b.text).join('\n');
    if (value?.error || !text.trim()) throw new TextGenerationError('malformed_response', p.id, 'No response text');
    const usage = value.usage ?? {};
    return { text, providerKey: p.id, model: typeof value.model === 'string' ? value.model : request.model,
      upstreamId: typeof value.id === 'string' ? value.id : null, nondeterministic: true as const,
      usage: { promptTokens: typeof usage.input_tokens === 'number' && !usage.cache_creation_input_tokens && !usage.cache_read_input_tokens ? usage.input_tokens : null,
        completionTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : null } };
  }
}
