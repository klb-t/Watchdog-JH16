import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AccessShell } from '../components/AccessShell';
import { SignInPanel } from '../components/SignInPanel';
import { announceSessionChange, postJson, useAccess } from '../lib/access';
import { useAccessText, type AccessKey } from '../lib/access_i18n';
import { PENDING_INVITATION_KEY } from './Login';

interface Preview {
  status: 'valid' | 'expired' | 'revoked' | 'used_up' | 'unknown' | 'inviter_no_longer_authorized';
  kind?: 'email' | 'open_link';
  roles?: string[];
  note?: string | null;
  inviter?: string | null;
  expiresAt?: string;
  emailHint?: string | null;
}

function readPending(): string | null {
  try { return sessionStorage.getItem(PENDING_INVITATION_KEY); } catch { return null; }
}
function writePending(token: string | null) {
  try { token ? sessionStorage.setItem(PENDING_INVITATION_KEY, token) : sessionStorage.removeItem(PENDING_INVITATION_KEY); } catch { /* ignore */ }
}

/**
 * An invitation link lands here (`/join#t=…`). The token rides in the URL
 * fragment, which browsers never send to a server, and is moved to session
 * storage and wiped from the address bar at once — so it survives the sign-in
 * step without being left in history or a copied URL.
 */
export function Join() {
  const access = useAccess();
  const { t, role, date } = useAccessText();
  const [token] = useState<string | null>(() => new URLSearchParams(window.location.hash.slice(1)).get('t') ?? readPending());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const autoAccepted = useRef(false);

  useEffect(() => {
    if (token) writePending(token);
    if (window.location.hash) history.replaceState(null, '', window.location.pathname);
  }, [token]);

  useEffect(() => {
    if (!token || access.mode !== 'accounts') return;
    postJson<{ invitation: Preview }>('/api/auth/invitations/preview', { token })
      .then(r => setPreview(r.invitation))
      .catch(e => setError((e as Error).message));
  }, [token, access.mode, access.email]);

  const signedIn = access.admission === 'member' || access.admission === 'applicant';

  async function accept() {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      await postJson('/api/auth/invitations/redeem', { token });
      writePending(null);
      setAccepted(true);
      announceSessionChange();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  // Someone who opened an invitation and then signed in meant to accept it.
  useEffect(() => {
    if (signedIn && preview?.status === 'valid' && !accepted && !autoAccepted.current) {
      autoAccepted.current = true;
      void accept();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, preview?.status]);

  async function signOut() {
    await postJson('/api/auth/signout');
    announceSessionChange();
  }

  if (access.mode === 'local') {
    return <AccessShell title={t('join_title')}><p>This installation runs without sign-in; invitations are not needed.</p>
      <Link className="underline" to="/">WatchDog</Link></AccessShell>;
  }

  return (
    <AccessShell title={t('join_title')}>
      {!token && <p className="field-error" data-testid="join-status">{t('join_status_unknown')}</p>}
      {token && !preview && !error && <p role="status">{t('working')}</p>}

      {preview && preview.status !== 'valid' && !accepted &&
        <p className="field-error" data-testid="join-status">{t(`join_status_${preview.status}` as AccessKey)}</p>}

      {preview && preview.status === 'valid' && !accepted && <div className="space-y-3" data-testid="join-preview">
        <p>{t('join_valid', { inviter: preview.inviter ?? 'WatchDog', roles: (preview.roles ?? []).map(role).join(', ') })}</p>
        {preview.note && <blockquote className="border-l-4 border-indigo-200 pl-3 text-sm text-slate-700 whitespace-pre-wrap">
          <span className="block text-xs text-slate-500 mb-1">{t('join_note')}</span>{preview.note}</blockquote>}
        <p className="text-sm text-slate-600">
          {preview.kind === 'email' ? t('join_email_bound', { hint: preview.emailHint ?? '' }) : t('join_open')}
          {' '}{t('join_expires', { date: date(preview.expiresAt) })}
        </p>

        {signedIn ? <div className="space-y-3">
          <p className="text-sm">{t('join_signed_in_as', { email: access.email ?? '' })}</p>
          <button className="field-button primary w-full" onClick={() => void accept()} disabled={busy} data-testid="join-accept">
            {busy ? t('working') : t('join_accept')}
          </button>
          {error && <button className="underline text-sm" onClick={() => void signOut()}>{t('other_address')}</button>}
        </div> : <SignInPanel onSignedIn={() => { /* the session change re-renders this page; acceptance follows */ }} />}
      </div>}

      {accepted && <div className="space-y-4" data-testid="join-accepted">
        <p className="text-emerald-700 font-medium">{t('join_accepted')}</p>
        <Link className="field-button primary w-full" to="/">{t('join_go')}</Link>
      </div>}

      {error && <p className="field-error" role="alert" data-testid="join-error">{error}</p>}
    </AccessShell>
  );
}
