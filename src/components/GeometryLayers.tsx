import { useState } from 'react';
import { useAccess } from '../lib/access';
import { workbenchApi, downloadText } from '../lib/workbench_client';
import { mapGeoJson, validateGeometryLayer, geometryWarnings, type GeometryLayerDocument, type GeometryLayerRecord } from '../../shared/geography';

/** Source review is independent of the dataset review and the figure's color scale. */
export function GeometryLayers({ records, busy, act, onChanged }: {
  records: GeometryLayerRecord[]; busy: boolean; act: (fn: () => Promise<void>) => Promise<void>; onChanged: () => Promise<void>;
}) {
  const access = useAccess();
  const [json, setJson] = useState(''), [raw, setRaw] = useState(''), [idProperty, setIdProperty] = useState(''), [nameProperty, setNameProperty] = useState('');
  const [draft, setDraft] = useState<GeometryLayerDocument | null>(null), [selected, setSelected] = useState('');
  const [reviewed, setReviewed] = useState(false), [share, setShare] = useState(false), [error, setError] = useState('');
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
      setError('');
    } catch (e) { setError((e as Error).message); }
  }
  return <details className="field-panel"><summary className="font-semibold">Boundary layers · import, review and versions</summary>
    <p className="text-sm my-3">Each boundary version has its own source and approval. Coordinates use WGS84 longitude, latitude. Region names and codes are never guessed. Changed boundaries create a new version.</p>
    {access.capabilities.includes('dataset.import') && <>
      <label className="field-control">Read boundary JSON or GeoJSON<input type="file" accept=".json,.geojson,application/geo+json" disabled={busy} onChange={e => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
        void act(async () => {
          if (file.size > 1_000_000) throw new Error('Boundary file exceeds the 1 MB import limit.');
          const text = await file.text(), document = JSON.parse(text);
          if (document.type === 'FeatureCollection') setRaw(text); else setJson(text);
        });
      }} /></label>
      <div className="grid md:grid-cols-2 gap-4 mt-4"><div>
        <label className="field-control">Mapped boundary JSON<textarea rows={6} spellCheck={false} value={json} onChange={e => setJson(e.target.value)} /></label>
        <button className="field-button mt-2" disabled={busy || !json} onClick={() => act(() => importLayer(JSON.parse(json)))}>Import boundary JSON as proposed</button>
        <button className="field-button mt-2" disabled={busy} onClick={() => act(async () => { const data = await workbenchApi('geometry-catalog/world'); await importLayer(data.document); })}>Import bundled world boundaries as proposed</button>
      </div><div>
        <label className="field-control">Source GeoJSON<textarea rows={6} spellCheck={false} value={raw} onChange={e => setRaw(e.target.value)} /></label>
        <div className="grid sm:grid-cols-2 gap-3 mt-2">
          <label className="field-control">Identifier property<input value={idProperty} onChange={e => setIdProperty(e.target.value)} placeholder="Blank uses feature.id" /></label>
          <label className="field-control">Label property<input value={nameProperty} onChange={e => setNameProperty(e.target.value)} placeholder="Blank uses identifier" /></label>
        </div>
        <button className="field-button mt-2" disabled={busy || !raw} onClick={prepare}>Prepare GeoJSON mapping</button>
      </div></div>
      {draft && <form className="border-t mt-4 pt-4" onSubmit={e => { e.preventDefault(); void act(() => importLayer(draft)); }}>
        <h3 className="font-semibold">GeoJSON mapping · {draft.features.length} features</h3>
        <p className="text-sm">The exact source text and chosen fields are retained. Supports closed 2D Polygon and MultiPolygon rings, including holes. Cut antimeridian crossings before import; no reprojection or geometry repair is performed.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
          {(['key', 'name', 'description'] as const).map(key => <label className="field-control" key={key}>Boundary {key}<input required value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
          {(['url', 'title', 'publisher', 'license', 'retrievedAt', 'sourceRecordId'] as const).map(key => <label className="field-control" key={key}>Boundary source {key}<input required type={key === 'url' ? 'url' : 'text'} placeholder={key === 'retrievedAt' ? 'YYYY-MM-DD or ISO timestamp' : undefined} value={draft.source[key]} onChange={e => setDraft({ ...draft, source: { ...draft.source, [key]: e.target.value } })} /></label>)}
          <label className="field-control">Declared coordinate precision (degrees)<input type="number" min="0" step="any" placeholder="Unknown" value={draft.coordinatePrecisionDegrees ?? ''} onChange={e => setDraft({ ...draft, coordinatePrecisionDegrees: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <label className="field-control">Upstream SHA-256 (if supplied)<input value={draft.source.upstreamSha256 ?? ''} onChange={e => setDraft({ ...draft, source: { ...draft.source, upstreamSha256: e.target.value || null } })} /></label>
        </div>
        <button className="field-button primary mt-3" disabled={busy}>Import GeoJSON mapping as proposed</button>
      </form>}
    </>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <label className="field-control mt-4">Review boundary version<select aria-label="Review boundary version" value={selected} onChange={e => { setSelected(e.target.value); setReviewed(false); setShare(records.find(r => r.id === e.target.value)?.visibility === 'shared_aggregate'); }}>
      <option value="">Select a boundary version</option>{records.map(r => <option key={r.id} value={r.id}>{r.document.name} · {r.approvalState} · {r.contentHash.slice(0, 12)}</option>)}
    </select></label>
    {record && <section className="mt-4" aria-label="Boundary review">
      <h3 className="font-semibold">{record.document.name} · {record.approvalState}</h3><p>{record.document.description}</p>
      <p className="text-sm"><a href={record.document.source.url}>{record.document.source.publisher} · {record.document.source.title}</a> · {record.document.source.license} · retrieved {record.document.source.retrievedAt}</p>
      <p className="text-sm">{record.document.features.length} features · {record.document.coordinateReferenceSystem} · coordinate precision: {record.document.coordinatePrecisionDegrees === null ? 'unspecified' : `${record.document.coordinatePrecisionDegrees}°`} · {record.visibility}</p>
      <p className="text-xs break-all">SHA-256: {record.contentHash} · approved by: {record.approvedBy ?? 'nobody'} · {record.approvedAt ?? 'not approved'}</p>
      {geometryWarnings(record.document).map(warning => <p className="field-warning text-sm" key={warning}>{warning}</p>)}
      <details className="mt-3"><summary>Boundary identifiers and names</summary><div className="max-h-64 overflow-auto"><table className="field-table"><thead><tr><th>Exact identifier</th><th>Source label</th><th>Geometry</th></tr></thead><tbody>{record.document.features.map(f => <tr key={f.id}><td>{f.id}</td><td>{f.name}</td><td>{f.geometry.type}</td></tr>)}</tbody></table></div></details>
      <button className="field-button mt-3" onClick={() => downloadText('watchdog-boundary.json', JSON.stringify(record.document, null, 2), 'application/json')}>Download boundary source and mapping</button>
      {access.capabilities.includes('dataset.approve') && record.ownerId === access.principalId && <div className="space-y-3 mt-4">
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I checked these exact boundary coordinates, identifiers, source, license and geographic scope.</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} />Share this reviewed boundary layer with institutional profiles.</label>
        <button className="field-button primary" disabled={busy || !reviewed} onClick={() => act(async () => { await workbenchApi(`geometry-layers/${record.id}/approve`, { expectedHash: record.contentHash, shareAggregate: share }); await onChanged(); setReviewed(false); })}>{record.approvalState === 'PROPOSED' ? 'Approve this boundary mapping' : 'Update boundary sharing after review'}</button>
        {record.approvalState === 'APPROVED' && <button className="field-button ml-2" disabled={busy} onClick={() => act(async () => { await workbenchApi(`geometry-layers/${record.id}/revoke`, {}); await onChanged(); setReviewed(false); })}>Revoke boundary approval</button>}
      </div>}
    </section>}
  </details>;
}
