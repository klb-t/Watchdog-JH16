import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AdmissionGate as AccountsGate, useAccess } from '../lib/access';
import { useAccessText, type AccessKey } from '../lib/access_i18n';
import { clientError, responseError } from '../lib/api_error';

const sessionChanged = () => window.dispatchEvent(new Event('watchdog-session-changed'));
async function authPost(path: string, body: unknown = {}) {
  const response = await fetch(`/api/auth/${path}`,{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw responseError(response, data);
  return data;
}

/** The anonymous surface contains only identity and an owner's admission process. */
export function AdmissionGate({ children }: { children: ReactNode }) {
  const access = useAccess();
  const { t, errorText } = useAccessText();
  const button = useRef<HTMLDivElement>(null);
  const [error,setError] = useState<unknown>(null);
  const [notice,setNotice] = useState<AccessKey | ''>('');
  const [reason,setReason] = useState('');
  const [busy,setBusy] = useState(false);
  const [invite] = useState(() => new URLSearchParams(window.location.search).get('invite'));
  useEffect(() => {
    // Keep the one-time token only in component memory, out of navigation,
    // referrers and later history entries while Google verifies the account.
    if (!invite) return;
    const url = new URL(window.location.href);url.searchParams.delete('invite');window.history.replaceState(null,'',url);
  },[invite]);
  useEffect(() => {
    if (access.loading || access.principalId || access.legacyAdmission?.verified || !access.googleClientId) return;
    let active = true;
    const render = () => {
      const google = (window as any).google;
      if (!active || !button.current || !google?.accounts?.id) return;
      google.accounts.id.initialize({ client_id:access.googleClientId,auto_select:false,callback:async (result: { credential:string }) => {
        setBusy(true); setError(null);
        try { await authPost('session',{ id_token:result.credential }); sessionChanged(); }
        catch (e) { setError(e); }
        finally { setBusy(false); }
      } });
      button.current.replaceChildren();
      google.accounts.id.renderButton(button.current,{ theme:'outline',size:'large',text:'signin_with',width:280 });
    };
    let script = document.getElementById('watchdog-google-identity') as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script'); script.id='watchdog-google-identity';
      script.src='https://accounts.google.com/gsi/client'; script.async=true; document.head.appendChild(script);
    }
    script.addEventListener('load',render);
    const failed = () => setError(clientError('google_load_failed', 'Google sign-in could not load. Check your connection and reload this page.'));
    script.addEventListener('error',failed); render();
    return () => { active=false;script?.removeEventListener('load',render);script?.removeEventListener('error',failed); };
  },[access.loading,access.principalId,access.legacyAdmission?.verified,access.googleClientId]);

  if (access.authMode === 'accounts') return <AccountsGate>{children}</AccountsGate>;
  if (access.loading) return <main className="min-h-screen grid place-items-center"><p role="status">{t('access_checking')}</p></main>;
  if (access.principalId && access.capabilities.length) return children;
  const verified = access.legacyAdmission?.verified;
  const status = access.legacyAdmission?.status;
  const act = async (operation: () => Promise<unknown>,message: AccessKey) => {
    setBusy(true);setError(null);setNotice('');
    try { await operation();setNotice(message);sessionChanged(); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  };
  return <main className="min-h-screen bg-slate-50 grid place-items-center p-6" data-testid="admission-gate">
    <section className="w-full max-w-lg rounded-xl border bg-white p-6 shadow-sm space-y-4">
      <h1 className="text-2xl font-semibold">WatchDog</h1>
      <p className="text-sm text-slate-600">{t('gate_intro')}</p>
      {error !== null && <p role="alert" className="text-sm text-red-700 break-words">{errorText(error)}</p>}
      {notice && <p role="status" className="text-sm text-emerald-700">{t(notice)}</p>}
      {!verified ? <>
        <div ref={button} aria-label={t('gate_google_label')} />
        {!access.googleClientId && <p role="alert" className="text-sm text-amber-800">{t('gate_unavailable')}</p>}
      </> : <>
        <p className="text-sm break-words">{t('gate_verified')} <strong>{access.legacyAdmission?.email}</strong></p>
        {status === 'approved' ? <button disabled={busy} className="rounded bg-slate-900 text-white px-4 py-2" onClick={() => act(() => authPost('admission/activate'),'gate_activated')}>{t('gate_enter')}</button> : <>
          {status === 'pending' && <p role="status" className="text-sm">{t('gate_pending')}</p>}
          {status === 'revoked' && <p className="text-sm">{t('gate_revoked')}</p>}
          {status === 'rejected' && <p className="text-sm">{t('gate_rejected')}</p>}
          {access.legacyAdmission?.request && <p className="text-sm text-slate-600 break-words">{t('gate_submitted_reason', { reason: access.legacyAdmission.request.reason })}</p>}
          {invite && <button disabled={busy} className="rounded border px-4 py-2" onClick={() => act(async () => {
            await authPost('admission/invitations/accept',{ token:invite });
            const url = new URL(window.location.href);url.searchParams.delete('invite');window.history.replaceState(null,'',url);
          },'gate_invite_accepted')}>{t('gate_accept_invite')}</button>}
          <form className="space-y-3" onSubmit={event => { event.preventDefault();void act(() => authPost('admission/request',{ reason }),'gate_request_sent'); }}>
            <label className="block text-sm font-medium" htmlFor="admission-reason">{t('gate_reason_label')}</label>
            <textarea id="admission-reason" required minLength={10} maxLength={4000} className="w-full rounded border p-3" rows={4} value={reason} onChange={e => setReason(e.target.value)} />
            <button disabled={busy || reason.trim().length < 10} className="rounded bg-slate-900 text-white px-4 py-2 disabled:opacity-50">{t('gate_submit')}</button>
          </form>
        </>}
        <div className="flex flex-wrap gap-4 text-sm">
          <button disabled={busy} className="underline" onClick={sessionChanged}>{t('gate_check')}</button>
          <button disabled={busy} className="underline" onClick={() => act(() => authPost('signout'),'gate_signed_out')}>{t('sign_out')}</button>
        </div>
      </>}
    </section>
  </main>;
}
