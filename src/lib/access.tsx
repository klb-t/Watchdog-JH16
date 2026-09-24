import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { clearFieldCache, readFieldCache } from './field_client';
import type { Capability, Role } from '../../shared/authorization';

/**
 * Where the current visitor stands (E4.5), from the server's own answer:
 *
 *  - `local`     — no sign-in on this installation; one shared local user.
 *  - `anonymous` — sign-in is on and nobody is signed in: only the login screen.
 *  - `applicant` — signed in, not admitted: only the application screen.
 *  - `member`    — admitted; the rest of the app, gated per capability.
 *  - `offline`   — no network, a cached responder snapshot is available.
 *
 * The UI receives the exact capability union the server enforces; there is no
 * second role ladder here, and hiding something in the UI is a courtesy — the
 * server refuses it anyway.
 */
export type Admission = 'loading' | 'local' | 'anonymous' | 'applicant' | 'member' | 'offline';

export interface SignInMethods {
  google: { client_id: string } | null;
  email_code: boolean;
}

interface Access {
  loading: boolean;
  admission: Admission;
  mode: 'local' | 'accounts' | null;
  roles: string[];
  capabilities: Capability[];
  grantableRoles: Role[];
  principalId: string | null;
  email: string | null;
  methods: SignInMethods;
  instanceName: string;
  refresh: () => void;
}

const noMethods: SignInMethods = { google: null, email_code: false };
const empty: Access = {
  loading: true, admission: 'loading', mode: null, roles: [], capabilities: [], grantableRoles: [],
  principalId: null, email: null, methods: noMethods, instanceName: 'WatchDog', refresh: () => {},
};
const AccessContext = createContext<Access>(empty);
export const useAccess = () => useContext(AccessContext);

/** Tells every listener that who is signed in has changed. */
export function announceSessionChange() {
  window.dispatchEvent(new Event('watchdog-session-changed'));
}

export function AccessProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access>(empty);
  const [generation, setGeneration] = useState(0);
  const location = useLocation();
  const refresh = useCallback(() => setGeneration(g => g + 1), []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [configResponse, meResponse] = await Promise.all([
          fetch('/api/auth/config', { cache: 'no-store' }),
          fetch('/api/auth/me', { cache: 'no-store' }),
        ]);
        const config = configResponse.ok ? await configResponse.json() : null;
        if ([401, 403].includes(meResponse.status)) clearFieldCache();
        const me = meResponse.ok ? await meResponse.json() : null;
        const mode: 'local' | 'accounts' = config?.mode === 'accounts' ? 'accounts' : 'local';
        const admission: Admission = !me ? (mode === 'accounts' ? 'anonymous' : 'local')
          : me.admission === 'applicant' ? 'applicant' : mode === 'local' ? 'local' : 'member';
        if (!active) return;
        setAccess({
          loading: false, admission, mode,
          roles: me?.principal.roles ?? [], capabilities: me?.capabilities ?? [],
          grantableRoles: me?.grantable_roles ?? [],
          principalId: me?.principal.id ?? null, email: me?.principal.email ?? null,
          methods: config?.methods ?? noMethods, instanceName: config?.instance_name ?? 'WatchDog', refresh,
        });
      } catch {
        // No network. A responder with a valid, principal-bound snapshot keeps
        // working offline; everyone else sees nothing they could not load anyway.
        try {
          const cached = await readFieldCache();
          if (active) setAccess({ ...empty, loading: false, admission: 'offline', roles: ['offline responder'],
            capabilities: ['responder.lookup'], principalId: cached.snapshot.principalId, refresh });
        } catch { if (active) setAccess({ ...empty, loading: false, admission: 'anonymous', refresh }); }
      }
    };
    void load();
    const sessionChanged = () => { clearFieldCache(); setAccess({ ...empty, refresh }); void load(); };
    window.addEventListener('watchdog-session-changed', sessionChanged);
    return () => { active = false; window.removeEventListener('watchdog-session-changed', sessionChanged); };
  }, [location.pathname, generation, refresh]);
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>;
}

/**
 * The closed door, in the UI. Anonymous visitors are sent to sign in and
 * applicants to their application; the address they wanted is kept so they
 * land there afterwards. The server enforces the same thing independently.
 */
export function AdmissionGate({ children }: { children: ReactNode }) {
  const access = useAccess();
  const location = useLocation();
  if (access.loading) return <p className="p-6" role="status">Checking access…</p>;
  const next = encodeURIComponent(`${location.pathname}${location.search}`);
  if (access.admission === 'anonymous') return <Navigate to={`/login?next=${next}`} replace />;
  if (access.admission === 'applicant') return <Navigate to="/apply" replace />;
  return children;
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

/** POST JSON to the API, returning the parsed body or throwing its message. */
export async function postJson<T = any>(url: string, body: unknown = {}): Promise<T> {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message ?? data?.message ?? `HTTP ${response.status}`) as Error & { code?: string; status?: number };
    error.code = data?.error?.code; error.status = response.status;
    throw error;
  }
  return data as T;
}
