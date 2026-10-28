import { readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalHash } from '../domain/canonical';
import { RunRepository } from '../db/repositories/runs';
import { ObservationRepository, AnalysisResultRepository } from '../db/repositories/data';
import { readJh16Preset } from './jh16_plan';
import type { AcquisitionPlanItem } from './run_orchestrator';

/**
 * Runs of the exploratory Google Trends calibration of JH16, built from the
 * versioned calibration file and the locked preset. One run per region: each is
 * an acquisition of the configured term groups followed by the calibration
 * analyzer, so the numbers come from the product's own stored observations.
 */

export function readTrendsCalibration(root = process.cwd()) {
  const calibration = JSON.parse(readFileSync(path.join(root, 'config/calibration/jh2016-trends.json'), 'utf8'));
  return { calibration, hash: canonicalHash(calibration) };
}

export interface ComparedRun { runId: string; pi: Record<string, number>; flags: Record<string, string[]> }

export function trendsRequestsPerRegion(calibration: any): number { return calibration.groups.length; }

export function buildTrendsCalibrationConfigs(regionIds: readonly string[], compared: ComparedRun | null, opts: { personal: boolean; root?: string }) {
  const { calibration, hash } = readTrendsCalibration(opts.root), preset = readJh16Preset(opts.root);
  const paper = JSON.parse(readFileSync(path.join(opts.root ?? process.cwd(), 'fixtures/jh2016/paper_reported.json'), 'utf8'));
  const term_entities: Record<string, string> = Object.fromEntries(preset.substances.map((s: any) => [s.query_label, s.canonical]));
  const published_pi = Object.fromEntries(paper.substances.map((s: any) => [s.canonical, s.Pi_percent]));
  const published_pi_may2012 = Object.fromEntries(Object.entries(paper.table2_popularity_over_time.Pi_percent).map(([k, v]: [string, any]) => [k, v[0]]));
  const plan: AcquisitionPlanItem[] = calibration.groups.map((g: any) => ({ entityId: g.id, dimension: `interest:${g.id}`, renderedQuery: g.terms.join(',') }));
  return [...regionIds].sort().map(regionId => {
    const region = calibration.regions.find((r: any) => r.id === regionId);
    if (!region) throw new Error(`Unknown calibration region '${regionId}'`);
    return {
      source_id: 'trends_interest_index', personal_credentials: opts.personal,
      source_params: { provider_params: { ...calibration.provider_params, ...region.provider_params }, term_entities },
      language: preset.language, query_expansion_mode: preset.query_expansion_mode, plan,
      preset_id: calibration.calibration_id, preset_version: calibration.version, calibration_hash: hash, region_id: regionId,
      method_id: 'jh16_trends_calibration',
      method_params: { calibration, term_entities, published_pi, published_pi_may2012,
        compare_pi: compared?.pi ?? null, compare_flags: compared?.flags ?? null, compare_run_id: compared?.runId ?? null },
      attempt_meaning: `EXPLORATORY: Google Trends calibration (${regionId}); relative search interest, not a result count; no verdicts`,
    };
  });
}

/** The owner's most recent completed JH16 run measured live, whose Pi the calibration compares with. */
export function latestLiveJh16Run(db: ConstructorParameters<typeof RunRepository>[0], owner: string): ComparedRun | null {
  const runs = new RunRepository(db), results = new AnalysisResultRepository(db), observations = new ObservationRepository(db);
  for (const run of runs.getRuns(200, owner)) {
    const config = JSON.parse(run.effective_config ?? '{}');
    if (run.status !== 'COMPLETED' || config.source_id !== 'serp_result_count' || config.preset_id !== 'jh2016-faithful') continue;
    const pi = Object.fromEntries(results.getByRunId(run.id).filter(r => r.metricKey === 'Pi' && r.entityId && !r.isMissing && r.valueNumeric !== null)
      .map(r => [r.entityId!, r.valueNumeric!]));
    if (Object.keys(pi).length === 0) continue;
    const flags: Record<string, string[]> = {};
    for (const o of observations.getByRunId(run.id)) flags[o.entityId] = [...new Set([...(flags[o.entityId] ?? []), ...o.qualityFlags])].sort();
    return { runId: run.id, pi, flags };
  }
  return null;
}
