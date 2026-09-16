# Personal setup and bounded assistant calls

The Setup wizard now saves owner-scoped configuration in SQLite. It offers simple,
standard, expert and debug views; these are presentation preferences, never role grants.
The cost slider belongs only to simple mode. Standard settings expose separate daily
LLM, per-request and SERP-request ceilings; expert settings can pin a model per task.
Language, dialect, slang, sentiment and geography are separate research dimensions.

Personal OpenRouter and SerpApi keys are entered once through the wizard. They are
encrypted with AES-256-GCM with owner/provider-bound envelopes. The browser clears the
field; settings, diagnostic events and exports contain no plaintext key. The master key
comes from `WATCHDOG_VAULT_KEY` (base64, exactly 32 bytes), or a private local file at
`WATCHDOG_VAULT_KEY_FILE`, defaulting next to the database under `secrets/master.key`.
Back up that file separately: losing it makes the encrypted keys unreadable. Preserve
both the database and object-store volumes. A saved key is not a verified subscription.

OpenRouter model identifiers, capabilities and prices are fetched from its public model
catalog, normalized and archived with original bytes and a hash. Prices older than 24
hours block automatic calls until refresh. Routing enforces context/output ceilings,
uses a separate task cost preference, respects explicit pins and reserves the estimated
maximum cost atomically before a call. Uncertain usage, failed calls and timeouts retain
the reservation and never retry automatically. This is an application-side estimate,
not a provider invoice or a guarantee against provider billing changes.

The initial router uses compatibility and cost; measured quality/benchmark routing,
additional personal provider profiles and trip-report/extractor tasks are the next
checkpoint. Price is never presented as measured model quality. The existing operator
OpenAI-compatible provider registry remains available independently.

The wizard prepares an immutable research plan before launching it. Its JH16 control
uses the actual 32-query fixture flow and the reviewed, hash-pinned MethodSpec executor.
A new SerpApi collection is a temporal reassessment; published counts are a pipeline
self-check. Neither is represented as an independent replication of historic collection.
Chosen public memory/discovery jobs and a daily paper schedule are real queue entries.
Repeated launch requests return the existing launch. Expanding a research dimension
records an exploratory plan, not an invented measurement or confirmed hypothesis.

Free-form assistant proposals and the checked narrative rewrite use the personal key
and the same budget router. Narratives still pass the existing no-novel-numbers guard.
Proposals stay PROPOSED and record the returned model, request settings/profile/catalog
hashes, usage and reservation. Only deterministic code computes scientific numbers.

Validation includes owner isolation, stale settings edits, encrypted-vault tampering and
rotation, malformed credential JSON, cross-origin writes, concurrent budget reservations,
actual transport selection, per-owner SERP counters and the complete fixture launch.
The browser test additionally checks saved modes, mobile width and explicit method review.

Reference: [OpenRouter model catalog API](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties).
