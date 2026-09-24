import { z } from 'zod';
import { CAPABILITIES, type Capability } from './authorization';

/**
 * Information architecture (spec 14, D21): seven areas plus settings, read from
 * `config/ui/navigation.json`. This module only resolves and filters; it holds
 * no labels, paths or capabilities of its own (rule 3).
 *
 * A view is visible when the viewer holds its capability (or any of
 * `capability_any`); an area is visible when any of its views is. Hiding is a
 * convenience, not a gate — every route still sits behind its own
 * AccessBoundary and every API behind its own check.
 */

const route = z.string().regex(/^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/);
const capability = z.string().refine(c => (CAPABILITIES as readonly string[]).includes(c), 'unknown capability');
const label = z.object({ pl: z.string().min(1), en: z.string().min(1) }).strict();

export const NavigationViewSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  path: route,
  exact: z.boolean().optional(),
  match: z.array(z.string().regex(/^\/[a-z0-9/-]+$/)).optional(),
  capability: capability.optional(),
  capability_any: z.array(capability).min(1).optional(),
  advanced: z.boolean().optional(),
  label,
}).strict().refine(v => !(v.capability && v.capability_any), 'use capability or capability_any, not both');

export const NavigationAreaSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  icon: z.string().min(1),
  path: route,
  label,
  hint: label.optional(),
  views: z.array(NavigationViewSchema).min(1),
}).strict();

export const NavigationSchema = z.object({
  schema_version: z.literal('1.0.0'),
  _note: z.string().optional(),
  areas: z.array(NavigationAreaSchema).min(1),
  settings: NavigationAreaSchema,
  strings: z.object({ pl: z.record(z.string(), z.string()), en: z.record(z.string(), z.string()) }).strict()
    .refine(s => Object.keys(s.pl).sort().join() === Object.keys(s.en).sort().join(), 'pl and en strings must have the same keys'),
}).strict();

export type Navigation = z.infer<typeof NavigationSchema>;
export type NavigationArea = z.infer<typeof NavigationAreaSchema>;
export type NavigationView = z.infer<typeof NavigationViewSchema>;
export type NavigationLanguage = 'pl' | 'en';

export function viewVisible(view: NavigationView, capabilities: readonly string[]): boolean {
  if (view.capability) return capabilities.includes(view.capability);
  if (view.capability_any) return view.capability_any.some(c => capabilities.includes(c));
  return true;
}

/** The area with only the views this viewer may open, or null when none remain. */
export function visibleArea(area: NavigationArea, capabilities: readonly string[]): NavigationArea | null {
  const views = area.views.filter(v => viewVisible(v, capabilities));
  return views.length ? { ...area, views } : null;
}

export function visibleNavigation(nav: Navigation, capabilities: readonly string[]) {
  return {
    areas: nav.areas.map(a => visibleArea(a, capabilities)).filter((a): a is NavigationArea => a !== null),
    settings: visibleArea(nav.settings, capabilities),
  };
}

function viewMatches(view: NavigationView, pathname: string): number {
  if (pathname === view.path) return view.path.length + 1;
  if (view.exact) return 0;
  const prefixes = [...(view.match ?? []), ...(view.path === '/' ? [] : [`${view.path}/`])];
  const hit = prefixes.filter(p => pathname.startsWith(p)).sort((a, b) => b.length - a.length)[0];
  return hit ? hit.length : 0;
}

/**
 * The area and view a path belongs to — the longest match wins, so
 * `/runs/:id/results` is Run history, not something that merely starts with `/r`.
 * Area landing paths (`/data`, `/analysis`…) resolve to the area with no view.
 */
export function locate(nav: Navigation, pathname: string): { area: NavigationArea; view: NavigationView | null } | null {
  const all = [...nav.areas, nav.settings];
  let best: { area: NavigationArea; view: NavigationView; score: number } | null = null;
  for (const area of all) {
    for (const view of area.views) {
      const score = viewMatches(view, pathname);
      if (score > (best?.score ?? 0)) best = { area, view, score };
    }
  }
  if (best) return { area: best.area, view: best.view };
  const landing = all.find(a => a.path === pathname);
  return landing ? { area: landing, view: null } : null;
}

/** Area landing paths that are not themselves a view — App.tsx redirects them to the first visible view. */
export function landingPaths(nav: Navigation): { area: NavigationArea; path: string }[] {
  return [...nav.areas, nav.settings]
    .filter(a => !a.views.some(v => v.path === a.path))
    .map(a => ({ area: a, path: a.path }));
}

export type { Capability };
