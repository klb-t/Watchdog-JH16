import { useEffect, useState } from 'react';
import { useAccess } from '../lib/access';
import { clientError, responseError } from '../lib/api_error';
import { useUiText } from '../lib/ui_text';
import text from '../../config/ui/access-admin.json';
import type { AdmissionInvitation, AdmissionRequest, InstallationGrant } from '../../shared/admission';
import type { Role } from '../../shared/authorization';

interface AdminData {
  requests:AdmissionRequest[];invitations:AdmissionInvitation[];grants:InstallationGrant[];roles:Role[];
  principals:{id:string;email:string;roles:Role[];active:boolean}[];
}
type Key = keyof typeof text.languages.en;

export default function AccessAdmin() {
  const access = useAccess();
  const { t, tCode, date, errorText } = useUiText(text);
  const canManage = access.capabilities.includes('principal.manage');
  const [data,setData] = useState<AdminData | null>(null);
  const [error,setError] = useState<unknown>(null);
  const [notice,setNotice] = useState<Key | ''>('');
  const [email,setEmail] = useState('');
  const [message,setMessage] = useState('');
  const [target,setTarget] = useState('');
  const [roles,setRoles] = useState<Role[]>(['researcher']);
  const [inviteLink,setInviteLink] = useState('');
  const [busy,setBusy] = useState(false);
  const roleLabel = (role: string) => tCode('role_', role);
  const load = async () => {
    const response = await fetch('/api/auth/admission/admin',{ cache:'no-store' });
    const body = await response.json();
    if (!response.ok) throw responseError(response, body);
    setData(body);
  };
  useEffect(() => { void load().catch(e => setError(e)); },[]);
  const post = async (path:string,body:unknown) => {
    const response = await fetch(`/api/auth/admission/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result = await response.json();
    if (!response.ok) throw responseError(response, result);
    return result;
  };
  const act = async (operation:() => Promise<unknown>,success:Key) => {
    setBusy(true);setError(null);setNotice('');
    try { await operation();await load();setNotice(success); }
    catch(e) { setError(e); }
    finally {setBusy(false);}
  };
  if (!access.capabilities.includes('principal.invite')) return <p className="p-6">{t('unavailable')}</p>;
  return <div className="p-6 max-w-5xl mx-auto space-y-6 min-w-0" data-testid="access-admin">
    <header><h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('intro')}</p></header>
    {error !== null && <p role="alert" className="text-sm text-red-700 break-words">{errorText(error)}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700">{t(notice)}</p>}
    <section className="rounded border bg-white p-4 space-y-3"><h2 className="font-semibold">{t('prepare_title')}</h2>
      <form className="space-y-3" onSubmit={e => {e.preventDefault();void act(async () => {
        const result = await post('invitations',{email,message});setInviteLink(new URL(result.invite_path,window.location.origin).href);
      },'created');}}>
        <label className="block text-sm">{t('email')}<input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
        <label className="block text-sm">{t('context')}<textarea maxLength={4000} value={message} onChange={e => setMessage(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
        <button disabled={busy} className="rounded bg-slate-900 text-white px-4 py-2">{t('create')}</button>
      </form>
      {inviteLink && <div className="space-y-2"><label className="block text-sm">{t('link_label')}<input readOnly value={inviteLink} className="block w-full rounded border p-2" /></label>
        <button className="underline text-sm" onClick={() => navigator.clipboard.writeText(inviteLink).then(() => setNotice('copied')).catch(() => setError(clientError('copy_failed', 'Select and copy the link above.')))}>{t('copy')}</button></div>}
    </section>
    <section className="rounded border bg-white p-4 space-y-3"><h2 className="font-semibold">{t('requests_title')}</h2>
      {!data?.requests.length && <p className="text-sm text-slate-500">{t('no_requests')}</p>}
      {data?.requests.map(request => <article key={request.principal_id} className="border-t pt-3 text-sm space-y-1 min-w-0">
        <p className="break-words"><strong>{request.email}</strong> · {tCode('request_status_', request.status)}</p><p className="whitespace-pre-wrap break-words">{request.reason}</p>
        <p className="text-xs text-slate-500">{t('updated', { date: date(request.updated_at) })}</p>
        {canManage && <div className="flex flex-wrap gap-3"><button className="underline" onClick={() => {setTarget(request.email);setRoles(['researcher']);}}>{t('choose_profiles')}</button>
          <button disabled={busy} className="underline text-red-700" onClick={() => act(() => post('grants',{email:request.email,roles:[],active:false}),'declined')}>{t('decline')}</button></div>}
      </article>)}
    </section>
    {canManage && <section className="rounded border bg-white p-4 space-y-3"><h2 className="font-semibold">{t('assign_title')}</h2>
      <form className="space-y-3" onSubmit={e => { e.preventDefault();void act(() => post('grants',{email:target,roles,active:true}),'granted'); }}>
        <label className="block text-sm">{t('grant_email')}<input type="email" required value={target} onChange={e => setTarget(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
        <fieldset className="flex flex-wrap gap-4"><legend className="text-sm font-medium mb-2">{t('profiles_legend')}</legend>
          {data?.roles.map(role => <label key={role} className="text-sm flex gap-1"><input type="checkbox" checked={roles.includes(role)} onChange={e => setRoles(e.target.checked ? [...roles,role] : roles.filter(r => r!==role))} />{roleLabel(role)}</label>)}
        </fieldset>
        <button disabled={busy || !roles.length} className="rounded bg-slate-900 text-white px-4 py-2">{t('grant')}</button>
      </form>
    </section>}
    <section className="rounded border bg-white p-4 space-y-3"><h2 className="font-semibold">{t('known_users')}</h2>
      {!data?.principals.length && <p className="text-sm text-slate-500">{t('no_users')}</p>}
      {data?.principals.map(person => <div key={person.id} className="flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
        <span className="grow min-w-0 break-words"><strong>{person.email}</strong> · {person.active && person.roles.length ? person.roles.map(roleLabel).join(', ') : t('no_access')}</span>
        {canManage && <><button className="underline" onClick={() => {setTarget(person.email);setRoles(person.roles.length ? person.roles : ['researcher']);}}>{t('edit_profiles')}</button>
          <button disabled={busy} className="underline text-red-700" onClick={() => act(() => post('grants',{email:person.email,roles:[],active:false}),'revoked')}>{t('revoke')}</button></>}
      </div>)}
    </section>
    <section className="rounded border bg-white p-4 space-y-3"><h2 className="font-semibold">{t('links_title')}</h2>
      {!data?.invitations.length && <p className="text-sm text-slate-500">{t('no_invitations')}</p>}
      {data?.invitations.map(invitation => <div key={invitation.id} className="flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
        <span className="grow min-w-0 break-words">{invitation.email} · {invitation.revoked_at ? t('inv_revoked') : invitation.accepted_at ? t('inv_accepted') : t('inv_expires', { date: date(invitation.expires_at) })}</span>
        {!invitation.revoked_at && <button disabled={busy} className="underline" onClick={() => act(() => post(`invitations/${invitation.id}/revoke`,{}),'link_revoked')}>{t('revoke_link')}</button>}
      </div>)}
    </section>
  </div>;
}
