import { useState } from 'react';
import { parseCsv } from '../../shared/csv_import';
import { validateDataset, type DatasetDocument, type WorkbenchProfile } from '../../shared/workbench';
import text from '../../config/ui/dataset-import.json';
import { useUiText } from '../lib/ui_text';
import { clientError } from '../lib/api_error';
import { useWorkbenchText } from '../lib/workbench_text';

const FIELD_KEYS = { name: 'field_name', description: 'field_description', measure: 'field_measure', comparisonScope: 'field_comparison_scope' } as const;
const SOURCE_KEYS = { url: 'source_url', title: 'source_title', publisher: 'source_publisher', sourceRecordId: 'source_record_id', license: 'source_license' } as const;

export function DatasetImport({ profile, onImport, busy }: { profile: WorkbenchProfile; onImport: (document: unknown) => void; busy: boolean }) {
  const { t, errorText } = useUiText(text), wt = useWorkbenchText();
  const [json, setJson] = useState(''), [csv, setCsv] = useState(''), [header, setHeader] = useState(1), [separator, setSeparator] = useState(',');
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState<DatasetDocument | null>(null);
  function mapCsv() {
    try {
      const all = parseCsv(csv, separator), headers = all[header - 1];
      if (!headers || headers.length < 2) throw clientError('csv_header', 'Select a header record with at least two columns.');
      const data = all.slice(header); if (!data.length || data.some(row => row.length !== headers.length)) throw clientError('csv_row_width', 'Data rows must have the same number of cells as the selected header.');
      // Stored dataset content: the generated labels, descriptions and missing reasons are data, not interface text.
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
        rawInput: { mediaType: 'text/csv', text: csv, separator: separator as ',' | ';' | '\t', headerRecord: header } }); setError(null);
    } catch (e) { setError(e); }
  }
  return <details className="field-panel"><summary className="font-semibold">{t('summary')}</summary>
    <p className="text-sm my-3">{t('intro')}</p>
    <label className="field-control">{t('read_file')}<input type="file" accept=".json,.csv,.tsv" onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      if (file.size > 1_000_000) { setError(clientError('file_too_large', 'File exceeds the 1 MB import limit.')); return; }
      const text = await file.text(); file.name.endsWith('.json') ? setJson(text) : setCsv(text);
    }} /></label>
    <div className="grid md:grid-cols-2 gap-4 mt-4"><div className="min-w-0">
      <label className="field-control">{t('mapped_json')}<textarea rows={7} value={json} onChange={e => setJson(e.target.value)} spellCheck={false} /></label>
      <button type="button" className="field-button mt-2" disabled={busy || !json} onClick={() => { try { onImport(validateDataset(JSON.parse(json))); setError(null); } catch (e) { setError(e); } }}>{t('import_json')}</button>
    </div><div className="min-w-0"><label className="field-control">{t('source_csv')}<textarea rows={7} value={csv} onChange={e => setCsv(e.target.value)} spellCheck={false} /></label>
      <div className="flex flex-wrap gap-3 mt-2"><label className="field-control">{t('header_record')}<input type="number" min={1} value={header} onChange={e => setHeader(Number(e.target.value))} /></label>
        <label className="field-control">{t('delimiter')}<select aria-label={t('delimiter')} value={separator} onChange={e => setSeparator(e.target.value)}><option value=",">{t('delimiter_comma')}</option><option value=";">{t('delimiter_semicolon')}</option><option value={'\t'}>{t('delimiter_tab')}</option></select></label>
        <button type="button" className="field-button self-end" disabled={!csv} onClick={mapCsv}>{t('prepare_mapping')}</button></div>
    </div></div>
    {draft && <form onSubmit={e => { e.preventDefault(); try { onImport(validateDataset(draft)); } catch (e) { setError(e); } }} className="border-t mt-4 pt-4">
      <h3 className="font-semibold">{t('review_heading', { count: draft.rows.length })}</h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
        {(['name', 'description', 'measure', 'comparisonScope'] as const).map(key => <label key={key} className="field-control">{t(FIELD_KEYS[key])}<input required value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
        <label className="field-control">{t('provider_profile')}<select aria-label={t('provider_profile')} value={draft.providerProfileId} onChange={e => { const p = profile.providerProfiles.find(p => p.id === e.target.value)!; setDraft({ ...draft, providerProfileId: p.id, normalization: (p.normalizations.includes('unknown') ? 'unknown' : p.normalizations[0]) as any }); }}>{profile.providerProfiles.map(p => <option value={p.id} key={p.id}>{wt.provider(p)}</option>)}</select></label>
        <label className="field-control">{t('normalization')}<select aria-label={t('normalization')} value={draft.normalization} onChange={e => setDraft({ ...draft, normalization: e.target.value as any })}>{profile.providerProfiles.find(p => p.id === draft.providerProfileId)!.normalizations.map(v => <option key={v}>{v}</option>)}</select></label>
        <label className="field-control">{t('language_meaning')}<select aria-label={t('language_meaning')} value={draft.languageMeaning} onChange={e => setDraft({ ...draft, languageMeaning: e.target.value as any })}>{profile.providerProfiles.find(p => p.id === draft.providerProfileId)!.languageMeanings.map(v => <option key={v}>{v}</option>)}</select></label>
        {(['url', 'title', 'publisher', 'sourceRecordId', 'license'] as const).map(key => <label key={key} className="field-control">{t(SOURCE_KEYS[key])}<input required value={draft.source[key]} onChange={e => setDraft({ ...draft, source: { ...draft.source, [key]: e.target.value } })} /></label>)}
      </div>
      <div className="overflow-auto mt-3"><table className="field-table"><thead><tr><th>{t('col_column')}</th><th>{t('col_detected_type')}</th><th>{t('col_unit')}</th><th>{t('col_semantic')}</th><th>{t('col_first')}</th></tr></thead><tbody>{draft.columns.map((c, i) => <tr key={c.key}>
        <td>{c.label} ({c.key})</td><td>{c.type}</td><td><input className="field-input" aria-label={t('aria_unit', { label: c.label })} value={c.unit ?? ''} onChange={e => setDraft({ ...draft, columns: draft.columns.map((col, j) => j === i ? { ...col, unit: e.target.value || null } : col) })} /></td>
        <td><select aria-label={t('aria_semantic', { label: c.label })} className="field-input" value={c.semanticType} onChange={e => setDraft({ ...draft, columns: draft.columns.map((col, j) => j === i ? { ...col, semanticType: e.target.value as any } : col) })}>{['dimension', 'count', 'proportion', 'percentage', 'score', 'rank', 'coefficient'].map(v => <option key={v}>{v}</option>)}</select></td><td>{draft.rows[0].values[c.key] === null || draft.rows[0].values[c.key] === undefined ? t('missing') : String(draft.rows[0].values[c.key])}</td>
      </tr>)}</tbody></table></div>
      <p className="text-sm my-2">{t('retained_note')}</p>
      <button type="button" className="field-button mr-2" onClick={() => setJson(JSON.stringify(draft, null, 2))}>{t('copy_to_json')}</button>
      <button className="field-button primary" disabled={busy}>{t('import_reviewed')}</button>
    </form>}
    {error != null && <p className="field-error" role="alert">{errorText(error)}</p>}
  </details>;
}
