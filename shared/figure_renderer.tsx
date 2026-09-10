import { useMemo, type RefObject } from 'react';
import { FigureSchema, axisValue, filterRows, checkFigureBindings, checkFigureProfile, type FigureSpec, type DatasetRecord, type WorkbenchProfile } from './workbench';
import { project3d, wrapFigureText } from './figure_geometry';
import { RegionCanvas } from './region_renderer';
import type { GeometryLayerRecord } from './geography';
import world from '../config/workbench/world.json';
type Row = DatasetRecord['document']['rows'][number];
const distinct = (values: unknown[]) => [...new Set(values.map(v => v === null ? '(missing)' : String(v)))].sort();
const W = 860, H = 490, M = 60;
export function FigureCanvas({ record, spec, profile, onSelect, onInspect, onMenu, svgRef, geometry, onRegionInspect, standalone = false }: {
  record: DatasetRecord; spec: FigureSpec; profile: WorkbenchProfile; standalone?: boolean; geometry?: GeometryLayerRecord | null; onRegionInspect?: (id: string) => void; onSelect: (id: string) => void;
  onInspect: (row: Row | null) => void; onMenu: () => void; svgRef: RefObject<SVGSVGElement | null>;
}) {
  const rows = useMemo(() => filterRows(record.document, spec), [record, spec]);
  const tiers = profile.evidenceDisplay;
  try { FigureSchema.parse(spec); checkFigureProfile(spec, profile); checkFigureBindings(spec, record.document); }
  catch (error) { return <p className="field-warning" role="alert">{(error as Error).message}</p>; }
  if (spec.renderer === 'choropleth') return <RegionCanvas record={record} spec={spec} profile={profile} geometry={geometry} standalone={standalone} svgRef={svgRef} onSelect={onSelect} onInspect={onInspect} onRegionInspect={onRegionInspect} onMenu={onMenu} />;
  const col = (key: string | null) => record.document.columns.find(c => c.key === key);
  const palette = profile.palettes.find(p => p.id === spec.style.palette)!.colors;
  // Legacy saved figures omitted domainScope and retain their original filtered domains.
  const domainRows = spec.style.domainScope === 'dataset' ? record.document.rows : rows;
  const facets = spec.channels.facet ? distinct(rows.map(r => r.values[spec.channels.facet!])) : ['All observations'];
  const colors = spec.channels.color ? distinct(domainRows.map(r => r.values[spec.channels.color!])) : [];
  const isMap = spec.renderer === 'map', is3d = spec.renderer === 'scatter3d';
  const numeric = (r: Row, key: string | null, scale = 'linear') => key ? axisValue(r.values[key], col(key)?.type, scale) : null;
  const rangeCache = new Map<string, number[]>();
  const numericRange = (key: string | null) => {
    if (rangeCache.has(key)) return rangeCache.get(key)!;
    const values = domainRows.map(r => numeric(r, key)).filter((v): v is number => v !== null);
    const range = values.length ? [Math.min(...values), Math.max(...values)] : [0, 1];
    rangeCache.set(key, range); return range;
  };
  const channelFraction = (r: Row, key: string | null) => {
    const value = numeric(r, key); if (value === null) return null;
    const [min, max] = numericRange(key); return max === min ? 0.5 : (value - min) / (max - min);
  };
  const color = (r: Row) => {
    if (!spec.channels.color) return palette[0];
    if (col(spec.channels.color)?.type === 'number') {
      const fraction = channelFraction(r, spec.channels.color);
      return fraction === null ? '#64748b' : palette[Math.min(palette.length - 1, Math.floor(fraction * palette.length))];
    }
    return r.values[spec.channels.color] === null ? '#64748b' : palette[colors.indexOf(String(r.values[spec.channels.color])) % palette.length] ?? '#64748b';
  };
  const xCol = col(spec.channels.x)!, yCol = col(spec.channels.y)!;
  const visibleFacets = facets.slice(0, 12);
  const titleLines = wrapFigureText(spec.style.title || spec.name, 55), subtitleLines = wrapFigureText(spec.style.subtitle, Math.floor(740 / (spec.style.fontSize * 0.62)));
  const headerHeight = 42 + titleLines.length * 28 + subtitleLines.length * (spec.style.fontSize + 5);
  const tierList = [...new Set(rows.map(r => r.evidenceTier))];
  const footerLines = [
    ...(spec.style.legend ? [`Color: ${spec.channels.color ?? 'constant'}; size: ${spec.channels.size ?? 'constant'}; alpha: ${spec.channels.alpha ?? 'constant'}; opacity: ${spec.style.opacity}.`,
      ...(spec.channels.size ? [`Size: ${numericRange(spec.channels.size).join(' to ')} → 0.5 to 2 times marker radius.`] : []),
      ...(spec.channels.alpha ? [`Alpha: ${numericRange(spec.channels.alpha).join(' to ')} → 0.15 to 1 times display opacity.`] : [])] : []),
    `Source: ${record.document.source.publisher}; ${record.document.source.title}; retrieved ${record.document.source.retrievedAt.slice(0, 10)}.`,
    `Normalization: ${record.document.normalization}; comparison: ${record.document.comparisonScope}.`,
    record.document.source.url,
    'Missing ≠ zero. Missing size/alpha uses a neutral mark with a dashed outline. Evidence tier, source mapping approval and quality flags are independent.',
    `Numeric/channel domains: ${spec.style.domainScope === 'dataset' ? 'whole dataset, stable across filters and time frames' : 'filtered observations, rescaled with each frame'}.`,
    ...(rows.some(r => r.qualityFlags.includes('PROVIDER_DISCONTINUITY')) ? ['Provider discontinuity: red vertical marker in line views; red outlined mark in other views.'] : []),
    ...(facets.length > 12 ? [`PREVIEW ONLY: 12 of ${facets.length} panels. Narrow the filter before SVG export.`] : []),
    ...(isMap ? ['Basemap: Natural Earth, public domain, 1:110m. Geographic markers; no inferred distribution routes.'] : []),
    ...(spec.channels.time && spec.timeValue !== null ? [`Time frame: ${String(spec.timeValue)}`] : []),
    `Dataset SHA-256: ${record.contentHash}`,
  ].flatMap(t => wrapFigureText(t, Math.floor(740 / (spec.style.fontSize * 0.62))));
  const colorItems = spec.style.legend && spec.channels.color ? col(spec.channels.color)?.type === 'number'
    ? palette.map((c, i) => { const [min, max] = numericRange(spec.channels.color); return { color: c, label: `${(min + (max - min) * i / palette.length).toPrecision(4)} to ${(min + (max - min) * (i + 1) / palette.length).toPrecision(4)}` }; })
    : colors.slice(0, 16).map((label, i) => ({ color: label === '(missing)' ? '#64748b' : palette[i % palette.length], label })) : [];
  const lineHeight = spec.style.fontSize + 7, legendHeight = (colorItems.length + tierList.length + 2) * lineHeight;
  const footerHeight = legendHeight + footerLines.length * lineHeight + 30;
  const svg = <svg ref={svgRef} role="group" aria-label={spec.style.title || spec.name} viewBox={`0 0 ${W} ${headerHeight + visibleFacets.length * H + footerHeight}`}
    className="w-full bg-white border border-slate-200 rounded" width={standalone ? W : undefined} height={standalone ? headerHeight + visibleFacets.length * H + footerHeight : undefined} onContextMenu={e => { e.preventDefault(); onMenu(); }}
    style={{ fontFamily: 'Arial, sans-serif', fontSize: spec.style.fontSize }} xmlns="http://www.w3.org/2000/svg">
    <title>{spec.style.title || spec.name}</title>
    <desc>Dataset {record.contentHash}. {record.document.measure}. {record.document.normalization}. {record.document.comparisonScope}. Colors and alpha encode the selected channels, not an overall confidence score. Missing values are not zero.</desc>
    <metadata>{JSON.stringify({ figure: spec, datasetHash: record.contentHash, source: record.document.source, profile })}</metadata>
    <rect width="100%" height="100%" fill="white" />
    {titleLines.map((line, i) => <text key={i} x={M} y={32 + i * 28} fontSize={22} fontWeight="bold" fill="#0f172a">{line}</text>)}
    {subtitleLines.map((line, i) => <text key={i} x={M} y={40 + titleLines.length * 28 + i * (spec.style.fontSize + 5)} fill="#475569">{line}</text>)}
    {visibleFacets.map((facet, fi) => {
      const group = rows.filter(r => !spec.channels.facet || (r.values[spec.channels.facet] === null ? '(missing)' : String(r.values[spec.channels.facet])) === facet);
      const axisRows = spec.style.domainScope === 'dataset' ? record.document.rows : group;
      const categories = distinct(axisRows.map(r => r.values[spec.channels.x]));
      const bars = [...group].sort((a, b) => String(a.values[spec.channels.x]).localeCompare(String(b.values[spec.channels.x])) || a.id.localeCompare(b.id));
      const barIndex = new Map(bars.map((r, i) => [r.id, i]));
      const xv = (r: Row) => r.values[spec.channels.x] === null ? null : spec.renderer === 'bar' ? barIndex.get(r.id)! : xCol.type === 'text' ? categories.indexOf(String(r.values[spec.channels.x])) : numeric(r, spec.channels.x, spec.style.xScale);
      const yv = (r: Row) => numeric(r, spec.channels.y, spec.style.yScale);
      const xs = axisRows.map(xv).filter((v): v is number => v !== null), ys = axisRows.map(yv).filter((v): v is number => v !== null);
      const extent = (vs: number[], zero = false) => { const min = Math.min(...vs, ...(zero ? [0] : [])), max = Math.max(...vs, ...(zero ? [0] : [])); return !vs.length ? [0, 1] : min === max ? [min - 0.5, max + 0.5] : [min, max]; };
      const [xmin, xmax] = isMap ? [spec.camera.centerLongitude - 180 / spec.camera.zoom, spec.camera.centerLongitude + 180 / spec.camera.zoom] : spec.renderer === 'bar' ? [-0.5, bars.length - 0.5] : extent(xs), [ymin, ymax] = isMap ? [spec.camera.centerLatitude - 90 / spec.camera.zoom, spec.camera.centerLatitude + 90 / spec.camera.zoom] : extent(ys, spec.renderer === 'bar');
      const xPixel = (n: number) => M + (n - xmin) / (xmax - xmin) * (W - 2 * M);
      const yPixel = (n: number) => H - M - (n - ymin) / (ymax - ymin) * (H - 2 * M);
      const projected = (a: number, b: number, c: number) => { const [x, y, depth] = project3d(a, b, c, spec.camera); return [W / 2 + x * 260, H / 2 - y * 260, depth]; };
      const position = (r: Row) => {
        const x = xv(r), y = yv(r); if (x === null || y === null) return null;
        if (isMap && (x < -180 || x > 180 || y < -90 || y > 90 || x < xmin || x > xmax || y < ymin || y > ymax)) return null;
        if (!is3d) return [xPixel(x), yPixel(y), 0];
        const z = numeric(r, spec.channels.z); if (z === null) return null;
        const [zmin, zmax] = numericRange(spec.channels.z);
        const p = projected((x - xmin) / (xmax - xmin) - 0.5, (y - ymin) / (ymax - ymin) - 0.5, zmin === zmax ? 0 : (z - zmin) / (zmax - zmin) - 0.5);
        return p[0] < M || p[0] > W - M || p[1] < M || p[1] > H - M ? null : p;
      };
      const plotted = group.flatMap(r => { const p = position(r); return p ? [{ row: r, p }] : []; }).sort((a, b) => a.p[2] - b.p[2]);
      const missing = group.length - plotted.length;
      const geometryPath = (coordinates: number[][][]) => coordinates.map(ring => ring.map(([lon, lat], i) => `${i ? 'L' : 'M'}${xPixel(lon).toFixed(2)},${yPixel(lat).toFixed(2)}`).join(' ') + 'Z').join(' ');
      const series = spec.channels.series ? distinct(group.map(r => r.values[spec.channels.series!])) : ['all'];
      const tick = (value: number, c: typeof xCol, scale: string) => c.type === 'date' ? new Date(value).toISOString().slice(0, 10) : Number((scale === 'log' ? 10 ** value : value).toPrecision(4)).toString();
      return <g key={facet} transform={`translate(0, ${headerHeight + fi * H})`}>
        <defs><clipPath id={`map-clip-${fi}`}><rect x={M} y={M} width={W - 2 * M} height={H - 2 * M} /></clipPath></defs>
        <text x={M} y={20} fontWeight="bold">{spec.channels.facet ? `${spec.channels.facet}: ${facet}` : is3d ? `Z: ${col(spec.channels.z)?.label} · orthographic 3D projection` : record.document.measure}</text>
        {isMap && <g clipPath={`url(#map-clip-${fi})`} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={0.5}>{world.features.map((f, i) => <path key={i} d={f.geometry.type === 'Polygon' ? geometryPath(f.geometry.coordinates as number[][][]) : (f.geometry.coordinates as number[][][][]).map(geometryPath).join(' ')}><title>{f.name}</title></path>)}</g>}
        {!is3d && [0, 0.25, 0.5, 0.75, 1].map(t => <g key={t} fill="#475569">
          {spec.style.grid && <><line x1={M} y1={yPixel(ymin + t * (ymax - ymin))} x2={W - M} y2={yPixel(ymin + t * (ymax - ymin))} stroke="#cbd5e1" strokeDasharray="3 4" />
            <line x1={xPixel(xmin + t * (xmax - xmin))} y1={M} x2={xPixel(xmin + t * (xmax - xmin))} y2={H - M} stroke="#cbd5e1" strokeDasharray="3 4" /></>}
          <text x={M - 8} y={yPixel(ymin + t * (ymax - ymin)) + 4} textAnchor="end">{tick(ymin + t * (ymax - ymin), yCol, spec.style.yScale)}</text>
          <text x={xPixel(xmin + t * (xmax - xmin))} y={H - M + 22} textAnchor="middle">{spec.renderer === 'bar' ? String(bars[Math.min(bars.length - 1, Math.round(t * (bars.length - 1)))]?.values[spec.channels.x] ?? '') : xCol.type === 'text' ? categories[Math.round(t * (categories.length - 1))] : tick(xmin + t * (xmax - xmin), xCol, spec.style.xScale)}</text>
        </g>)}
        {!is3d && <><line x1={M} y1={H - M} x2={W - M} y2={H - M} stroke="#334155" /><line x1={M} y1={M} x2={M} y2={H - M} stroke="#334155" /></>}
        {is3d && <g aria-label="3D axes" clipPath={`url(#map-clip-${fi})`}>
          {[0, 1, 2].flatMap(axis => [-0.5, 0.5].flatMap(a => [-0.5, 0.5].map(b => {
            const start = [a, b]; start.splice(axis, 0, -0.5); const end = [...start]; end[axis] = 0.5;
            const p = projected(start[0], start[1], start[2]), q = projected(end[0], end[1], end[2]);
            return <line key={`${axis}-${a}-${b}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="#94a3b8" strokeDasharray={spec.style.grid ? undefined : '3 3'} />;
          })))}
          {[['X', spec.channels.x, xmin, xmax], ['Y', spec.channels.y, ymin, ymax], ['Z', spec.channels.z, ...numericRange(spec.channels.z)]].map(([name, key, min, max], i) => <text key={String(name)} x={M + 8} y={M + 20 + i * lineHeight} fill="#334155">{name}: {col(String(key))?.label} [{col(String(key))?.unit ?? 'unit unspecified'}] · {tick(Number(min), col(String(key))!, i === 0 ? spec.style.xScale : i === 1 ? spec.style.yScale : 'linear')} to {tick(Number(max), col(String(key))!, i === 0 ? spec.style.xScale : i === 1 ? spec.style.yScale : 'linear')}</text>)}
          {['X', 'Y', 'Z'].map((name, axis) => { const end = [-0.5, -0.5, -0.5]; end[axis] = 0.5; const p = projected(...end as [number, number, number]); return <text key={name} x={p[0] + 5} y={p[1] - 5} fontWeight="bold">{name}</text>; })}
        </g>}
        {spec.renderer === 'line' && series.map(seriesId => {
          const members = group.filter(r => !spec.channels.series || String(r.values[spec.channels.series]) === seriesId).sort((a, b) => (xv(a) ?? Infinity) - (xv(b) ?? Infinity));
          let broken = true; const path: string[] = [];
          for (const r of members) { const p = position(r); if (!p || r.qualityFlags.includes('PROVIDER_DISCONTINUITY')) broken = true;
            if (p) { path.push(`${broken ? 'M' : 'L'}${p[0]},${p[1]}`); broken = false; } }
          return <path key={seriesId} d={path.join(' ')} fill="none" stroke={color(members[0])} strokeWidth={spec.style.lineWidth} opacity={spec.style.opacity} />;
        })}
        {plotted.map(({ row, p: [x, y] }) => {
          const selected = spec.selectedIds.includes(row.id), label = spec.channels.label ? String(row.values[spec.channels.label] ?? 'Missing label') : isMap && spec.channels.region ? String(row.values[spec.channels.region] ?? row.id) : row.id;
          const sf = channelFraction(row, spec.channels.size), af = channelFraction(row, spec.channels.alpha);
          const missingChannel = (spec.channels.size && sf === null) || (spec.channels.alpha && af === null);
          const size = spec.style.pointSize * (spec.channels.size && sf !== null ? 0.5 + sf * 1.5 : 1);
          const opacity = spec.style.opacity * (spec.channels.alpha && af !== null ? 0.15 + af * 0.85 : 1);
          const barWidth = Math.min(40, (W - 2 * M) / Math.max(1, bars.length) * 0.8);
          const description = `${label}: ${record.document.columns.map(c => `${c.label}=${row.values[c.key] ?? 'missing'}`).join('; ')}; evidence ${row.evidenceTier}; ${record.approvalState} mapping; ${row.qualityFlags.join(', ')}`;
          return <g key={row.id} role="button" aria-label={description} tabIndex={0} data-row-id={row.id}
            onClick={() => onSelect(row.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(row.id); } if (e.key === 'ContextMenu' || e.shiftKey && e.key === 'F10') { e.preventDefault(); onMenu(); } }}
            onMouseEnter={() => onInspect(row)} onFocus={() => onInspect(row)}>
            <title>{description}</title>
            {spec.renderer === 'bar' ? <rect x={x - barWidth / 2} y={Math.min(y, yPixel(0))} width={barWidth} height={Math.abs(yPixel(0) - y)} fill={color(row)} opacity={opacity} stroke={selected ? '#111827' : 'none'} strokeWidth={3} />
              : <circle cx={x} cy={y} r={size} fill={color(row)} opacity={opacity} stroke={selected ? '#111827' : missingChannel ? '#64748b' : 'white'} strokeDasharray={missingChannel ? '2 2' : undefined} strokeWidth={selected ? 3 : 1} />}
            {row.qualityFlags.includes('PROVIDER_DISCONTINUITY') && (spec.renderer === 'line' ? <line x1={x} y1={M} x2={x} y2={H - M} stroke="#be123c" strokeDasharray="5 4"><title>Provider discontinuity</title></line> : <circle cx={x} cy={y} r={size + 3} fill="none" stroke="#be123c" strokeDasharray="3 2"><title>Provider discontinuity</title></circle>)}
            {spec.style.labels && <text x={x + size + 3} y={y - 5} fill="#0f172a">{label}</text>}
          </g>;
        })}
        <text x={W / 2} y={H - 14} textAnchor="middle">{spec.style.xLabel || `${xCol.label}${xCol.unit ? ` [${xCol.unit}]` : ''}`}{isMap ? ' · longitude degrees' : ''}</text>
        <text transform={`translate(16,${H / 2}) rotate(-90)`} textAnchor="middle">{spec.style.yLabel || `${yCol.label}${yCol.unit ? ` [${yCol.unit}]` : ''}`}{isMap ? ' · latitude degrees' : ''}</text>
        <text x={W - M} y={38} textAnchor="end" fill={missing ? '#9f1239' : '#64748b'}>{plotted.length} shown · {missing} missing or outside axis domain</text>
      </g>;
    })}
    <g transform={`translate(${M}, ${headerHeight + visibleFacets.length * H + 15})`} fill="#475569">
      {colorItems.map((item, i) => <g key={i} transform={`translate(0,${i * lineHeight})`}><rect y={-10} width={12} height={12} fill={item.color} /><text x={20}>{item.label.length > 80 ? item.label.slice(0, 77) + '…' : item.label}</text></g>)}
      {tierList.map((tier, i) => <g key={tier} transform={`translate(0,${(colorItems.length + i) * lineHeight})`}><rect y={-10} width={12} height={12} fill={tiers[tier].color} /><text x={20}>Evidence tier: {tiers[tier].label}</text></g>)}
      <text y={(colorItems.length + tierList.length) * lineHeight}>Source mapping: {record.approvalState}; this is not a confidence score.{colors.length > 16 ? ` First 16 of ${colors.length} color categories in legend.` : ''}</text>
      {footerLines.map((line, i) => <text key={i} y={legendHeight + i * lineHeight}>{line}</text>)}
    </g>
  </svg>;
  if (standalone) return svg;
  return <>{svg}
  {facets.length > 12 && <p className="field-warning">Showing 12 of {facets.length} panels. Narrow the facet filter before exporting.</p>}
  <div className="flex flex-wrap gap-2 mt-3" aria-label="Evidence legend">{[...new Set(rows.map(r => r.evidenceTier))].map(t => <span className="evidence-badge" key={t} style={{ color: tiers[t].color, borderColor: tiers[t].color }}>{tiers[t].icon} {tiers[t].label}</span>)}<span className="evidence-badge">✓ Approved source mapping</span></div></>;
}
