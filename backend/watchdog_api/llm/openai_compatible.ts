import {
  TextGenerator, TextGenerationRequest, TextGenerationResult, TextGenerationError, HttpPost,
} from './base';
import { SecretHandle } from '../secrets';

/**
 * One adapter for every vendor that speaks the OpenAI chat-completions schema
 * — OpenRouter, OpenAI itself, Together, and any local llama.cpp/vLLM/Ollama
 * server. Writing five near-identical adapters would give five places for the
 * error mapping below to drift apart.
 *
 * The error mapping is the substantive part. An LLM call fails in ways that are
 * operationally different — a dead key, an exhausted budget, a per-minute
 * throttle — and collapsing them into "provider error" means the maintainer
 * cannot tell "top up the account" from "fix the key" from "wait sixty
 * seconds".
 */
export class OpenAiCompatibleGenerator implements TextGenerator {
  constructor(
    readonly providerKey: string,
    private readonly endpoint: string,
    private readonly credential: SecretHandle,
    private readonly post: HttpPost,
    private readonly extraHeaders: Record<string, string> = {},
    private readonly allowedModels: readonly string[] = [],
  ) {}

  async generate(request: TextGenerationRequest): Promise<TextGenerationResult> {
    if (!this.credential.isPresent) {
      throw new TextGenerationError(
        this.credential.status === 'invalid' ? 'credential_invalid' : 'credential_absent',
        this.providerKey,
        this.credential.detail,
      );
    }

    // An empty allow-list means "operator names their own model" (a manual
    // endpoint). A populated one is a real constraint: silently substituting a
    // different model is a silent method substitution under rule 4.
    if (this.allowedModels.length > 0 && !this.allowedModels.includes(request.model)) {
      throw new TextGenerationError('model_not_permitted', this.providerKey,
        `Model '${request.model}' is not in the configured allowed_models. ` +
        'Add it to config/providers/text_generation.json rather than passing it at the call site.');
    }

    const messages = [
      ...(request.system ? [{ role: 'system', content: request.system }] : []),
      { role: 'user', content: request.prompt },
    ];

    const res = await this.credential.use(key => this.post(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify({ model: request.model, messages, ...request.params }),
    }));

    const raw = await res.text();

    if (!res.ok) throw this.mapFailure(res.status, raw);

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new TextGenerationError('malformed_response', this.providerKey,
        'Upstream returned a 2xx body that is not JSON.');
    }

    // Some OpenAI-compatible gateways return HTTP 200 with an error object.
    if (parsed?.error) {
      throw new TextGenerationError('upstream_error', this.providerKey,
        `Upstream reported an error inside a 200 response: ${String(parsed.error?.message ?? parsed.error)}`);
    }

    const text = parsed?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.trim() === '') {
      throw new TextGenerationError('malformed_response', this.providerKey,
        'Upstream returned no message content. Refusing to substitute placeholder prose.');
    }

    const usage = parsed?.usage ?? {};
    return {
      text,
      providerKey: this.providerKey,
      // What the provider says it served, which can differ from what was asked
      // for (OpenRouter reroutes). Recording the asked-for model would hide that.
      model: typeof parsed?.model === 'string' ? parsed.model : request.model,
      upstreamId: typeof parsed?.id === 'string' ? parsed.id : null,
      usage: {
        promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
        completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
      },
      nondeterministic: true,
    };
  }

  private mapFailure(status: number, body: string): TextGenerationError {
    const snippet = body.slice(0, 300);
    switch (status) {
      case 401:
      case 403:
        return new TextGenerationError('credential_invalid', this.providerKey,
          `Upstream rejected the credential (HTTP ${status}). The key is present but not accepted.`);
      case 402:
        return new TextGenerationError('quota_exhausted', this.providerKey,
          'Upstream reports insufficient credit (HTTP 402). This is a billing state, not a transient fault.');
      case 429:
        return new TextGenerationError('rate_limited', this.providerKey,
          `Upstream rate-limited the request (HTTP 429): ${snippet}`, true);
      default:
        return new TextGenerationError('upstream_error', this.providerKey,
          `HTTP ${status}: ${snippet}`, status >= 500);
    }
  }
}
