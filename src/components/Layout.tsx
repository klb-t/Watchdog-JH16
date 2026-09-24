import { Link, Outlet, useLocation } from 'react-router-dom';
import { Activity, ChevronRight, LogOut, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { announceSessionChange, postJson, useAccess } from '../lib/access';
import { AreaIcon, CommandPalette, areaTarget, useNavigationModel } from '../lib/navigation';
import type { NavigationArea } from '../../shared/navigation';
import { useEffect, useState } from 'react';

/**
 * The shell (spec 14): seven areas in the sidebar, settings at the bottom, the
 * current area's views as tabs above the page, a breadcrumb, and Ctrl/Cmd+K to
 * jump anywhere. Everything comes from `config/ui/navigation.json`; the pages
 * themselves are unchanged and keep their own paths and access boundaries.
 */
export function Layout() {
  const location = useLocation();
  const access = useAccess();
  const nav = useNavigationModel();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [density, setDensity] = useState('comfortable');
  useEffect(() => { let active = true; setDensity('comfortable');
    const refresh = () => { if (access.principalId) void fetch('/api/settings', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => { if (active) setDensity(d?.settings?.value?.density ?? 'comfortable'); }).catch(() => {}); };
    refresh(); window.addEventListener('watchdog-settings-changed', refresh); return () => { active = false; window.removeEventListener('watchdog-settings-changed', refresh); };
  }, [access.principalId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { setPaletteOpen(false); }, [location.pathname]);

  const here = nav.locate(location.pathname);
  const currentArea = here && [...nav.areas, ...(nav.settings ? [nav.settings] : [])].find(a => a.id === here.area.id);
  const signOut = async () => { await postJson('/api/auth/signout'); announceSessionChange(); };
  const itemClass = (active: boolean) => cn(
    `flex shrink-0 items-center px-3 ${density === 'compact' ? 'py-1.5' : 'py-2.5'} text-sm font-medium rounded-md transition-colors`,
    active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900');

  const areaLink = (area: NavigationArea) => {
    const active = here?.area.id === area.id;
    return <Link key={area.id} to={areaTarget(area)} className={itemClass(active)} data-area={area.id}
      title={area.hint?.[nav.lang]} aria-current={active ? 'page' : undefined}>
      <AreaIcon name={area.icon} className={cn('mr-3 h-5 w-5', active ? 'text-indigo-700' : 'text-slate-400')} />
      {area.label[nav.lang]}
    </Link>;
  };

  return (
    <div className="flex flex-col md:flex-row h-dvh bg-slate-50 text-slate-900" data-density={density}>
      <div className="md:w-60 shrink-0 bg-white border-r border-slate-200 flex flex-col min-w-0">
        <div className="h-14 md:h-16 flex items-center px-4 md:px-6 border-b border-slate-200 gap-2">
          <Activity className="w-6 h-6 text-indigo-600" />
          <span className="font-semibold text-lg tracking-tight flex-1">WatchDog</span>
          <button type="button" onClick={() => setPaletteOpen(true)} data-testid="open-command-palette"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
            aria-label={nav.text('search')} title={`${nav.text('search')} (${nav.text('shortcut_hint')})`}>
            <Search className="w-3.5 h-3.5" /><span className="hidden md:inline">{nav.text('shortcut_hint')}</span>
          </button>
        </div>

        <nav aria-label="Main navigation" className="flex md:flex-col overflow-x-auto md:flex-1 px-3 py-2 md:py-6 gap-1 md:gap-0 md:space-y-1">
          {nav.areas.map(areaLink)}
          {nav.settings && <div className="flex md:flex-col gap-1 md:gap-0 md:space-y-1 md:mt-auto md:pt-4 md:border-t md:border-slate-100"
            data-area-group="settings">
            {nav.settings.views.map(view => {
              const active = here?.view?.id === view.id && here.area.id === nav.settings!.id;
              return <Link key={view.id} to={view.path} className={itemClass(active)} aria-current={active ? 'page' : undefined}>
                <AreaIcon name={nav.settings!.icon} className={cn('mr-3 h-5 w-5', active ? 'text-indigo-700' : 'text-slate-400')} />
                {view.label[nav.lang]}
              </Link>;
            })}
          </div>}
        </nav>
        {access.mode === 'accounts' && access.email && <div className="hidden md:block border-t border-slate-200 px-4 py-3 text-xs"
          data-testid="account-box">
          <p className="truncate font-medium text-slate-700" title={access.email}>{access.email}</p>
          <p className="truncate text-slate-500">{access.roles.filter(r => r !== 'dev').join(', ')}</p>
          <button className="mt-2 inline-flex items-center gap-1 text-slate-600 hover:text-slate-900" onClick={() => void signOut()}
            data-testid="layout-sign-out"><LogOut className="w-3.5 h-3.5" /> {nav.text('sign_out')}</button>
        </div>}
      </div>

      <main className="flex-1 overflow-auto bg-slate-50 min-w-0">
        {currentArea && here?.view && currentArea.id !== 'dashboard' && <AreaHeader area={currentArea} viewId={here.view.id} />}
        <Outlet />
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

/** Breadcrumb and, when the area has more than one view, its views as tabs — advanced ones after a divider. */
function AreaHeader({ area, viewId }: { area: NavigationArea; viewId: string }) {
  const nav = useNavigationModel();
  const view = area.views.find(v => v.id === viewId);
  const basic = area.views.filter(v => !v.advanced);
  const advanced = area.views.filter(v => v.advanced);
  const tab = (v: typeof area.views[number]) => <Link key={v.id} to={v.path} role="tab" aria-selected={v.id === viewId}
    data-testid={`area-tab-${v.id}`}
    className={cn('shrink-0 whitespace-nowrap px-3 py-2 text-sm border-b-2 -mb-px',
      v.id === viewId ? 'border-indigo-600 text-indigo-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800')}>
    {v.label[nav.lang]}
  </Link>;
  return <div className="bg-white border-b border-slate-200 px-4 md:px-6 pt-3" data-testid="area-header">
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-slate-500 min-w-0" data-testid="breadcrumb">
      <Link to={areaTarget(area)} className="hover:text-slate-800 truncate">{area.label[nav.lang]}</Link>
      {view && <><ChevronRight className="w-3 h-3 shrink-0" /><span className="text-slate-700 truncate" aria-current="page">{view.label[nav.lang]}</span></>}
    </nav>
    {area.views.length > 1 ? <div role="tablist" aria-label={area.label[nav.lang]} className="flex items-end overflow-x-auto mt-1 border-b border-transparent">
      {basic.map(tab)}
      {advanced.length > 0 && <>
        <span className="shrink-0 self-center mx-2 pl-3 border-l border-slate-200 text-[10px] uppercase tracking-wide text-slate-400">{nav.text('advanced')}</span>
        {advanced.map(tab)}
      </>}
    </div> : <div className="h-3" />}
  </div>;
}
