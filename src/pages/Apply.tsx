import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { AccessShell } from '../components/AccessShell';
import { announceSessionChange, postJson, useAccess } from '../lib/access';
import { useAccessText, type AccessKey } from '../lib/access_i18n';

interface Application {
  id: string;
  status: 'pending' | 'approved' | 'denied' | 'withdrawn';
  submitted_at: string;
  decided_at: string | null;
  decision_note: string | null;
  reason: string;
}

/** Roles someone may ask for. Admin and developer are given, not requested. */
const REQUESTABLE = ['viewer', 'researcher', 'responder', 'institutional', 'law_enforcement'];
const REASON_MIN = 20;

/**
 * The one screen a signed-in person without access can use: say who they are
 * and why, see where the request stands, withdraw it, sign out. Nothing here
 * touches research data, and the server enforces that independently.
 */
export function Apply() {
  const access = useAccess();
  const { t, role, date } = useAccessText();
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [name, setName] = useState('');
  const [affiliation, setAffiliation] = useState('');
  const [reason, setReason] = useState('');
  const [requested, setRequested] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => fetch('/api/auth/application', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : { applications: [] })
    .then(d => setApplications(d.applications ?? []))
    .catch(() => setApplications([]));

  useEffect(() => { if (access.admission === 'applicant') void load(); }, [access.admission]);

  if (!access.loading) {
    if (access.admission === 'anonymous') return <Navigate to="/login" replace />;
    if (access.admission === 'member' || access.admission === 'local') return <Navigate to="/" replace />;
  }

  const pending = applications?.find(a => a.status === 'pending');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await postJson('/api/auth/application', { display_name: name, affiliation, reason, requested_roles: requested });
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function withdraw() {
    setBusy(true); setError(null);
    try { await postJson('/api/auth/application/withdraw'); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function signOut(everywhere = false) {
    await postJson(everywhere ? '/api/auth/signout-everywhere' : '/api/auth/signout');
    announceSessionChange();
  }

  return (
    <AccessShell title={t('apply_title')}>
      <p className="text-sm text-slate-600 mb-4">{t('apply_intro', { email: access.email ?? '' })}</p>

      {applications === null && <p role="status">{t('working')}</p>}

      {pending && <div className="space-y-3" data-testid="application-pending">
        <p className="field-warning">{t('apply_pending', { date: date(pending.submitted_at) })}</p>
        <button className="field-button" onClick={() => void withdraw()} disabled={busy}>{t('apply_withdraw')}</button>
      </div>}

      {applications && !pending && <form onSubmit={submit} className="space-y-3" data-testid="application-form">
        {applications[0]?.status === 'denied' && <p className="field-warning">
          {t('apply_denied', { date: date(applications[0].decided_at) })}
          {applications[0].decision_note && <span className="block mt-1 italic">{applications[0].decision_note}</span>}
        </p>}
        <label className="field-control">{t('apply_name')}
          <input value={name} onChange={e => setName(e.target.value)} maxLength={200} autoComplete="name" data-testid="apply-name" />
        </label>
        <label className="field-control">{t('apply_affiliation')}
          <input value={affiliation} onChange={e => setAffiliation(e.target.value)} maxLength={200} autoComplete="organization" />
        </label>
        <label className="field-control">{t('apply_reason')}
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={5} required minLength={REASON_MIN}
            maxLength={2000} data-testid="apply-reason" />
          <span className="text-xs font-normal text-slate-500">{t('apply_reason_hint', { min: REASON_MIN })}</span>
        </label>
        <fieldset className="text-sm">
          <legend className="font-semibold text-sm mb-1">{t('apply_roles')}</legend>
          <div className="flex flex-wrap gap-2">
            {REQUESTABLE.map(r => <label key={r} className="inline-flex items-center gap-1 border border-slate-300 rounded px-2 py-1">
              <input type="checkbox" checked={requested.includes(r)}
                onChange={e => setRequested(e.target.checked ? [...requested, r] : requested.filter(x => x !== r))} />
              {role(r)}
            </label>)}
          </div>
        </fieldset>
        <button className="field-button primary w-full" disabled={busy || reason.trim().length < REASON_MIN} data-testid="apply-submit">
          {busy ? t('working') : t('apply_submit')}
        </button>
      </form>}

      {error && <p className="field-error" role="alert">{error}</p>}

      <p className="text-sm text-slate-600 mt-5">{t('apply_have_invite')}</p>

      {applications && applications.length > 0 && <details className="mt-4 text-sm">
        <summary>{t('apply_history')}</summary>
        <ul className="mt-2 space-y-1">
          {applications.map(a => <li key={a.id}>{date(a.submitted_at)} — {t(`status_${a.status}` as AccessKey)}</li>)}
        </ul>
      </details>}

      <div className="flex flex-wrap gap-3 mt-6 pt-4 border-t border-slate-200 text-sm">
        <button className="underline" onClick={() => void signOut()} data-testid="sign-out">{t('sign_out')}</button>
        <button className="underline" onClick={() => void signOut(true)}>{t('sign_out_everywhere')}</button>
      </div>
    </AccessShell>
  );
}
