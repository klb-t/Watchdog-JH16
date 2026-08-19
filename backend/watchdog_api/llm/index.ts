import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { OpenAiCompatibleGenerator } from './openai_compatible';
import { TextGenerator, HttpPost, TextGenerationError } from './base';
import { SecretStore, secretStore as defaultSecretStore, CredentialStatus } from '../secrets';
import { RegistryStatus, capabilityRegistry, CapabilityRegistry } from '../sources/provider_registry';
import { hashConfig } from '../config/canonicalize';

export * from './base';
export { OpenAiCompatibleGenerator } from './openai_compatible';

/**
 * A `secret_ref` is a pointer. This refuses anything shaped like a literal key,
 * because the failure it prevents — a real credential committed to
 * `config/providers/` and then hashed into a manifest — is unrecoverable by
 * rotation alone once it is in git history.
 */
const SecretRef = z.string().regex(/^[a-z][a-z0-9-]*:.+$/,
  "secret_ref must be '<scheme>:<locator>', e.g. 'env:OPENROUTER_API_KEY'. It is a pointer, never a key.")
  .refine(v => !/^(sk|pk|ya29|AIza|hf)[-_]/i.test(v.split(':').slice(1).join(':')),
    'This looks like a literal credential. Secrets never live in configuration.');

const ProviderConfigSchema = z.object({
  provider_key: z.string().min(1),
  display_name: z.string().min(1),
  endpoint: z.string().url().optional(),
  endpoint_ref: SecretRef.optional(),
  secret_ref: SecretRef,
  default_model: z.string().optional(),
  default_model_ref: SecretRef.optional(),
  allowed_models: z.array(z.string()),
  generation_params: z.record(z.string(), z.unknown()),
  attribution_headers: z.record(z.string(), z.string()).optional(),
}).refine(p => !!(p.endpoint || p.endpoint_ref), {
  message: 'A provider needs either endpoint or endpoint_ref.',
}).refine(p => !!(p.default_model || p.default_model_ref), {
  message: 'A provider needs either default_model or default_model_ref.',
});

const TextGenerationConfigSchema = z.object({
  schema_version: z.string(),
  capability: z.literal('text.generate'),
  providers: z.array(ProviderConfigSchema).min(1),
});

export type TextGenerationConfig = z.infer<typeof TextGenerationConfigSchema>;

export const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'config', 'providers', 'text_generation.json');

export function loadTextGenerationConfig(file: string = DEFAULT_CONFIG_PATH): { config: TextGenerationConfig; hash: string } {
  const parsed = TextGenerationConfigSchema.parse(JSON.parse(fs.readFileSync(file, 'utf-8')));
  return { config: parsed, hash: hashConfig(parsed) };
}

export interface ProviderAvailability {
  providerKey: string;
  displayName: string;
  /** Derived on read from credential state — never a stored flag. */
  status: RegistryStatus;
  credentialStatus: CredentialStatus;
  /** What the maintainer must do to make this usable. Empty when usable. */
  remediation: string;
  defaultModel: string | null;
  allowedModels: readonly string[];
}

const defaultPost: HttpPost = (url, init) => fetch(url, init) as any;

/**
 * Turns configuration plus credential state into either a working generator or
 * a precise reason why there isn't one.
 *
 * Availability is **derived**, not stored. A provider is `implemented` only
 * while its credential actually resolves; deleting the environment variable
 * takes it back to `blocked` on the next read with no invalidation step. A
 * stored `is_configured` boolean is the version that eventually lies.
 */
export class TextGenerationRegistry {
  constructor(
    private readonly config: TextGenerationConfig,
    private readonly configHash: string,
    private readonly secrets: SecretStore = defaultSecretStore,
    private readonly post: HttpPost = defaultPost,
  ) {}

  get hash(): string { return this.configHash; }

  providerKeys(): string[] {
    return this.config.providers.map(p => p.provider_key).sort();
  }

  private find(providerKey: string) {
    const p = this.config.providers.find(x => x.provider_key === providerKey);
    if (!p) {
      throw new TextGenerationError('upstream_error', providerKey,
        `No text.generate provider '${providerKey}' is configured. Known: ${this.providerKeys().join(', ')}.`);
    }
    return p;
  }

  /** Resolves `X` or `X_ref`, so an operator can supply either literally or via a secret. */
  private async resolveField(literal: string | undefined, ref: string | undefined): Promise<string | null> {
    if (literal) return literal;
    if (!ref) return null;
    const h = await this.secrets.resolve(ref);
    return h.isPresent ? h.use(v => v) : null;
  }

  async availability(providerKey: string): Promise<ProviderAvailability> {
    const p = this.find(providerKey);
    const cred = await this.secrets.resolve(p.secret_ref);
    const model = await this.resolveField(p.default_model, p.default_model_ref);
    const endpoint = await this.resolveField(p.endpoint, p.endpoint_ref);

    let status: RegistryStatus = 'implemented';
    let remediation = '';

    if (!cred.isPresent) {
      status = 'blocked';
      remediation = cred.status === 'invalid'
        ? `The credential at ${p.secret_ref} is set but unusable. ${cred.detail}`
        : `Set ${p.secret_ref} to enable ${p.display_name}.`;
    } else if (!endpoint) {
      status = 'blocked';
      remediation = `Set ${p.endpoint_ref} to the endpoint URL.`;
    } else if (!model) {
      status = 'blocked';
      remediation = `Set ${p.default_model_ref} to a model identifier.`;
    }

    return {
      providerKey: p.provider_key,
      displayName: p.display_name,
      status,
      credentialStatus: cred.status,
      remediation,
      defaultModel: model,
      allowedModels: p.allowed_models,
    };
  }

  async listAvailability(): Promise<ProviderAvailability[]> {
    return Promise.all(this.providerKeys().map(k => this.availability(k)));
  }

  /**
   * Publishes derived status into the capability registry, so the single gate
   * every run already passes through (`assertSelectable`) keeps working
   * unchanged. Without this, credential state and selectability would be two
   * sources of truth.
   */
  async syncTo(registry: CapabilityRegistry = capabilityRegistry): Promise<void> {
    for (const a of await this.listAvailability()) {
      const existing = registry.getProvider(a.providerKey);
      registry.registerProvider({
        provider_key: a.providerKey,
        capability_key: 'text.generate',
        display_name: a.displayName,
        adapter_id: 'openai_compatible',
        adapter_version: '1.0.0',
        status: a.status,
        approved_by: existing?.approved_by,
        approved_at: existing?.approved_at,
      });
    }
  }

  /** A generator, or a throw naming the one thing to fix. */
  async get(providerKey: string): Promise<TextGenerator> {
    const p = this.find(providerKey);
    const a = await this.availability(providerKey);
    if (a.status !== 'implemented') {
      throw new TextGenerationError(
        a.credentialStatus === 'invalid' ? 'credential_invalid' : 'credential_absent',
        providerKey, a.remediation);
    }
    const cred = await this.secrets.resolve(p.secret_ref);
    const endpoint = (await this.resolveField(p.endpoint, p.endpoint_ref))!;
    return new OpenAiCompatibleGenerator(
      p.provider_key, endpoint, cred, this.post, p.attribution_headers ?? {}, p.allowed_models);
  }

  async defaultParams(providerKey: string): Promise<Record<string, unknown>> {
    return { ...this.find(providerKey).generation_params };
  }
}

export function buildTextGenerationRegistry(
  file: string = DEFAULT_CONFIG_PATH,
  secrets?: SecretStore,
  post?: HttpPost,
): TextGenerationRegistry {
  const { config, hash } = loadTextGenerationConfig(file);
  return new TextGenerationRegistry(config, hash, secrets, post);
}
