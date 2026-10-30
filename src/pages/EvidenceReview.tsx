import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAccess } from '../lib/access';
import { fieldApi } from '../lib/field_client';
import { clientError } from '../lib/api_error';
import { defaultFieldProfile, RecordEvidence } from '../components/FieldEvidence';
import type { ReferenceDocument, ReferenceRecord } from '../../shared/field';
import text from '../../config/ui/evidence-review.json';
import { useUiText } from '../lib/ui_text';

/** The pasted mapping must be JSON; the parser's English detail is kept for the label. */
function parseMapping(input: string): unknown {
  try { return JSON.parse(input); }
  catch (e) { const detail = (e as Error).message; throw clientError('invalid_json', detail, { detail }); }
}

export function EvidenceReview() {
  const access = useAccess();
  const { t, errorText } = useUiText(text);
  const [searchParams] = useSearchParams();
  const requestedReferenceId = searchParams.get('reference');
  const [records, setRecords] = useState<ReferenceRecord[]>([]), [catalog, setCatalog] = useState<ReferenceDocument[]>([]);
  const [profile, setProfile] = useState(defaultFieldProfile), [input, setInput] = useState('');
  const [selected, setSelected] = useState<string | null>(requestedReferenceId), [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false);
  const record = records.find(r => r.id === selected);
  async function refresh() {
    const data = await fieldApi('references'); setRecords(data.records); setProfile(data.profile);
    const proposals = await fieldApi('catalog'); setCatalog(proposals.proposals);
  }
  useEffect(() => { if (requestedReferenceId) { setSelected(requestedReferenceId); setReviewed(false); } }, [requestedReferenceId]);
  useEffect(() => { refresh().catch(e => setError(e)); }, []);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); await refresh(); setReviewed(false); } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  async function importOne(doc: unknown) {
    const data = await fieldApi('references', doc); setSelected(data.record.id); setReviewed(false);
  }
  return <div className="field-page min-w-0"><h1 className="break-words">{t('title')}</h1>
    <p className="mt-2 text-slate-600">{t('intro')}</p>
    <p className="field-warning">{t('catalog_warning')}</p>
    {error !== null && <p className="field-error break-words" role="alert">{errorText(error)}</p>}
    <div className="grid xl:grid-cols-[minmax(18rem,1fr)_2fr] gap-5"><div className="min-w-0">
      {access.capabilities.includes('evidence.import') && <><section className="field-panel"><h2>{t('catalog')}</h2>
        <ul className="space-y-3 mt-3">{catalog.map(doc => <li key={doc.key} className="border-b border-slate-200 pb-3 break-words">
          <strong>{doc.kind === 'sample' ? doc.name : `${doc.subject.name} → ${doc.object?.name ?? doc.category}`}</strong>
          <p className="text-sm"><a href={doc.citation.url}>{doc.citation.publisher}</a> · {doc.key}</p>
          <button className="field-button mt-2" disabled={busy} onClick={() => act(() => importOne(doc))}>{t('import_one')}</button>
        </li>)}</ul></section>
        <form className="field-panel" onSubmit={e => { e.preventDefault(); void act(() => importOne(parseMapping(input))); }}>
          <label className="field-control">{t('import_json')}<textarea rows={8} value={input} onChange={e => setInput(e.target.value)} spellCheck={false} required /></label>
          <button className="field-button mt-3" disabled={busy}>{t('import_proposed')}</button>
        </form></>}
      <section className="field-panel"><h2>{t('imported', { count: records.length })}</h2>
        <ul className="mt-3 space-y-2">{records.map(r => <li key={r.id}><button className="field-button w-full justify-start text-left break-words" aria-pressed={selected === r.id}
          onClick={() => { setSelected(r.id); setReviewed(false); }}>{r.document.kind === 'sample' ? r.document.name : `${r.document.subject.name}: ${r.document.category}`} · {r.approvalState}</button></li>)}</ul>
        {!records.length && <p>{t('none_imported')}</p>}</section>
    </div><section className="field-panel self-start min-w-0">
      {record ? <><h2>{t('review_exact')}</h2><div className="mt-3"><RecordEvidence record={record} profile={profile} /></div>
        <pre className="text-xs bg-slate-50 p-3 rounded mt-4 overflow-auto max-h-[38rem]" data-testid="mapping-document">{JSON.stringify(record.document, null, 2)}</pre>
        {access.capabilities.includes('evidence.approve') && <div className="mt-4 space-y-3">
          {record.approvalState === 'PROPOSED' ? <><label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />
            {t('checked')}</label>
            <button className="field-button primary" disabled={!reviewed || busy} onClick={() => act(() => fieldApi(`references/${record.id}/approve`, { expectedHash: record.contentHash }))}>{t('approve')}</button></>
            : <button className="field-button" disabled={busy} onClick={() => act(() => fieldApi(`references/${record.id}/revoke`, {}))}>{t('revoke')}</button>}
        </div>}</> : <p>{t('select_prompt')}</p>}
    </section></div>
  </div>;
}
