# Personal provider profiles and task routing

The personal vault and wizard now support 16 provider profiles. This means bounded,
non-streaming text generation through an implemented protocol adapter. It does not mean
every provider-specific tool, multimodal feature, regional endpoint or account is tested.
Each profile includes its official documentation URL in `config/providers/personal.json`.

| Provider | Protocol | Model discovery | Automatic provider pricing |
|---|---|---|---|
| OpenRouter | Chat Completions + gateway flags | Public catalog | Yes |
| OpenAI | Chat Completions, max_completion_tokens | Authenticated | Reviewed profile required |
| Anthropic | Native Messages | Authenticated | Reviewed profile required |
| Google Gemini | OpenAI compatibility | Authenticated | Reviewed profile required |
| Groq | OpenAI compatibility | Authenticated | Reviewed profile required |
| Together AI | OpenAI compatibility | Authenticated | Reviewed profile required |
| Fireworks AI | OpenAI compatibility | Manual model profile | Reviewed profile required |
| DeepSeek | OpenAI compatibility | Authenticated | Reviewed profile required |
| Mistral AI | OpenAI compatibility | Authenticated | Reviewed profile required |
| xAI | Chat Completions | Authenticated | Reviewed profile required |
| Perplexity | Chat Completions | Manual model profile | Include request/search fees |
| Cohere | OpenAI compatibility | Manual model profile | Reviewed profile required |
| NVIDIA NIM | OpenAI compatibility | Authenticated | Reviewed profile required |
| Hugging Face | Router Chat Completions | Catalog | Reviewed profile required |
| Alibaba Model Studio | Singapore OpenAI endpoint | Authenticated | Reviewed profile required |
| Cerebras | OpenAI compatibility | Authenticated | Reviewed profile required |

Provider keys are never probed against another service. Private catalogs, model-price
profiles and task benchmark records are owner-scoped. Unsupported catalog discovery
does not prevent a named, reviewed model profile from using the generation adapter.
Direct model profiles declare their price ceiling, context/output limits, provenance and
expiration. The standard UI reviews them for 24 hours. They do not borrow another
provider's price or pretend to be an automatically verified price feed. Expiry blocks use.
Automatic direct-provider price acquisition and populated price/quality seeds remain open.

Seven task profiles separate query expansion, method proposals, narrative, extraction
planning, qualitative trip-report interpretation, paper-method extraction and extension
proposals. Task provider assignments and model pins are saved data. Bulk public collection
continues to use deterministic adapters; no text generator is on that numeric path.

Simple mode alone has the cost slider. Standard/expert modes use task defaults, independent
budgets, provider assignments and explicit pins. Compatible models first pass context,
output and request-budget limits. Within the selected price range, a comparable, reviewed
task benchmark can choose a lower-priced model over a poorer, more expensive candidate.
The same suite hash is required; unrelated leaderboard scales are not combined. Wilson
lower bounds account for sample size. Observed per-task success rate contributes only
after the configured minimum number of calls. Latency is recorded for inspection.

Benchmarks are imported as reviewed source data with passed/total, source, observation
time and exact suite hash, never invented by a model. Unknown quality remains explicitly
unknown. Fresh default settings do not contain fabricated benchmark scores. The current
policy does not itself ask an LLM to choose a model or run semantic benchmark suites.
Those are extension points with the price and provenance gates already in place.

Public OpenRouter catalog refresh can also be selected in Automation and scheduled.
All generated text remains PROPOSED. Price/settings/task/provider/catalog hashes,
returned model, usage, latency and uncertain reservations are retained. Native Messages
cache usage is treated conservatively when complete pricing cannot be resolved.

Validation: one contract test traverses all 16 real protocol adapters with injected HTTP
fixtures, checking native/bearer credentials, endpoint, limits, model pins and blocked
parameter overrides. Other tests exercise native Messages through the owned budget
service and private catalog store, cross-task routing, benchmark comparability and stale
or unavailable configuration. These are not 16 paid account integration tests.
