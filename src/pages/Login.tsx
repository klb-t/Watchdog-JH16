import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AccessShell } from '../components/AccessShell';
import { SignInPanel } from '../components/SignInPanel';
import { announceSessionChange, postJson, useAccess } from '../lib/access';
import { useAccessText } from '../lib/access_i18n';

export const PENDING_INVITATION_KEY = 'watchdog-pending-invitation';

/** Only same-site paths, so `?next=` cannot bounce someone to another site. */
function safeNext(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
}

/**
 * The sign-in screen (E4.5): the only thing an anonymous visitor sees.
 *
 * Secrets that arrive in a link — an emailed code, an operator's one-time
 * link — are read from the URL fragment and the fragment is wiped at once, so
 * they do not linger in history, in a screenshot of the address bar, or in a
 * link someone copies from the page.
 */
export function Login() {
  const access = useAccess();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { t } = useAccessText();
  const [operatorError, setOperatorError] = useState<string | null>(null);

  // Read purely (React may run an initializer twice); wiped in an effect.
  const [fragment] = useState(() => {
    const f = new URLSearchParams(window.location.hash.slice(1));
    return { signin: f.get('signin'), email: f.get('email') ?? '', code: f.get('code') ?? '' };
  });
  useEffect(() => {
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);
  const [operatorPending, setOperatorPending] = useState(!!fragment.signin);
  // A one-time link must be spent exactly once, even where React runs effects
  // twice in development — otherwise the second attempt reports a false error.
  const spent = useRef(false);

  const after = () => {
    let pending: string | null = null;
    try { pending = sessionStorage.getItem(PENDING_INVITATION_KEY); } catch { /* ignore */ }
    navigate(pending ? '/join' : safeNext(params.get('next')), { replace: true });
  };

  useEffect(() => {
    if (!fragment.signin || spent.current) return;
    spent.current = true;
    postJson('/api/auth/operator/verify', { token: fragment.signin })
      .then(() => { announceSessionChange(); after(); })
      .catch(e => setOperatorError((e as Error).message))
      .finally(() => setOperatorPending(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!access.loading && !operatorPending) {
    if (access.admission === 'member' || access.admission === 'local') return <Navigate to={safeNext(params.get('next'))} replace />;
    if (access.admission === 'applicant') return <Navigate to="/apply" replace />;
  }

  return (
    <AccessShell title={t('sign_in_title')}>
      {operatorPending ? <p role="status">{t('operator_signing_in')}</p> : <>
        <p className="text-sm text-slate-600 mb-5">{t('sign_in_intro')}</p>
        {operatorError && <p className="field-error mb-4" role="alert">{operatorError}</p>}
        <SignInPanel onSignedIn={after} initialEmail={fragment.email} initialCode={fragment.code} />
      </>}
    </AccessShell>
  );
}
