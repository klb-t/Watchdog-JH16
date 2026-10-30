import { useEffect, useState } from 'react';
import { KeyRound, CheckCircle2, AlertTriangle, CircleDashed, LogIn, LogOut } from 'lucide-react';
import { ConfigurationWizard } from '../components/ConfigurationWizard';
import { useUiText } from '../lib/ui_text';
import text from '../../config/ui/setup.json';

type Text = ReturnType<typeof useUiText<typeof text>>;

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
  remediation_code?: string | null;
  remediation_params?: Record<string, string>;
  default_model?: string | null;
  allowed_models?: string[];
}

interface Readiness {
  capabilities: Record<string, ProviderRow[]>;
  sources: { source_id: string; description: string; status: string; remediation?: string; remediation_code?: string | null; remediation_params?: Record<string, string> }[];
  ready: { text_generate: boolean; live_acquisition: boolean };
}

interface AuthConfig {
  mode: 'local' | 'oidc' | 'accounts';
  reason: string;
  reason_code?: string | null;
  reason_params?: Record<string, string | number>;
  google_client_id: string | null;
  grant_count: number;
  signed_in: boolean;
}

interface Me {
  principal: { id: string; email: string | null; roles: string[]; identity_provenance: string };
  capabilities: string[];
}

const StatusIcon = ({ status, ui }: { status: string; ui: Text }) => {
  if (status === 'implemented' || status === 'fixture') {
    return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-label={ui.t('icon_ready')} />;
  }
  if (status === 'blocked') {
    return <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" aria-label={ui.t('icon_blocked')} />;
  }
  return <CircleDashed className="w-4 h-4 text-slate-400 shrink-0" aria-label={ui.t('icon_planned')} />;
};

/** A registry status in the reader's language; an unknown status is shown as stored. */
const registryStatus = (ui: Text, status: string) => {
  const code = status.replace(/[^a-z0-9]+/g, '_'), label = ui.tCode('registry_', code);
  return label === code ? status : label;
};

/** The server's remediation in the reader's language when it carries a code; its English text otherwise. */
function remediationText(ui: Text, r: { remediation?: string; remediation_code?: string | null; remediation_params?: Record<string, string> }) {
  if (!r.remediation) return '';
  const label = r.remediation_code ? ui.tCode('remediation_', r.remediation_code, r.remediation_params) : null;
  return label && label !== r.remediation_code ? label : r.remediation;
}

/** A source description is registry data: translated only when it is exactly one of the two known texts. */
function sourceDescription(ui: Text, id: string, description: string) {
  const key = `source_${id}`, pl = (text.languages.pl as Record<string, string>)[key], en = (text.languages.en as Record<string, string>)[key];
  return description === pl || description === en ? ui.tCode('source_', id) : description;
}

/**
 * A plain function rather than a component, so the `key` sits on an intrinsic
 * element. This project has no `@types/react`, so `key` is not special-cased
 * on custom components — the existing pages follow the same convention.
 */
function providerCard(ui: Text, p: ProviderRow) {
  const ready = p.status === 'implemented';
  return (
    <div
      key={p.provider_key}
      data-testid={`provider-${p.provider_key}`}
      data-status={p.status}
      className={`rounded-lg border p-4 ${ready ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}
    >
      <div className="flex items-center gap-2">
        <StatusIcon status={p.status} ui={ui} />
        <span className="font-medium text-sm min-w-0 break-words">{p.display_name}</span>
        <span className="ml-auto text-[11px] uppercase tracking-wide text-slate-500">{registryStatus(ui, p.status)}</span>
      </div>

      {p.remediation && (
        // The whole reason this page exists: what to do, not that something is wrong.
        <p data-testid={`remediation-${p.provider_key}`} className="mt-2 text-xs text-slate-600 leading-relaxed break-words">
          {remediationText(ui, p)}
        </p>
      )}

      {p.default_model && (
        <p className="mt-2 text-[11px] text-slate-500 font-mono break-all">{p.default_model}</p>
      )}
    </div>
  );
}

export function Setup() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [auth, setAuth] = useState<AuthConfig | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<unknown>(null);
  const ui = useUiText(text);
  const { t, c, errorText } = ui;

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
      setError(e);
    }
  };

  useEffect(() => { load(); }, []);

  const signOut = async () => {
    await fetch('/api/auth/signout', { method: 'POST',headers:{'Content-Type':'application/json'},body:'{}' });
    window.dispatchEvent(new Event('watchdog-session-changed'));
    load();
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8" data-testid="setup-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-slate-500 mt-1 text-sm">
          {t('intro')}
        </p>
      </div>

      {error !== null && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 break-words">{errorText(error)}</div>}
      {me && <ConfigurationWizard />}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t('access')}</h2>
        <div className="rounded-lg border border-slate-200 bg-white p-4" data-testid="auth-panel">
          {!auth ? <p className="text-sm text-slate-500">{c('loading')}</p> : (
            <>
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-medium" data-testid="auth-mode">
                  {auth.mode === 'accounts' ? t('mode_accounts') : auth.mode === 'oidc' ? t('mode_oidc') : t('mode_local')}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-600 break-words">{(() => { const label = auth.reason_code ? ui.tCode('auth_reason_', auth.reason_code, auth.reason_params) : null; return label && label !== auth.reason_code ? label : auth.reason; })()}</p>

              {auth.mode === 'local' && (
                <p className="mt-2 text-xs text-amber-700">
                  {t('local_warning')}
                </p>
              )}

              {me ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-mono text-slate-700 break-all" data-testid="me-id">{me.principal.email ?? me.principal.id}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5">{me.principal.roles.join(', ')}</span>
                  {auth.mode !== 'local' && (
                    <button onClick={signOut} className="ml-auto inline-flex items-center gap-1 text-slate-600 hover:text-slate-900">
                      <LogOut className="w-3.5 h-3.5" /> {t('sign_out')}
                    </button>
                  )}
                </div>
              ) : auth.mode !== 'local' && (
                <p className="mt-3 inline-flex items-center gap-1 text-xs text-slate-600">
                  <LogIn className="w-3.5 h-3.5" /> {t('not_signed_in')}
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {readiness && (
        <>
          <p className="text-sm text-slate-600">{t('operator_note')}</p>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t('lm_title')}
            </h2>
            <p className="text-xs text-slate-500">
              {(() => { const [before, after = ''] = t('lm_note').split('{proposed}'); return <>{before}<em>{t('lm_proposed')}</em>{after}</>; })()}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(readiness.capabilities['text.generate'] ?? []).map(p => providerCard(ui, p))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t('search_title')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(readiness.capabilities['search.result_count'] ?? []).map(p => providerCard(ui, p))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t('sources_title')}</h2>
            <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
              {readiness.sources.map(s => (
                <div key={s.source_id} className="flex items-start gap-3 p-3" data-testid={`source-${s.source_id}`}>
                  <StatusIcon status={s.status} ui={ui} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium break-all">{s.source_id}</div>
                    <div className="text-xs text-slate-500 break-words">{sourceDescription(ui, s.source_id, s.description)}</div>
                    {s.remediation && <div className="text-xs text-amber-700 mt-1 break-words">{remediationText(ui, s)}</div>}
                  </div>
                  <span className="ml-auto text-[11px] uppercase tracking-wide text-slate-400 shrink-0">
                    {registryStatus(ui, s.status)}
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
