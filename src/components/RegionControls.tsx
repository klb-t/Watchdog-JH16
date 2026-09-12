import { useEffect, useState } from 'react';
import { checkFigureBindings, checkFigureProfile, type DatasetRecord, type FigureSpec, type WorkbenchProfile } from '../../shared/workbench';
import { checkGeographyBinding, fitGeometry, joinRegions, regionJoinReport, type GeometryLayerRecord } from '../../shared/geography';

export function RegionControls({ record, spec, profile, layers, onChange }: { record: DatasetRecord; spec: FigureSpec; profile: WorkbenchProfile;
  layers: GeometryLayerRecord[]; onChange: (spec: FigureSpec) => void }) {
  const [source, setSource] = useState(''), [target, setTarget] = useState(''), [breaks, setBreaks] = useState(''), [error, setError] = useState('');
  const geometry = layers.find(r => r.id === spec.geography?.layerId && r.contentHash === spec.geography?.layerHash);
  useEffect(() => { setBreaks(spec.geography?.classification.breaks.join(', ') ?? ''); }, [JSON.stringify(spec.geography?.classification)]);
  useEffect(() => { setSource(''); setTarget(''); setError(''); }, [spec.channels.region, spec.geography?.layerId]);
  const identifiers = [...new Set(record.document.rows.map(r => r.values[spec.channels.region!]).filter(v => v !== null && v !== undefined).map(String))].sort();
  return <fieldset className="mt-4 border-t pt-4"><legend className="font-medium">Region boundaries and exact joins</legend>
    <p className="text-sm">REGION joins to boundary identifiers; COLOR is the reported numeric value. X and Y remain inputs for the statistical tools. Use time or panels to distinguish observations before drawing regional colors.</p>
    <div className="grid sm:grid-cols-2 gap-3 mt-3">
      <label className="field-control">Boundary layer<select aria-label="Boundary layer" value={geometry?.id ?? ''} onChange={e => {
        const layer = layers.find(r => r.id === e.target.value); const next = { ...spec }; delete next.geography;
        if (layer) next.geography = { version: 'region-map-1', layerId: layer.id, layerHash: layer.contentHash, mappings: {}, classification: { mode: 'equal_interval', breaks: [] } };
        onChange(next);
      }}><option value="">Select an approved boundary layer</option>{layers.filter(r => r.approvalState === 'APPROVED').map(r => <option key={r.id} value={r.id}>{r.document.name} · {r.contentHash.slice(0, 12)}</option>)}</select></label>
      {spec.geography && <label className="field-control">Color classification<select aria-label="Color classification" value={spec.geography.classification.mode} onChange={e => onChange({ ...spec, geography: { ...spec.geography!, classification: { mode: e.target.value as 'equal_interval' | 'manual', breaks: [] } } })}><option value="equal_interval">Equal intervals of source values</option><option value="manual">Explicit class boundaries</option></select></label>}
    </div>
    {spec.geography && !geometry && <p role="alert" className="field-warning">The pinned boundary version is unavailable. Import and review that exact version or explicitly choose another layer.</p>}
    {geometry && <>
      <p className="text-xs mt-2 break-all">{geometry.document.features.length} features · {geometry.approvalState} · SHA-256 {geometry.contentHash}</p>
      <button className="field-button mt-3" disabled={geometry.approvalState !== 'APPROVED'} onClick={() => onChange({ ...spec, camera: { ...spec.camera, ...fitGeometry(geometry.document.features) } })}>Fit boundary layer</button>
      <button className="field-button mt-3 ml-2" disabled={geometry.approvalState !== 'APPROVED' || !spec.channels.region} onClick={() => { try {
        const ids = new Set(joinRegions(record.document, spec, geometry.document).regions.filter(r => r.rowIds.length).map(r => r.featureId));
        onChange({ ...spec, camera: { ...spec.camera, ...fitGeometry(geometry.document.features.filter(f => ids.has(f.id))) } }); setError('');
      } catch (e) { setError((e as Error).message); } }}>Fit regions with observations</button>
      {spec.geography?.classification.mode === 'manual' && <div className="flex flex-wrap items-end gap-3 mt-3">
        <label className="field-control flex-1">Manual class boundaries<input aria-label="Manual class boundaries" value={breaks} onChange={e => setBreaks(e.target.value)} placeholder="Comma-separated numbers, in ascending order" /></label>
        <button className="field-button" onClick={() => { try {
          const parts = breaks.split(',').map(v => v.trim()); if (parts.some(v => !v || !Number.isFinite(Number(v)))) throw new Error('Every class boundary must be an explicit finite number.');
          const next = { ...spec, geography: { ...spec.geography!, classification: { mode: 'manual' as const, breaks: parts.map(Number) } } };
          checkFigureProfile(next, profile); onChange(next); setError('');
        } catch (e) { setError((e as Error).message); } }}>Apply class boundaries</button>
        <p className="text-sm w-full">Enter {(profile.palettes.find(p => p.id === spec.style.palette)?.colors.length ?? 1) - 1} boundaries for the selected palette. Values equal to a boundary enter the upper class. Classification changes color only.</p>
      </div>}
      <details className="mt-3"><summary>Explicit identifier mappings</summary>
        <p className="text-sm mt-2">Exact identifiers already match without a mapping. Add a source-to-boundary mapping only when its meaning is documented. Multiple source rows mapped to the same feature remain ambiguous.</p>
        <div className="grid sm:grid-cols-2 gap-3 mt-2">
          <label className="field-control">Source region identifier<select aria-label="Source region identifier" value={source} onChange={e => setSource(e.target.value)}><option value="">Choose a source identifier</option>{identifiers.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
          <label className="field-control">Target boundary identifier<select aria-label="Target boundary identifier" value={target} onChange={e => setTarget(e.target.value)}><option value="">Choose a boundary identifier</option>{geometry.document.features.map(f => <option key={f.id} value={f.id}>{f.id} · {f.name}</option>)}</select></label>
        </div>
        <button className="field-button mt-2" disabled={!source || !target || !spec.geography} onClick={() => onChange({ ...spec, geography: { ...spec.geography!, mappings: { ...spec.geography!.mappings, [source]: target } } })}>Add explicit region mapping</button>
        <ul className="text-sm mt-2">{Object.entries(spec.geography?.mappings ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([from, to]) => <li key={from}>{from} → {to} <button className="underline" aria-label={`Remove mapping ${from}`} onClick={() => { const mappings = { ...spec.geography!.mappings }; delete mappings[from]; onChange({ ...spec, geography: { ...spec.geography!, mappings } }); }}>Remove</button></li>)}</ul>
      </details>
    </>}
    {error && <p role="alert" className="field-error">{error}</p>}
  </fieldset>;
}

export function RegionInspector({ record, spec, profile, geometry, inspectedId, onInspect, onSelect }: {
  record: DatasetRecord; spec: FigureSpec; profile: WorkbenchProfile; geometry?: GeometryLayerRecord; inspectedId: string | null;
  onInspect: (row: DatasetRecord['document']['rows'][number]) => void; onSelect: (id: string) => void;
}) {
  if (!geometry) return null;
  let report: ReturnType<typeof regionJoinReport>;
  try { checkFigureProfile(spec, profile); checkFigureBindings(spec, record.document); checkGeographyBinding(spec, geometry); report = regionJoinReport(record.document, spec, geometry.document); } catch { return null; }
  const feature = geometry.document.features.find(f => f.id === inspectedId);
  const rows = new Map(record.document.rows.map(r => [r.id, r]));
  const rowButton = (id: string) => <button className="field-button" key={id} onClick={() => onInspect(rows.get(id)!)}>{id} · inspect source</button>;
  return <section className="field-panel" aria-label="Region join inspection"><h2>Region join inspection</h2>
    <p className="text-sm">Inspect a region by hovering, focusing or clicking it. Hatch patterns distinguish missing values from multiple observations. Selection never resolves an ambiguous join.</p>
    {feature && <div className="my-3"><h3 className="font-semibold">{feature.name} [{feature.id}]</h3>
      {report.panels.map((panel, i) => { const joined = panel.regions.find(r => r.featureId === feature.id)!; return <div className="border-t mt-2 pt-2" key={i}>
        <p>{spec.channels.facet ? `${spec.channels.facet}: ${panel.facet ?? '(missing)'} · ` : ''}{joined.state} · {joined.rowIds.length} source observations</p>
        <div className="flex flex-wrap gap-2 mt-2">{joined.rowIds.map(rowButton)}</div>
        {joined.rowIds.length > 0 && <div className="flex flex-wrap gap-2 mt-2">{joined.rowIds.map(id => <button className="field-button" key={id} aria-pressed={spec.selectedIds.includes(id)} onClick={() => onSelect(id)}>{spec.selectedIds.includes(id) ? 'Deselect' : 'Select'} {id} for statistics</button>)}</div>}
      </div>; })}
    </div>}
    <details><summary>Join diagnostics · {report.panels.length} panels</summary>
      {report.panels.map((panel, i) => <div className="mt-3" key={i}><h3 className="font-semibold">{spec.channels.facet ? `${spec.channels.facet}: ${panel.facet ?? '(missing)'}` : 'Current frame'}</h3>
        <p className="text-sm">{panel.regions.filter(r => r.state === 'value').length} numeric · {panel.regions.filter(r => r.state === 'missing').length} missing value · {panel.regions.filter(r => r.state === 'no_observation').length} no observation · {panel.regions.filter(r => r.state === 'ambiguous').length} ambiguous · {panel.unmatched.length} unmatched rows</p>
        {panel.unmatched.map(row => <div className="text-sm mt-2" key={row.rowId}>{row.reason} · {rowButton(row.rowId)}</div>)}
      </div>)}
    </details>
  </section>;
}
