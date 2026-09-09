import { useState } from 'react';
import { parseCsv } from '../../shared/csv_import';
import { validateDataset, type DatasetDocument, type WorkbenchProfile } from '../../shared/workbench';
export function DatasetImport({ profile, onImport, busy }: { profile: WorkbenchProfile; onImport: (document: unknown) => void; busy: boolean }) {
  const [json, setJson] = useState(''), [csv, setCsv] = useState(''), [header, setHeader] = useState(1), [separator, setSeparator] = useState(',');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<DatasetDocument | null>(null);
  function mapCsv() {
    try {
      const all = parseCsv(csv, separator), headers = all[header - 1];
      if (!headers || headers.length < 2) throw new Error('Select a header record with at least two columns.');
      const data = all.slice(header); if (!data.length || data.some(row => row.length !== headers.length)) throw new Error('Data rows must have the same number of cells as the selected header.');
      const columns = headers.map((label, i) => { const values = data.map(row => row[i].trim()).filter(Boolean);
        const type = values.length && values.every(v => /^-?\d+(\.\d+)?$/.test(v) || /^<\d/.test(v)) ? 'number' as const : values.length && values.every(v => /^\d{4}-\d{2}-\d{2}$/.test(v)) ? 'date' as const : 'text' as const;
        return { key: `c${i + 1}`, label: label || `Column ${i + 1}`, type, unit: null, semanticType: type === 'number' ? 'score' as const : 'dimension' as const, description: `CSV column ${i + 1}: ${label}` };
      });
      const rows = data.map((dataRow, i) => {
        const values: Record<string, string | number | null> = {}, missingReasons: Record<string, string> = {};
        for (const [j, column] of columns.entries()) {
          const value = dataRow[j].trim();
          if (!value || column.type === 'number' && value.startsWith('<')) { values[column.key] = null; missingReasons[column.key] = value ? `Source reports ${value}; exact numeric value is unavailable` : 'Empty source cell'; }
          else values[column.key] = column.type === 'number' ? Number(value) : value;
        }
        return { id: `row-${i + 1}`, values, missingReasons, evidenceTier: 'RAW_OBSERVATIONAL' as const, qualityFlags: ['CSV_MAPPING_REQUIRES_REVIEW'] };
      });
      setDraft({ version: 'workbench-dataset-1', key: 'imported-table', name: '', description: '', providerProfileId: 'manual-table', measure: '',
        source: { url: '', publisher: '', title: '', sourceRecordId: '', retrievedAt: new Date().toISOString(), license: '' },
        normalization: 'unknown', comparisonScope: '', languageMeaning: 'unknown', columns, rows,
        rawInput: { mediaType: 'text/csv', text: csv, separator: separator as ',' | ';' | '\t', headerRecord: header } }); setError('');
    } catch (e) { setError((e as Error).message); }
  }
  return <details className="field-panel"><summary className="font-semibold">Import a versioned dataset · JSON or CSV</summary>
    <p className="text-sm my-3">Imports start as proposed. CSV types are suggestions to review; units, source and comparison context must be explicit. Suppressed values such as &lt;1 remain missing with the original text retained.</p>
    <label className="field-control">Read a local file<input type="file" accept=".json,.csv,.tsv" onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      if (file.size > 1_000_000) { setError('File exceeds the 1 MB import limit.'); return; }
      const text = await file.text(); file.name.endsWith('.json') ? setJson(text) : setCsv(text);
    }} /></label>
    <div className="grid md:grid-cols-2 gap-4 mt-4"><div>
      <label className="field-control">Mapped dataset JSON<textarea rows={7} value={json} onChange={e => setJson(e.target.value)} spellCheck={false} /></label>
      <button type="button" className="field-button mt-2" disabled={busy || !json} onClick={() => { try { onImport(validateDataset(JSON.parse(json))); setError(''); } catch (e) { setError((e as Error).message); } }}>Import JSON as proposed</button>
    </div><div><label className="field-control">Source CSV<textarea rows={7} value={csv} onChange={e => setCsv(e.target.value)} spellCheck={false} /></label>
      <div className="flex flex-wrap gap-3 mt-2"><label className="field-control">Header record<input type="number" min={1} value={header} onChange={e => setHeader(Number(e.target.value))} /></label>
        <label className="field-control">Delimiter<select value={separator} onChange={e => setSeparator(e.target.value)}><option value=",">Comma</option><option value=";">Semicolon</option><option value={'\t'}>Tab</option></select></label>
        <button type="button" className="field-button self-end" disabled={!csv} onClick={mapCsv}>Prepare mapping</button></div>
    </div></div>
    {draft && <form onSubmit={e => { e.preventDefault(); try { onImport(validateDataset(draft)); } catch (e) { setError((e as Error).message); } }} className="border-t mt-4 pt-4">
      <h3 className="font-semibold">Review CSV mapping · {draft.rows.length} records</h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
        {(['name', 'description', 'measure', 'comparisonScope'] as const).map(key => <label key={key} className="field-control">{key}<input required value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
        <label className="field-control">Provider profile<select value={draft.providerProfileId} onChange={e => { const p = profile.providerProfiles.find(p => p.id === e.target.value)!; setDraft({ ...draft, providerProfileId: p.id, normalization: (p.normalizations.includes('unknown') ? 'unknown' : p.normalizations[0]) as any }); }}>{profile.providerProfiles.map(p => <option value={p.id} key={p.id}>{p.label}</option>)}</select></label>
        <label className="field-control">Normalization<select value={draft.normalization} onChange={e => setDraft({ ...draft, normalization: e.target.value as any })}>{profile.providerProfiles.find(p => p.id === draft.providerProfileId)!.normalizations.map(v => <option key={v}>{v}</option>)}</select></label>
        <label className="field-control">What language describes<select value={draft.languageMeaning} onChange={e => setDraft({ ...draft, languageMeaning: e.target.value as any })}>{profile.providerProfiles.find(p => p.id === draft.providerProfileId)!.languageMeanings.map(v => <option key={v}>{v}</option>)}</select></label>
        {(['url', 'title', 'publisher', 'sourceRecordId', 'license'] as const).map(key => <label key={key} className="field-control">Source {key}<input required value={draft.source[key]} onChange={e => setDraft({ ...draft, source: { ...draft.source, [key]: e.target.value } })} /></label>)}
      </div>
      <div className="overflow-auto mt-3"><table className="field-table"><thead><tr><th>Column</th><th>Detected type</th><th>Reported unit (numeric)</th><th>Semantic type</th><th>First value</th></tr></thead><tbody>{draft.columns.map((c, i) => <tr key={c.key}>
        <td>{c.label} ({c.key})</td><td>{c.type}</td><td><input className="field-input" aria-label={`${c.label} unit`} value={c.unit ?? ''} onChange={e => setDraft({ ...draft, columns: draft.columns.map((col, j) => j === i ? { ...col, unit: e.target.value || null } : col) })} /></td>
        <td><select className="field-input" value={c.semanticType} onChange={e => setDraft({ ...draft, columns: draft.columns.map((col, j) => j === i ? { ...col, semanticType: e.target.value as any } : col) })}>{['dimension', 'count', 'proportion', 'percentage', 'score', 'rank', 'coefficient'].map(v => <option key={v}>{v}</option>)}</select></td><td>{String(draft.rows[0].values[c.key] ?? 'Missing')}</td>
      </tr>)}</tbody></table></div>
      <p className="text-sm my-2">The original CSV and mapping settings are retained with the dataset. For another type interpretation, edit the mapped JSON before importing.</p>
      <button type="button" className="field-button mr-2" onClick={() => setJson(JSON.stringify(draft, null, 2))}>Copy mapping to JSON editor</button>
      <button className="field-button primary" disabled={busy}>Import reviewed mapping as proposed</button>
    </form>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </details>;
}
