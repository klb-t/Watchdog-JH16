import { z } from 'zod';
import { CAPABILITIES, type Capability } from './authorization';

const viewSchema = z.object({
  label: z.string().min(1),
  href: z.string().regex(/^\/(?:[a-z]+(?:-[a-z]+)*)?$/),
  anyCapability: z.array(z.enum(CAPABILITIES)),
}).strict();

export const WorkspaceNavigationSchema = z.object({
  version: z.literal('workspace-navigation-1'),
  labels: z.object({ primary: z.string(), section: z.string(), utilities: z.string(),
    settings: z.string(), diagnostics: z.string(), access: z.string() }).strict(),
  groups: z.array(z.object({
    id: z.enum(['dashboard', 'data', 'analysis', 'collection', 'projects', 'papers', 'database']),
    label: z.string().min(1),
    icon: z.enum(['dashboard', 'database', 'analysis', 'calendar', 'project', 'paper', 'search']),
    views: z.array(viewSchema).min(1),
  }).strict()).length(7),
}).strict().superRefine((profile, context) => {
  const ids = profile.groups.map(group => group.id);
  const hrefs = profile.groups.flatMap(group => group.views.map(view => view.href));
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Workspace groups must be unique.' });
  if (new Set(hrefs).size !== hrefs.length) context.addIssue({ code: 'custom', message: 'Each route belongs to one workspace group.' });
  if (profile.groups.find(group => group.id === 'dashboard')?.views[0]?.href !== '/') {
    context.addIssue({ code: 'custom', message: 'The dashboard must retain the root route.' });
  }
});

export type WorkspaceNavigation = z.infer<typeof WorkspaceNavigationSchema>;
export type WorkspaceGroup = WorkspaceNavigation['groups'][number];
export type WorkspaceView = WorkspaceGroup['views'][number];

export function availableWorkspaceGroups(profile: WorkspaceNavigation, capabilities: readonly Capability[]): WorkspaceGroup[] {
  return profile.groups.map(group => ({ ...group, views: group.views.filter(view =>
    !view.anyCapability.length || view.anyCapability.some(capability => capabilities.includes(capability))) }))
    .filter(group => group.views.length > 0);
}

/** Nested run/results links retain their workspace without matching unrelated slugs. */
export function isWorkspaceViewActive(view: WorkspaceView, pathname: string): boolean {
  return pathname === view.href || (view.href !== '/' && pathname.startsWith(`${view.href}/`));
}

export function activeWorkspaceGroup(groups: readonly WorkspaceGroup[], pathname: string): WorkspaceGroup | undefined {
  return groups.find(group => group.views.some(view => isWorkspaceViewActive(view, pathname)));
}
