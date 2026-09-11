import { useEffect, useState } from 'react';
import { KeyRound, CheckCircle2, AlertTriangle, CircleDashed, LogIn, LogOut } from 'lucide-react';
import { ConfigurationWizard } from '../components/ConfigurationWizard';

/**
 * The readiness page (D17).
 *
 * Its job is to answer one question — "why can't I run this yet?" — with the
 * exact remediation, never with the word "unavailable". Every status here is
 * derived server-side from live credential state, so this page cannot claim a
 * provider works when its key has been removed.
 *
 * Personal keys now use the separate encrypted, owner-scoped vault. The
 * instance readiness below still describes operator-configured providers.
 */

interface ProviderRow {
  provider_key: string;
  display_name: string;
  status: string;
  credential_status: string;
  remediation: string;
  default_model?: string | null;
  allowed_models?: string[];
}

interface Readiness {
  capabilities: Record<string, ProviderRow[]>;
  sources: { source_id: string; description: string; status: string; remediation?: string }[];
  ready: { text_generate: boolean; live_acquisition: boolean };
}

interface AuthConfig {
  mode: 'local' | 'oidc';
  reason: string;
  google_client_id: string | null;
  grant_count: number;
  signed_in: boolean;
}

interface Me {
  principal: { id: string; email: string | null; roles: string[]; identity_provenance: string };
  capabilities: string[];
}

const StatusIcon = ({ status }: { status: string }) => {
  if (status === 'implemented' || status === 'fixture') {
    return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-label="ready" />;
  }
  if (status === 'blocked') {
    return <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" aria-label="blocked" />;
  }
  return <CircleDashed className="w-4 h-4 text-slate-400 shrink-0" aria-label="planned" />;
};

/**
 * A plain function rather than a component, so the `key` sits on an intrinsic
 * element. This project has no `@types/react`, so `key` is not special-cased
 * on custom components — the existing pages follow the same convention.
 */
function providerCard(p: ProviderRow) {
  const ready = p.status === 'implemented';
  return (
    <div
      key={p.provider_key}
      data-testid={`provider-${p.provider_key}`}
      data-status={p.status}
      className={`rounded-lg border p-4 ${ready ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}
    >
      <div className="flex items-center gap-2">
        <StatusIcon status={p.status} />
        <span className="font-medium text-sm">{p.display_name}</span>
        <span className="ml-auto text-[11px] uppercase tracking-wide text-slate-500">{p.status}</span>
      </div>

      {p.remediation && (
        // The whole reason this page exists: what to do, not that something is wrong.
        <p data-testid={`remediation-${p.provider_key}`} className="mt-2 text-xs text-slate-600 leading-relaxed">
          {p.remediation}
        </p>
      )}

      {p.default_model && (
        <p className="mt-2 text-[11px] text-slate-500 font-mono">{p.default_model}</p>
      )}
    </div>
  );
}

export function Setup() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [auth, setAuth] = useState<AuthConfig | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [a, r] = await Promise.all([
        fetch('/api/auth/config').then(x => x.json()),
        fetch('/api/providers/readiness').then(async x => (x.ok ? x.json() : null)),
      ]);
      setAuth(a);
      setReadiness(r);
      const meRes = await fetch('/api/auth/me');
      setMe(meRes.ok ? await meRes.json() : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { load(); }, []);

  const signOut = async () => {
    await fetch('/api/auth/signout', { method: 'POST' });
    window.dispatchEvent(new Event('watchdog-session-changed'));
    load();
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8" data-testid="setup-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Setup</h1>
        <p className="text-slate-500 mt-1 text-sm">
          What this instance can do right now, and what each missing piece needs.
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {me && <ConfigurationWizard />}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Access</h2>
        <div className="rounded-lg border border-slate-200 bg-white p-4" data-testid="auth-panel">
          {!auth ? <p className="text-sm text-slate-500">Loading…</p> : (
            <>
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-medium" data-testid="auth-mode">
                  {auth.mode === 'oidc' ? 'Google sign-in' : 'No authentication (local mode)'}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-600">{auth.reason}</p>

              {auth.mode === 'local' && (
                <p className="mt-2 text-xs text-amber-700">
                  Every request is the local user with full rights. Fine on your own machine;
                  the server refuses to start this way in production unless you say so explicitly.
                </p>
              )}

              {me ? (
                <div className="mt-3 flex items-center gap-3 text-xs">
                  <span className="font-mono text-slate-700" data-testid="me-id">{me.principal.email ?? me.principal.id}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5">{me.principal.roles.join(', ')}</span>
                  {auth.mode === 'oidc' && (
                    <button onClick={signOut} className="ml-auto inline-flex items-center gap-1 text-slate-600 hover:text-slate-900">
                      <LogOut className="w-3.5 h-3.5" /> Sign out
                    </button>
                  )}
                </div>
              ) : auth.mode === 'oidc' && (
                <p className="mt-3 inline-flex items-center gap-1 text-xs text-slate-600">
                  <LogIn className="w-3.5 h-3.5" /> Not signed in.
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {readiness && (
        <>
          <p className="text-sm text-slate-600">Konfiguracja operatora instancji. Poniższe połączenia są niezależne od Twoich osobistych kluczy zapisanych w kreatorze.</p>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Language models — narrative and, later, the method compiler
            </h2>
            <p className="text-xs text-slate-500">
              A model may propose prose and method specifications. It never computes, rounds or
              adjusts a scientific value, and everything it produces stays <em>proposed</em> until
              a person approves it.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(readiness.capabilities['text.generate'] ?? []).map(providerCard)}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Live search counts
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(readiness.capabilities['search.result_count'] ?? []).map(providerCard)}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Sources</h2>
            <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
              {readiness.sources.map(s => (
                <div key={s.source_id} className="flex items-start gap-3 p-3" data-testid={`source-${s.source_id}`}>
                  <StatusIcon status={s.status} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{s.source_id}</div>
                    <div className="text-xs text-slate-500">{s.description}</div>
                    {s.remediation && <div className="text-xs text-amber-700 mt-1">{s.remediation}</div>}
                  </div>
                  <span className="ml-auto text-[11px] uppercase tracking-wide text-slate-400 shrink-0">
                    {s.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
