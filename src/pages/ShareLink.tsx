import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AccessShell } from '../components/AccessShell';
import { postJson, useAccess } from '../lib/access';

/**
 * A run-share link lands here (`/share#t=…`). The token rides in the fragment and
 * is kept in session storage across sign-in. A signed-in member redeems it into
 * read access to the shared runs; the owner can withdraw it at any time.
 */
const KEY = 'watchdog-pending-share';
const read = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
const write = (t: string | null) => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* ignore */ } };

export function ShareLink() {
  const access = useAccess();
  const [token] = useState<string | null>(() => new URLSearchParams(window.location.hash.slice(1)).get('t') ?? read());
  const [runIds, setRunIds] = useState<string[] | null>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => { if (token) write(token); if (window.location.hash) history.replaceState(null, '', window.location.pathname); }, [token]);
  useEffect(() => {
    if (!token || access.admission !== 'member' && access.admission !== 'local') return;
    postJson<{ runIds: string[] }>('/api/run-shares/redeem', { token }).then(r => { setRunIds(r.runIds); write(null); }).catch(e => setError((e as Error).message));
  }, [token, access.admission]);
  return <AccessShell title="Udostępnione przebiegi">
    {!token && <p className="field-error">Ten link nie zawiera udostępnienia.</p>}
    {token && access.admission === 'anonymous' && <div className="space-y-3"><p>Aby zobaczyć udostępnione przebiegi, zaloguj się (albo wejdź linkiem zaproszenia, jeśli go dostałeś), a potem wróć na tę stronę.</p>
      <Link className="field-button primary w-full" to="/login?next=/share">Zaloguj się</Link></div>}
    {token && access.admission === 'applicant' && <p>Twoje konto czeka na dostęp do WatchDoga. Udostępnione przebiegi zobaczysz po zatwierdzeniu.</p>}
    {runIds && <div className="space-y-3" data-testid="share-redeemed"><p>Masz dostęp do odczytu {runIds.length} {runIds.length === 1 ? 'przebiegu' : 'przebiegów'}. Właściciel może go w każdej chwili wycofać.</p>
      <ul className="text-sm list-disc ml-5">{runIds.map(id => <li key={id}><Link className="underline font-mono" to={`/runs/${id}/results`}>{id.slice(0, 8)}</Link></li>)}</ul>
      <Link className="field-button primary w-full" to="/replications">Replikacje</Link></div>}
    {error && <p className="field-error" role="alert" data-testid="share-error">{error}</p>}
  </AccessShell>;
}
