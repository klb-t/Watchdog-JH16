import { useEffect, useRef, useState, type FormEvent } from 'react';
import { announceSessionChange, postJson, useAccess } from '../lib/access';
import { useAccessText } from '../lib/access_i18n';

declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize(options: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }): void;
      renderButton(el: HTMLElement, options: Record<string, unknown>): void;
    } } };
  }
}

let gisLoading: Promise<void> | null = null;
function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  gisLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { gisLoading = null; reject(new Error('Google sign-in could not be loaded.')); };
    document.head.appendChild(script);
  });
  return gisLoading;
}

/**
 * Every sign-in method this installation offers, in one panel. Used by the
 * login screen and inline on an invitation, so accepting an invitation never
 * needs a detour through a separate page.
 */
export function SignInPanel({ onSignedIn, initialEmail = '', initialCode = '' }: {
  onSignedIn: () => void; initialEmail?: string; initialCode?: string;
}) {
  const access = useAccess();
  const { t, lang } = useAccessText();
  const googleRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState(initialCode);
  const [step, setStep] = useState<'email' | 'code'>(initialEmail && initialCode ? 'code' : 'email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const done = () => { announceSessionChange(); onSignedIn(); };

  useEffect(() => {
    const clientId = access.methods.google?.client_id;
    if (!clientId || !googleRef.current) return;
    let active = true;
    loadGoogleIdentity().then(() => {
      if (!active || !googleRef.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          setBusy(true); setError(null);
          try { await postJson('/api/auth/session', { id_token: credential }); done(); }
          catch (e) { setError((e as Error).message); }
          finally { setBusy(false); }
        },
      });
      window.google.accounts.id.renderButton(googleRef.current,
        { theme: 'outline', size: 'large', text: 'signin_with', width: 300, locale: lang });
    }).catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.methods.google?.client_id, lang]);

  // A code arriving in the link from the email signs in without typing — once,
  // even where React runs effects twice in development.
  const autoVerified = useRef(false);
  useEffect(() => {
    if (!initialEmail || !initialCode || autoVerified.current) return;
    autoVerified.current = true;
    void verify(initialEmail, initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      await postJson('/api/auth/email/start', { email, language: lang });
      setStep('code'); setNotice(t('email_sent', { email }));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function verify(address: string, value: string, event?: FormEvent) {
    event?.preventDefault();
    setBusy(true); setError(null);
    try { await postJson('/api/auth/email/verify', { email: address, code: value }); done(); }
    catch (e) { setError((e as Error).message); setStep('code'); }
    finally { setBusy(false); }
  }

  const hasGoogle = !!access.methods.google;
  const hasEmail = access.methods.email_code;

  return (
    <div className="space-y-4" data-testid="sign-in-panel">
      {hasGoogle && <div className="flex justify-center min-h-11" ref={googleRef} data-testid="google-button" aria-label={t('google')} />}
      {hasGoogle && hasEmail && <div className="flex items-center gap-3 text-xs text-slate-500" aria-hidden>
        <span className="h-px flex-1 bg-slate-200" />{t('or')}<span className="h-px flex-1 bg-slate-200" />
      </div>}

      {hasEmail && step === 'email' && <form onSubmit={start} className="space-y-3">
        <label className="field-control">{t('email_label')}
          <input type="email" required autoComplete="email" inputMode="email" value={email}
            onChange={e => setEmail(e.target.value)} data-testid="email-input" />
        </label>
        <button className="field-button primary w-full" disabled={busy || !email} data-testid="email-send">
          {busy ? t('working') : t('email_send')}
        </button>
      </form>}

      {hasEmail && step === 'code' && <form onSubmit={e => verify(email, code, e)} className="space-y-3">
        {notice && <p className="text-sm text-slate-700" role="status">{notice}</p>}
        <label className="field-control">{t('code_label')}
          <input value={code} onChange={e => setCode(e.target.value)} required autoComplete="one-time-code"
            autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX"
            className="tracking-widest font-mono text-lg" data-testid="code-input" />
        </label>
        <button className="field-button primary w-full" disabled={busy || code.replace(/[\s-]/g, '').length < 8} data-testid="code-submit">
          {busy ? t('working') : t('code_submit')}
        </button>
        <div className="flex justify-between text-sm">
          <button type="button" className="underline" onClick={() => void start()} disabled={busy}>{t('code_again')}</button>
          <button type="button" className="underline" onClick={() => { setStep('email'); setCode(''); setNotice(null); }}>{t('other_address')}</button>
        </div>
      </form>}

      {!hasGoogle && !hasEmail && <p className="field-warning" data-testid="no-methods">{t('no_methods')}</p>}
      {error && <p className="field-error" role="alert" data-testid="sign-in-error">{error}</p>}
    </div>
  );
}
