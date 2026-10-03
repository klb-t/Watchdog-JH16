import { useEffect, useState } from 'react';
import { automationApi as api, buttonClass, formClass } from '../lib/automation_client';
import { useAccess } from '../lib/access';
import { MEMBER_OUTCOMES } from '../../shared/paper_comparison_family';

/** Fired by the comparison editor so families see newly reviewed comparisons. */
export const COMPARISONS_CHANGED = 'watchdog-paper-comparisons-changed';

/**
 * E5.7b.1 — frozen comparison families for one paper, shown in the context of
 * that paper's operations (not a new primary screen). Every member is always
 * listed against the frozen denominator; nothing here computes a verdict.
 */
export function PaperComparisonFamilies({ documentId, operationIds, profile, parentBusy }: {
  documentId: string; operationIds: string[]; profile: any; parentBusy: boolean;
}) {
  const access = useAccess();
  const [families, setFamilies] = useState<any[]>([]), [comparisons, setComparisons] = useState<any[]>([]);
  const [chosen, setChosen] = useState<string[]>([]), [title, setTitle] = useState(''), [rationale, setRationale] = useState('');
  const [supersedes, setSupersedes] = useState<{ id: string; hash: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const disabled = busy || parentBusy, canAnalyze = access.capabilities.includes('workbench.analyze');
  const opsKey = [...operationIds].sort().join(',');

  const load = async () => {
    const [f, lists] = await Promise.all([
      api(`/api/research/comparison-families?documentId=${encodeURIComponent(documentId)}`),
      Promise.all([...operationIds].sort().map(id => api(`/api/research/comparisons?operationId=${encodeURIComponent(id)}`))),
    ]);
    setFamilies(f.families);
    setComparisons(lists.flatMap((l: any) => l.comparisons).filter((c: any) => c.review && c.review.comparisonHash === c.hash));
  };
  useEffect(() => { let live = true; setError('');
    const refresh = () => { load().catch(e => { if (live) setError(e.message); }); };
    refresh(); window.addEventListener(COMPARISONS_CHANGED, refresh);
    return () => { live = false; window.removeEventListener(COMPARISONS_CHANGED, refresh); };
  }, [documentId, opsKey]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const byId = new Map(comparisons.map(c => [c.id, c]));
  const label = (id: string) => byId.get(id)?.body.claim.quote ?? id;
  const create = () => act(async () => {
    const members = comparisons.filter(c => chosen.includes(c.id)).map(c => ({ comparisonId: c.id, hash: c.hash }));
    await api('/api/research/comparison-families', { documentId, title, rationale, members, supersedes });
    setChosen([]); setTitle(''); setRationale(''); setSupersedes(null); setNotice(profile.createdNotice);
  });
  const revise = (f: any) => {
    setSupersedes({ id: f.id, hash: f.hash }); setTitle(f.body.title);
    setChosen(f.body.members.map((m: any) => m.comparisonId).filter((id: string) => byId.get(id)?.hash === f.body.members.find((m: any) => m.comparisonId === id).hash));
  };

  return <section className="border rounded p-3 space-y-3 min-w-0" data-testid="comparison-families">
    <h4 className="font-semibold">{profile.title}</h4>
    <p className="text-sm bg-amber-50 p-3">{profile.notice}</p>
    {error && <p role="alert" className="bg-red-50 p-3 text-red-800 break-words">{error}</p>}
    {notice && <p role="status" className="text-sm break-words">{notice}</p>}
    <fieldset disabled={disabled || !canAnalyze} className="space-y-3 min-w-0" data-testid="family-editor">
      <legend className="text-sm font-medium">{profile.membersLabel}</legend>
      {supersedes && <p className="text-sm break-all">{profile.supersedesLabel}: {supersedes.id}</p>}
      {comparisons.length === 0 && <p className="text-sm">{profile.noMembersLabel}</p>}
      {comparisons.map(c => <label key={c.id} className="flex items-start gap-2 text-sm break-words">
        <input type="checkbox" data-testid={`family-member-${c.id}`} checked={chosen.includes(c.id)}
          onChange={e => setChosen(e.target.checked ? [...chosen, c.id] : chosen.filter(id => id !== c.id))} />
        <span className="min-w-0">{c.body.claim.quote} · {c.body.claim.statistic}</span>
      </label>)}
      <label className="block">{profile.titleLabel}<input aria-label={profile.titleLabel} className={formClass} value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label className="block">{profile.rationaleLabel}<textarea aria-label={profile.rationaleLabel} className={formClass} rows={2} value={rationale} onChange={e => setRationale(e.target.value)} /></label>
      <button className={buttonClass} data-testid="family-create" disabled={!chosen.length || !title.trim() || !rationale.trim()} onClick={() => void create()}>{profile.createLabel}</button>
    </fieldset>
    <div className="space-y-3"><h5 className="font-semibold text-sm">{profile.listLabel} ({families.length})</h5>
      {families.map(f => <article key={f.id} className="border-t pt-2 space-y-2 min-w-0" data-testid="family-card">
        <p className="font-medium break-words">{f.body.title}</p>
        <p className="text-sm whitespace-pre-wrap break-words">{f.body.rationale}</p>
        <p className="text-sm" data-testid="family-summary"><strong>{f.summary.denominator}</strong> {profile.denominatorLabel}: {MEMBER_OUTCOMES
          .filter(o => f.summary.counts[o] > 0).map(o => `${f.summary.counts[o]} ${profile.outcomes[o]}`).join(' · ')}</p>
        <ol className="text-sm space-y-1 list-decimal pl-5">{f.summary.members.map((m: any) => <li key={m.comparisonId} className="break-words" data-testid="family-outcome" data-outcome={m.outcome}>
          <span>{label(m.comparisonId)}</span> — <strong>{profile.outcomes[m.outcome]}</strong>{m.reason ? ` (${m.reason})` : ''}{m.attempts > 1 ? ` · ${m.attempts}×` : ''}</li>)}</ol>
        {f.body.supersedes && <p className="text-xs break-all">{profile.supersedesLabel}: {f.body.supersedes.id}</p>}
        {f.supersededBy.length > 0 && <p className="text-xs break-all">{profile.supersededByLabel}: {f.supersededBy.map((s: any) => s.id).join(', ')}</p>}
        <div className="flex flex-wrap gap-3">
          <button className={buttonClass} data-testid="family-execute" disabled={disabled || !canAnalyze}
            onClick={() => void act(async () => { await api(`/api/research/comparison-families/${f.id}/execute`, { expectedHash: f.hash }); })}>{profile.executeLabel}</button>
          <button className="underline text-sm" disabled={disabled || !canAnalyze} onClick={() => revise(f)}>{profile.reviseLabel}</button>
        </div>
        <details><summary className="text-sm">{profile.exposureLabel}</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{JSON.stringify(f.body.priorExposure, null, 2)}</pre></details>
        <details><summary className="text-sm">{profile.eventsLabel} ({f.events.length})</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{JSON.stringify(f.events, null, 2)}</pre></details>
      </article>)}
    </div>
  </section>;
}
