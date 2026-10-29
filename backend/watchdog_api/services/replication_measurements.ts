import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalHash } from '../domain/canonical';
import type { SettingsRepository } from '../db/repositories/settings';
import type { UserVault } from '../secrets/user_vault';
import type { AssistantProfile } from '../config/assistant';
import type { RunOrchestrator, AcquisitionPlanItem } from './run_orchestrator';
import type { ReplicationTarget } from './replication_dossier';
import type { Protocol } from './study_protocols';
import { AutomationError } from '../db/repositories/automation';
import { loadTrendsProviderConfig, TRENDS_BY_REGION_CONFIG_PATH } from '../sources/google_trends';

/**
 * A new measurement for a replication target whose dossier declares a
 * `measurement` block (any target besides JH16, which keeps its wizard path).
 * Everything the run does comes from the target's locked preset: the source,
 * the provider parameters, the query terms, the method and its reference
 * tables. The owner approves the exact preset hash; the request count is
 * checked against the personal daily limit before anything is sent.
 */

const read = (root: string, p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf-8'));

export interface MeasurementPlan {
  target_id: string; preset: any; preset_hash: string; source_id: string; provider_params: Record<string, string>;
  plan: AcquisitionPlanItem[]; requests: number; method_id: string; method_params: any; reference_hashes: Record<string, string>; credential: string;
}

export function measurementPlan(t: ReplicationTarget, root = process.cwd()): MeasurementPlan | null {
  const m = t.dossier?.measurement;
  if (!m?.preset_ref) return null;
  const preset = read(root, m.preset_ref), interpretation = t.interpretation ?? {};
  const references = Object.fromEntries(preset.comparisons.map((c: any) => [c.id, read(root, c.reference_ref)]));
  const plan = [...preset.queries].sort((a: any, b: any) => a.dimension.localeCompare(b.dimension))
    .map((q: any) => ({ entityId: q.dimension, dimension: q.dimension, renderedQuery: q.terms.join(preset.query_joiner ?? ' + ') }));
  return {
    target_id: t.target.target_id, preset, preset_hash: canonicalHash(preset), source_id: preset.source_id, provider_params: preset.provider_params,
    plan, requests: plan.length * (m.requests_per_run ?? 1), method_id: preset.method_id, credential: m.credential,
    method_params: {
      comparisons: preset.comparisons.map((c: any) => ({ id: c.id, dimension: c.dimension, statistic: c.statistic, reference: references[c.id].scores })),
      sensitivity: (interpretation.exploratory_sensitivity ?? []).map((s: any) => ({ id: s.id, comparison: s.comparison, exclude_entities: s.exclude_entities ?? [] })),
    },
    reference_hashes: Object.fromEntries(Object.entries(references).map(([id, r]) => [id, canonicalHash(r)])),
  };
}

export class ReplicationMeasurements {
  constructor(private readonly settings: SettingsRepository, private readonly vault: UserVault, private readonly profile: AssistantProfile,
    private readonly orchestrator: RunOrchestrator, private readonly protocol: (owner: string, id: string) => Protocol | null) {}

  describe(owner: string, t: ReplicationTarget) {
    const p = measurementPlan(t);
    if (!p) return null;
    const limit = this.settings.get(owner, this.profile.defaults).value.searchDailyRequestLimit, left = Math.max(0, limit - this.settings.searchesToday(owner));
    const keyPresent = this.vault.resolve(owner, p.credential).isPresent;
    const maxChars = p.source_id === 'trends_interest_by_region' ? loadTrendsProviderConfig(TRENDS_BY_REGION_CONFIG_PATH).provider.max_query_chars : undefined;
    const tooLong = maxChars ? p.plan.find(i => i.renderedQuery.length > maxChars) : undefined;
    const blocked = tooLong ? `The query for '${tooLong.dimension}' has ${tooLong.renderedQuery.length} characters; the provider accepts at most ${maxChars}. The preset needs a new version.`
      : !keyPresent ? `Add your personal ${p.credential} key in Settings → wizard, step 1.`
      : p.requests > left ? `This measurement needs ${p.requests} request(s); your daily limit (${limit}) leaves ${left} today.` : null;
    // The same reason as a stable code with its values, so the interface can say it in the reader's language.
    const blocked_reason = tooLong ? { code: 'query_too_long', params: { dimension: tooLong.dimension, length: tooLong.renderedQuery.length, max: maxChars! } }
      : !keyPresent ? { code: 'key_missing', params: { credential: p.credential } }
      : p.requests > left ? { code: 'daily_limit', params: { requests: p.requests, limit, left } } : null;
    return { preset_id: p.preset.preset_id, preset_version: p.preset.preset_version, preset_hash: p.preset_hash, label: p.preset.label,
      source_id: p.source_id, provider_params: p.provider_params, queries: p.preset.queries.map((q: any) => ({ dimension: q.dimension, terms: q.terms })),
      method_id: p.method_id, comparisons: p.preset.comparisons.map((c: any) => ({ id: c.id, label: c.label, statistic: c.statistic, reference_ref: c.reference_ref, reference_hash: p.reference_hashes[c.id] })),
      requests: p.requests, daily_limit: limit, left_today: left, key_present: keyPresent, blocked, blocked_reason };
  }

  launch(owner: string, t: ReplicationTarget, body: { expectedPresetHash: string; dataRole: 'exploratory' | 'confirmation'; protocolId?: string }) {
    const p = measurementPlan(t), d = this.describe(owner, t);
    if (!p || !d) throw new AutomationError('This target has no measurement in its dossier');
    if (body.expectedPresetHash !== p.preset_hash) throw new AutomationError('The preset changed; reload and review it again');
    if (d.blocked) throw new AutomationError(d.blocked);
    let role: Record<string, string> = { data_role: 'exploratory' };
    if (body.dataRole === 'confirmation') {
      const protocol = body.protocolId ? this.protocol(owner, body.protocolId) : null;
      if (!protocol || protocol.target_id !== t.target.target_id) throw new AutomationError('Choose a protocol frozen for this target');
      role = { data_role: 'confirmation', protocol_id: protocol.id, protocol_hash: protocol.content_hash };
    }
    const now = new Date().toISOString();
    const runId = this.orchestrator.submitJob('PIPELINE', {
      source_id: p.source_id, personal_credentials: true, source_params: { provider_params: p.provider_params },
      language: p.preset.language, query_expansion_mode: p.preset.query_expansion_mode, plan: p.plan,
      method_id: p.method_id, method_params: p.method_params, reference_hashes: p.reference_hashes,
      preset_id: p.preset.preset_id, preset_version: p.preset.preset_version, preset_hash: p.preset_hash,
      replication_target_id: t.target.target_id, approved_preset_hash: p.preset_hash, approved_by: owner, approved_at: now, ...role,
      attempt_meaning: `New measurement for ${t.target.target_id} with the locked preset ${p.preset.preset_id}; read against the pre-registered claims.`,
    }, owner);
    return { runId, requests: p.requests };
  }
}
