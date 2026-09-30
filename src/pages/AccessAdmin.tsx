import { useEffect, useState } from 'react';
import { useAccess } from '../lib/access';
import type { AdmissionInvitation, AdmissionRequest, InstallationGrant } from '../../shared/admission';
import type { Role } from '../../shared/authorization';

interface AdminData {
  requests:AdmissionRequest[];invitations:AdmissionInvitation[];grants:InstallationGrant[];roles:Role[];
  principals:{id:string;email:string;roles:Role[];active:boolean}[];
}

export default function AccessAdmin() {
  const access = useAccess();
  const canManage = access.capabilities.includes('principal.manage');
  const [data,setData] = useState<AdminData | null>(null);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [email,setEmail] = useState('');
  const [message,setMessage] = useState('');
  const [target,setTarget] = useState('');
  const [roles,setRoles] = useState<Role[]>(['researcher']);
  const [inviteLink,setInviteLink] = useState('');
  const [busy,setBusy] = useState(false);
  const load = async () => {
    const response = await fetch('/api/auth/admission/admin',{ cache:'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? 'Access management unavailable.');
    setData(body);
  };
  useEffect(() => { void load().catch(e => setError(e.message)); },[]);
  const post = async (path:string,body:unknown) => {
    const response = await fetch(`/api/auth/admission/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? 'The action could not be completed.');
    return result;
  };
  const act = async (operation:() => Promise<unknown>,success:string) => {
    setBusy(true);setError('');setNotice('');
    try { await operation();await load();setNotice(success); }
    catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally {setBusy(false);}
  };
  if (!access.capabilities.includes('principal.invite')) return <p className="p-6">Access unavailable.</p>;
  return <div className="p-6 max-w-5xl mx-auto space-y-6" data-testid="access-admin">
    <header><h1 className="text-2xl font-semibold">Installation access</h1>
      <p className="mt-2 text-sm text-slate-600">Invitations bind to a verified email and create an access request. A developer approves profiles. Revoking access affects existing sessions immediately.</p></header>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    <section className="rounded border bg-white p-4 space-y-3"><h2 className="font-semibold">Prepare an invitation</h2>
      <form className="space-y-3" onSubmit={e => {e.preventDefault();void act(async () => {
        const result = await post('invitations',{email,message});setInviteLink(new URL(result.invite_path,window.location.origin).href);
      },'Invitation created. Copy the link to share it.');}}>
        <label className="block text-sm">Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
        <label className="block text-sm">Invitation context<textarea maxLength={4000} value={message} onChange={e => setMessage(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
        <button disabled={busy} className="rounded bg-slate-900 text-white px-4 py-2">Create invitation</button>
      </form>
      {inviteLink && <div className="space-y-2"><label className="block text-sm">Invitation link (shown only now)<input readOnly value={inviteLink} className="block w-full rounded border p-2" /></label>
        <button className="underline text-sm" onClick={() => navigator.clipboard.writeText(inviteLink).then(() => setNotice('Link copied.')).catch(() => setError('Select and copy the link above.'))}>Copy link</button></div>}
    </section>
    <section className="rounded border bg-white p-4 space-y-3"><h2 className="font-semibold">Access requests</h2>
      {!data?.requests.length && <p className="text-sm text-slate-500">No requests.</p>}
      {data?.requests.map(request => <article key={request.principal_id} className="border-t pt-3 text-sm space-y-1">
        <p><strong>{request.email}</strong> · {request.status}</p><p className="whitespace-pre-wrap">{request.reason}</p>
        <p className="text-xs text-slate-500">Updated {request.updated_at}</p>
        {canManage && <div className="flex gap-3"><button className="underline" onClick={() => {setTarget(request.email);setRoles(['researcher']);}}>Choose profiles below</button>
          <button disabled={busy} className="underline text-red-700" onClick={() => act(() => post('grants',{email:request.email,roles:[],active:false}),'Request declined and access revoked.')}>Decline</button></div>}
      </article>)}
    </section>
    {canManage && <section className="rounded border bg-white p-4 space-y-3"><h2 className="font-semibold">Assign profiles</h2>
      <form className="space-y-3" onSubmit={e => { e.preventDefault();void act(() => post('grants',{email:target,roles,active:true}),'Profiles granted.'); }}>
        <label className="block text-sm">Verified email to grant<input type="email" required value={target} onChange={e => setTarget(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
        <fieldset className="flex flex-wrap gap-4"><legend className="text-sm font-medium mb-2">Profiles combine capabilities</legend>
          {data?.roles.map(role => <label key={role} className="text-sm flex gap-1"><input type="checkbox" checked={roles.includes(role)} onChange={e => setRoles(e.target.checked ? [...roles,role] : roles.filter(r => r!==role))} />{role}</label>)}
        </fieldset>
        <button disabled={busy || !roles.length} className="rounded bg-slate-900 text-white px-4 py-2">Grant selected profiles</button>
      </form>
    </section>}
    <section className="rounded border bg-white p-4 space-y-3"><h2 className="font-semibold">Known users</h2>
      {!data?.principals.length && <p className="text-sm text-slate-500">No Google identities have signed in.</p>}
      {data?.principals.map(person => <div key={person.id} className="flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
        <span className="grow"><strong>{person.email}</strong> · {person.active && person.roles.length ? person.roles.join(', ') : 'no access'}</span>
        {canManage && <><button className="underline" onClick={() => {setTarget(person.email);setRoles(person.roles.length ? person.roles : ['researcher']);}}>Edit profiles</button>
          <button disabled={busy} className="underline text-red-700" onClick={() => act(() => post('grants',{email:person.email,roles:[],active:false}),'Access revoked. Existing sessions no longer have access.')}>Revoke access</button></>}
      </div>)}
    </section>
    <section className="rounded border bg-white p-4 space-y-3"><h2 className="font-semibold">Invitation links</h2>
      {!data?.invitations.length && <p className="text-sm text-slate-500">No invitations.</p>}
      {data?.invitations.map(invitation => <div key={invitation.id} className="flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
        <span className="grow">{invitation.email} · {invitation.revoked_at ? 'revoked' : invitation.accepted_at ? 'accepted; approval still required' : `expires ${invitation.expires_at}`}</span>
        {!invitation.revoked_at && <button disabled={busy} className="underline" onClick={() => act(() => post(`invitations/${invitation.id}/revoke`,{}),'Invitation link revoked. User grants are managed separately.')}>Revoke link</button>}
      </div>)}
    </section>
  </div>;
}
