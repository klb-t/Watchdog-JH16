import { useMemo, type RefObject } from 'react';
import { filterRows, type DatasetRecord, type FigureSpec, type WorkbenchProfile } from './workbench';
import { checkGeographyBinding, geometryBounds, geometryWarnings, joinRegions, regionColorScale, polygonPath, regionLabelPoint, regionAlphaFraction, type GeometryLayerRecord } from './geography';
import { wrapFigureText } from './figure_geometry';
const WIDTH = 860, PANEL = 480, M = 60;
type Row = DatasetRecord['document']['rows'][number];
export interface RegionCanvasProps {
  record: DatasetRecord; spec: FigureSpec; profile: WorkbenchProfile; geometry?: GeometryLayerRecord | null;
  standalone?: boolean; svgRef: RefObject<SVGSVGElement | null>; onSelect: (id: string) => void;
  onInspect: (row: Row | null) => void; onRegionInspect?: (id: string) => void; onMenu: () => void;
}
export function RegionCanvas({ record, spec, profile, geometry, standalone, svgRef, onSelect, onInspect, onRegionInspect, onMenu }: RegionCanvasProps) {
  const filtered = useMemo(() => filterRows(record.document, spec), [record, spec]);
  if (!geometry) return <p role="alert" className="field-warning">Choose an accessible, approved boundary layer.</p>;
  try { checkGeographyBinding(spec, geometry); } catch (error) { return <p role="alert" className="field-warning">{(error as Error).message}</p>; }
  const palette = profile.palettes.find(p => p.id === spec.style.palette)!.colors;
  let scale: ReturnType<typeof regionColorScale>;
  try { scale = regionColorScale(record.document, spec, palette); }
  catch (error) { if (standalone) throw error; return <p role="alert" className="field-warning">{(error as Error).message}</p>; }
  const rowIndex = new Map(record.document.rows.map(r => [r.id, r]));
  const groups = new Map<string, { label: string; rows: Row[] }>();
  for (const row of filtered) {
    const value = spec.channels.facet ? row.values[spec.channels.facet] : null;
    const key = JSON.stringify(value);
    if (!groups.has(key)) groups.set(key, { label: spec.channels.facet ? `${spec.channels.facet}: ${value === null ? '(missing)' : value}` : record.document.measure, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  if (!groups.size) groups.set('empty', { label: 'No observations in this frame', rows: [] });
  const title = wrapFigureText(spec.style.title || spec.name, 55), subtitle = wrapFigureText(spec.style.subtitle, 90);
  const header = 42 + title.length * 28 + subtitle.length * 20, lineHeight = spec.style.fontSize + 7;
  let panelHeight = 0;
  const panels = [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, 12).map(([key, panel]) => {
    const labelLines = wrapFigureText(panel.label, Math.floor(740 / (spec.style.fontSize * 0.62)));
    const extra = Math.max(0, (labelLines.length + 1) * lineHeight + 10 - M), offset = panelHeight;
    panelHeight += PANEL + extra + lineHeight;
    return { key, ...panel, labelLines, extra, offset };
  });
  const tiers = [...new Set(filtered.map(r => r.evidenceTier))].sort();
  const column = record.document.columns.find(c => c.key === spec.channels.color)!;
  const alphaValues = (spec.style.domainScope === 'dataset' ? record.document.rows : filtered).map(r => r.values[spec.channels.alpha!]).filter((v): v is number => typeof v === 'number');
  const alphaMin = alphaValues.length ? Math.min(...alphaValues) : null, alphaMax = alphaValues.length ? Math.max(...alphaValues) : null;
  const opacity = (row: Row | null) => {
    const v = row?.values[spec.channels.alpha!];
    return spec.style.opacity * (!spec.channels.alpha || typeof v !== 'number' || alphaMin === null ? 1 : 0.15 + 0.85 * regionAlphaFraction(v, alphaMin, alphaMax!));
  };
  const footer = [
    `Color: ${column.label}${column.unit ? ` [${column.unit}]` : ''}; classification: ${spec.geography!.classification.mode}.`,
    `Domain: ${spec.style.domainScope === 'dataset' ? 'whole dataset' : 'filtered frame'}, including numeric source values with unresolved region joins.`,
    `Alpha: ${spec.channels.alpha ?? 'constant'}; display opacity: ${spec.style.opacity}. Source alpha range ${alphaMin ?? 'missing'} to ${alphaMax ?? 'missing'} maps to 0.15–1 of display opacity. Missing alpha keeps display opacity and has a dashed outline.`,
    'One source observation per region and panel. Multiple rows remain ambiguous; no sum, mean or other aggregate is inferred.',
    'Selection highlights source rows; it does not hide observations or resolve an ambiguous join. Missing is not zero.',
    `Projection: equirectangular longitude/latitude (WGS84). Polygon area on the page is not a geographic area estimate.`,
    `Data: ${record.document.source.publisher}; ${record.document.source.title}; ${record.document.sourceCopy ? 'copied' : 'retrieved'} ${record.document.source.retrievedAt}.`,
    record.document.source.url,
    `Normalization: ${record.document.normalization}; comparison: ${record.document.comparisonScope}.`,
    `Boundaries: ${geometry.document.source.publisher}; ${geometry.document.name}; ${geometry.document.source.license}; retrieved ${geometry.document.source.retrievedAt}.`,
    geometry.document.source.url,
    ...geometryWarnings(geometry.document),
    `Boundary mapping: ${geometry.approvalState}; data mapping: ${record.approvalState}. Evidence tier and quality flags remain independent.`,
    ...(spec.timeValue !== null ? [`Time frame: ${spec.timeValue}`] : []),
    ...(groups.size > 12 ? [`PREVIEW ONLY: 12 of ${groups.size} panels. Filter before vector export.`] : []),
    `Dataset SHA-256: ${record.contentHash}`, `Geometry SHA-256: ${geometry.contentHash}`,
  ].flatMap(line => wrapFigureText(line, Math.floor(740 / (spec.style.fontSize * 0.62))));
  const legend = spec.style.legend ? scale.legend : [];
  const statusLegend = [{ color: '#f1f5f9', label: 'No observation for this region' }, { color: 'url(#region-missing)', label: 'Diagonal hatch: source value missing' }, { color: 'url(#region-ambiguous)', label: 'Crosshatch: multiple source observations (ambiguous)' }];
  const legendCount = legend.length + statusLegend.length + tiers.length;
  const height = header + panelHeight + (legendCount + footer.length + 3) * lineHeight;
  const svg = <svg xmlns="http://www.w3.org/2000/svg" ref={svgRef} role="group" aria-label={spec.style.title || spec.name}
    viewBox={`0 0 ${WIDTH} ${height}`} width={standalone ? WIDTH : undefined} height={standalone ? height : undefined}
    className="w-full bg-white border border-slate-200 rounded" style={{ fontFamily: 'Arial, sans-serif', fontSize: spec.style.fontSize }}
    onContextMenu={event => { event.preventDefault(); onMenu(); }}>
    <title>{spec.style.title || spec.name}</title><desc>Region colors join exact source identifiers. Missing and ambiguous regions are not zero. No implicit aggregation.</desc>
    <metadata>{JSON.stringify({ figure: spec, datasetHash: record.contentHash, source: record.document.source, profile,
      geometry: { id: geometry.id, hash: geometry.contentHash, source: geometry.document.source, approvedHash: geometry.approvedHash, approvedBy: geometry.approvedBy, approvedAt: geometry.approvedAt } })}</metadata>
    <rect width="100%" height="100%" fill="white" />
    <defs><pattern id="region-missing" patternUnits="userSpaceOnUse" width="8" height="8"><rect width="8" height="8" fill="#f1f5f9" /><path d="M-2,2 L2,-2 M0,8 L8,0 M6,10 L10,6" stroke="#64748b" /></pattern>
      <pattern id="region-ambiguous" patternUnits="userSpaceOnUse" width="9" height="9"><rect width="9" height="9" fill="#faf5ff" /><path d="M0,0 L9,9 M0,9 L9,0" stroke="#9333ea" strokeWidth="1" /></pattern></defs>
    {title.map((t, i) => <text key={i} x={M} y={32 + i * 28} fontWeight="bold" fontSize={22}>{t}</text>)}
    {subtitle.map((t, i) => <text key={i} x={M} y={40 + title.length * 28 + i * 20}>{t}</text>)}
    {panels.map((panel, panelIndex) => {
      const join = joinRegions({ ...record.document, rows: panel.rows }, spec, geometry.document), joined = new Map(join.regions.map(r => [r.featureId, r]));
      const west = spec.camera.centerLongitude - 180 / spec.camera.zoom, east = spec.camera.centerLongitude + 180 / spec.camera.zoom;
      const south = spec.camera.centerLatitude - 90 / spec.camera.zoom, north = spec.camera.centerLatitude + 90 / spec.camera.zoom;
      const project = (lon: number, lat: number): [number, number] => [M + (lon - west) / (east - west) * (WIDTH - 2 * M), PANEL - M - (lat - south) / (north - south) * (PANEL - 2 * M)];
      let visible = 0;
      const features = geometry.document.features.filter(f => { const [w, s, e, n] = geometryBounds([f]); return e >= west && w <= east && n >= south && s <= north; });
      for (const feature of features) if (joined.get(feature.id)!.state === 'value') visible++;
      return <g key={panel.key} transform={`translate(0,${header + panel.offset})`}>
        {panel.labelLines.map((line, i) => <text key={i} x={M} y={20 + i * lineHeight} fontWeight="bold">{line}</text>)}
        <text x={M} y={20 + panel.labelLines.length * lineHeight} fill="#475569" fontSize={Math.min(14, spec.style.fontSize)}>{visible} numeric regions in view · {join.regions.filter(r => r.state === 'ambiguous').length} ambiguous · {join.unmatched.length} unmatched rows</text>
        <g transform={`translate(0,${panel.extra})`}>
        <defs><clipPath id={`region-clip-${panelIndex}`}><rect x={M} y={M} width={WIDTH - 2 * M} height={PANEL - 2 * M} /></clipPath></defs>
        <g clipPath={`url(#region-clip-${panelIndex})`}>
          {features.map(feature => {
            const joinedRegion = joined.get(feature.id)!, row = joinedRegion.rowIds.length === 1 ? rowIndex.get(joinedRegion.rowIds[0])! : null;
            const selected = joinedRegion.rowIds.some(id => spec.selectedIds.includes(id));
            const missingAlpha = row && spec.channels.alpha && typeof row.values[spec.channels.alpha] !== 'number';
            const fill = joinedRegion.state === 'value' ? scale.color(joinedRegion.value!) : joinedRegion.state === 'missing' ? 'url(#region-missing)' : joinedRegion.state === 'ambiguous' ? 'url(#region-ambiguous)' : '#f1f5f9';
            const label = row && spec.channels.label ? String(row.values[spec.channels.label] ?? feature.name) : feature.name;
            const description = `${feature.name} [${feature.id}]: ${joinedRegion.state === 'value' ? `${joinedRegion.value} ${column.unit ?? ''}` : joinedRegion.state}; rows: ${joinedRegion.rowIds.join(', ') || 'none'}`;
            const inspect = () => { onInspect(row); onRegionInspect?.(feature.id); };
            const activate = () => { inspect(); if (row) onSelect(row.id); };
            const center = project(...regionLabelPoint(feature.geometry));
            return <g key={feature.id} data-region-id={feature.id} data-join-state={joinedRegion.state} role="button" tabIndex={0} aria-label={description}
              onMouseEnter={inspect} onFocus={inspect} onClick={activate} onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
                if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); onMenu(); }
              }}><title>{description + (row ? `; evidence ${row.evidenceTier}; ${row.qualityFlags.join(', ')}` : '')}</title>
              {polygonPath(feature.geometry, project).map((d, i) => <path key={i} d={d} fillRule="evenodd" clipRule="evenodd" fill={fill}
                fillOpacity={joinedRegion.state === 'value' ? opacity(row) : 1} stroke={selected ? '#0f172a' : row?.qualityFlags.includes('PROVIDER_DISCONTINUITY') ? '#be123c' : '#64748b'} strokeWidth={selected ? 3 : spec.style.lineWidth}
                strokeDasharray={missingAlpha || row?.qualityFlags.includes('PROVIDER_DISCONTINUITY') ? '4 3' : undefined} />)}
              {spec.style.labels && <text x={center[0]} y={center[1]} textAnchor="middle" fill="#0f172a" paintOrder="stroke" stroke="white" strokeWidth="2" strokeLinejoin="round">{label}</text>}
            </g>;
          })}
          {spec.style.grid && [0, 0.25, 0.5, 0.75, 1].map(t => <g key={t} stroke="#94a3b8" strokeDasharray="3 4" pointerEvents="none"><line x1={M} x2={WIDTH - M} y1={project(west, south + (north - south) * t)[1]} y2={project(west, south + (north - south) * t)[1]} /><line x1={project(west + (east - west) * t, south)[0]} x2={project(west + (east - west) * t, south)[0]} y1={M} y2={PANEL - M} /></g>)}
        </g>
        <rect x={M} y={M} width={WIDTH - 2 * M} height={PANEL - 2 * M} fill="none" stroke="#64748b" pointerEvents="none" />
        {wrapFigureText(`Longitude ${west.toFixed(3)}° to ${east.toFixed(3)}° · latitude ${south.toFixed(3)}° to ${north.toFixed(3)}°`, Math.floor(740 / (spec.style.fontSize * 0.62))).map((line, i) => <text key={i} x={WIDTH / 2} y={PANEL - 22 + i * lineHeight} textAnchor="middle">{line}</text>)}
        </g>
      </g>;
    })}
    <g transform={`translate(${M},${header + panelHeight + 10})`} fill="#475569">
      {[...legend, ...statusLegend, ...tiers.map(tier => ({ color: profile.evidenceDisplay[tier].color, label: `Evidence tier: ${profile.evidenceDisplay[tier].label}` }))].map((item, i) => <g key={i} transform={`translate(0,${i * lineHeight})`}><rect y={-10} width={12} height={12} fill={item.color} /><text x={20}>{item.label}</text></g>)}
      {footer.map((line, i) => <text key={i} y={(legendCount + 2 + i) * lineHeight}>{line}</text>)}
    </g>
  </svg>;
  if (standalone) return svg;
  return <>{svg}<div className="flex flex-wrap gap-2 mt-3" aria-label="Evidence legend">
    {tiers.map(t => <span className="evidence-badge" key={t} style={{ color: profile.evidenceDisplay[t].color, borderColor: profile.evidenceDisplay[t].color }}>{profile.evidenceDisplay[t].icon} {profile.evidenceDisplay[t].label}</span>)}
    <span className="evidence-badge">✓ Approved source mapping</span><span className="evidence-badge">✓ Approved boundary mapping</span>
  </div></>;
}
