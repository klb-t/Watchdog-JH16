import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AcquisitionPlanItem } from './run_orchestrator';

/**
 * The JH16 acquisition plan, built from the locked preset alone: every
 * substance, its query_label (never the canonical name), both templates.
 * One builder for every entry point, so the Study page and the research plan
 * cannot drift into different query sets.
 */
export function readJh16Preset(root = process.cwd()) {
  return JSON.parse(readFileSync(path.join(root, 'config/presets/jh2016-faithful.json'), 'utf8'));
}

export function jh16PlanItems(preset: any): AcquisitionPlanItem[] {
  return [...preset.substances].sort((a: any, b: any) => a.canonical.localeCompare(b.canonical, 'en')).flatMap((s: any) => ['harm', 'popularity'].map(dimension => ({
    entityId: s.canonical, dimension,
    renderedQuery: (dimension === 'harm' ? preset.queries.harm_template : preset.queries.popularity_template).replace('{query_label}', s.query_label) })));
}
