import { useWorkspace } from '../lib/workspace_preferences';
import { useAccess } from '../lib/access';
import { workspacePreferences } from '../../shared/workspace_preferences';
import { Link } from 'react-router-dom';
import { Activity, BookOpenText, CalendarClock, Database, FlaskConical, FolderKanban, LayoutDashboard, Search, Settings, Users } from 'lucide-react';
import profileData from '../../config/workspace-navigation.json';
import { WorkspaceNavigationSchema, activeWorkspaceGroup, availableWorkspaceGroups, isWorkspaceViewActive } from '../../shared/workspace_navigation';
import type { Capability } from '../../shared/authorization';
import { cn } from '../lib/utils';

export const workspaceProfile = WorkspaceNavigationSchema.parse(profileData);
const icons = { dashboard: LayoutDashboard, database: Database, analysis: FlaskConical,
  calendar: CalendarClock, project: FolderKanban, paper: BookOpenText, search: Search };
interface NavigationProps { capabilities: readonly Capability[]; pathname: string; density?: string; }

export function WorkspaceMenu({ capabilities, pathname, density = 'comfortable' }: NavigationProps) {
  const {profile:workspaceProfile}=useWorkspace();
  const groups = availableWorkspaceGroups(workspaceProfile, capabilities);
  const active = activeWorkspaceGroup(groups, pathname);
  return <nav aria-label={workspaceProfile.labels.primary} data-testid="workspace-navigation"
    className="flex md:flex-col overflow-x-auto md:overflow-x-visible gap-1 px-3 py-2 md:py-5">
    {groups.map(group => {
      const Icon = icons[group.icon], selected = active?.id === group.id;
      return <Link key={group.id} to={group.views[0].href} aria-current={selected ? 'page' : undefined}
        data-workspace={group.id} className={cn(`flex shrink-0 items-center px-3 ${density === 'compact' ? 'py-1.5' : 'py-2.5'} text-sm font-medium rounded-md transition-colors`,
          selected ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}>
        <Icon aria-hidden="true" className={cn('mr-3 h-5 w-5 shrink-0', selected ? 'text-indigo-700' : 'text-slate-400')} />
        <span>{group.label}</span>
      </Link>;
    })}
  </nav>;
}

export function WorkspaceTabs({ capabilities, pathname }: NavigationProps) {
  const {profile:workspaceProfile,language}=useWorkspace();
  const active = activeWorkspaceGroup(availableWorkspaceGroups(workspaceProfile, capabilities), pathname);
  const current=active?.views.find(v=>isWorkspaceViewActive(v,pathname));
  if (!active) return null;
  return <header className="bg-white border-b border-slate-200 px-4 sm:px-8 py-3">
    <p data-testid="breadcrumb" className="text-xs font-semibold text-slate-500 mb-2"><span>{active.label}</span>{current&&<> › <span aria-current="page">{current.label}</span></>}</p>
    <nav aria-label={workspaceProfile.labels.section} className="flex flex-wrap gap-2">
      {active.views.map(view => <Link key={view.href} to={view.href} aria-label={view.label} data-testid={`area-tab-${view.href.slice(1)}`}
        aria-current={isWorkspaceViewActive(view, pathname) ? 'page' : undefined}
        className={cn('text-sm rounded-md px-3 py-2', isWorkspaceViewActive(view, pathname)
          ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-100')}>{view.label}{workspacePreferences.views[view.href]?.advanced&&<small className="ml-1 text-slate-500"> · {workspacePreferences.strings[language].advanced}</small>}</Link>)}
    </nav>
  </header>;
}

export function WorkspaceUtilities({ capabilities, pathname }: NavigationProps) {
  const {profile:workspaceProfile,language}=useWorkspace();
  const access=useAccess();
  const items = [
    ...(access.mode==='accounts'&&capabilities.includes('principal.view') ? [{label:workspacePreferences.strings[language].accounts,href:'/access',icon:Users,active:pathname==='/access'}] : []),
    { label: workspaceProfile.labels.settings, href: '/setup', icon: Settings, active: ['/setup', '/settings'].includes(pathname) },
    ...(capabilities.includes('principal.invite') ? [{ label: workspaceProfile.labels.access, href: '/settings/access', icon: Users, active: pathname === '/settings/access' }] : []),
    ...(capabilities.includes('diagnostics.view') ? [{ label: workspaceProfile.labels.diagnostics, href: '/diagnostics', icon: Activity, active: pathname === '/diagnostics' }] : []),
  ];
  return <nav aria-label={workspaceProfile.labels.utilities} className="flex flex-wrap md:flex-nowrap md:flex-col gap-1 px-3 py-2 md:py-4 border-t border-slate-200">
    {items.map(item => <Link key={item.href} to={item.href} aria-current={item.active ? 'page' : undefined}
      className={cn('flex items-center px-3 py-2 text-sm rounded-md', item.active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100')}>
      <item.icon aria-hidden="true" className="w-4 h-4 mr-3 shrink-0" />{item.label}
    </Link>)}
  </nav>;
}
