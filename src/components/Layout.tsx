import { WorkspaceControls } from '../lib/workspace_preferences';
import { Outlet, useLocation } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { useAccess } from '../lib/access';
import { useEffect, useState } from 'react';
import { WorkspaceMenu, WorkspaceTabs, WorkspaceUtilities } from './WorkspaceNavigation';
import { useAccessText } from '../lib/access_i18n';

export function Layout() {
  const location = useLocation();
  const access = useAccess();
  const { t, role } = useAccessText();
  const [density, setDensity] = useState('comfortable');
  useEffect(() => { let active = true; setDensity('comfortable');
    const refresh = () => { if (access.principalId) void fetch('/api/settings', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => { if (active) setDensity(d?.settings?.value?.density ?? 'comfortable'); }).catch(() => {}); };
    refresh(); window.addEventListener('watchdog-settings-changed', refresh); return () => { active = false; window.removeEventListener('watchdog-settings-changed', refresh); };
  }, [access.principalId]);

  return (
    <div className="flex flex-col md:flex-row h-dvh bg-slate-50 text-slate-900" data-density={density}>
      <aside className="md:w-60 shrink-0 bg-white border-r border-slate-200 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-slate-200">
          <Activity className="w-6 h-6 text-indigo-600 mr-2" />
          <span className="font-semibold text-lg tracking-tight">WatchDog</span>
        </div>
        
        <div className="md:flex-1"><WorkspaceMenu capabilities={access.capabilities} pathname={location.pathname} density={density} /></div>
        <WorkspaceControls />
        <WorkspaceUtilities capabilities={access.capabilities} pathname={location.pathname} />
      </aside>

      <main className="flex-1 min-w-0 overflow-auto bg-slate-50">
        <WorkspaceTabs capabilities={access.capabilities} pathname={location.pathname} />
        {access.pendingApplication && <p role="status" className="mx-4 sm:mx-8 mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="pending-approval">
          {t('pending_banner', { roles: access.pendingApplication.requested_roles.map(role).join(', ') })}</p>}
        <Outlet />
      </main>
    </div>
  );
}
