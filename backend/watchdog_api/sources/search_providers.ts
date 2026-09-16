import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { SerpApiAdapter, SerpApiProviderConfig, HttpGet, Sleep } from './serpapi';
import { SecretStore, secretStore as defaultSecretStore, CredentialStatus } from '../secrets';
import { RegistryStatus, capabilityRegistry, CapabilityRegistry } from './provider_registry';
import { hashConfig } from '../config/canonicalize';

/** Same rule as the text.generate config: a pointer, never a key. */
const SecretRef = z.string().regex(/^[a-z][a-z0-9-]*:.+$/,
  "secret_ref must be '<scheme>:<locator>'. It is a pointer, never a key.")
  .refine(v => !/^(sk|pk|ya29|AIza|hf)[-_]/i.test(v.split(':').slice(1).join(':')),
    'This looks like a literal credential. Secrets never live in configuration.');

const ProviderSchema = z.object({
  provider_key: z.string().min(1),
  display_name: z.string().min(1),
  endpoint: z.string().url(),
  secret_ref: SecretRef,
  engine: z.string().min(1),
  api_key_param: z.string().min(1),
  count_path: z.string().min(1),
  zero_result_policy: z.enum(['treat_as_missing', 'treat_as_measurement']),
  request_params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  pacing: z.object({
    min_interval_ms: z.number().int().nonnegative(),
    // Unbounded retries against an exhausted quota is a hung study, not resilience.
    max_attempts: z.number().int().min(1).max(10),
    backoff_ms: z.array(z.number().int().nonnegative()),
  }),
});

const SearchProviderConfigSchema = z.object({
  schema_version: z.string(),
  capability: z.literal('search.result_count'),
  providers: z.array(ProviderSchema).min(1),
});

export type SearchProviderConfig = z.infer<typeof SearchProviderConfigSchema>;

export const DEFAULT_SEARCH_CONFIG_PATH =
  path.join(process.cwd(), 'config', 'providers', 'search_result_count.json');

export function loadSearchProviderConfig(file: string = DEFAULT_SEARCH_CONFIG_PATH) {
  const config = SearchProviderConfigSchema.parse(JSON.parse(fs.readFileSync(file, 'utf-8')));
  return { config, hash: hashConfig(config) };
}

export interface SearchProviderAvailability {
  providerKey: string;
  displayName: string;
  status: RegistryStatus;
  credentialStatus: CredentialStatus;
  remediation: string;
}

const defaultGet: HttpGet = (url) => fetch(url) as any;

/**
 * Availability derived from credential state, exactly as for `text.generate`.
 * The two registries are separate because the capabilities are separate (D5),
 * but they must behave identically: a provider is never `implemented` on the
 * strength of a stored flag.
 */
export class SearchProviderRegistry {
  constructor(
    private readonly config: SearchProviderConfig,
    private readonly configHash: string,
    private readonly secrets: SecretStore = defaultSecretStore,
    private readonly httpGet: HttpGet = defaultGet,
    private readonly sleep?: Sleep,
  ) {}

  get hash(): string { return this.configHash; }

  providerKeys(): string[] { return this.config.providers.map(p => p.provider_key).sort(); }

  private find(providerKey: string) {
    const p = this.config.providers.find(x => x.provider_key === providerKey);
    if (!p) throw new Error(`No search.result_count provider '${providerKey}'. Known: ${this.providerKeys().join(', ')}.`);
    return p;
  }

  async availability(providerKey: string): Promise<SearchProviderAvailability> {
    const p = this.find(providerKey);
    const cred = await this.secrets.resolve(p.secret_ref);
    const usable = cred.isPresent;
    return {
      providerKey: p.provider_key,
      displayName: p.display_name,
      status: usable ? 'implemented' : 'blocked',
      credentialStatus: cred.status,
      remediation: usable ? ''
        : cred.status === 'invalid'
          ? `The credential at ${p.secret_ref} is set but unusable. ${cred.detail}`
          : `Set ${p.secret_ref} to enable ${p.display_name}.`,
    };
  }

  async listAvailability(): Promise<SearchProviderAvailability[]> {
    return Promise.all(this.providerKeys().map(k => this.availability(k)));
  }

  async syncTo(registry: CapabilityRegistry = capabilityRegistry): Promise<void> {
    for (const a of await this.listAvailability()) {
      const existing = registry.getProvider(a.providerKey);
      registry.registerProvider({
        provider_key: a.providerKey,
        capability_key: 'search.result_count',
        display_name: a.displayName,
        adapter_id: 'serpapi',
        adapter_version: '1.0.0',
        status: a.status,
        approved_by: existing?.approved_by,
        approved_at: existing?.approved_at,
      });
    }
  }

  /**
   * Returns an adapter even when the credential is absent.
   *
   * That is deliberate and is the opposite of the `text.generate` registry,
   * which throws. A narrative that cannot be generated is one absent artifact;
   * an acquisition run that cannot start produces no record at all. Here the
   * adapter runs and writes 32 observations that are explicitly missing with
   * reason `CREDENTIAL_UNAVAILABLE` — an inspectable, honest record of a study
   * that was attempted and could not collect data, which is worth strictly
   * more than a stack trace.
   */
  async adapter(providerKey: string): Promise<SerpApiAdapter> {
    const p = this.find(providerKey);
    const cred = await this.secrets.resolve(p.secret_ref);
    return new SerpApiAdapter(p as SerpApiProviderConfig, cred, this.httpGet, this.sleep);
  }
}

export function buildSearchProviderRegistry(
  file: string = DEFAULT_SEARCH_CONFIG_PATH,
  secrets?: SecretStore,
  httpGet?: HttpGet,
  sleep?: Sleep,
): SearchProviderRegistry {
  const { config, hash } = loadSearchProviderConfig(file);
  return new SearchProviderRegistry(config, hash, secrets, httpGet, sleep);
}
