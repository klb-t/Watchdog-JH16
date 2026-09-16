import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Download, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAccess } from '../lib/access';
import { automationApi } from '../lib/automation_client';

/**
 * E1.23 — Results page: charts, the results table, the manifest link, the
 * export button, and the narrative in its approval state.
 *
 * The rule this page exists to honour: a missing value is shown as visibly
 * missing, never as zero and never as an empty cell that reads as zero.
 */

interface ChartPoint { entityId: string; value: number | null; missing: boolean; missingReason?: string }
interface ChartSpec {
  id: string; kind: string; title: string; unit: string;
  points: ChartPoint[]; legendFlags: string[];
  missingRendering: { style: string; label: string; treatAsZero: false };
}
interface ResultRow {
  entityId?: string; metricKey: string; valueNumeric: number | null; unit?: string; isMissing: boolean;
}

export function Results() {
  const { id } = useParams<{ id: string }>();
  const [results, setResults] = useState<ResultRow[]>([]);
  const [charts, setCharts] = useState<ChartSpec[]>([]);
  const [narrative, setNarrative] = useState<any>(null);
  const [manifest, setManifest] = useState<any>(null);
  const access = useAccess(), [generationBusy, setGenerationBusy] = useState(false), [generationError, setGenerationError] = useState('');

  useEffect(() => {
    if (!id) return;
    fetch(`/api/runs/${id}/results`).then(r => r.json())
      .then(d => setResults(d.analysis_results ?? [])).catch(() => {});
    fetch(`/api/runs/${id}/charts`).then(r => r.json())
      .then(d => setCharts(d.charts ?? [])).catch(() => {});
    fetch(`/api/runs/${id}/narrative`).then(r => r.json())
      .then(d => setNarrative(d.narrative)).catch(() => {});
    fetch(`/api/runs/${id}/manifest`).then(r => r.ok ? r.json() : null)
      .then(d => setManifest(d?.manifest ?? null)).catch(() => {});
  }, [id]);

  const maxValue = (c: ChartSpec) =>
    Math.max(1, ...c.points.filter(p => !p.missing).map(p => p.value ?? 0));

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8" data-testid="results-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Results</h1>
          <p className="text-slate-500 mt-1 text-sm font-mono">{id}</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            data-testid="export-csv"
            href={`/api/runs/${id}/export?format=csv`}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50"
          >
            <Download className="w-4 h-4" /> CSV
          </a>
          <a
            data-testid="manifest-link"
            href={`/api/runs/${id}/manifest`}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50"
          >
            <FileText className="w-4 h-4" /> Manifest{manifest ? '' : ' (none)'}
          </a>
        </div>
      </div>

      {/* Charts ------------------------------------------------------------ */}
      {charts.map(chart => (
        <section key={chart.id} data-testid={`chart-${chart.id}`} className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">{chart.title}</h2>
            <div className="flex gap-1">
              {chart.legendFlags.map(f => (
                <span key={f} data-testid={`legend-flag-${f}`}
                  className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200">
                  {f}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-4 space-y-1.5">
            {chart.points.map(p => (
              <div key={p.entityId} className="flex items-center gap-3 text-sm"
                   data-testid={`point-${chart.id}-${p.entityId}`}
                   data-missing={p.missing ? 'true' : 'false'}>
                <span className="w-40 shrink-0 truncate text-slate-700">{p.entityId}</span>
                {p.missing ? (
                  // Missing is drawn, labelled, and visually distinct — not a
                  // blank that a reader could take for zero.
                  <span
                    data-testid={`missing-${chart.id}-${p.entityId}`}
                    title={p.missingReason ?? 'no data'}
                    className="flex-1 h-5 rounded border border-dashed border-slate-400 bg-[repeating-linear-gradient(45deg,#e2e8f0_0,#e2e8f0_4px,transparent_4px,transparent_8px)] flex items-center px-2"
                  >
                    <span className="text-xs text-slate-600 font-medium">{chart.missingRendering.label}</span>
                  </span>
                ) : (
                  <span className="flex-1 flex items-center gap-2">
                    <span className="h-5 rounded bg-indigo-500"
                          style={{ width: `${((p.value ?? 0) / maxValue(chart)) * 100}%` }} />
                    <span className="text-xs text-slate-600 tabular-nums">
                      {p.value?.toFixed(2)}{chart.unit}
                    </span>
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Results table ----------------------------------------------------- */}
      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm" data-testid="results-table">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Entity</th>
              <th className="px-4 py-3 text-left font-medium">Metric</th>
              <th className="px-4 py-3 text-left font-medium">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {results.map((r, i) => (
              <tr key={i} data-testid={`result-${r.entityId ?? 'global'}-${r.metricKey}`}
                  data-missing={r.isMissing ? 'true' : 'false'}>
                <td className="px-4 py-2.5">{r.entityId ?? '—'}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.metricKey}</td>
                <td className="px-4 py-2.5 font-mono">
                  {r.isMissing
                    ? <span className="text-slate-500 italic">missing — not zero</span>
                    : <>{r.valueNumeric}{r.unit ?? ''}</>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Narrative --------------------------------------------------------- */}
      {narrative && (
        <section
          data-testid="narrative"
          data-approval-state={narrative.approvalState}
          className={[
            'rounded-xl border-2 p-5',
            narrative.approvalState === 'APPROVED'
              ? 'bg-emerald-50/40 border-emerald-300'
              : 'bg-red-50/40 border-red-300',
          ].join(' ')}
        >
          <div className="flex items-center gap-2 mb-2">
            {narrative.approvalState === 'APPROVED'
              ? <CheckCircle2 className="w-4 h-4 text-emerald-700" />
              : <AlertCircle className="w-4 h-4 text-red-700" />}
            <span className="text-sm font-semibold" data-testid="narrative-state">
              {narrative.approvalState}
            </span>
            {/* Machine-written content is labelled wherever it appears. */}
            <span className="text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-700">
              machine-generated
            </span>
          </div>
          <p className="text-sm text-slate-800">{narrative.content}</p>
          {access.capabilities.includes('narrative.approve') && <button className="mt-3 text-sm underline disabled:opacity-50" disabled={generationBusy}
            onClick={async () => { setGenerationBusy(true); setGenerationError(''); try {
              const result = await automationApi(`/api/runs/${id}/narrative/automatic`, { consent: true }); setNarrative(result.narrative);
            } catch (e) { setGenerationError((e as Error).message); } finally { setGenerationBusy(false); } }}>
            {generationBusy ? 'Generowanie…' : 'Zredaguj przez mój LLM w zapisanym budżecie'}</button>}
          {generationError && <p role="alert" className="text-sm text-red-900 mt-2">{generationError}</p>}
        </section>
      )}
    </div>
  );
}
