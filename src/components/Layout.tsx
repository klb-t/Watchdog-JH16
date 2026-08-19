import { Link, Outlet, useLocation } from 'react-router-dom';
import { Activity, Database, PlayCircle, Settings, LayoutDashboard, FlaskConical, ClipboardCheck } from 'lucide-react';
import { cn } from '../lib/utils';

export function Layout() {
  const location = useLocation();

  const navItems = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Study', href: '/study', icon: FlaskConical },
    { name: 'Method', href: '/method', icon: ClipboardCheck },
    { name: 'Sources', href: '/sources', icon: Database },
    { name: 'Runs', href: '/runs', icon: PlayCircle },
    { name: 'Analyzers', href: '/analyzers', icon: Activity },
    { name: 'Setup', href: '/setup', icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900">
      <div className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-slate-200">
          <Activity className="w-6 h-6 text-indigo-600 mr-2" />
          <span className="font-semibold text-lg tracking-tight">WatchDog</span>
        </div>
        
        <nav className="flex-1 px-4 py-6 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.href || 
                            (item.href !== '/' && location.pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                to={item.href}
                className={cn(
                  "flex items-center px-3 py-2.5 text-sm font-medium rounded-md transition-colors",
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
