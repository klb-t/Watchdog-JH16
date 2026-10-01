import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { postJson, useAccess } from '../lib/access';
import { useAccessText, type AccessKey } from '../lib/access_i18n';

interface GrantSource { kind: 'environment' | 'grant'; source: string; roles: string[]; expiresAt: string | null }
interface Member {
  email: string; principalId: string | null; displayName: string | null; roles: string[]; sources: GrantSource[];
  active: boolean; lastSeenAt: string | null; signInMethods: string[]; modifiable: boolean; notModifiableReason: string | null;
}
interface ApplicationRow {
  id: string; email: string; display_name: string | null; affiliation: string | null; reason: string;
  requested_roles: string[]; status: string; submitted_at: string; decision_note: string | null;
}
interface Invitation {
  id: string; kind: 'email' | 'open_link'; email: string | null; roles: string[]; note: string | null;
  maxUses: number; uses: number; expiresAt: string; status: 'active' | 'expired' | 'revoked' | 'used_up';
  deliveryStatus: 'draft' | 'link_shared' | 'sent' | 'send_failed'; deliveryDetail: string | null;
  redeemedBy: { email: string; redeemedAt: string }[];
}
interface Overview {
  members: Member[]; applications: ApplicationRow[]; invitations: Invitation[];
  grantable_roles: string[]; open_link_roles: string[];
  limits: { defaultExpiryDays: number; maxExpiryDays: number; maxOpenLinkUses: number };
  mail: { available: boolean; remediation: string; public_url: string | null };
  languages: string[]; default_language: string;
}
interface Fresh { invitation: Invitation; token: string; link: string | null; draft: { subject: string; body: string } | null }

type Run = (fn: () => Promise<unknown>, success?: string) => Promise<void>;

/** `dev` is a compatibility alias of `developer`; offering both would only confuse. */
const visible = (roles: string[]) => roles.filter(r => r !== 'dev');

function RolePicker({ options, value, onChange, testId }: {
  options: string[]; value: string[]; onChange: (v: string[]) => void; testId?: string;
}) {
  const { role } = useAccessText();
  return <div className="flex flex-wrap gap-2" data-testid={testId}>
    {visible(options).map(r => <label key={r} className="inline-flex items-center gap-1 border border-slate-300 rounded px-2 py-1 text-sm bg-white">
      <input type="checkbox" checked={value.includes(r)} data-role={r}
        onChange={e => onChange(e.target.checked ? [...value, r] : value.filter(x => x !== r))} />
      {role(r)}
    </label>)}
  </div>;
}

/**
 * People & access (E4.5). Everything here is enforced again on the server,
 * which re-derives the administrator's own rights on every call; the role
 * lists offered are just the ones that would succeed.
 */
export function PeopleAccess() {
  const access = useAccess();
  const { t, lang } = useAccessText();
  const [tab, setTab] = useState<'invite' | 'applications' | 'members' | 'invitations'>('invite');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => fetch('/api/access/overview', { cache: 'no-store' })
    .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error?.message ?? `HTTP ${r.status}`); return r.json(); })
    .then(setData).catch(e => setError((e as Error).message)), []);
  useEffect(() => { void load(); }, [load]);

  const run: Run = async (fn, success) => {
    setError(null); setNotice(null);
    try { await fn(); if (success) setNotice(success); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  const canAdmit = access.capabilities.includes('access.admit');
  const pendingCount = data?.applications.filter(a => a.status === 'pending').length ?? 0;
  const tabs: [typeof tab, string][] = [
    ...(canAdmit ? [['invite', t('tab_invite')] as [typeof tab, string]] : []),
    ['applications', `${t('tab_applications')}${pendingCount ? ` (${pendingCount})` : ''}`],
    ['members', t('tab_members')],
    ['invitations', t('tab_invitations')],
  ];

  return (
    <div className="field-page max-w-4xl" data-testid="people-access">
      <h1>{t('people_title')}</h1>
      <p className="text-sm text-slate-600 mt-1">{t('people_intro')}</p>
      {canAdmit && <ProfileName />}

      <div className="flex flex-wrap gap-2 mt-4" role="tablist">
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} aria-pressed={tab === id}
          className="field-button" onClick={() => setTab(id)} data-testid={`tab-${id}`}>{label}</button>)}
      </div>

      {error && <p className="field-error" role="alert" data-testid="access-error">{error}</p>}
      {notice && <p className="field-warning" role="status">{notice}</p>}
      {!data && !error && <p className="mt-4" role="status">{t('working')}</p>}

      {data && tab === 'invite' && canAdmit && <InviteForm data={data} lang={lang} onDone={load} />}
      {data && tab === 'applications' && <Applications data={data} canAdmit={canAdmit} run={run} />}
      {data && tab === 'members' && <Members data={data} run={run} />}
      {data && tab === 'invitations' && <Invitations data={data} canAdmit={canAdmit} run={run} lang={lang} load={load}
        onError={setError} />}

      {access.capabilities.includes('principal.manage') && <ClaimLocalUser />}
    </div>
  );

}


function Applications({ data, canAdmit, run }: { data: Overview; canAdmit: boolean; run: Run }) {
  const { t, date } = useAccessText();
  const pending = data.applications.filter(a => a.status === 'pending');
  return <section className="mt-4 space-y-3">
    {pending.length === 0 && <p className="text-sm text-slate-600">{t('applications_empty')}</p>}
    {pending.map(a => <ApplicationCard key={a.id} a={a} data={data} canAdmit={canAdmit} run={run} />)}
    {data.applications.some(a => a.status !== 'pending') && <details className="text-sm">
      <summary>{t('apply_history')}</summary>
      <ul className="mt-2 space-y-1">{data.applications.filter(a => a.status !== 'pending').map(a =>
        <li key={a.id}>{a.email} — {t(`status_${a.status}` as AccessKey)} ({date(a.submitted_at)})</li>)}</ul>
    </details>}
  </section>;
}

function ApplicationCard({ a, data, canAdmit, run }: { a: ApplicationRow; data: Overview; canAdmit: boolean; run: Run }) {
  const { t, date } = useAccessText();
  const [roles, setRoles] = useState<string[]>(a.requested_roles.filter(r => data.grantable_roles.includes(r)));
  const [note, setNote] = useState('');
  return <article className="field-panel" data-testid={`application-${a.email}`}>
    <p className="font-medium">{a.display_name ?? a.email} <span className="text-sm text-slate-500">{a.email}</span></p>
    {a.affiliation && <p className="text-sm text-slate-600">{a.affiliation}</p>}
    <p className="mt-2 whitespace-pre-wrap text-sm">{a.reason}</p>
    <p className="text-xs text-slate-500 mt-1">{date(a.submitted_at)}</p>
    {canAdmit && <div className="mt-3 space-y-2">
      <RolePicker options={data.grantable_roles} value={roles} onChange={setRoles} testId="approve-roles" />
      <label className="field-control">{t('application_note')}
        <input value={note} onChange={e => setNote(e.target.value)} maxLength={1000} />
      </label>
      <div className="flex gap-2">
        <button className="field-button primary" disabled={roles.length === 0} data-testid="approve"
          onClick={() => void run(() => postJson(`/api/access/applications/${a.id}/approve`, { roles, note }))}>{t('application_approve')}</button>
        <button className="field-button" data-testid="deny"
          onClick={() => void run(() => postJson(`/api/access/applications/${a.id}/deny`, { note }))}>{t('application_deny')}</button>
      </div>
    </div>}
  </article>;
}

function Members({ data, run }: { data: Overview; run: Run }) {
  const { t } = useAccessText();
  return <section className="mt-4 space-y-3">
    {data.members.length === 0 && <p className="text-sm text-slate-600">{t('members_empty')}</p>}
    {data.members.map(m => <MemberCard key={m.email} m={m} data={data} run={run} />)}
  </section>;
}

function MemberCard({ m, data, run }: { m: Member; data: Overview; run: Run }) {
  const { t, role, date } = useAccessText();
  const [editing, setEditing] = useState(false);
  const uiRoles = m.sources.filter(s => s.kind === 'grant').flatMap(s => s.roles);
  const [roles, setRoles] = useState<string[]>(uiRoles);
  const fromEnv = m.sources.some(s => s.kind === 'environment');
  return <article className="field-panel" data-testid={`member-${m.email}`}>
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="font-medium">{m.displayName ?? m.email}</span>
      {m.displayName && <span className="text-sm text-slate-500">{m.email}</span>}
      {!m.active && <span className="evidence-badge text-rose-700">{t('member_blocked')}</span>}
    </div>
    <p className="text-sm mt-1">{visible(m.roles).map(role).join(', ') || t('roles_none')}</p>
    <p className="text-xs text-slate-500 mt-1">
      {m.lastSeenAt ? t('member_last_seen', { date: date(m.lastSeenAt) }) : t('member_never')}
      {m.signInMethods.length > 0 && ` · ${m.signInMethods.join(', ')}`}
    </p>
    {fromEnv && <p className="text-xs text-slate-500 mt-1">{t('member_from_env')}</p>}
    {m.modifiable ? <div className="mt-3 space-y-2">
      {editing ? <>
        <RolePicker options={data.grantable_roles} value={roles} onChange={setRoles} testId="member-roles" />
        <button className="field-button primary" disabled={roles.length === 0} data-testid="member-save"
          onClick={() => void run(() => postJson('/api/access/members/roles', { email: m.email, roles }))
            .then(() => setEditing(false))}>{t('member_save')}</button>
      </> : <div className="flex flex-wrap gap-2">
        <button className="field-button" onClick={() => setEditing(true)} data-testid="member-edit">{t('member_edit')}</button>
        {uiRoles.length > 0 && <button className="field-button" data-testid="member-revoke" onClick={() => {
          if (window.confirm(t('member_confirm_revoke', { email: m.email }))) void run(() => postJson('/api/access/members/revoke', { email: m.email }));
        }}>{t('member_revoke')}</button>}
        {m.active ? <button className="field-button" data-testid="member-block" onClick={() => {
          if (window.confirm(t('member_confirm_revoke', { email: m.email }))) void run(() => postJson('/api/access/members/revoke', { email: m.email, block: true }));
        }}>{t('member_block')}</button>
          : <button className="field-button" onClick={() => void run(() => postJson('/api/access/members/unblock', { email: m.email }))}>{t('member_unblock')}</button>}
      </div>}
    </div> : m.notModifiableReason && <p className="text-xs text-slate-500 mt-2">{m.notModifiableReason}</p>}
  </article>;
}

function Invitations({ data, canAdmit, run, lang, load, onError }: { data: Overview; canAdmit: boolean; run: Run; lang: string;
  load: () => void; onError: (message: string) => void }) {
  const { t, role, date } = useAccessText();
  const [fresh, setFresh] = useState<Fresh | null>(null);
  return <section className="mt-4 space-y-3">
    {fresh && <FreshInvitation fresh={fresh} data={data} lang={lang} onChange={load} />}
    {data.invitations.length === 0 && <p className="text-sm text-slate-600">{t('invitations_empty')}</p>}
    {data.invitations.map(i => <article key={i.id} className="field-panel text-sm" data-testid={`invitation-${i.id}`}>
      <p className="font-medium">{i.kind === 'email' ? i.email : t('invite_kind_open')} — {visible(i.roles).map(role).join(', ')}</p>
      <p className="text-xs text-slate-600 mt-1">
        {t(`inv_status_${i.status}` as AccessKey)} · {t(`delivery_${i.deliveryStatus}` as AccessKey)} · {t('uses_of', { uses: i.uses, max: i.maxUses })} · {t('join_expires', { date: date(i.expiresAt) })}
      </p>
      {i.redeemedBy.length > 0 && <p className="text-xs text-slate-600">{t('used_by', { list: i.redeemedBy.map(r => r.email).join(', ') })}</p>}
      {i.deliveryDetail && <p className="text-xs text-slate-500">{i.deliveryDetail}</p>}
      {canAdmit && i.status === 'active' && <div className="flex flex-wrap gap-2 mt-2">
        <button className="field-button" onClick={() => void postJson<Fresh>(`/api/access/invitations/${i.id}/rotate`,
          { link_base: window.location.origin, language: lang }).then(setFresh).then(load).catch(e => onError((e as Error).message))}>
          {t('invite_new_link')}</button>
        <button className="field-button" data-testid="invitation-revoke"
          onClick={() => void run(() => postJson(`/api/access/invitations/${i.id}/revoke`))}>{t('invite_revoke')}</button>
      </div>}
    </article>)}
  </section>;
}

function InviteForm({ data, lang, onDone }: { data: Overview; lang: string; onDone: () => void }) {
  const { t, languageName } = useAccessText();
  const [kind, setKind] = useState<'email' | 'open_link'>('email');
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [days, setDays] = useState(data.limits.defaultExpiryDays);
  const [uses, setUses] = useState(1);
  const [language, setLanguage] = useState(data.languages.includes(lang) ? lang : data.default_language);
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = kind === 'email' ? data.grantable_roles : data.open_link_roles;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      setFresh(await postJson<Fresh>('/api/access/invitations', {
        kind, email: kind === 'email' ? email : undefined, roles: roles.filter(r => options.includes(r)), note,
        expires_in_days: days, max_uses: kind === 'open_link' ? uses : undefined,
        link_base: window.location.origin, language,
      }));
      onDone();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (fresh) return <div className="mt-4 space-y-3">
    <FreshInvitation fresh={fresh} data={data} lang={language} onChange={onDone} />
    <button className="field-button" onClick={() => { setFresh(null); setEmail(''); setRoles([]); setNote(''); }}>{t('invite_create')}</button>
  </div>;

  return <form onSubmit={submit} className="field-panel space-y-4" data-testid="invite-form">
    <fieldset>
      <legend className="font-semibold text-sm mb-2">{t('invite_kind')}</legend>
      <div className="grid sm:grid-cols-2 gap-2">
        {(['email', 'open_link'] as const).map(k => <label key={k}
          className={`border rounded p-3 cursor-pointer text-sm ${kind === k ? 'border-indigo-600 bg-indigo-50' : 'border-slate-300'}`}>
          <input type="radio" name="kind" className="mr-2" checked={kind === k} onChange={() => setKind(k)} data-testid={`kind-${k}`} />
          <span className="font-medium">{t(k === 'email' ? 'invite_kind_email' : 'invite_kind_open')}</span>
          <span className="block text-xs text-slate-600 mt-1">{t(k === 'email' ? 'invite_kind_email_hint' : 'invite_kind_open_hint')}</span>
        </label>)}
      </div>
    </fieldset>
    {kind === 'email' && <label className="field-control">{t('invite_email')}
      <input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" data-testid="invite-email" />
    </label>}
    <fieldset>
      <legend className="font-semibold text-sm mb-2">{t('invite_roles')}</legend>
      <RolePicker options={options} value={roles} onChange={setRoles} testId="invite-roles" />
    </fieldset>
    <label className="field-control">{t('invite_note')}
      <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={1000} />
    </label>
    <div className="grid sm:grid-cols-3 gap-3">
      <label className="field-control">{t('invite_days')}
        <input type="number" min={1} max={data.limits.maxExpiryDays} value={days} onChange={e => setDays(Number(e.target.value))} />
      </label>
      {kind === 'open_link' && <label className="field-control">{t('invite_uses')}
        <input type="number" min={1} max={data.limits.maxOpenLinkUses} value={uses} onChange={e => setUses(Number(e.target.value))} data-testid="invite-uses" />
      </label>}
      <label className="field-control">{t('invite_language')}
        <select value={language} onChange={e => setLanguage(e.target.value)}>
          {data.languages.map(l => <option key={l} value={l}>{languageName(l as never)}</option>)}
        </select>
      </label>
    </div>
    <button className="field-button primary w-full sm:w-auto" disabled={busy || roles.filter(r => options.includes(r)).length === 0 || (kind === 'email' && !email)}
      data-testid="invite-create">{busy ? t('working') : t('invite_create')}</button>
    {error && <p className="field-error" role="alert" data-testid="invite-error">{error}</p>}
  </form>;
}

/** The one moment the link exists in plain text: copy it, share it, mail it, or have the server send it. */
function FreshInvitation({ fresh, data, lang, onChange }: { fresh: Fresh; data: Overview; lang: string; onChange: () => void }) {
  const { t } = useAccessText();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState('');
  const { invitation, token, link, draft } = fresh;
  const whole = draft ? `${draft.subject}\n\n${draft.body}` : link ?? '';

  const recordShared = (via: string) => void postJson(`/api/access/invitations/${invitation.id}/shared`, { via }).then(onChange).catch(() => {});
  const copy = async (text: string, via: string) => {
    try { await navigator.clipboard.writeText(text); setMessage(t('invite_copied')); recordShared(via); }
    catch { setError('Copy is not available in this browser; select the text below.'); }
  };
  const share = async () => {
    try { await navigator.share({ title: draft?.subject, text: draft?.body ?? link ?? '' }); recordShared('share'); }
    catch { /* dismissed by the user */ }
  };
  const send = async () => {
    setError(null);
    try {
      const r = await postJson<{ sent_to: string }>(`/api/access/invitations/${invitation.id}/send`,
        { token, language: lang, to: invitation.kind === 'open_link' ? sendTo : undefined });
      setMessage(t('invite_sent', { email: r.sent_to })); onChange();
    } catch (e) { setError((e as Error).message); }
  };
  const mailto = invitation.kind === 'email' && draft
    ? `mailto:${encodeURIComponent(invitation.email!)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`
    : draft ? `mailto:?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}` : null;

  return <article className="field-panel border-indigo-300 space-y-3" data-testid="fresh-invitation">
    <p className="text-sm font-medium">{t('invite_ready')}</p>
    {link && <input readOnly value={link} className="field-input w-full font-mono text-xs" onFocus={e => e.currentTarget.select()} data-testid="invite-link" />}
    <div className="flex flex-wrap gap-2">
      {link && <button className="field-button primary" onClick={() => void copy(link, 'copy_link')} data-testid="copy-link">{t('invite_copy')}</button>}
      {draft && <button className="field-button" onClick={() => void copy(whole, 'copy_message')}>{t('invite_copy_message')}</button>}
      {'share' in navigator && <button className="field-button" onClick={() => void share()}>{t('invite_share')}</button>}
      {mailto && <a className="field-button" href={mailto} onClick={() => recordShared('mailto')}>{t('invite_mailto')}</a>}
    </div>
    {data.mail.available && data.mail.public_url ? <div className="flex flex-wrap gap-2 items-end">
      {invitation.kind === 'open_link' && <label className="field-control">{t('invite_email')}
        <input type="email" value={sendTo} onChange={e => setSendTo(e.target.value)} />
      </label>}
      <button className="field-button" onClick={() => void send()} disabled={invitation.kind === 'open_link' && !sendTo}
        data-testid="send-invitation">{t('invite_send')}</button>
    </div> : <p className="text-xs text-slate-600" data-testid="mail-unavailable">
      {t('invite_mail_unavailable', { reason: data.mail.available ? 'WATCHDOG_PUBLIC_URL is not set.' : data.mail.remediation })}</p>}
    {draft && <details className="text-sm"><summary>{t('invite_draft')}</summary>
      <pre className="whitespace-pre-wrap text-xs bg-slate-50 p-3 rounded mt-2" data-testid="invite-draft">{whole}</pre></details>}
    {message && <p className="text-sm text-emerald-700" role="status">{message}</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </article>;
}

/** How invitations are signed: the administrator's own name rather than their address. */
function ProfileName() {
  const { t } = useAccessText();
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void fetch('/api/auth/me', { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
      .then(d => setName(d?.principal?.display_name ?? '')).catch(() => {});
  }, []);
  return <form className="flex flex-wrap items-end gap-2 mt-3" onSubmit={e => {
    e.preventDefault();
    void postJson('/api/auth/profile', { display_name: name }).then(() => setSaved(true));
  }}>
    <label className="field-control flex-1 min-w-56">{t('profile_name')}
      <input value={name} maxLength={200} autoComplete="name" onChange={e => { setName(e.target.value); setSaved(false); }}
        data-testid="profile-name" />
    </label>
    <button className="field-button" data-testid="profile-save">{t('profile_save')}</button>
    {saved && <span className="text-sm text-emerald-700" role="status">{t('profile_saved')}</span>}
  </form>;
}

function ClaimLocalUser() {
  const { t } = useAccessText();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return <section className="field-panel mt-8 text-sm">
    <h2>{t('claim_title')}</h2>
    <p className="mt-1 text-slate-600">{t('claim_body')}</p>
    <button className="field-button mt-3" onClick={() => void postJson<{ moved: Record<string, number> }>('/api/auth/principals/migrate-local-user')
      .then(r => setResult(t('claim_done', { count: Object.values(r.moved).reduce((a, b) => a + b, 0) })))
      .catch(e => setError((e as Error).message))}>{t('claim_button')}</button>
    {result && <p className="mt-2 text-emerald-700">{result}</p>}
    {error && <p className="field-error">{error}</p>}
  </section>;
}
