import { Link, Outlet, useLocation } from 'react-router-dom';
import { Activity, Database, PlayCircle, Settings, LayoutDashboard, FlaskConical, ClipboardCheck } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAccess } from '../lib/access';
import type { Capability } from '../../shared/authorization';
import { useEffect, useState } from 'react';

export function Layout() {
  const location = useLocation();
  const access = useAccess();
  const [density, setDensity] = useState('comfortable');
  useEffect(() => { let active = true; setDensity('comfortable');
    const refresh = () => { if (access.principalId) void fetch('/api/settings', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => { if (active) setDensity(d?.settings?.value?.density ?? 'comfortable'); }).catch(() => {}); };
    refresh(); window.addEventListener('watchdog-settings-changed', refresh); return () => { active = false; window.removeEventListener('watchdog-settings-changed', refresh); };
  }, [access.principalId]);

  const navItems: { name: string; href: string; icon: typeof Activity; capability?: Capability }[] = [
    { name: 'Cele', href: '/', icon: LayoutDashboard },
    { name: 'Research', href: '/research', icon: FlaskConical, capability: 'method.propose' },
    { name: 'Automation', href: '/automation', icon: PlayCircle, capability: 'run.create' },
    ...((access.capabilities.includes('responder.lookup') || access.capabilities.includes('evidence.review')) ? [{ name: 'Substance memory', href: '/memory', icon: Database }] : []),
    { name: 'Diagnostics', href: '/diagnostics', icon: Activity, capability: 'diagnostics.view' },
    { name: 'Workbench', href: '/workbench', icon: FlaskConical, capability: 'workbench.view' },
    { name: 'Responder', href: '/responder', icon: Activity, capability: 'responder.lookup' },
    { name: 'Evidence review', href: '/evidence', icon: ClipboardCheck, capability: 'evidence.review' },
    { name: 'Study', href: '/study', icon: FlaskConical, capability: 'run.create' },
    { name: 'Method', href: '/method', icon: ClipboardCheck, capability: 'method.propose' },
    { name: 'Sources', href: '/sources', icon: Database, capability: 'run.view' },
    { name: 'Runs', href: '/runs', icon: PlayCircle, capability: 'run.view' },
    { name: 'Analyzers', href: '/analyzers', icon: Activity, capability: 'run.view' },
    { name: 'Setup', href: '/setup', icon: Settings },
  ];

  return (
    <div className="flex flex-col md:flex-row h-dvh bg-slate-50 text-slate-900" data-density={density}>
      <div className="md:w-56 shrink-0 bg-white border-r border-slate-200 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-slate-200">
          <Activity className="w-6 h-6 text-indigo-600 mr-2" />
          <span className="font-semibold text-lg tracking-tight">WatchDog</span>
        </div>
        
        <nav aria-label="Main navigation" className="flex md:block overflow-x-auto md:flex-1 px-3 py-2 md:py-6 md:space-y-1">
          {navItems.filter(item => !item.capability || access.capabilities.includes(item.capability)).map((item) => {
            const isActive = location.pathname === item.href || 
                            (item.href !== '/' && location.pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                to={item.href}
                className={cn(
                  `flex shrink-0 items-center px-3 ${density === 'compact' ? 'py-1.5' : 'py-2.5'} text-sm font-medium rounded-md transition-colors`,
                  isActive 
                    ? "bg-indigo-50 text-indigo-700" 
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                <item.icon className={cn("mr-3 h-5 w-5", isActive ? "text-indigo-700" : "text-slate-400")} />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>

      <main className="flex-1 overflow-auto bg-slate-50">
        <Outlet />
      </main>
    </div>
  );
}
