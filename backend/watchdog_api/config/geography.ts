import { readFileSync } from 'node:fs';
import { validateGeometryLayer } from '../../../shared/geography';
/** Available for explicit import/review; never approved or shared at startup. */
export function bundledWorldLayer() {
  const world = JSON.parse(readFileSync('config/workbench/world.json', 'utf8'));
  return validateGeometryLayer({ version: 'workbench-geometry-1', key: 'natural-earth-110m', name: 'Natural Earth · country boundaries · 1:110m',
    description: 'Existing rounded Natural Earth boundaries. Exact upstream ISO_A3 identifiers where available; NE:name identifiers retain the five undefined -99 entries without inventing country codes. One small PRK polygon collapsed during the earlier 0.001-degree rounding; retained and flagged without repair. Not municipal boundaries.',
    coordinateReferenceSystem: 'OGC:CRS84', coordinatePrecisionDegrees: world.coordinatePrecisionDegrees,
    collapsedPartPolicy: 'retain_and_flag',
    source: { url: world.sourceUrl, title: 'Natural Earth 1:110m admin-0 countries', publisher: 'Natural Earth', license: world.license,
      retrievedAt: world.retrievedAt, sourceRecordId: 'ne_110m_admin_0_countries', upstreamSha256: world.sourceSha256 },
    features: world.features.map((f: any) => ({ ...f, id: /^[A-Z]{3}$/.test(f.id) ? f.id : `NE:${f.name}` })),
  });
}
