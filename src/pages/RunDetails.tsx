import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchRun, fetchRunResults, fetchRunManifest, fetchRunEvents } from '../lib/api';
import { Run, Manifest, FetchEvent } from '../types';
import { StatusBadge } from './Dashboard';
import { FileJson, Database, RefreshCw, AlertTriangle, FileText, Download } from 'lucide-react';
import { cn } from '../lib/utils';

export function RunDetails() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [results, setResults] = useState<any>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [events, setEvents] = useState<FetchEvent[]>([]);
  const [activeTab, setActiveTab] = useState<'overview'|'data'|'artifacts'>('overview');

  const load = () => {
    if (!id) return;
    fetchRun(id).then(setRun).catch(console.error);
    fetchRunResults(id).then(setResults).catch(console.error);
    fetchRunManifest(id).then(setManifest).catch(console.error);
    fetchRunEvents(id).then(setEvents).catch(console.error);
  };

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (run && !['SUCCESS', 'FAILED'].includes(run.status)) {
        load();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [id, run?.status]);

  if (!run) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center space-x-2 text-sm text-slate-500 mb-6">
        <Link to="/runs" className="hover:text-slate-900">Runs</Link>
        <span>/</span>
        <span className="font-mono text-slate-900">{run.id}</span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-200 flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight font-mono">{run.id}</h1>
            <div className="flex items-center space-x-4 mt-2">
              <span className="text-sm font-medium text-slate-600">{run.type}</span>
              <span className="text-slate-300">•</span>
              <span className="text-sm text-slate-500">{new Date(run.created_at).toLocaleString()}</span>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <StatusBadge status={run.status} />
            <button onClick={load} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">
              <RefreshCw className={cn("w-5 h-5", !['SUCCESS','FAILED'].includes(run.status) && "animate-spin")} />
            </button>
          </div>
        </div>

        <div className="flex border-b border-slate-200 bg-slate-50/50">
          <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} icon={FileText} label="Overview" />
          <TabButton active={activeTab === 'data'} onClick={() => setActiveTab('data')} icon={Database} label="Data & Results" />
          <TabButton active={activeTab === 'artifacts'} onClick={() => setActiveTab('artifacts')} icon={FileJson} label="Provenance" />
        </div>

        <div className="p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {run.error_code && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start space-x-3 text-red-800">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-sm">Execution Failed: {run.error_code}</h4>
                    {run.error_details && <p className="text-sm mt-1 opacity-90 font-mono">{run.error_details}</p>}
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold text-slate-900 mb-3">Effective Configuration</h3>
                <div className="bg-slate-900 text-slate-50 p-4 rounded-lg overflow-auto font-mono text-sm">
                  <pre>{JSON.stringify(run.effective_config, null, 2)}</pre>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'data' && (
            <div className="space-y-8">
              {results?.analysis_results && results.analysis_results.length > 0 && (
                 <div>
                   <h3 className="text-sm font-semibold text-slate-900 mb-4">Analysis Results</h3>
                   <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                     <table className="min-w-full divide-y divide-slate-200 text-sm">
                       <thead className="bg-slate-50">
                         <tr>
                           <th className="px-4 py-3 text-left font-medium text-slate-500">Analyzer</th>
                           <th className="px-4 py-3 text-left font-medium text-slate-500">Entity</th>
                           <th className="px-4 py-3 text-left font-medium text-slate-500">Metric</th>
                           <th className="px-4 py-3 text-left font-medium text-slate-500">Value</th>
                         </tr>
                       </thead>
                       <tbody className="divide-y divide-slate-200">
                         {results.analysis_results.map((r: any) => (
                           <tr key={r.id}>
                             <td className="px-4 py-3 font-medium">{r.analyzer_id}</td>
                             <td className="px-4 py-3">{r.entity_id}</td>
                             <td className="px-4 py-3 font-mono">{r.metric_key}</td>
                             <td className="px-4 py-3 font-mono">{r.value_numeric ?? r.value_text}</td>
                           </tr>
                         ))}
                       </tbody>
                     </table>
                   </div>
                 </div>
              )}

              {results?.observations && results.observations.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 mb-4">Observations (First 10)</h3>
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-slate-500">Source</th>
                          <th className="px-4 py-3 text-left font-medium text-slate-500">Entity</th>
                          <th className="px-4 py-3 text-left font-medium text-slate-500">Dimension</th>
                          <th className="px-4 py-3 text-left font-medium text-slate-500">Query / Context</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {results.observations.slice(0, 10).map((o: any) => (
                          <tr key={o.id}>
                            <td className="px-4 py-3">{o.source_id}</td>
                            <td className="px-4 py-3">{o.entity_id}</td>
                            <td className="px-4 py-3 text-slate-500">{o.dimension || '-'}</td>
                            <td className="px-4 py-3 truncate max-w-xs" title={o.query_text}>{o.query_text}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {!results?.analysis_results?.length && !results?.observations?.length && (
                <div className="text-center py-12 text-slate-500">No data generated yet.</div>
              )}
            </div>
          )}

          {activeTab === 'artifacts' && (
            <div className="space-y-8">
              {manifest && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 mb-3">WORM Manifest</h3>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 font-mono text-sm space-y-2">
                    <div className="flex text-emerald-800"><span className="w-24 text-emerald-600/70">Status</span> Validated (Immutable)</div>
                    <div className="flex text-emerald-800"><span className="w-24 text-emerald-600/70">SHA256</span> {manifest.sha256}</div>
                    <div className="flex text-emerald-800"><span className="w-24 text-emerald-600/70">URI</span> {manifest.object_uri}</div>
                    <div className="flex text-emerald-800"><span className="w-24 text-emerald-600/70">Finalized</span> {new Date(manifest.finalized_at).toLocaleString()}</div>
                  </div>
                </div>
              )}

              {events.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 mb-3">Fetch Events</h3>
                  <div className="space-y-3">
                    {events.map(ev => (
                      <div key={ev.id} className="bg-white border border-slate-200 rounded-lg p-4 flex justify-between items-center">
                        <div>
                          <div className="text-sm font-medium">{ev.source_id}</div>
                          <div className="text-xs text-slate-500 font-mono mt-1">{ev.id}</div>
                        </div>
                        <div className="flex items-center space-x-4">
                          <StatusBadge status={ev.status} />
                          {ev.raw_blob_id && (
                            <a href={`/api/artifacts/${ev.raw_blob_id}`} target="_blank" rel="noreferrer" className="flex items-center space-x-1 text-sm text-indigo-600 hover:text-indigo-800">
                              <Download className="w-4 h-4" />
                              <span>Raw Blob</span>
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!manifest && events.length === 0 && (
                 <div className="text-center py-12 text-slate-500">No provenance artifacts generated.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center space-x-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors",
        active ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
      )}
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
    </button>
  );
}
