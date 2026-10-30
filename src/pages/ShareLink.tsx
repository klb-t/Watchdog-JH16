import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AccessShell } from '../components/AccessShell';
import { postJson, useAccess } from '../lib/access';
import { useAccessText } from '../lib/access_i18n';

/**
 * A run-share link lands here (`/share#t=…`). The token rides in the fragment and
 * is kept in session storage across sign-in. A signed-in member redeems it into
 * read access to the shared runs; the owner can withdraw it at any time.
 * Labels from config/access/ui.json, in the reader's language.
 */
const KEY = 'watchdog-pending-share';
const read = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
const write = (t: string | null) => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* ignore */ } };

export function ShareLink() {
  const access = useAccess();
  const { t, errorText } = useAccessText();
  const [token] = useState<string | null>(() => new URLSearchParams(window.location.hash.slice(1)).get('t') ?? read());
  const [runIds, setRunIds] = useState<string[] | null>(null), [error, setError] = useState<unknown>(null);
  useEffect(() => { if (token) write(token); if (window.location.hash) history.replaceState(null, '', window.location.pathname); }, [token]);
  useEffect(() => {
    if (!token || access.admission !== 'member' && access.admission !== 'local') return;
    postJson<{ runIds: string[] }>('/api/run-shares/redeem', { token }).then(r => { setRunIds(r.runIds); write(null); }).catch(e => setError(e));
  }, [token, access.admission]);
  return <AccessShell title={t('share_title')}>
    {!token && <p className="field-error" data-testid="share-status">{t('share_no_token')}</p>}
    {token && access.admission === 'anonymous' && <div className="space-y-3" data-testid="share-sign-in"><p>{t('share_sign_in_needed')}</p>
      <Link className="field-button primary w-full" to="/login?next=/share">{t('share_sign_in')}</Link></div>}
    {token && access.admission === 'applicant' && <p data-testid="share-applicant">{t('share_applicant')}</p>}
    {runIds && <div className="space-y-3" data-testid="share-redeemed"><p>{t('share_redeemed', { count: runIds.length })}</p>
      <ul className="text-sm list-disc ml-5">{runIds.map(id => <li key={id}><Link className="underline font-mono" to={`/runs/${id}/results`}>{id.slice(0, 8)}</Link></li>)}</ul>
      <Link className="field-button primary w-full" to="/replications">{t('share_go_replications')}</Link></div>}
    {!!error && <p className="field-error" role="alert" data-testid="share-error">{errorText(error)}</p>}
  </AccessShell>;
}
