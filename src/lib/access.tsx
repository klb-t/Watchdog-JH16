import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { clearFieldCache, readFieldCache } from './field_client';
import type { Capability } from '../../shared/authorization';

interface Access {
  loading: boolean;
  roles: string[];
  capabilities: Capability[];
  principalId: string | null;
}
const empty: Access = { loading: true, roles: [], capabilities: [], principalId: null };
const AccessContext = createContext<Access>(empty);
export const useAccess = () => useContext(AccessContext);

/** UI receives the exact union the server enforces; no second role ladder. */
export function AccessProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access>(empty);
  const location = useLocation();
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' });
        if ([401, 403].includes(response.status)) clearFieldCache();
        const data = response.ok ? await response.json() : null;
        if (active) setAccess({ loading: false, roles: data?.principal.roles ?? [],
          capabilities: data?.capabilities ?? [], principalId: data?.principal.id ?? null });
      } catch {
        try {
          const cached = await readFieldCache();
          if (active) setAccess({ loading: false, roles: ['offline responder'], capabilities: ['responder.lookup'], principalId: cached.snapshot.principalId });
        } catch { if (active) setAccess({ ...empty, loading: false }); }
      }
    };
    refresh();
    const sessionChanged = () => { clearFieldCache(); setAccess(empty); void refresh(); };
    window.addEventListener('watchdog-session-changed', sessionChanged);
    return () => { active = false; window.removeEventListener('watchdog-session-changed', sessionChanged); };
  }, [location.pathname]);
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>;
}

export function AccessBoundary({ capability, children }: { capability: Capability; children: ReactNode }) {
  const access = useAccess();
  if (access.loading) return <p className="p-6" role="status">Checking access…</p>;
  if (!access.capabilities.includes(capability)) return <div className="p-6" data-testid="access-denied">
    <h1 className="text-xl font-semibold">Access unavailable</h1>
    <p className="mt-2">Your current profiles do not grant access to this view.</p>
    <Link className="underline" to="/setup">Account and access</Link>
  </div>;
  return children;
}
