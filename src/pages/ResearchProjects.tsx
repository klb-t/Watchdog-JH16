import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAccess } from '../lib/access';
import { projectsApi as api } from '../lib/research_projects_client';
import { formClass, buttonClass, sectionClass } from '../lib/automation_client';
import type { ProjectDraft, ProjectLinkInput, ProjectLinkStatus, ProjectResourceKind, ProjectResourceSummary, ProjectRevision, ProjectSummary, ResearchProjectsProfile } from '../../shared/research_projects';

const emptyDraft: ProjectDraft = { name: '', question: '', purpose: '', state: 'DRAFT', meaning: 'unspecified', links: [] };
interface History { hash: string; createdAt: string; revision: number; name: string; state: ProjectDraft['state']; }
export function ResearchProjects() {
  const access = useAccess(), [params] = useSearchParams();
  if (params.get('resourceKind') && params.get('resourceId')) return <ProjectResourcePreview key={`${access.principalId}:${params.get('resourceKind')}:${params.get('resourceId')}:${params.get('expectedHash')}`} kind={params.get('resourceKind')!} id={params.get('resourceId')!} expectedHash={params.get('expectedHash')} />;
  return <ResearchProjectsContent key={access.principalId ?? 'pending'} />;
}
function ProjectResourcePreview({ kind, id, expectedHash }: { kind: string; id: string; expectedHash: string | null }) {
  const [resource, setResource] = useState<(ProjectResourceSummary & { snapshot: Record<string, unknown> }) | null>(null), [error, setError] = useState('');
  useEffect(() => { let active = true;
    api<{ resource: ProjectResourceSummary & { snapshot: Record<string, unknown> } }>(`/resources/${encodeURIComponent(kind)}/${encodeURIComponent(id)}${expectedHash ? `?expectedHash=${encodeURIComponent(expectedHash)}` : ''}`)
      .then(data => active && setResource(data.resource)).catch(e => active && setError(e.message));
    return () => { active = false; };
  }, [kind, id, expectedHash]);
  return <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-4"><Link className="underline" to="/projects">Wróć do pakietów badań</Link>
    <h1 className="text-2xl font-semibold">{resource?.label ?? 'Zapisany materiał badawczy'}</h1>
    <p>Podgląd dokładnego własnego materiału. Ten widok nie zatwierdza metody ani nie uruchamia obliczeń.</p>
    {error && <p role="alert" className="bg-red-50 p-3 text-red-800">{error}</p>}
    {!resource && !error && <p role="status">Wczytywanie materiału…</p>}
    {resource && <><p className="text-sm break-all">Identyfikator: {resource.id} · SHA-256: {resource.hash}</p>
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
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const readonly = !!revisionHash;
  const refresh = async () => { const data = await api<{ profile: ResearchProjectsProfile; projects: ProjectSummary[]; total: number }>(`?limit=50&offset=${offset}`);
    setProfile(data.profile); setProjects(data.projects); setTotal(data.total); };
  useEffect(() => { let active = true;
    api<{ profile: ResearchProjectsProfile; projects: ProjectSummary[]; total: number }>(`?limit=50&offset=${offset}`).then(data => {
      if (active) { setProfile(data.profile); setProjects(data.projects); setTotal(data.total); }
    }).catch(e => active && setError(e.message));
    return () => { active = false; };
  }, [offset]);
  useEffect(() => { let active = true; setError(''); setLoading(true); setRevision(null); setHistory([]); setStatuses([]); setDraft({ ...emptyDraft, links: [] });
    if (!id) { setLoading(false); return () => { active = false; }; }
    Promise.all([api<{ revision: ProjectRevision; statuses: ProjectLinkStatus[] }>(`/${encodeURIComponent(id)}${revisionHash ? `?revision=${encodeURIComponent(revisionHash)}` : ''}`), api<{ revisions: History[] }>(`/${encodeURIComponent(id)}/history`)]).then(([data, old]) => {
      if (!active) return; setRevision(data.revision); setStatuses(data.statuses); setHistory(old.revisions);
      const { name, question, purpose, state, meaning, links } = data.revision.body;
      setDraft({ name, question, purpose, state, meaning, links: links.map(({ kind, id, expectedHash, role, notes }) => ({ kind, id, expectedHash, role, notes })) });
    }).catch(e => active && setError(e.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [id, revisionHash]);
  useEffect(() => { let active = true; setResources([]); setSelectedResource('');
    api<{ resources: ProjectResourceSummary[]; total: number }>(`/resources?kind=${kind}&limit=50&offset=${resourceOffset}`).then(data => {
      if (active) { setResources(data.resources); setResourceTotal(data.total); }
    }).catch(e => active && setError(e.message));
    return () => { active = false; };
  }, [kind, resourceOffset]);
  const save = async () => {
    const startedAt = navigation.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await api<{ revision: ProjectRevision }>(id ? `/${encodeURIComponent(id)}/revisions` : '', id ? { expectedHash: revision?.hash, draft } : draft);
      if (navigation.current !== startedAt) { await refresh(); return; }
      setRevision(data.revision); setNotice(`Zapisano wersję ${data.revision.body.revision}. Poprzednie wersje zachowują swoje materiały.`);
      await refresh();
      if (navigation.current !== startedAt) return;
      if (id) {
        const [older, live] = await Promise.all([api<{ revisions: History[] }>(`/${encodeURIComponent(id)}/history`), api<{ statuses: ProjectLinkStatus[] }>(`/${encodeURIComponent(id)}`)]);
        if (navigation.current !== startedAt) return;
        setHistory(older.revisions); setStatuses(live.statuses);
      } else setParams({ id: data.revision.body.projectId });
    } catch (e) { if (navigation.current === startedAt) setError((e as Error).message); } finally { setBusy(false); }
  };
  const addResource = () => {
    const selected = resources.find(r => r.id === selectedResource); if (!selected) return;
    const link: ProjectLinkInput = { kind: selected.kind, id: selected.id, expectedHash: selected.hash, role: linkRole || profile?.defaultLinkRole || 'Materiał', notes: linkNotes };
    setDraft({ ...draft, links: [...draft.links.filter(l => !(l.kind === link.kind && l.id === link.id)), link] });
    setLinkNotes(''); setNotice('Wybrano dokładną wersję materiału. Powiązanie zostanie utrwalone przy zapisie pakietu.');
  };
  if (!profile) return <div className="p-6" role={error ? 'alert' : 'status'}>{error || 'Wczytywanie pakietów badań…'}</div>;
  return <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-5" data-testid="research-projects-page">
    <header><h1 className="text-2xl font-semibold">{profile.title}</h1><p className="mt-2 text-slate-600">{profile.introduction}</p></header>
    {error && <p role="alert" className="bg-red-50 text-red-800 p-3 break-words">{error}</p>}
    {notice && <p role="status" className="bg-indigo-50 p-3">{notice}</p>}
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-5">
      <section className={sectionClass}><div className="flex gap-3 justify-between items-center"><h2 className="font-semibold">Moje zadania ({total})</h2><button className={buttonClass} disabled={busy} onClick={() => {
        setParams({}); setDraft({ ...emptyDraft, links: [] }); setRevision(null); setStatuses([]); setHistory([]); setNotice(''); setError(''); setLinkNotes(''); setLinkRole(''); setSelectedResource('');
      }}>Nowy pakiet</button></div>
        {projects.length === 0 && <p>Utwórz zadanie i połącz je z zapisanymi materiałami.</p>}
        <ul className="space-y-3">{projects.map(p => <li key={p.id} className={`border p-3 rounded ${id === p.id ? 'border-indigo-600' : 'border-slate-200'}`}>
          <button className="underline font-medium text-left break-words" disabled={busy} onClick={() => setParams({ id: p.id })}>{p.name}</button>
          <p className="text-sm">{profile.stateLabels[p.state]} · wersja {p.revision}</p><p className="text-xs text-slate-600 break-words">{p.question}</p>
        </li>)}</ul>
        <div className="flex flex-wrap gap-3 text-sm"><button className="underline disabled:opacity-40" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Poprzednie 50</button>
          <span>{total ? offset + 1 : 0}–{Math.min(offset + 50, total)} z {total}</span><button className="underline disabled:opacity-40" disabled={busy || offset + 50 >= total} onClick={() => setOffset(offset + 50)}>Następne 50</button></div>
      </section>
      <section className={sectionClass}>
        {loading ? <p role="status">Wczytywanie zapisanej wersji…</p> : <>
          <h2 className="font-semibold">{id ? `${readonly ? 'Zapisana' : 'Aktualna'} wersja ${revision?.body.revision ?? ''}` : 'Nowy pakiet badania'}</h2>
          {readonly && <p className="text-sm bg-amber-50 p-2">Oglądasz niezmienną wersję z historii. <button className="underline" onClick={() => setParams({ id: id! })}>Przejdź do aktualnej wersji, aby zapisać zmianę</button>.</p>}
          <fieldset disabled={readonly || busy || !!id && !revision} className="space-y-3 min-w-0">
            <label className="block">Nazwa zadania<input aria-label="Nazwa zadania" className={formClass} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} maxLength={160} /></label>
            <label className="block">Pytanie badawcze<textarea aria-label="Pytanie badawcze" className={formClass} rows={3} value={draft.question} onChange={e => setDraft({ ...draft, question: e.target.value })} maxLength={4000} /></label>
            <label className="block">Cel, zakres i różnice wobec źródła<textarea aria-label="Cel, zakres i różnice wobec źródła" className={formClass} rows={3} value={draft.purpose} onChange={e => setDraft({ ...draft, purpose: e.target.value })} maxLength={4000} /></label>
            <div className="grid sm:grid-cols-2 gap-3"><label>Stan zadania<select aria-label="Stan zadania" className={formClass} value={draft.state} onChange={e => setDraft({ ...draft, state: e.target.value as ProjectDraft['state'] })}>{Object.entries(profile.stateLabels).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
              <label>Znaczenie deklarowane przez właściciela<select aria-label="Znaczenie deklarowane przez właściciela" className={formClass} value={draft.meaning} onChange={e => setDraft({ ...draft, meaning: e.target.value as ProjectDraft['meaning'] })}>{Object.entries(profile.meaningLabels).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label></div>
            <p className="text-sm text-slate-600">{profile.meaningDescriptions[draft.meaning]}</p>
          </fieldset>
          <div className="space-y-3"><h3 className="font-semibold">Powiązane materiały ({draft.links.length})</h3>
            {draft.links.length === 0 && <p className="text-sm">Możesz zacząć od samego pytania. Materiały dołączysz w kolejnej wersji.</p>}
            {draft.links.map(l => { const pinned = revision?.body.links.find(p => p.kind === l.kind && p.id === l.id), live = resources.find(r => r.kind === l.kind && r.id === l.id), status = statuses.find(s => s.kind === l.kind && s.id === l.id);
              return <article key={`${l.kind}:${l.id}`} className="rounded border p-3 space-y-2 break-words"><Link className="underline font-medium" to={pinned?.href ?? live?.href ?? '/research'}>{pinned?.label ?? live?.label ?? l.id}</Link>
                <p className="text-xs">{profile.resourceLabels[l.kind]}{l.kind === 'schedule' ? ' · wskaźnik na harmonogram; przyszłe wyniki nie są dołączane automatycznie' : ' · przypięty materiał'}</p>
                {status && <p className="text-xs">{status.status === 'CURRENT' ? 'Bieżący materiał zgodny z zapisaną wersją.' : status.status === 'CHANGED' ? 'Bieżący materiał lub jego zatwierdzenie zmieniły się. Zapisany materiał pozostaje w historii.' : 'Bieżący materiał niedostępny. Zapisany materiał pozostaje w historii.'}</p>}
                <p className="text-xs break-all">SHA-256: {l.expectedHash}</p>
                <label className="block text-sm">Rola w zadaniu<input aria-label="Rola w zadaniu" className={formClass} disabled={readonly || busy} value={l.role} onChange={e => setDraft({ ...draft, links: draft.links.map(v => v === l ? { ...v, role: e.target.value } : v) })} /></label>
                <label className="block text-sm">Znaczenie i ograniczenia<textarea aria-label="Znaczenie i ograniczenia" className={formClass} disabled={readonly || busy} rows={2} value={l.notes} onChange={e => setDraft({ ...draft, links: draft.links.map(v => v === l ? { ...v, notes: e.target.value } : v) })} /></label>
                {!readonly && <button className="underline text-sm" disabled={busy} onClick={() => setDraft({ ...draft, links: draft.links.filter(v => v !== l) })}>Usuń z następnej wersji</button>}
                {pinned && <details><summary className="text-sm">Zapisane pochodzenie i pliki</summary><p className="text-xs">{pinned.files.length} plików · hash metadanych {pinned.snapshotHash}</p><pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{JSON.stringify(pinned.snapshot, null, 2)}</pre></details>}
              </article>; })}
          </div>
          {!readonly && <fieldset disabled={busy || draft.links.length >= 50 || !!id && !revision} className="space-y-3 border-t pt-3 min-w-0"><legend className="font-semibold">Dodaj zapisany materiał</legend>
            <label className="block">Rodzaj materiału<select aria-label="Rodzaj materiału" className={formClass} value={kind} onChange={e => { setKind(e.target.value as ProjectResourceKind); setResourceOffset(0); }}>{Object.entries(profile.resourceLabels).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
            <label className="block">Wybierz swoją wersję<select aria-label="Wybierz swoją wersję" className={formClass} value={selectedResource} onChange={e => setSelectedResource(e.target.value)}><option value="">Wybierz materiał…</option>{resources.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
            <div className="flex flex-wrap gap-3 text-xs"><button className="underline disabled:opacity-40" disabled={resourceOffset === 0} onClick={() => setResourceOffset(Math.max(0, resourceOffset - 50))}>Poprzednie 50</button><span>{resourceTotal ? resourceOffset + 1 : 0}–{Math.min(resourceOffset + 50, resourceTotal)} z {resourceTotal}</span><button className="underline disabled:opacity-40" disabled={resourceOffset + 50 >= resourceTotal} onClick={() => setResourceOffset(resourceOffset + 50)}>Następne 50</button></div>
            {resourceTotal === 0 && <p className="text-sm">Brak własnych materiałów tego rodzaju. <Link className="underline" to={kind === 'schedule' || kind === 'job' ? '/automation' : kind === 'dataset' || kind === 'figure' ? '/workbench' : '/research'}>Otwórz właściwy warsztat</Link>.</p>}
            <label className="block">Rola materiału<input aria-label="Rola materiału" className={formClass} value={linkRole} placeholder={profile.defaultLinkRole} onChange={e => setLinkRole(e.target.value)} /></label>
            <label className="block">Znaczenie, różnice i ograniczenia<textarea aria-label="Znaczenie, różnice i ograniczenia" className={formClass} rows={2} value={linkNotes} onChange={e => setLinkNotes(e.target.value)} /></label>
            <button className={buttonClass} disabled={!selectedResource} onClick={addResource}>Dołącz wybraną wersję</button>
          </fieldset>}
          <div className="flex flex-wrap gap-3">{!readonly && <button className={buttonClass} disabled={busy || loading || !draft.name.trim() || !draft.question.trim() || !!id && !revision} onClick={() => void save()}>Zapisz nową niezmienną wersję</button>}
            {revision && <a className="underline text-sm self-center" href={`/api/projects/${encodeURIComponent(revision.body.projectId)}/export?revision=${revision.hash}`}>Pobierz tę wersję z manifestem i plikami</a>}</div>
          {revision && <p className="text-xs break-all">SHA-256 pakietu: {revision.hash}. Eksport jest prywatnym archiwum warsztatu i zachowuje stan zatwierdzenia z chwili zapisu.</p>}
          {history.length > 0 && <details><summary>Historia wersji ({history.length})</summary><ul className="mt-2 space-y-2">{history.map(r => <li key={r.hash}><button className="underline text-sm" disabled={busy} onClick={() => setParams({ id: id!, revision: r.hash })}>Wersja {r.revision} · {profile.stateLabels[r.state]} · {new Date(r.createdAt).toLocaleString()}</button><p className="text-xs break-all">{r.hash}</p></li>)}</ul></details>}
        </>}
      </section>
    </div>
  </div>;
}
