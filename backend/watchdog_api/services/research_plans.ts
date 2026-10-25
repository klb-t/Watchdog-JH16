import { readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalHash } from '../domain/canonical';
import { SettingsRepository } from '../db/repositories/settings';
import { AutomationRepository, AutomationError } from '../db/repositories/automation';
import { MethodSpecRepository } from '../db/repositories/method_specs';
import { RunOrchestrator } from './run_orchestrator';
import type { AssistantProfile } from '../config/assistant';
import type { AutomationProfile } from '../config/automation';
import { ResearchPlanInputSchema } from '../../../shared/settings';
import { UserVault } from '../secrets/user_vault';
import { jh16PlanItems } from './jh16_plan';

export class ResearchPlans {
  constructor(readonly repo: SettingsRepository, private readonly automation: AutomationRepository,
    private readonly assistantProfile: AssistantProfile, private readonly automationProfile: AutomationProfile,
    private readonly orchestrator: RunOrchestrator, private readonly methods: MethodSpecRepository, private readonly vault: UserVault) {}
  prepare(owner: string, raw: unknown) {
    const input = ResearchPlanInputSchema.parse(raw), settings = this.repo.get(owner, this.assistantProfile.defaults);
    if (settings.hash !== input.settingsHash) throw new AutomationError('Save and reload the current settings before preparing the plan');
    const preset = JSON.parse(readFileSync(path.join(process.cwd(), 'config/presets/jh2016-faithful.json'), 'utf8'));
    const method = JSON.parse(readFileSync(path.join(process.cwd(), 'config/methods/jh2016-faithful.methodspec.json'), 'utf8'));
    const specId = this.methods.upsert(method, { id: 'jh2016-faithful' }), specHash = canonicalHash(method);
    // The SERP extension is a separate ENHANCED preset; its variants are listed
    // in the plan so the reviewed body names every run and every difference.
    const extension = input.baseline === 'live_serp_extension'
      ? JSON.parse(readFileSync(path.join(process.cwd(), 'config/presets/jh2016-serp-extension.json'), 'utf8')) : null;
    const baseline = input.baseline === 'none' ? null : { mode: input.baseline, preset, presetHash: canonicalHash(preset), method, methodId: specId, methodHash: specHash,
      attemptMeaning: input.baseline === 'fixture' ? 'pipeline_self_check: published 2014 counts; not an independent replication' : 'temporal_reassessment: new counts cannot reproduce the historic data collection',
      extension: extension ? { preset: extension, presetHash: canonicalHash(extension) } : null,
      plannedQueries: preset.substances.length * 2 * (1 + (extension?.variants.length ?? 0)), retryPolicy: 'Finite provider retries also consume the daily SERP request limit' };
    const jobs = [ ...(input.refreshMemory ? [this.automationProfile.defaults.substanceJob] : []),
      ...(input.scanPapers ? [{ ...this.automationProfile.defaults.paperJob, scope: input.paperScope }] : []) ];
    const body = { version: 'research-plan-1', name: input.name, settings: settings.value, settingsHash: settings.hash, baseline,
      sourceProfileHash: this.automationProfile.contentHash, assistantProfileHash: this.assistantProfile.contentHash,
      jobs, dailyScan: input.dailyScan ? { request: { ...this.automationProfile.defaults.paperJob, scope: input.paperScope }, recurrence: this.automationProfile.defaults.recurrence } : null,
      extensions: { status: 'EXPLORATORY_PLAN', ...settings.value.research, baselineChanges: 'none',
        geographyMeaning: 'Explicit requested areas, not inferred from language or internet search locale',
        hypotheses: 'LLM proposals remain unapproved candidates; source facts and numeric results are not generated',
        confirmation: { state: 'NOT_PREREGISTERED', requirements: ['freeze hypotheses and primary endpoints before outcomes',
          'declare the complete comparison family and multiplicity procedure', 'separate discovery data from untouched confirmation data',
          'record all attempted variants, including null and negative outcomes', 'do not tune alternatives on the confirmation set'],
          automaticConfirmatoryClaims: false } },
    };
    return this.repo.savePlan(owner, body);
  }
  launch(owner: string, id: string, expectedHash: string, approvedMethodHash: string | null) {
    const plan = this.repo.plan(owner, id); if (!plan || plan.hash !== expectedHash) throw new AutomationError('Plan not found or changed');
    if (plan.launch) return plan.launch;
    const baseline = plan.body.baseline;
    if (baseline && approvedMethodHash !== baseline.methodHash) throw new AutomationError('Review the displayed baseline method and confirm its exact hash');
    if ((baseline?.mode === 'live_serp' || baseline?.mode === 'live_serp_extension') && !this.vault.resolve(owner, 'serpapi').isPresent) throw new AutomationError('Add your personal SerpApi key before launching live counts');
    return this.repo.launchPlan(owner, id, expectedHash, () => {
      let runId: string | null = null; const extensionRunIds: string[] = [];
      if (baseline) {
        this.methods.approve(baseline.methodId, owner, new Date().toISOString(), baseline.methodHash);
        const p = baseline.preset, planItems = jh16PlanItems(p);
        const live = baseline.mode !== 'fixture';
        const common = { source_id: live ? 'serp_result_count' : 'fixture_jh2016', personal_credentials: live,
          language: p.language, query_expansion_mode: p.query_expansion_mode,
          method_spec_id: baseline.methodId, method_spec_hash: baseline.methodHash, plan: planItems, research_plan_id: id, research_plan_hash: expectedHash };
        runId = this.orchestrator.submitJob('PIPELINE', { ...common, source_params: live ? {} : { fixture_set: 'faithful_2014-06-20' },
          preset_id: p.preset_id, preset_version: p.preset_version, attempt_meaning: baseline.attemptMeaning }, owner);
        const ext = baseline.extension?.preset;
        if (ext) for (const v of ext.variants) extensionRunIds.push(this.orchestrator.submitJob('PIPELINE', { ...common,
          source_params: { provider_params: v.provider_params }, preset_id: ext.preset_id, preset_version: ext.preset_version,
          variant_id: v.variant_id, variant_differences: v.differences, extension_preset_hash: baseline.extension.presetHash,
          attempt_meaning: `ENHANCED variant ${v.variant_id}: not a replication; differences from FAITHFUL: ${v.differences.join('; ')}` }, owner));
      }
      const jobs = plan.body.jobs.map((request: unknown) => this.automation.enqueue(owner, request, plan.body.sourceProfileHash).id);
      const schedule = plan.body.dailyScan ? this.automation.saveSchedule(owner, { name: `${plan.body.name} · daily discovery`, enabled: true,
        recurrence: plan.body.dailyScan.recurrence, request: plan.body.dailyScan.request }, plan.body.sourceProfileHash) : null;
      return { runId, extensionRunIds, jobs, scheduleId: schedule?.id ?? null, launchedAt: new Date().toISOString() };
    });
  }
}
