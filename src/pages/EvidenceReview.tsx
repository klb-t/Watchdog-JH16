import { useEffect, useState } from 'react';
import { useAccess } from '../lib/access';
import { fieldApi } from '../lib/field_client';
import { defaultFieldProfile, RecordEvidence } from '../components/FieldEvidence';
import type { ReferenceDocument, ReferenceRecord } from '../../shared/field';

export function EvidenceReview() {
  const access = useAccess();
  const [records, setRecords] = useState<ReferenceRecord[]>([]), [catalog, setCatalog] = useState<ReferenceDocument[]>([]);
  const [profile, setProfile] = useState(defaultFieldProfile), [input, setInput] = useState('');
  const [selected, setSelected] = useState<string | null>(null), [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const record = records.find(r => r.id === selected);
  async function refresh() {
    const data = await fieldApi('references'); setRecords(data.records); setProfile(data.profile);
    const proposals = await fieldApi('catalog'); setCatalog(proposals.proposals);
  }
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await fn(); await refresh(); setReviewed(false); } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function importOne(doc: unknown) {
    const data = await fieldApi('references', doc); setSelected(data.record.id); setReviewed(false);
  }
  return <div className="field-page"><h1>Evidence review</h1>
    <p className="mt-2 text-slate-600">Review one sourced mapping at a time. Approval binds to the exact displayed content and your signed-in identity.</p>
    <p className="field-warning">Catalog entries are proposed mappings. Importing does not approve them. Verify the source, composition, geography, dates, evidence tier and missing values before making a reference available to responders.</p>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="grid xl:grid-cols-[minmax(18rem,1fr)_2fr] gap-5"><div>
      {access.capabilities.includes('evidence.import') && <><section className="field-panel"><h2>Versioned source catalog</h2>
        <ul className="space-y-3 mt-3">{catalog.map(doc => <li key={doc.key} className="border-b border-slate-200 pb-3">
          <strong>{doc.kind === 'sample' ? doc.name : `${doc.subject.name} → ${doc.object?.name ?? doc.category}`}</strong>
          <p className="text-sm"><a href={doc.citation.url}>{doc.citation.publisher}</a> · {doc.key}</p>
          <button className="field-button mt-2" disabled={busy} onClick={() => act(() => importOne(doc))}>Import for individual review</button>
        </li>)}</ul></section>
        <form className="field-panel" onSubmit={e => { e.preventDefault(); void act(() => importOne(JSON.parse(input))); }}>
          <label className="field-control">Import a reference mapping (JSON)<textarea rows={8} value={input} onChange={e => setInput(e.target.value)} spellCheck={false} required /></label>
          <button className="field-button mt-3" disabled={busy}>Import as proposed</button>
        </form></>}
      <section className="field-panel"><h2>Imported mappings ({records.length})</h2>
        <ul className="mt-3 space-y-2">{records.map(r => <li key={r.id}><button className="field-button w-full justify-start text-left" aria-pressed={selected === r.id}
          onClick={() => { setSelected(r.id); setReviewed(false); }}>{r.document.kind === 'sample' ? r.document.name : `${r.document.subject.name}: ${r.document.category}`} · {r.approvalState}</button></li>)}</ul>
        {!records.length && <p>No mappings imported yet.</p>}</section>
    </div><section className="field-panel self-start">
      {record ? <><h2>Review exact mapping</h2><div className="mt-3"><RecordEvidence record={record} profile={profile} /></div>
        <pre className="text-xs bg-slate-50 p-3 rounded mt-4 overflow-auto max-h-[38rem]" data-testid="mapping-document">{JSON.stringify(record.document, null, 2)}</pre>
        {access.capabilities.includes('evidence.approve') && <div className="mt-4 space-y-3">
          {record.approvalState === 'PROPOSED' ? <><label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />
            I checked this exact mapping against its cited source, including uncertainties and tier.</label>
            <button className="field-button primary" disabled={!reviewed || busy} onClick={() => act(() => fieldApi(`references/${record.id}/approve`, { expectedHash: record.contentHash }))}>Approve this mapping</button></>
            : <button className="field-button" disabled={busy} onClick={() => act(() => fieldApi(`references/${record.id}/revoke`, {}))}>Revoke this mapping</button>}
        </div>}</> : <p>Select an imported mapping to inspect its complete content and provenance.</p>}
    </section></div>
  </div>;
}
