import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAccess } from '../lib/access';
import { projectsApi as api } from '../lib/research_projects_client';
import { formClass, buttonClass, sectionClass } from '../lib/automation_client';
import bundle from '../../config/ui/research-projects.json';
import { useUiText } from '../lib/ui_text';
import type { ProjectDraft, ProjectLinkInput, ProjectLinkStatus, ProjectResourceKind, ProjectResourceSummary, ProjectRevision, ProjectSummary, ResearchProjectsProfile } from '../../shared/research_projects';

const emptyDraft: ProjectDraft = { name: '', question: '', purpose: '', state: 'DRAFT', meaning: 'unspecified', links: [] };
interface History { hash: string; createdAt: string; revision: number; name: string; state: ProjectDraft['state']; }
/** Page texts; profile options by id (the profile's text when an id has no label) and refusals by their stable reason. */
function useText() {
  const u = useUiText(bundle);
  const option = (prefix: 'state_' | 'meaning_' | 'meaning_desc_' | 'resource_', code: string, fallback: string | undefined) => { const s = u.tCode(prefix, code); return s === code ? fallback ?? code : s; };
  const failure = (e: unknown) => { const reason = (e as { vars?: Record<string, unknown> })?.vars?.reason;
    if ((e as { code?: unknown })?.code === 'research_project_error' && typeof reason === 'string') { const s = u.tCode('error_reason_', reason); if (s !== reason) return s; }
    return u.errorText(e); };
  return { ...u, option, failure };
}
export function ResearchProjects() {
  const access = useAccess(), [params] = useSearchParams();
  if (params.get('resourceKind') && params.get('resourceId')) return <ProjectResourcePreview key={`${access.principalId}:${params.get('resourceKind')}:${params.get('resourceId')}:${params.get('expectedHash')}`} kind={params.get('resourceKind')!} id={params.get('resourceId')!} expectedHash={params.get('expectedHash')} />;
  return <ResearchProjectsContent key={access.principalId ?? 'pending'} />;
}
function ProjectResourcePreview({ kind, id, expectedHash }: { kind: string; id: string; expectedHash: string | null }) {
  const [resource, setResource] = useState<(ProjectResourceSummary & { snapshot: Record<string, unknown> }) | null>(null), [error, setError] = useState<unknown>(null);
  const { t, failure } = useText();
  useEffect(() => { let active = true;
    api<{ resource: ProjectResourceSummary & { snapshot: Record<string, unknown> } }>(`/resources/${encodeURIComponent(kind)}/${encodeURIComponent(id)}${expectedHash ? `?expectedHash=${encodeURIComponent(expectedHash)}` : ''}`)
      .then(data => active && setResource(data.resource)).catch(e => active && setError(e));
    return () => { active = false; };
  }, [kind, id, expectedHash]);
  return <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-4"><Link className="underline" to="/projects">{t('back')}</Link>
    <h1 className="text-2xl font-semibold">{resource?.label ?? t('resource_fallback_title')}</h1>
    <p>{t('preview_note')}</p>
    {error !== null && <p role="alert" className="bg-red-50 p-3 text-red-800">{failure(error)}</p>}
    {!resource && error === null && <p role="status">{t('loading_resource')}</p>}
    {resource && <><p className="text-sm break-all">{t('resource_identity', { id: resource.id, hash: resource.hash })}</p>
      <pre className="text-sm whitespace-pre-wrap break-words border rounded p-4 max-h-[70vh] overflow-auto">{JSON.stringify(resource.snapshot, null, 2)}</pre></>}
  </div>;
}
function ResearchProjectsContent() {
  const [params, setParams] = useSearchParams(), id = params.get('id'), revisionHash = params.get('revision');
  const navigation = useRef(''); navigation.current = `${id ?? ''}:${revisionHash ?? ''}`;
  const [profile, setProfile] = useState<ResearchProjectsProfile | null>(null), [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [total, setTotal] = useState(0), [offset, setOffset] = useState(0), [draft, setDraft] = useState<ProjectDraft>({ ...emptyDraft });
  const [revision, setRevision] = useState<ProjectRevision | null>(null), [statuses, setStatuses] = useState<ProjectLinkStatus[]>([]), [history, setHistory] = useState<History[]>([]);
  const [kind, setKind] = useState<ProjectResourceKind>('paper'), [resources, setResources] = useState<ProjectResourceSummary[]>([]), [resourceTotal, setResourceTotal] = useState(0), [resourceOffset, setResourceOffset] = useState(0);
  const [selectedResource, setSelectedResource] = useState(''), [linkRole, setLinkRole] = useState(''), [linkNotes, setLinkNotes] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [notice, setNotice] = useState<{ key: 'notice_saved' | 'notice_selected'; revision?: number } | null>(null);
  const { t, option, failure, date } = useText();
  const readonly = !!revisionHash;
  const refresh = async () => { const data = await api<{ profile: ResearchProjectsProfile; projects: ProjectSummary[]; total: number }>(`?limit=50&offset=${offset}`);
    setProfile(data.profile); setProjects(data.projects); setTotal(data.total); };
  useEffect(() => { let active = true;
    api<{ profile: ResearchProjectsProfile; projects: ProjectSummary[]; total: number }>(`?limit=50&offset=${offset}`).then(data => {
      if (active) { setProfile(data.profile); setProjects(data.projects); setTotal(data.total); }
    }).catch(e => active && setError(e));
    return () => { active = false; };
  }, [offset]);
  useEffect(() => { let active = true; setError(null); setLoading(true); setRevision(null); setHistory([]); setStatuses([]); setDraft({ ...emptyDraft, links: [] });
    if (!id) { setLoading(false); return () => { active = false; }; }
    Promise.all([api<{ revision: ProjectRevision; statuses: ProjectLinkStatus[] }>(`/${encodeURIComponent(id)}${revisionHash ? `?revision=${encodeURIComponent(revisionHash)}` : ''}`), api<{ revisions: History[] }>(`/${encodeURIComponent(id)}/history`)]).then(([data, old]) => {
      if (!active) return; setRevision(data.revision); setStatuses(data.statuses); setHistory(old.revisions);
      const { name, question, purpose, state, meaning, links } = data.revision.body;
      setDraft({ name, question, purpose, state, meaning, links: links.map(({ kind, id, expectedHash, role, notes }) => ({ kind, id, expectedHash, role, notes })) });
    }).catch(e => active && setError(e)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [id, revisionHash]);
  useEffect(() => { let active = true; setResources([]); setSelectedResource('');
    api<{ resources: ProjectResourceSummary[]; total: number }>(`/resources?kind=${kind}&limit=50&offset=${resourceOffset}`).then(data => {
      if (active) { setResources(data.resources); setResourceTotal(data.total); }
    }).catch(e => active && setError(e));
    return () => { active = false; };
  }, [kind, resourceOffset]);
  const save = async () => {
    const startedAt = navigation.current;
    setBusy(true); setError(null); setNotice(null);
    try {
      const data = await api<{ revision: ProjectRevision }>(id ? `/${encodeURIComponent(id)}/revisions` : '', id ? { expectedHash: revision?.hash, draft } : draft);
      if (navigation.current !== startedAt) { await refresh(); return; }
      setRevision(data.revision); setNotice({ key: 'notice_saved', revision: data.revision.body.revision });
      await refresh();
      if (navigation.current !== startedAt) return;
      if (id) {
        const [older, live] = await Promise.all([api<{ revisions: History[] }>(`/${encodeURIComponent(id)}/history`), api<{ statuses: ProjectLinkStatus[] }>(`/${encodeURIComponent(id)}`)]);
        if (navigation.current !== startedAt) return;
        setHistory(older.revisions); setStatuses(live.statuses);
      } else setParams({ id: data.revision.body.projectId });
    } catch (e) { if (navigation.current === startedAt) setError(e); } finally { setBusy(false); }
  };
  const addResource = () => {
    const selected = resources.find(r => r.id === selectedResource); if (!selected) return;
    const link: ProjectLinkInput = { kind: selected.kind, id: selected.id, expectedHash: selected.hash, role: linkRole || profile!.defaultLinkRole, notes: linkNotes };
    setDraft({ ...draft, links: [...draft.links.filter(l => !(l.kind === link.kind && l.id === link.id)), link] });
    setLinkNotes(''); setNotice({ key: 'notice_selected' });
  };
  if (!profile) return <div className="p-6" role={error !== null ? 'alert' : 'status'}>{error !== null ? failure(error) : t('loading_projects')}</div>;
  return <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-5" data-testid="research-projects-page">
    <header><h1 className="text-2xl font-semibold">{t('profile_title')}</h1><p className="mt-2 text-slate-600">{t('profile_introduction')}</p></header>
    {error !== null && <p role="alert" className="bg-red-50 text-red-800 p-3 break-words">{failure(error)}</p>}
    {notice && <p role="status" className="bg-indigo-50 p-3">{t(notice.key, { revision: notice.revision ?? '' })}</p>}
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-5">
      <section className={sectionClass}><div className="flex flex-wrap gap-3 justify-between items-center"><h2 className="font-semibold">{t('my_projects', { count: total })}</h2><button className={buttonClass} disabled={busy} onClick={() => {
        setParams({}); setDraft({ ...emptyDraft, links: [] }); setRevision(null); setStatuses([]); setHistory([]); setNotice(null); setError(null); setLinkNotes(''); setLinkRole(''); setSelectedResource('');
      }}>{t('new_project')}</button></div>
        {projects.length === 0 && <p>{t('no_projects')}</p>}
        <ul className="space-y-3">{projects.map(p => <li key={p.id} className={`border p-3 rounded ${id === p.id ? 'border-indigo-600' : 'border-slate-200'}`}>
          <button className="underline font-medium text-left break-words" disabled={busy} onClick={() => setParams({ id: p.id })}>{p.name}</button>
          <p className="text-sm">{t('project_line', { state: option('state_', p.state.toLowerCase(), profile.stateLabels[p.state]), revision: p.revision })}</p><p className="text-xs text-slate-600 break-words">{p.question}</p>
        </li>)}</ul>
        <div className="flex flex-wrap gap-3 text-sm"><button className="underline disabled:opacity-40" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>{t('previous_page')}</button>
          <span>{t('range', { from: total ? offset + 1 : 0, to: Math.min(offset + 50, total), total })}</span><button className="underline disabled:opacity-40" disabled={busy || offset + 50 >= total} onClick={() => setOffset(offset + 50)}>{t('next_page')}</button></div>
      </section>
      <section className={sectionClass}>
        {loading ? <p role="status">{t('loading_revision')}</p> : <>
          <h2 className="font-semibold">{id ? t(readonly ? 'heading_saved' : 'heading_current', { revision: revision?.body.revision ?? '' }) : t('heading_new')}</h2>
          {readonly && <p className="text-sm bg-amber-50 p-2">{t('readonly_note')} <button className="underline" onClick={() => setParams({ id: id! })}>{t('go_current')}</button>.</p>}
          <fieldset disabled={readonly || busy || !!id && !revision} className="space-y-3 min-w-0">
            <label className="block">{t('name')}<input aria-label={t('name')} className={formClass} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} maxLength={160} /></label>
            <label className="block">{t('question')}<textarea aria-label={t('question')} className={formClass} rows={3} value={draft.question} onChange={e => setDraft({ ...draft, question: e.target.value })} maxLength={4000} /></label>
            <label className="block">{t('purpose')}<textarea aria-label={t('purpose')} className={formClass} rows={3} value={draft.purpose} onChange={e => setDraft({ ...draft, purpose: e.target.value })} maxLength={4000} /></label>
            <div className="grid sm:grid-cols-2 gap-3"><label>{t('state')}<select aria-label={t('state')} className={formClass} value={draft.state} onChange={e => setDraft({ ...draft, state: e.target.value as ProjectDraft['state'] })}>{Object.entries(profile.stateLabels).map(([k, label]) => <option key={k} value={k}>{option('state_', k.toLowerCase(), label)}</option>)}</select></label>
              <label>{t('meaning')}<select aria-label={t('meaning')} className={formClass} value={draft.meaning} onChange={e => setDraft({ ...draft, meaning: e.target.value as ProjectDraft['meaning'] })}>{Object.entries(profile.meaningLabels).map(([k, label]) => <option key={k} value={k}>{option('meaning_', k, label)}</option>)}</select></label></div>
            <p className="text-sm text-slate-600">{option('meaning_desc_', draft.meaning, profile.meaningDescriptions[draft.meaning])}</p>
          </fieldset>
          <div className="space-y-3"><h3 className="font-semibold">{t('linked', { count: draft.links.length })}</h3>
            {draft.links.length === 0 && <p className="text-sm">{t('no_links')}</p>}
            {draft.links.map(l => { const pinned = revision?.body.links.find(p => p.kind === l.kind && p.id === l.id), live = resources.find(r => r.kind === l.kind && r.id === l.id), status = statuses.find(s => s.kind === l.kind && s.id === l.id);
              return <article key={`${l.kind}:${l.id}`} className="rounded border p-3 space-y-2 break-words"><Link className="underline font-medium" to={pinned?.href ?? live?.href ?? '/research'}>{pinned?.label ?? live?.label ?? l.id}</Link>
                <p className="text-xs">{option('resource_', l.kind, profile.resourceLabels[l.kind])}{l.kind === 'schedule' ? t('schedule_pointer') : t('pinned_material')}</p>
                {status && <p className="text-xs">{status.status === 'CURRENT' ? t('link_current') : status.status === 'CHANGED' ? t('link_changed') : t('link_unavailable')}</p>}
                <p className="text-xs break-all">{t('sha', { hash: l.expectedHash })}</p>
                <label className="block text-sm">{t('role')}<input aria-label={t('role')} className={formClass} disabled={readonly || busy} value={l.role} onChange={e => setDraft({ ...draft, links: draft.links.map(v => v === l ? { ...v, role: e.target.value } : v) })} /></label>
                <label className="block text-sm">{t('notes')}<textarea aria-label={t('notes')} className={formClass} disabled={readonly || busy} rows={2} value={l.notes} onChange={e => setDraft({ ...draft, links: draft.links.map(v => v === l ? { ...v, notes: e.target.value } : v) })} /></label>
                {!readonly && <button className="underline text-sm" disabled={busy} onClick={() => setDraft({ ...draft, links: draft.links.filter(v => v !== l) })}>{t('remove')}</button>}
                {pinned && <details><summary className="text-sm">{t('provenance')}</summary><p className="text-xs break-all">{t('files_line', { count: pinned.files.length, hash: pinned.snapshotHash })}</p><pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{JSON.stringify(pinned.snapshot, null, 2)}</pre></details>}
              </article>; })}
          </div>
          {!readonly && <fieldset disabled={busy || draft.links.length >= 50 || !!id && !revision} className="space-y-3 border-t pt-3 min-w-0"><legend className="font-semibold">{t('add_title')}</legend>
            <label className="block">{t('kind')}<select aria-label={t('kind')} className={formClass} value={kind} onChange={e => { setKind(e.target.value as ProjectResourceKind); setResourceOffset(0); }}>{Object.entries(profile.resourceLabels).map(([k, label]) => <option key={k} value={k}>{option('resource_', k, label)}</option>)}</select></label>
            <label className="block">{t('choose_version')}<select aria-label={t('choose_version')} className={formClass} value={selectedResource} onChange={e => setSelectedResource(e.target.value)}><option value="">{t('choose_placeholder')}</option>{resources.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
            <div className="flex flex-wrap gap-3 text-xs"><button className="underline disabled:opacity-40" disabled={resourceOffset === 0} onClick={() => setResourceOffset(Math.max(0, resourceOffset - 50))}>{t('previous_page')}</button><span>{t('range', { from: resourceTotal ? resourceOffset + 1 : 0, to: Math.min(resourceOffset + 50, resourceTotal), total: resourceTotal })}</span><button className="underline disabled:opacity-40" disabled={resourceOffset + 50 >= resourceTotal} onClick={() => setResourceOffset(resourceOffset + 50)}>{t('next_page')}</button></div>
            {resourceTotal === 0 && <p className="text-sm">{t('no_resources')} <Link className="underline" to={kind === 'schedule' || kind === 'job' ? '/automation' : kind === 'dataset' || kind === 'figure' ? '/workbench' : '/research'}>{t('open_workshop')}</Link>.</p>}
            <label className="block">{t('link_role')}<input aria-label={t('link_role')} className={formClass} value={linkRole} placeholder={profile.defaultLinkRole} onChange={e => setLinkRole(e.target.value)} /></label>
            <label className="block">{t('link_notes')}<textarea aria-label={t('link_notes')} className={formClass} rows={2} value={linkNotes} onChange={e => setLinkNotes(e.target.value)} /></label>
            <button className={buttonClass} disabled={!selectedResource} onClick={addResource}>{t('attach')}</button>
          </fieldset>}
          <div className="flex flex-wrap gap-3">{!readonly && <button className={buttonClass} disabled={busy || loading || !draft.name.trim() || !draft.question.trim() || !!id && !revision} onClick={() => void save()}>{t('save')}</button>}
            {revision && <a className="underline text-sm self-center" href={`/api/projects/${encodeURIComponent(revision.body.projectId)}/export?revision=${revision.hash}`}>{t('export')}</a>}</div>
          {revision && <p className="text-xs break-all">{t('package_hash', { hash: revision.hash })}</p>}
          {history.length > 0 && <details><summary>{t('history', { count: history.length })}</summary><ul className="mt-2 space-y-2">{history.map(r => <li key={r.hash}><button className="underline text-sm" disabled={busy} onClick={() => setParams({ id: id!, revision: r.hash })}>{t('history_item', { revision: r.revision, state: option('state_', r.state.toLowerCase(), profile.stateLabels[r.state]), date: date(r.createdAt) })}</button><p className="text-xs break-all">{r.hash}</p></li>)}</ul></details>}
        </>}
      </section>
    </div>
  </div>;
}
