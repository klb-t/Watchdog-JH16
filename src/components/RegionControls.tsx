import { useEffect, useState } from 'react';
import { checkFigureBindings, checkFigureProfile, type DatasetRecord, type FigureSpec, type WorkbenchProfile } from '../../shared/workbench';
import { checkGeographyBinding, fitGeometry, joinRegions, regionJoinReport, type GeometryLayerRecord } from '../../shared/geography';
import text from '../../config/ui/region-controls.json';
import { useUiText } from '../lib/ui_text';
import { clientError } from '../lib/api_error';
import { useWorkbenchText } from '../lib/workbench_text';

export function RegionControls({ record, spec, profile, layers, onChange }: { record: DatasetRecord; spec: FigureSpec; profile: WorkbenchProfile;
  layers: GeometryLayerRecord[]; onChange: (spec: FigureSpec) => void }) {
  const { t, errorText } = useUiText(text), wt = useWorkbenchText();
  const [source, setSource] = useState(''), [target, setTarget] = useState(''), [breaks, setBreaks] = useState(''), [error, setError] = useState<unknown>(null);
  const geometry = layers.find(r => r.id === spec.geography?.layerId && r.contentHash === spec.geography?.layerHash);
  useEffect(() => { setBreaks(spec.geography?.classification.breaks.join(', ') ?? ''); }, [JSON.stringify(spec.geography?.classification)]);
  useEffect(() => { setSource(''); setTarget(''); setError(null); }, [spec.channels.region, spec.geography?.layerId]);
  const identifiers = [...new Set(record.document.rows.map(r => r.values[spec.channels.region!]).filter(v => v !== null && v !== undefined).map(String))].sort();
  return <fieldset className="mt-4 border-t pt-4 min-w-0"><legend className="font-medium">{t('legend')}</legend>
    <p className="text-sm">{t('intro')}</p>
    <div className="grid sm:grid-cols-2 gap-3 mt-3">
      <label className="field-control">{t('boundary_layer')}<select aria-label={t('boundary_layer')} value={geometry?.id ?? ''} onChange={e => {
        const layer = layers.find(r => r.id === e.target.value); const next = { ...spec }; delete next.geography;
        if (layer) next.geography = { version: 'region-map-1', layerId: layer.id, layerHash: layer.contentHash, mappings: {}, classification: { mode: 'equal_interval', breaks: [] } };
        onChange(next);
      }}><option value="">{t('select_layer')}</option>{layers.filter(r => r.approvalState === 'APPROVED').map(r => <option key={r.id} value={r.id}>{r.document.name} · {r.contentHash.slice(0, 12)}</option>)}</select></label>
      {spec.geography && <label className="field-control">{t('classification')}<select aria-label={t('classification')} value={spec.geography.classification.mode} onChange={e => onChange({ ...spec, geography: { ...spec.geography!, classification: { mode: e.target.value as 'equal_interval' | 'manual', breaks: [] } } })}><option value="equal_interval">{t('equal_interval')}</option><option value="manual">{t('manual')}</option></select></label>}
    </div>
    {spec.geography && !geometry && <p role="alert" className="field-warning">{t('pinned_unavailable')}</p>}
    {geometry && <>
      <p className="text-xs mt-2 break-all">{t('layer_line', { count: geometry.document.features.length, state: wt.approval(geometry.approvalState), hash: geometry.contentHash })}</p>
      <button className="field-button mt-3" disabled={geometry.approvalState !== 'APPROVED'} onClick={() => onChange({ ...spec, camera: { ...spec.camera, ...fitGeometry(geometry.document.features) } })}>{t('fit_layer')}</button>
      <button className="field-button mt-3 ml-2" disabled={geometry.approvalState !== 'APPROVED' || !spec.channels.region} onClick={() => { try {
        const ids = new Set(joinRegions(record.document, spec, geometry.document).regions.filter(r => r.rowIds.length).map(r => r.featureId));
        onChange({ ...spec, camera: { ...spec.camera, ...fitGeometry(geometry.document.features.filter(f => ids.has(f.id))) } }); setError(null);
      } catch (e) { setError(e); } }}>{t('fit_observed')}</button>
      {spec.geography?.classification.mode === 'manual' && <div className="flex flex-wrap items-end gap-3 mt-3">
        <label className="field-control flex-1">{t('manual_breaks')}<input aria-label={t('manual_breaks')} value={breaks} onChange={e => setBreaks(e.target.value)} placeholder={t('breaks_placeholder')} /></label>
        <button className="field-button" onClick={() => { try {
          const parts = breaks.split(',').map(v => v.trim()); if (parts.some(v => !v || !Number.isFinite(Number(v)))) throw clientError('break_not_finite', 'Every class boundary must be an explicit finite number.');
          const next = { ...spec, geography: { ...spec.geography!, classification: { mode: 'manual' as const, breaks: parts.map(Number) } } };
          checkFigureProfile(next, profile); onChange(next); setError(null);
        } catch (e) { setError(e); } }}>{t('apply_breaks')}</button>
        <p className="text-sm w-full">{t('breaks_help', { count: (profile.palettes.find(p => p.id === spec.style.palette)?.colors.length ?? 1) - 1 })}</p>
      </div>}
      <details className="mt-3"><summary>{t('mappings_summary')}</summary>
        <p className="text-sm mt-2">{t('mappings_note')}</p>
        <div className="grid sm:grid-cols-2 gap-3 mt-2">
          <label className="field-control">{t('source_identifier')}<select aria-label={t('source_identifier')} value={source} onChange={e => setSource(e.target.value)}><option value="">{t('choose_source')}</option>{identifiers.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
          <label className="field-control">{t('target_identifier')}<select aria-label={t('target_identifier')} value={target} onChange={e => setTarget(e.target.value)}><option value="">{t('choose_target')}</option>{geometry.document.features.map(f => <option key={f.id} value={f.id}>{f.id} · {f.name}</option>)}</select></label>
        </div>
        <button className="field-button mt-2" disabled={!source || !target || !spec.geography} onClick={() => onChange({ ...spec, geography: { ...spec.geography!, mappings: { ...spec.geography!.mappings, [source]: target } } })}>{t('add_mapping')}</button>
        <ul className="text-sm mt-2 break-words">{Object.entries(spec.geography?.mappings ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([from, to]) => <li key={from}>{from} → {to} <button className="underline" aria-label={t('remove_mapping', { from })} onClick={() => { const mappings = { ...spec.geography!.mappings }; delete mappings[from]; onChange({ ...spec, geography: { ...spec.geography!, mappings } }); }}>{t('remove')}</button></li>)}</ul>
      </details>
    </>}
    {error != null && <p role="alert" className="field-error">{errorText(error)}</p>}
  </fieldset>;
}

export function RegionInspector({ record, spec, profile, geometry, inspectedId, onInspect, onSelect }: {
  record: DatasetRecord; spec: FigureSpec; profile: WorkbenchProfile; geometry?: GeometryLayerRecord; inspectedId: string | null;
  onInspect: (row: DatasetRecord['document']['rows'][number]) => void; onSelect: (id: string) => void;
}) {
  const { t } = useUiText(text), wt = useWorkbenchText();
  if (!geometry) return null;
  let report: ReturnType<typeof regionJoinReport>;
  try { checkFigureProfile(spec, profile); checkFigureBindings(spec, record.document); checkGeographyBinding(spec, geometry); report = regionJoinReport(record.document, spec, geometry.document); } catch { return null; }
  const feature = geometry.document.features.find(f => f.id === inspectedId);
  const rows = new Map(record.document.rows.map(r => [r.id, r]));
  const rowButton = (id: string) => <button className="field-button" key={id} onClick={() => onInspect(rows.get(id)!)}>{t('inspect_source', { id })}</button>;
  const facetLabel = (facet: unknown) => `${spec.channels.facet}: ${facet ?? t('facet_missing')}`;
  // The report's reasons are exported in English; the page words the two known reasons in the reader's language.
  const reason = (row: { region: string | number | null; reason: string }) =>
    row.reason === 'Missing region identifier' ? t('unmatched_missing')
      : row.reason === `No exact geometry match for ${JSON.stringify(row.region)}` ? t('unmatched_no_match', { region: JSON.stringify(row.region) }) : row.reason;
  return <section className="field-panel min-w-0" aria-label={t('inspector_title')}><h2>{t('inspector_title')}</h2>
    <p className="text-sm">{t('inspector_help')}</p>
    {feature && <div className="my-3"><h3 className="font-semibold break-words">{feature.name} [{feature.id}]</h3>
      {report.panels.map((panel, i) => { const joined = panel.regions.find(r => r.featureId === feature.id)!; return <div className="border-t mt-2 pt-2" key={i}>
        <p className="break-words">{spec.channels.facet ? `${facetLabel(panel.facet)} · ` : ''}{wt.regionState(joined.state)} · {t('source_observations', { count: joined.rowIds.length })}</p>
        <div className="flex flex-wrap gap-2 mt-2">{joined.rowIds.map(rowButton)}</div>
        {joined.rowIds.length > 0 && <div className="flex flex-wrap gap-2 mt-2">{joined.rowIds.map(id => <button className="field-button" key={id} aria-pressed={spec.selectedIds.includes(id)} onClick={() => onSelect(id)}>{spec.selectedIds.includes(id) ? t('deselect_for_stats', { id }) : t('select_for_stats', { id })}</button>)}</div>}
      </div>; })}
    </div>}
    <details><summary>{t('diagnostics', { count: report.panels.length })}</summary>
      {report.panels.map((panel, i) => <div className="mt-3" key={i}><h3 className="font-semibold break-words">{spec.channels.facet ? facetLabel(panel.facet) : t('current_frame')}</h3>
        <p className="text-sm">{t('diagnostic_counts', { numeric: panel.regions.filter(r => r.state === 'value').length, missing: panel.regions.filter(r => r.state === 'missing').length,
          none: panel.regions.filter(r => r.state === 'no_observation').length, ambiguous: panel.regions.filter(r => r.state === 'ambiguous').length, unmatched: panel.unmatched.length })}</p>
        {panel.unmatched.map(row => <div className="text-sm mt-2 break-words" key={row.rowId}>{reason(row)} · {rowButton(row.rowId)}</div>)}
      </div>)}
    </details>
  </section>;
}
