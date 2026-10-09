import { canonicalHash } from '../domain/canonical';
import { ApprovalState } from '../domain/approval';
import { TextGenerator, TextGenerationError, TextGenerationResult } from '../llm/base';
import { loadNarrativeCatalog, selectNarrativeRecipe, renderNarrativeText, type NarrativeCatalog, type NarrativeRecipe } from '../config/narrative';

/**
 * Narrative service (E1.17).
 *
 * Consumes a **frozen** payload and its hash. It cannot read the database,
 * cannot recompute, and cannot alter a scientific value — the type it receives
 * is the only thing it sees, and the output carries the hash of what it was
 * given so any drift is detectable.
 *
 * Every generated paragraph is `PROPOSED` until a human approves it, and is
 * rendered visually distinct from deterministic content wherever it appears,
 * including in exports.
 */

export interface NarrativePayload {
  /**
   * Deliberately no run id.
   *
   * The payload is the *analysis* being described, so two runs that computed
   * the same numbers must produce the same payload hash — that identity is
   * useful evidence, and mixing the run id in would destroy it while adding
   * nothing the surrounding record does not already carry.
   */
  readonly presetId: string | null;
  /** Already-computed values. Read-only to this service by construction. */
  readonly results: readonly { metricKey: string; entityId?: string; valueNumeric: number | null; unit?: string }[];
  readonly missingCount: number;
  readonly qualityFlags: readonly string[];
}

export interface NarrativeRequest {
  runId: string;
  payload: NarrativePayload;
  payloadHash: string;
  templateId: string;
  templateVersion: string;
  providerId: string | null;
  model: string | null;
  generationParams?: Record<string, unknown>;
}

export interface Narrative {
  /** The run this narrative belongs to. Not part of the hashed payload. */
  runId: string;
  templateId: string;
  templateVersion: string;
  providerId: string | null;
  model: string | null;
  generationParams: Record<string, unknown> | null;
  inputPayloadHash: string;
  content: string;
  contentHash: string;
  approvalState: ApprovalState;
  /** Marks the text as machine-generated in every format that can show it. */
  generated: true;
  /** Additive evidence; absent on historical narratives, never inferred later. */
  producedBy?: {
    schema: 'watchdog.narrative_execution/1';
    mechanism: 'deterministic_template/1' | 'provider_rewrite/1';
    catalogHash: string;
    recipeHash: string;
    recipe: NarrativeRecipe;
    inputPayloadHash: string;
    systemHash: string | null;
    promptHash: string | null;
    generation: TextGenerationResult['generation'] | null;
  };
}

export class NarrativePayloadTamperedError extends Error {
  readonly code = 'validation_error';
  constructor() {
    super('Narrative payload does not match its hash; refusing to describe data that may have changed under it.');
    this.name = 'NarrativePayloadTamperedError';
  }
}

export function hashNarrativePayload(payload: NarrativePayload): string {
  return canonicalHash(payload);
}

/**
 * The E1 narrative generator is deterministic and template-based rather than
 * model-backed. That is a deliberate E1 choice, not a stub: no language
 * provider is configured offline, and a template that states only what the
 * numbers say cannot invent a finding. E2 swaps the body for a real provider
 * behind the same interface and the same approval gate.
 *
 * The reporting-language rule in `03_JH2016_CONTRACT.md` applies here: this
 * never says "successful replication", only what was computed.
 */
export function generateNarrative(request: NarrativeRequest, catalog = loadNarrativeCatalog()): Narrative {
  const actual = hashNarrativePayload(request.payload);
  if (actual !== request.payloadHash) throw new NarrativePayloadTamperedError();

  const recipe = selectNarrativeRecipe(catalog, request);
  const { payload } = request;
  const count = (metric: string) => payload.results.filter(r => r.metricKey === metric && r.valueNumeric !== null).length;
  const ranked = payload.results.filter(r => r.metricKey === recipe.ranking.metricKey && r.valueNumeric !== null)
    .map((row, index) => ({ row, index })).sort((a, b) => {
      const difference = (a.row.valueNumeric! - b.row.valueNumeric!) * (recipe.ranking.direction === 'ascending' ? 1 : -1);
      if (difference) return difference;
      if (recipe.ranking.tieBreak === 'entity_id') {
        const left = a.row.entityId ?? '', right = b.row.entityId ?? '';
        if (left !== right) return left < right ? -1 : 1;
      }
      return a.index - b.index;
    });
  const selected = recipe.ranking.topK === null ? ranked : ranked.slice(0, recipe.ranking.topK);
  const top = selected.map(({ row }) => row.entityId).filter(Boolean);
  const render = renderNarrativeText;
  const preset = payload.presetId ? render(recipe.text.preset, { presetId: payload.presetId }) : '';
  const lines = [
    render(recipe.text.completed, { preset }),
    render(recipe.text.counts, { primaryCount: count(recipe.metrics.primary), secondaryCount: count(recipe.metrics.secondary) }),
    payload.missingCount > 0 ? render(recipe.text.missing, { missingCount: payload.missingCount }) : recipe.text.noMissing,
    top.length > 0 ? render(recipe.text.ranking, { entities: top.join(recipe.formatting.listSeparator) }) : '',
    payload.qualityFlags.length > 0
      ? render(recipe.text.qualityFlags, { qualityFlags: [...payload.qualityFlags].sort().join(recipe.formatting.listSeparator) }) : '',
    recipe.text.equivalence,
  ].filter(Boolean);
  const content = lines.join(recipe.formatting.lineSeparator);

  return {
    runId: request.runId,
    templateId: request.templateId,
    templateVersion: request.templateVersion,
    providerId: request.providerId,
    model: request.model,
    generationParams: request.generationParams ?? null,
    inputPayloadHash: request.payloadHash,
    content,
    contentHash: canonicalHash({ content }),
    // Always PROPOSED on creation. Nothing here can approve itself.
    approvalState: 'PROPOSED',
    generated: true,
    producedBy: { schema: 'watchdog.narrative_execution/1', mechanism: 'deterministic_template/1',
      catalogHash: catalog.contentHash, recipeHash: canonicalHash(recipe), recipe: structuredClone(recipe),
      inputPayloadHash: request.payloadHash, systemHash: null, promptHash: null, generation: null },
  };
}

// ---------------------------------------------------------------------------
// Provider-backed narrative (E2.1)
// ---------------------------------------------------------------------------

export class NarrativeFabricationError extends Error {
  readonly code = 'validation_error';
  constructor(readonly novelNumbers: string[], readonly providerKey: string) {
    super(
      `The narrative provider '${providerKey}' emitted numeric values that do not appear in the ` +
      `frozen payload: ${novelNumbers.join(', ')}. Rejecting the generation rather than presenting ` +
      'it for approval — a fabricated figure inside otherwise-correct prose is the hardest kind ' +
      'for a reviewer to catch.'
    );
    this.name = 'NarrativeFabricationError';
  }
}

/** Digit-bearing tokens, normalised so 1,234 / 1234 / 12.30 / 12.3 compare equal. */
function numericTokens(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/\d[\d,  ]*(?:\.\d+)?/g)) {
    const raw = m[0].trim();
    const normalised = raw.replace(/[,  ]/g, '');
    const n = Number(normalised);
    if (!Number.isFinite(n)) continue;
    out.set(String(n), raw);
  }
  return out;
}

/**
 * The guard that lets rule 2 be enforced rather than merely stated.
 *
 * A language model rewriting a paragraph will, sooner or later, round 15.17 to
 * 15.2, or carry a plausible figure over from its training data. Both produce
 * prose a reviewer reads as a measurement. So: every digit-bearing token in the
 * generated text must already exist in the deterministic source. Anything else
 * is rejected outright — not flagged, not footnoted, because a narrative that
 * needs a caveat about which of its numbers are real is not usable evidence.
 *
 * Deliberately strict about rounding: "15.2" is a *different* number from
 * "15.17" and would be a silent precision change under rule 4.
 */
export function assertNoNovelNumbers(generated: string, source: string, providerKey: string): void {
  const allowed = new Set(numericTokens(source).keys());
  const novel: string[] = [];
  for (const [value, raw] of numericTokens(generated)) {
    if (!allowed.has(value)) novel.push(raw);
  }
  if (novel.length > 0) throw new NarrativeFabricationError([...new Set(novel)].sort(), providerKey);
}

export interface ProviderNarrativeRequest extends NarrativeRequest {
  generator: TextGenerator;
  model: string;
}

export interface ProviderNarrative extends Narrative {
  /**
   * True whenever the prose came from a sampler. Rule 7's byte-identical
   * guarantee covers deterministic artifacts; this marks the one artifact it
   * cannot cover, so the claim is never made on its behalf.
   */
  nondeterministicContent: boolean;
  upstreamId: string | null;
  usage: { promptTokens: number | null; completionTokens: number | null } | null;
}


/**
 * Generates the narrative with a real provider, then verifies it against the
 * deterministic version of the same payload before it is allowed to exist as
 * an artifact.
 *
 * The deterministic narrative is not a fallback here — it is the **reference**.
 * If the provider fails, this throws: silently substituting template prose
 * that the operator believes came from a model is a silent provider
 * substitution under rule 4.
 */
export async function generateNarrativeWithProvider(
  request: ProviderNarrativeRequest,
  catalog: NarrativeCatalog = loadNarrativeCatalog(),
): Promise<ProviderNarrative> {
  const deterministic = generateNarrative(request, catalog);
  const recipe = deterministic.producedBy!.recipe;
  const system = recipe.provider.system;
  const prompt = renderNarrativeText(recipe.provider.prompt, { summary: deterministic.content });

  const result = await request.generator.generate({
    system, prompt,
    model: request.model,
    params: request.generationParams ?? {},
  });

  assertNoNovelNumbers(result.text, deterministic.content, result.providerKey);

  const content = result.text.trim();
  return {
    ...deterministic,
    providerId: result.providerKey,
    model: result.model,
    generationParams: request.generationParams ?? null,
    content,
    contentHash: canonicalHash({ content }),
    // Unchanged and unchangeable here: nothing in this function can approve.
    approvalState: 'PROPOSED',
    nondeterministicContent: true,
    upstreamId: result.upstreamId,
    usage: result.usage,
    producedBy: { ...deterministic.producedBy!, mechanism: 'provider_rewrite/1',
      systemHash: canonicalHash({ system }), promptHash: canonicalHash({ prompt }), generation: result.generation ? structuredClone(result.generation) : null },
  };
}

export { TextGenerationError };
