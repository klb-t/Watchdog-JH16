import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAccess } from '../lib/access';
import { workbenchApi, downloadText, downloadBlob } from '../lib/workbench_client';
import { defaultFigure, filterRows, type DatasetRecord, type FigureSpec, type SavedFigure, type WorkbenchProfile, selectionIdentity } from '../../shared/workbench';
import { DatasetImport } from '../components/DatasetImport';
import { FigureCanvas } from '../components/FigureCanvas';
import { GeometryLayers } from '../components/GeometryLayers';
import { RegionControls, RegionInspector } from '../components/RegionControls';
import { fitGeometry, type GeometryLayerRecord } from '../../shared/geography';
import text from '../../config/ui/workbench.json';
import { useUiText } from '../lib/ui_text';
import { clientError } from '../lib/api_error';
import { useWorkbenchText } from '../lib/workbench_text';

type WorkbenchKey = Extract<keyof typeof text.languages.en, string>;
type Notice = { key: WorkbenchKey; vars?: Record<string, string | number> };
const TOGGLE_KEYS = { labels: 'toggle_labels', grid: 'toggle_grid', legend: 'toggle_legend' } as const;
const STYLE_KEYS = { title: 'style_title', subtitle: 'style_subtitle', xLabel: 'style_xlabel', yLabel: 'style_ylabel' } as const;
const RANGE_KEYS = { opacity: 'range_opacity', pointSize: 'range_pointsize', lineWidth: 'range_linewidth', fontSize: 'range_fontsize' } as const;
const CAMERA_KEYS = { yaw: 'camera_yaw', pitch: 'camera_pitch', zoom: 'camera_zoom' } as const;
const SCALE_KEYS = { xScale: 'scale_x', yScale: 'scale_y' } as const;
const CENTER_KEYS = { centerLongitude: 'center_longitude', centerLatitude: 'center_latitude' } as const;

export function Workbench() {
  const access = useAccess();
  return <WorkbenchContent key={access.principalId ?? 'pending'} />;
}

function WorkbenchContent() {
  const access = useAccess(), svgRef = useRef<SVGSVGElement>(null);
  const { t, tCode, errorText } = useUiText(text), wt = useWorkbenchText();
  const [params] = useSearchParams(), openedDataset = useRef<string | null>(null), openedFigure = useRef<string | null>(null), openedMethod = useRef<string | null>(null), restoringMethod = useRef(false);
  const requestedDataset = params.get('dataset'), requestedFigure = params.get('figure'), requestedMethod = params.get('method');
  const [currentProfile, setCurrentProfile] = useState<WorkbenchProfile | null>(null), [records, setRecords] = useState<DatasetRecord[]>([]), [saved, setSaved] = useState<SavedFigure[]>([]);
  const [geometryLayers, setGeometryLayers] = useState<GeometryLayerRecord[]>([]), [inspectedRegion, setInspectedRegion] = useState<string | null>(null);
  const [archivedProfile, setArchivedProfile] = useState<WorkbenchProfile | null>(null);
  const [datasetId, setDatasetId] = useState(''), [spec, setSpecState] = useState<FigureSpec | null>(null);
  function setSpec(update: FigureSpec | null | ((value: FigureSpec | null) => FigureSpec | null)) {
    setSpecState(previous => {
      const next = typeof update === 'function' ? update(previous) : update;
      if (next && previous && next.analysis === previous.analysis && JSON.stringify(selectionIdentity(next, [next.channels.x, next.channels.y])) !== JSON.stringify(selectionIdentity(previous, [previous.channels.x, previous.channels.y]))) return { ...next, analysis: null };
      return next;
    });
  }
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [notice, setNotice] = useState<Notice | null>(null);
  const [reviewed, setReviewed] = useState(false), [share, setShare] = useState(false), [favorite, setFavorite] = useState(true);
  const [filterColumn, setFilterColumn] = useState(''), [filterValue, setFilterValue] = useState(''), [filterEnd, setFilterEnd] = useState(''), [filterOperator, setFilterOperator] = useState('equals');
  const [menu, setMenu] = useState(false), [inspected, setInspected] = useState<DatasetRecord['document']['rows'][number] | null>(null);
  const [method, setMethod] = useState<any>(null), [methodReviewed, setMethodReviewed] = useState(false), [analysis, setAnalysis] = useState<any>(null), [playing, setPlaying] = useState(false);
  const profile = spec && spec.profileHash !== currentProfile?.contentHash ? (archivedProfile?.contentHash === spec.profileHash ? archivedProfile : null) : currentProfile;
  const tiers = profile?.evidenceDisplay;
  const geometry = geometryLayers.find(r => r.id === spec?.geography?.layerId && r.contentHash === spec?.geography?.layerHash);
  const record = records.find(r => r.id === datasetId), columns = record?.document.columns ?? [];
  async function load() {
    const [p, d, f, g] = await Promise.all([workbenchApi('profile'), workbenchApi('datasets'), workbenchApi('figures'), workbenchApi('geometry-layers')]);
    setCurrentProfile(p); setRecords(d.records); setSaved(f.figures); setGeometryLayers(g.records);
  }
  useEffect(() => { load().catch(e => setError(e)); }, []);
  useEffect(() => {
    if (!currentProfile || !requestedDataset || openedDataset.current === requestedDataset) return;
    openedDataset.current = requestedDataset;
    if (records.some(r => r.id === requestedDataset)) selectDataset(requestedDataset);
    else setError(clientError('requested_dataset_unavailable', 'The requested dataset is unavailable for this account.'));
  }, [currentProfile, requestedDataset, records]);
  useEffect(() => {
    if (!currentProfile || !requestedFigure || openedFigure.current === requestedFigure) return;
    openedFigure.current = requestedFigure;
    const selected = saved.find(f => f.id === requestedFigure), data = selected && records.find(r => r.id === selected.spec.datasetId && r.contentHash === selected.spec.datasetHash && r.approvalState === 'APPROVED');
    if (!selected || !data) { setError(clientError('requested_figure_unavailable', 'The requested saved figure or its exact approved dataset is unavailable for this account.')); return; }
    setError(null); setPlaying(false); setInspected(null); setDatasetId(data.id); setSpec(selected.spec); setNotice({ key: 'notice_restored_figure', vars: { hash: selected.hash } });
  }, [currentProfile, requestedFigure, saved, records]);
  useEffect(() => {
    if (!currentProfile || !requestedMethod || openedMethod.current === requestedMethod) return;
    let active = true;
    workbenchApi(`methods/${encodeURIComponent(requestedMethod)}`).then(data => {
      if (!active) return;
      const source = records.find(r => r.id === data.method.datasetId);
      if (!source) { setError(clientError('requested_method_unavailable', 'The requested method source is unavailable for this account.')); return; }
      openedMethod.current = requestedMethod; restoringMethod.current = true;
      setError(null); setPlaying(false); setInspected(null); setDatasetId(source.id); setSpec(data.method.selection.figure);
      setMethod(data.method); setMethodReviewed(false); setAnalysis(null); setNotice({ key: 'notice_opened_method', vars: { hash: data.method.hash } });
    }).catch(e => { if (active) setError(e); });
    return () => { active = false; };
  }, [currentProfile, requestedMethod, records]);
  useEffect(() => {
    if (!spec || spec.profileHash === currentProfile?.contentHash || spec.profileHash === archivedProfile?.contentHash) return;
    let active = true;
    workbenchApi(`profiles/${spec.profileHash}`).then(p => { if (active) setArchivedProfile(p); }).catch(e => { if (active) setError(e); });
    return () => { active = false; };
  }, [spec?.profileHash, currentProfile?.contentHash, archivedProfile?.contentHash]);
  useEffect(() => { if (restoringMethod.current) { restoringMethod.current = false; return; } setMethod(null); setAnalysis(null); }, [spec?.channels.x, spec?.channels.y, spec?.channels.time, spec?.filters, spec?.selectedIds, spec?.timeValue, datasetId]);
  useEffect(() => { setInspectedRegion(null); setInspected(null); }, [datasetId, spec?.geography?.layerId]);
  const frames = record && spec?.channels.time ? [...new Set(record.document.rows.map(r => r.values[spec.channels.time!]).filter(v => v !== null))].sort((a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))) : [];
  useEffect(() => {
    if (!playing || !spec || !frames.length) return;
    const timer = setInterval(() => setSpec(current => current ? { ...current, timeValue: frames[(frames.indexOf(current.timeValue as any) + 1) % frames.length] } : current), 900);
    return () => clearInterval(timer);
  }, [playing, datasetId, spec?.channels.time]);
  function selectDataset(id: string) {
    const next = records.find(r => r.id === id); setDatasetId(id); setSpec(next?.approvalState === 'APPROVED' ? defaultFigure(next, currentProfile!) : null);
    setReviewed(false); setInspected(null); setShare(next?.visibility === 'shared_aggregate'); setError(null); setPlaying(false);
  }
  async function act(fn: () => Promise<void>) { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e); } finally { setBusy(false); } }
  const style = <K extends keyof FigureSpec['style']>(key: K, value: FigureSpec['style'][K]) => setSpec(s => s ? { ...s, style: { ...s.style, [key]: value } } : s);
  const channel = (key: keyof FigureSpec['channels'], value: string) => setSpec(s => s ? { ...s, channels: { ...s.channels, [key]: value || null }, ...(key === 'time' ? { timeValue: null } : {}) } : s);
  function selectRow(id: string) { setSpec(s => s ? { ...s, selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter(v => v !== id) : [...s.selectedIds, id] } : s); }
  function changeRenderer(renderer: string) {
    if (!spec) return;
    const next = { ...spec, renderer };
    if (renderer !== 'choropleth') { delete next.geography; next.camera = { ...next.camera, zoom: Math.min(8, next.camera.zoom) }; }
    else next.channels = { ...next.channels, z: null, size: null, series: null };
    if (renderer === 'map' || renderer === 'choropleth') next.style = { ...next.style, xScale: 'linear', yScale: 'linear' };
    setSpec(next); setInspectedRegion(null);
  }
  async function exportFigure(format: 'svg' | 'csv' | 'json' | 'zip') {
    if (!spec) return;
    setPlaying(false);
    const data = await workbenchApi('export', { figure: spec, format }, format === 'zip' ? 'blob' : format !== 'json');
    if (format === 'zip') {
      downloadBlob('watchdog-research-package.zip', data.blob);
      setNotice({ key: 'notice_package_exported', vars: { hash: String(data.manifestHash) } });
    } else {
      downloadText(`watchdog-figure.${format}`, format === 'json' ? JSON.stringify(data, null, 2) : data, format === 'svg' ? 'image/svg+xml' : format === 'csv' ? 'text/csv' : 'application/json');
      setNotice({ key: 'notice_exported', vars: { format: format.toUpperCase() } });
    }
  }
  async function restoreFile(file: File) {
    if (file.size > 2_000_000) throw clientError('figure_json_too_large', 'Figure JSON exceeds the 2 MB import limit. Use workspace.json from the research package.');
    const input = JSON.parse(await file.text());
    const restored = await workbenchApi('figures/restore', { figure: input.figure, profile: input.profile });
    setPlaying(false); setInspected(null); setArchivedProfile(restored.profile);
    setRecords(rows => [...rows.filter(r => r.id !== restored.dataset.id), restored.dataset]);
    if (restored.geometry) setGeometryLayers(rows => [...rows.filter(r => r.id !== restored.geometry.id), restored.geometry]);
    setDatasetId(restored.dataset.id); setSpec(restored.figure);
    setNotice({ key: 'notice_restored_file' });
  }
  const tools = () => <div className="flex flex-wrap gap-2" aria-label={t('figure_tools')}>
    <button className="field-button" disabled={!spec} onClick={() => setSpec(s => s ? { ...s, selectedIds: [] } : s)}>{t('clear_selection')}</button>
    {spec?.renderer === 'choropleth' && geometry?.approvalState === 'APPROVED' && <button className="field-button" onClick={() => setSpec({ ...spec, camera: { ...spec.camera, ...fitGeometry(geometry.document.features) } })}>{t('fit_layer')}</button>}
    {profile?.methods.map(m => <button key={m.id} className="field-button" title={wt.methodDescription(m)} disabled={busy || !spec || !access.capabilities.includes('workbench.analyze')} onClick={() => { setMenu(false); void act(async () => {
      const data = await workbenchApi('methods', { figure: spec, method: m.id }); setMethod(data.method); setMethodReviewed(false); setAnalysis(null);
      setNotice({ key: 'notice_method_prepared' });
    }); }}>{wt.method(m)}</button>)}
    {(['svg', 'csv', 'json', 'zip'] as const).map(f => <button className="field-button" disabled={!spec || busy} key={f} onClick={() => act(() => exportFigure(f))}>{f === 'zip' ? t('export_zip') : t('export_format', { format: f.toUpperCase() })}</button>)}
  </div>;
  return <div className="field-page"><div className="flex flex-wrap justify-between gap-3"><div className="min-w-0"><h1 className="break-words">{t('title')}</h1><p className="text-slate-600">{t('intro')}</p></div>
    <button className="field-button" onClick={() => act(load)} disabled={busy}>{t('refresh')}</button></div>
    {error != null && <p className="field-error" role="alert">{errorText(error)}</p>}{notice && <p role="status" className="mt-3 text-sm text-slate-600 break-all">{t(notice.key, notice.vars)}</p>}
    {!currentProfile ? <p role="status" className="mt-4">{t('loading_profiles')}</p> : <>
      <div className="field-panel grid md:grid-cols-2 gap-4"><label className="field-control">{t('dataset')}<select aria-label={t('dataset')} value={datasetId} onChange={e => selectDataset(e.target.value)}><option value="">{t('select_dataset')}</option>{records.map(r => <option key={r.id} value={r.id}>{r.document.name} · {wt.approval(r.approvalState)} · {wt.visibility(r.visibility)}</option>)}</select></label>
        <label className="field-control">{t('saved_figures')}<select aria-label={t('saved_figures')} value="" onChange={e => { const selected = saved.find(f => f.id === e.target.value); if (!selected) return;
          const data = records.find(r => r.id === selected.spec.datasetId && r.contentHash === selected.spec.datasetHash && r.approvalState === 'APPROVED');
          if (!data) { setError(clientError('pinned_dataset_unavailable', 'The pinned dataset is unavailable or its approval was revoked. The figure will not render against replacement data.')); return; }
          setError(null); setPlaying(false); setInspected(null); setDatasetId(data.id); setSpec(selected.spec); setNotice({ key: 'notice_restored_figure', vars: { hash: selected.hash } });
        }}><option value="">{t('restore_saved')}</option>{saved.map(f => <option key={f.id} value={f.id}>{f.favorite ? '★ ' : ''}{f.spec.name} · {f.savedAt.slice(0, 10)}</option>)}</select></label></div>
      {access.capabilities.includes('dataset.import') && <DatasetImport profile={currentProfile} busy={busy} onImport={document => { void act(async () => {
        const { record: imported } = await workbenchApi('datasets', document); await load(); setDatasetId(imported.id); setSpec(null); setReviewed(false); setShare(false);
        setNotice({ key: 'notice_dataset_imported' });
      }); }} />}
      <GeometryLayers records={geometryLayers} busy={busy} act={act} onChanged={load} />
      {!records.length && <p className="field-panel">{t('no_datasets')}</p>}
      {record && <section className="field-panel"><h2>{record.document.name}</h2><p>{record.document.description}</p>
        <p className="text-sm mt-2 break-words">{record.document.source.url.startsWith('https:') ? <a href={record.document.source.url}>{record.document.source.publisher} · {record.document.source.title}</a> : <span>{record.document.source.publisher} · {record.document.source.title} · {t('content_addressed_source')}</span>} · {t('source_recorded', { retrieved_at: record.document.source.retrievedAt, count: record.document.rows.length })}</p>
        <p className="text-sm break-words">{t('measure_line', { measure: record.document.measure, normalization: record.document.normalization, language: record.document.languageMeaning })}</p>
        <p className="text-sm break-words">{t('comparison_scope', { scope: record.document.comparisonScope })}</p>
        {record.document.sourceCopy && <div className="text-sm space-y-1 mt-2" data-testid="dataset-extraction-origin"><p>{t('source_copy_note', { policy: record.document.sourceCopy.numericPolicy })}</p><p className="break-all">{t('source_sha', { hash: record.document.sourceCopy.rawHash })}</p><p className="break-all">{t('execution', { trial_id: record.document.sourceCopy.trialId, trial_hash: record.document.sourceCopy.trialHash })}</p><p>{t('source_copy_share')}</p></div>}
        <div className="field-warning text-sm">{(profile ?? currentProfile).providerProfiles.find(p => p.id === record.document.providerProfileId)?.notices.map((n, i) => <p key={n}>{wt.notice(record.document.providerProfileId, i, n)}</p>)}</div>
        <details><summary>{t('provenance_summary')}</summary><pre className="max-h-80 overflow-auto bg-slate-50 p-3 mt-3 text-xs">{JSON.stringify(record, null, 2)}</pre></details>
        {access.capabilities.includes('dataset.approve') && record.ownerId === access.principalId && <div className="mt-4 space-y-3">
          {record.approvalState === 'PROPOSED' ? <><label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />{t('review_dataset_check')}</label>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} />{t('share_dataset')}</label>
            <button className="field-button primary" disabled={!reviewed || busy} onClick={() => act(async () => { const { record: approved } = await workbenchApi(`datasets/${record.id}/approve`, { expectedHash: record.contentHash, shareAggregate: share }); await load(); setSpec(defaultFigure(approved, currentProfile!)); setReviewed(false); })}>{t('approve_dataset')}</button></>
            : <button className="field-button" disabled={busy} onClick={() => act(async () => { await workbenchApi(`datasets/${record.id}/revoke`, {}); await load(); setSpec(null); })}>{t('revoke_dataset')}</button>}
        </div>}
      </section>}
      {access.capabilities.includes('figure.manage') && <label className="field-control field-panel">{t('restore_file')}<input type="file" accept=".json,application/json" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void act(() => restoreFile(file)); }} /><span className="text-sm text-slate-600">{t('restore_file_hint')}</span></label>}
      {spec && !profile && <p role="status" className="field-panel">{t('loading_archived_profile')}</p>}
      {record?.approvalState === 'APPROVED' && spec && profile && <>
        {profile.contentHash !== currentProfile.contentHash && <p className="field-panel text-sm break-words">{t('historical_profile', { version: profile.version, hash: profile.contentHash.slice(0, 16) })}</p>}
        <section className="field-panel"><div className="flex flex-wrap items-center justify-between gap-3"><h2>{t('figure_builder')}</h2><button className="field-button" onClick={() => setMenu(!menu)} aria-expanded={menu}>{t('tools_menu')}</button></div>
          <p className="text-sm text-slate-600 mt-2">{t('builder_help')}</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
            <label className="field-control">{t('view_type')}<select aria-label={t('view_type')} value={spec.renderer} onChange={e => changeRenderer(e.target.value)}>{profile.renderers.map(r => <option key={r.id} value={r.id}>{wt.renderer(r)}</option>)}</select></label>
            {Object.entries(spec.channels).filter(([key]) => (key !== 'region' || ['map', 'choropleth'].includes(spec.renderer)) && !(spec.renderer === 'choropleth' && ['z', 'size', 'series'].includes(key))).map(([key, value]) => <label className="field-control" key={key}>{t('channel', { channel: key.toUpperCase() })}<select aria-label={t('channel', { channel: key.toUpperCase() })} value={value ?? ''} onChange={e => channel(key as any, e.target.value)}>
              {!['x', 'y'].includes(key) && <option value="">{t('none_constant')}</option>}{columns.map(c => <option value={c.key} key={c.key}>{c.label} ({c.type})</option>)}</select></label>)}
            <label className="field-control">{t('palette')}<select aria-label={t('palette')} value={spec.style.palette} onChange={e => style('palette', e.target.value)}>{profile.palettes.map(p => <option key={p.id} value={p.id}>{wt.palette(p)}</option>)}</select></label>
            <label className="field-control">{t('scale_domain')}<select aria-label={t('scale_domain')} value={spec.style.domainScope ?? 'filtered'} onChange={e => style('domainScope', e.target.value as 'dataset' | 'filtered')}><option value="dataset">{t('domain_dataset')}</option><option value="filtered">{t('domain_filtered')}</option></select></label>
            {(['xScale', 'yScale'] as const).map(key => <label className="field-control" key={key}>{t(SCALE_KEYS[key])}<select aria-label={t(SCALE_KEYS[key])} value={spec.style[key]} disabled={['map', 'choropleth'].includes(spec.renderer)} onChange={e => style(key, e.target.value as any)}><option value="linear">{t('scale_linear')}</option><option value="log">{t('scale_log')}</option></select></label>)}
          </div>
          <div className="flex flex-wrap gap-4 mt-4">{(['labels', 'grid', 'legend'] as const).map(key => <label className="text-sm" key={key}><input type="checkbox" checked={spec.style[key]} onChange={e => style(key, e.target.checked)} /> {t(TOGGLE_KEYS[key])}</label>)}</div>
          <details className="mt-4"><summary>{t('publication_style')}</summary><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
            {(['title', 'subtitle', 'xLabel', 'yLabel'] as const).map(key => <label className="field-control" key={key}>{t(STYLE_KEYS[key])}<input value={spec.style[key]} onChange={e => style(key, e.target.value)} /></label>)}
            {([{ key: 'opacity', min: 0.1, max: 1, step: 0.05 }, { key: 'pointSize', min: 2, max: 20, step: 1 }, { key: 'lineWidth', min: 0.5, max: 8, step: 0.5 }, { key: 'fontSize', min: 8, max: 24, step: 1 }] as const).map(c => <label className="field-control" key={c.key}>{t(RANGE_KEYS[c.key], { value: spec.style[c.key] })}<input type="range" min={c.min} max={c.max} step={c.step} value={spec.style[c.key]} onChange={e => style(c.key, Number(e.target.value))} /></label>)}
            {spec.renderer === 'scatter3d' && (['yaw', 'pitch', 'zoom'] as const).map(key => <label className="field-control" key={key}>{t(CAMERA_KEYS[key])}<input type="range" min={key === 'zoom' ? 0.5 : key === 'pitch' ? -90 : -180} max={key === 'zoom' ? 8 : key === 'pitch' ? 90 : 180} step={key === 'zoom' ? 0.1 : 1} value={spec.camera[key]} onChange={e => setSpec({ ...spec, camera: { ...spec.camera, [key]: Number(e.target.value) } })} /></label>)}
            {['map', 'choropleth'].includes(spec.renderer) && <><label className="field-control">{t('map_zoom')}<input type={spec.renderer === 'choropleth' ? 'number' : 'range'} min={0.5} max={spec.renderer === 'choropleth' ? 4096 : 8} step={0.1} value={spec.camera.zoom} onChange={e => setSpec({ ...spec, camera: { ...spec.camera, zoom: Number(e.target.value) } })} /></label>
              {(['centerLongitude', 'centerLatitude'] as const).map(key => <label className="field-control" key={key}>{t(CENTER_KEYS[key])}<input type="number" min={key === 'centerLongitude' ? -180 : -90} max={key === 'centerLongitude' ? 180 : 90} value={spec.camera[key]} onChange={e => setSpec({ ...spec, camera: { ...spec.camera, [key]: Number(e.target.value) } })} /></label>)}</>}
          </div></details>
          {spec.renderer === 'choropleth' && <RegionControls record={record} spec={spec} profile={profile} layers={geometryLayers} onChange={setSpec} />}
          <fieldset className="mt-4 border-t pt-4 min-w-0"><legend className="font-medium">{t('filters_legend')}</legend><div className="flex flex-wrap gap-2 items-end mt-2">
            <label className="field-control">{t('filter_column')}<select aria-label={t('filter_column')} value={filterColumn} onChange={e => setFilterColumn(e.target.value)}><option value="">{t('select_column')}</option>{columns.map(c => <option value={c.key} key={c.key}>{c.label}</option>)}</select></label>
            <label className="field-control">{t('operator')}<select aria-label={t('operator')} value={filterOperator} onChange={e => setFilterOperator(e.target.value)}><option value="equals">{t('op_equals')}</option><option value="contains">{t('op_contains')}</option><option value="range">{t('op_range')}</option></select></label>
            <label className="field-control">{t('value_from')}<input value={filterValue} onChange={e => setFilterValue(e.target.value)} /></label>
            {filterOperator === 'range' && <label className="field-control">{t('value_to')}<input value={filterEnd} onChange={e => setFilterEnd(e.target.value)} /></label>}
            <button className="field-button" disabled={!filterColumn || !filterValue || filterOperator === 'range' && !filterEnd} onClick={() => { const c = columns.find(c => c.key === filterColumn)!;
              const values = (filterOperator === 'range' ? [filterValue, filterEnd] : [filterValue]).map(v => c.type === 'number' ? Number(v) : v);
              if (values.some(v => typeof v === 'number' && !Number.isFinite(v))) { setError(clientError('filter_not_finite', 'Filter value must be a finite number.')); return; }
              setSpec({ ...spec, selectedIds: [], filters: [...spec.filters, { column: filterColumn, operator: filterOperator as any, values }] }); }}>{t('add_filter')}</button>
            <button className="field-button" onClick={() => setSpec({ ...spec, selectedIds: [], filters: [] })}>{t('clear_filters')}</button>
          </div><ul className="text-sm mt-2 break-words">{spec.filters.map((f, i) => <li key={i}>{f.column} {tCode('filter_op_', f.operator)} {f.values.join(' → ')} <button className="underline" onClick={() => setSpec({ ...spec, filters: spec.filters.filter((_, j) => i !== j), selectedIds: [] })}>{t('remove')}</button></li>)}</ul></fieldset>
          {spec.channels.time && <div className="flex flex-wrap gap-3 mt-4 items-center"><label className="field-control">{t('time_frame')}<select aria-label={t('time_frame')} value={spec.timeValue === null ? '' : String(frames.indexOf(spec.timeValue as any))} onChange={e => setSpec({ ...spec, timeValue: e.target.value === '' ? null : frames[Number(e.target.value)] })}><option value="">{t('all_frames')}</option>{frames.map((f, i) => <option key={i} value={i}>{String(f)}</option>)}</select></label>
            <button className="field-button" onClick={() => setPlaying(!playing)}>{playing ? t('pause_time') : t('play_time')}</button><span className="text-sm">{t('animation_note')}</span></div>}
          <div className="border-t mt-4 pt-4">{tools()}</div>
        </section>
        {menu && <div className="field-panel border-indigo-400" role="dialog" aria-label={t('context_tools')} onKeyDown={e => { if (e.key === 'Escape') setMenu(false); }}>
          <div className="flex flex-wrap gap-2 justify-between mb-3"><strong>{t('tools_selected', { count: spec.selectedIds.length })}</strong><button className="field-button" onClick={() => setMenu(false)}>{t('close_tools')}</button></div>{tools()}</div>}
        <div className="mt-5"><FigureCanvas record={record} spec={spec} profile={profile} geometry={geometry} svgRef={svgRef} onInspect={setInspected} onRegionInspect={setInspectedRegion} onMenu={() => setMenu(true)} onSelect={selectRow} /></div>
        {spec.renderer === 'choropleth' && <RegionInspector record={record} spec={spec} profile={profile} geometry={geometry} inspectedId={inspectedRegion} onInspect={setInspected} onSelect={selectRow} />}
        {inspected && <aside className="field-panel" aria-label={t('inspected_observation')}><strong>{inspected.id}</strong><div className="flex flex-wrap gap-2 my-2"><span className="evidence-badge" style={{ color: tiers[inspected.evidenceTier].color, borderColor: tiers[inspected.evidenceTier].color }}>{tiers[inspected.evidenceTier].icon} {wt.tier(inspected.evidenceTier, tiers[inspected.evidenceTier].label)}</span><span className="evidence-badge">{t('approved_mapping')}</span></div><p className="text-sm">{inspected.qualityFlags.join(' · ')}</p>
          <dl className="field-metadata text-sm">{columns.map(c => <div key={c.key}><dt className="font-medium">{c.label}{c.unit ? ` [${c.unit}]` : ''}</dt><dd>{inspected.values[c.key] === null ? t('missing_reason', { reason: String(inspected.missingReasons[c.key]) }) : String(inspected.values[c.key])}</dd></div>)}</dl></aside>}
        <div className="field-panel flex flex-wrap gap-3 items-end"><label className="field-control">{t('saved_figure_name')}<input value={spec.name} onChange={e => setSpec({ ...spec, name: e.target.value })} /></label>
          <label className="text-sm pb-2"><input type="checkbox" checked={favorite} onChange={e => setFavorite(e.target.checked)} /> {t('add_favourites')}</label>
          <button className="field-button primary" disabled={busy || !access.capabilities.includes('figure.manage')} onClick={() => act(async () => { const data = await workbenchApi('figures', { spec, favorite }); await load(); setNotice({ key: 'notice_saved_figure', vars: { hash: data.figure.hash } }); })}>{t('save_figure')}</button>
          {spec.analysis && !analysis && <button className="field-button" disabled={busy} onClick={() => act(async () => { const verified = await workbenchApi('export', { figure: spec, format: 'analysis' }); downloadText('watchdog-analysis.json', JSON.stringify(verified, null, 2), 'application/json'); })}>{t('download_saved_analysis')}</button>}
          <label className="field-control">{t('reuse_style')}<select aria-label={t('reuse_style')} value="" onChange={e => { const f = saved.find(f => f.id === e.target.value); if (f) {
            const next = { ...spec, renderer: f.spec.renderer, profileHash: f.spec.profileHash, style: { ...f.spec.style }, camera: { ...f.spec.camera } };
            delete next.geography;
            if (f.spec.geography) { next.geography = structuredClone(f.spec.geography); next.channels = { ...next.channels, z: null, size: null, series: null }; }
            setSpec(next);
          } }}><option value="">{t('keep_style')}</option>{saved.filter(f => f.favorite).map(f => <option key={f.id} value={f.id}>{f.spec.name}</option>)}</select></label>
        </div>
        {method && <section className="field-panel"><h2 className="break-words">{method.spec.name} · {wt.approval(method.approvalState)}</h2><p className="text-sm">{t('method_pinned')}</p>
          <pre className="text-xs max-h-80 overflow-auto p-3 bg-slate-50 mt-3">{JSON.stringify(method.spec, null, 2)}</pre>
          {method.approvalState !== 'APPROVED' && access.capabilities.includes('method.approve') && <div className="mt-3"><label className="text-sm flex gap-2"><input type="checkbox" checked={methodReviewed} onChange={e => setMethodReviewed(e.target.checked)} />{t('method_review_check')}</label>
            <button className="field-button mt-3" disabled={!methodReviewed || busy} onClick={() => act(async () => { const data = await workbenchApi(`methods/${method.id}/approve`, { expectedHash: method.hash }); setMethod(data.method); })}>{t('approve_method')}</button></div>}
          <button className="field-button primary mt-3" disabled={busy || method.approvalState !== 'APPROVED'} onClick={() => act(async () => {
            const data = await workbenchApi(`methods/${method.id}/execute`, {}); setAnalysis(data);
            setSpec(s => s ? { ...s, analysis: { methodId: method.id, methodHash: method.hash, resultHash: data.hash } } : s);
          })}>{t('run_analysis')}</button>
          {analysis && <div className="mt-4"><p className="field-warning">{t('exploratory_warning')}</p>
            <div className="overflow-auto"><table className="field-table"><thead><tr><th>{t('col_statistic')}</th><th>{t('col_value')}</th><th>{t('col_unit')}</th></tr></thead><tbody>{analysis.artifact.results.map((r: any) => <tr key={r.metricKey}><td>{r.metricKey}</td><td>{r.valueNumeric === null ? t('undefined_missing') : r.valueNumeric}</td><td>{r.unit}</td></tr>)}</tbody></table></div>
            <p className="text-xs break-all mt-3">{t('run_line', { run_id: analysis.runId, hash: analysis.hash, trace_id: analysis.traceId })}</p>
            <button className="field-button mt-3" disabled={busy} onClick={() => act(async () => { const verified = await workbenchApi('export', { figure: spec, format: 'analysis' }); downloadText('watchdog-analysis.json', JSON.stringify(verified, null, 2), 'application/json'); })}>{t('download_analysis')}</button></div>}
        </section>}
      </>}
    </>}
  </div>;
}
