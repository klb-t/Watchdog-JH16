import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAccess } from '../lib/access';

const sessionChanged = () => window.dispatchEvent(new Event('watchdog-session-changed'));
async function authPost(path: string, body: unknown = {}) {
  const response = await fetch(`/api/auth/${path}`,{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? 'The request could not be completed.');
  return data;
}

/** The anonymous surface contains only identity and an owner's admission process. */
export function AdmissionGate({ children }: { children: ReactNode }) {
  const access = useAccess();
  const button = useRef<HTMLDivElement>(null);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
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
    if (access.loading || access.principalId || access.admission?.verified || !access.googleClientId) return;
    let active = true;
    const render = () => {
      const google = (window as any).google;
      if (!active || !button.current || !google?.accounts?.id) return;
      google.accounts.id.initialize({ client_id:access.googleClientId,auto_select:false,callback:async (result: { credential:string }) => {
        setBusy(true); setError('');
        try { await authPost('session',{ id_token:result.credential }); sessionChanged(); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); }
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
    const failed = () => setError('Google sign-in could not load. Check your connection and reload this page.');
    script.addEventListener('error',failed); render();
    return () => { active=false;script?.removeEventListener('load',render);script?.removeEventListener('error',failed); };
  },[access.loading,access.principalId,access.admission?.verified,access.googleClientId]);

  if (access.loading) return <main className="min-h-screen grid place-items-center"><p role="status">Checking access…</p></main>;
  if (access.principalId && access.capabilities.length) return children;
  const verified = access.admission?.verified;
  const status = access.admission?.status;
  const act = async (operation: () => Promise<unknown>,message: string) => {
    setBusy(true);setError('');setNotice('');
    try { await operation();setNotice(message);sessionChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <main className="min-h-screen bg-slate-50 grid place-items-center p-6" data-testid="admission-gate">
    <section className="w-full max-w-lg rounded-xl border bg-white p-6 shadow-sm space-y-4">
      <h1 className="text-2xl font-semibold">WatchDog</h1>
      <p className="text-sm text-slate-600">Private research workspace. Sign in with a verified Google account to enter or request access.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
      {!verified ? <>
        <div ref={button} aria-label="Google sign-in" />
        {!access.googleClientId && <p role="alert" className="text-sm text-amber-800">Sign-in is unavailable. The installation owner must configure Google authentication.</p>}
      </> : <>
        <p className="text-sm">Verified account: <strong>{access.admission?.email}</strong></p>
        {status === 'approved' ? <button disabled={busy} className="rounded bg-slate-900 text-white px-4 py-2" onClick={() => act(() => authPost('admission/activate'),'Access activated.')}>Enter workspace</button> : <>
          {status === 'pending' && <p role="status" className="text-sm">Your request is awaiting the owner's approval.</p>}
          {status === 'revoked' && <p className="text-sm">Access has been revoked. You can submit a new explanation for review.</p>}
          {status === 'rejected' && <p className="text-sm">The previous request was declined. You can update your explanation.</p>}
          {access.admission?.request && <p className="text-sm text-slate-600">Submitted explanation: {access.admission.request.reason}</p>}
          {invite && <button disabled={busy} className="rounded border px-4 py-2" onClick={() => act(async () => {
            await authPost('admission/invitations/accept',{ token:invite });
            const url = new URL(window.location.href);url.searchParams.delete('invite');window.history.replaceState(null,'',url);
          },'Invitation accepted. The owner must approve your access.')}>Accept invitation for this account</button>}
          <form className="space-y-3" onSubmit={event => { event.preventDefault();void act(() => authPost('admission/request',{ reason }),'Request submitted.'); }}>
            <label className="block text-sm font-medium" htmlFor="admission-reason">How do you intend to use WatchDog?</label>
            <textarea id="admission-reason" required minLength={10} maxLength={4000} className="w-full rounded border p-3" rows={4} value={reason} onChange={e => setReason(e.target.value)} />
            <button disabled={busy || reason.trim().length < 10} className="rounded bg-slate-900 text-white px-4 py-2 disabled:opacity-50">Submit request</button>
          </form>
        </>}
        <div className="flex gap-4 text-sm">
          <button disabled={busy} className="underline" onClick={sessionChanged}>Check approval</button>
          <button disabled={busy} className="underline" onClick={() => act(() => authPost('signout'),'Signed out.')}>Sign out</button>
        </div>
      </>}
    </section>
  </main>;
}
