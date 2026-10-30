import { useState } from 'react';
import { useAccess } from '../lib/access';
import { workbenchApi, downloadText } from '../lib/workbench_client';
import { mapGeoJson, validateGeometryLayer, collapsedRings, type GeometryLayerDocument, type GeometryLayerRecord } from '../../shared/geography';
import text from '../../config/ui/geometry-layers.json';
import { useUiText } from '../lib/ui_text';
import { clientError } from '../lib/api_error';
import { useWorkbenchText } from '../lib/workbench_text';

const DOCUMENT_KEYS = { key: 'boundary_key', name: 'boundary_name', description: 'boundary_description' } as const;
const SOURCE_KEYS = { url: 'boundary_source_url', title: 'boundary_source_title', publisher: 'boundary_source_publisher', license: 'boundary_source_license',
  retrievedAt: 'boundary_source_retrieved_at', sourceRecordId: 'boundary_source_record_id' } as const;

/** Source review is independent of the dataset review and the figure's color scale. */
export function GeometryLayers({ records, busy, act, onChanged }: {
  records: GeometryLayerRecord[]; busy: boolean; act: (fn: () => Promise<void>) => Promise<void>; onChanged: () => Promise<void>;
}) {
  const access = useAccess();
  const { t, errorText } = useUiText(text), wt = useWorkbenchText();
  const [json, setJson] = useState(''), [raw, setRaw] = useState(''), [idProperty, setIdProperty] = useState(''), [nameProperty, setNameProperty] = useState('');
  const [draft, setDraft] = useState<GeometryLayerDocument | null>(null), [selected, setSelected] = useState('');
  const [reviewed, setReviewed] = useState(false), [share, setShare] = useState(false), [error, setError] = useState<unknown>(null);
  const record = records.find(r => r.id === selected);
  async function importLayer(document: unknown) {
    const { record } = await workbenchApi('geometry-layers', validateGeometryLayer(document));
    await onChanged(); setSelected(record.id); setReviewed(false); setShare(record.visibility === 'shared_aggregate');
  }
  function prepare() {
    try {
      const mapped = mapGeoJson(raw, idProperty || null, nameProperty || null);
      setDraft({ version: 'workbench-geometry-1', key: 'imported-boundaries', name: '', description: '',
        coordinateReferenceSystem: 'OGC:CRS84', coordinatePrecisionDegrees: null,
        source: { url: '', title: '', publisher: '', license: '', retrievedAt: '', sourceRecordId: '', upstreamSha256: null }, ...mapped });
      setError(null);
    } catch (e) { setError(e); }
  }
  return <details className="field-panel"><summary className="font-semibold">{t('summary')}</summary>
    <p className="text-sm my-3">{t('intro')}</p>
    {access.capabilities.includes('dataset.import') && <>
      <label className="field-control">{t('read_file')}<input type="file" accept=".json,.geojson,application/geo+json" disabled={busy} onChange={e => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
        void act(async () => {
          // Shown by the workbench page, which labels `error_boundary_file_too_large`.
          if (file.size > 1_000_000) throw clientError('boundary_file_too_large', 'Boundary file exceeds the 1 MB import limit.');
          const text = await file.text(), document = JSON.parse(text);
          if (document.type === 'FeatureCollection') setRaw(text); else setJson(text);
        });
      }} /></label>
      <div className="grid md:grid-cols-2 gap-4 mt-4"><div className="min-w-0">
        <label className="field-control">{t('mapped_json')}<textarea rows={6} spellCheck={false} value={json} onChange={e => setJson(e.target.value)} /></label>
        <button className="field-button mt-2" disabled={busy || !json} onClick={() => act(() => importLayer(JSON.parse(json)))}>{t('import_json')}</button>
        <button className="field-button mt-2" disabled={busy} onClick={() => act(async () => { const data = await workbenchApi('geometry-catalog/world'); await importLayer(data.document); })}>{t('import_world')}</button>
      </div><div className="min-w-0">
        <label className="field-control">{t('source_geojson')}<textarea rows={6} spellCheck={false} value={raw} onChange={e => setRaw(e.target.value)} /></label>
        <div className="grid sm:grid-cols-2 gap-3 mt-2">
          <label className="field-control">{t('id_property')}<input value={idProperty} onChange={e => setIdProperty(e.target.value)} placeholder={t('id_placeholder')} /></label>
          <label className="field-control">{t('label_property')}<input value={nameProperty} onChange={e => setNameProperty(e.target.value)} placeholder={t('label_placeholder')} /></label>
        </div>
        <button className="field-button mt-2" disabled={busy || !raw} onClick={prepare}>{t('prepare')}</button>
      </div></div>
      {draft && <form className="border-t mt-4 pt-4" onSubmit={e => { e.preventDefault(); void act(() => importLayer(draft)); }}>
        <h3 className="font-semibold">{t('mapping_heading', { count: draft.features.length })}</h3>
        <p className="text-sm">{t('mapping_note')}</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
          {(['key', 'name', 'description'] as const).map(key => <label className="field-control" key={key}>{t(DOCUMENT_KEYS[key])}<input required value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
          {(['url', 'title', 'publisher', 'license', 'retrievedAt', 'sourceRecordId'] as const).map(key => <label className="field-control" key={key}>{t(SOURCE_KEYS[key])}<input required type={key === 'url' ? 'url' : 'text'} placeholder={key === 'retrievedAt' ? t('retrieved_placeholder') : undefined} value={draft.source[key]} onChange={e => setDraft({ ...draft, source: { ...draft.source, [key]: e.target.value } })} /></label>)}
          <label className="field-control">{t('precision')}<input type="number" min="0" step="any" placeholder={t('precision_placeholder')} value={draft.coordinatePrecisionDegrees ?? ''} onChange={e => setDraft({ ...draft, coordinatePrecisionDegrees: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <label className="field-control">{t('upstream_sha')}<input value={draft.source.upstreamSha256 ?? ''} onChange={e => setDraft({ ...draft, source: { ...draft.source, upstreamSha256: e.target.value || null } })} /></label>
        </div>
        <button className="field-button primary mt-3" disabled={busy}>{t('import_mapping')}</button>
      </form>}
    </>}
    {error != null && <p className="field-error" role="alert">{errorText(error)}</p>}
    <label className="field-control mt-4">{t('review_version')}<select aria-label={t('review_version')} value={selected} onChange={e => { setSelected(e.target.value); setReviewed(false); setShare(records.find(r => r.id === e.target.value)?.visibility === 'shared_aggregate'); }}>
      <option value="">{t('select_version')}</option>{records.map(r => <option key={r.id} value={r.id}>{r.document.name} · {wt.approval(r.approvalState)} · {r.contentHash.slice(0, 12)}</option>)}
    </select></label>
    {record && <section className="mt-4 min-w-0" aria-label={t('boundary_review')}>
      <h3 className="font-semibold break-words">{record.document.name} · {wt.approval(record.approvalState)}</h3><p>{record.document.description}</p>
      <p className="text-sm break-words"><a href={record.document.source.url}>{record.document.source.publisher} · {record.document.source.title}</a> · {record.document.source.license} · {t('retrieved', { date: record.document.source.retrievedAt })}</p>
      <p className="text-sm break-words">{t('features_line', { count: record.document.features.length, crs: record.document.coordinateReferenceSystem,
        precision: record.document.coordinatePrecisionDegrees === null ? t('unspecified') : `${record.document.coordinatePrecisionDegrees}°`, visibility: wt.visibility(record.visibility) })}</p>
      <p className="text-xs break-all">{t('hash_line', { hash: record.contentHash, by: record.approvedBy ?? t('nobody'), at: record.approvedAt ?? t('not_approved') })}</p>
      {collapsedRings(record.document).map(w => <p className="field-warning text-sm" key={`${w.featureId}:${w.polygonIndex}:${w.ringIndex}`}>{t('warning_collapsed', { feature: w.featureId, polygon: w.polygonIndex, ring: w.ringIndex })}</p>)}
      <details className="mt-3"><summary>{t('ids_summary')}</summary><div className="max-h-64 overflow-auto"><table className="field-table"><thead><tr><th>{t('col_id')}</th><th>{t('col_label')}</th><th>{t('col_geometry')}</th></tr></thead><tbody>{record.document.features.map(f => <tr key={f.id}><td>{f.id}</td><td>{f.name}</td><td>{f.geometry.type}</td></tr>)}</tbody></table></div></details>
      <button className="field-button mt-3" onClick={() => downloadText('watchdog-boundary.json', JSON.stringify(record.document, null, 2), 'application/json')}>{t('download')}</button>
      {access.capabilities.includes('dataset.approve') && record.ownerId === access.principalId && <div className="space-y-3 mt-4">
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />{t('review_check')}</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} />{t('share')}</label>
        <button className="field-button primary" disabled={busy || !reviewed} onClick={() => act(async () => { await workbenchApi(`geometry-layers/${record.id}/approve`, { expectedHash: record.contentHash, shareAggregate: share }); await onChanged(); setReviewed(false); })}>{record.approvalState === 'PROPOSED' ? t('approve') : t('update_sharing')}</button>
        {record.approvalState === 'APPROVED' && <button className="field-button ml-2" disabled={busy} onClick={() => act(async () => { await workbenchApi(`geometry-layers/${record.id}/revoke`, {}); await onChanged(); setReviewed(false); })}>{t('revoke')}</button>}
      </div>}
    </section>}
  </details>;
}
