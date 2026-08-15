import { useEffect, useState } from 'react';
import { fetchSources, submitRun } from '../lib/api';
import { Source } from '../types';
import { Database, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function Sources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchSources().then(setSources).catch(console.error);
  }, []);

  const handleAcquire = async (sourceId: string) => {
    try {
      setSubmitting(true);
      const res = await submitRun({
        type: 'ACQUISITION',
        config: { source_id: sourceId }
      });
      navigate(`/runs/${res.run_id}`);
    } catch (e) {
      console.error(e);
      alert('Failed to start run');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Data Sources</h1>
        <p className="text-slate-500 mt-1 text-sm">Configured adapters and integrations</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sources.map(source => (
          <div key={source.source_id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-lg bg-indigo-50 text-indigo-600">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">{source.source_id}</h3>
                  <p className="text-sm text-slate-500">Adapter: {source.adapter}</p>
                </div>
              </div>
            </div>
            
            <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => handleAcquire(source.source_id)}
                disabled={submitting}
                className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                <Play className="w-4 h-4" />
                <span>Acquire Data</span>
              </button>
            </div>
          </div>
        ))}
        {sources.length === 0 && (
          <div className="col-span-full p-12 text-center bg-white rounded-xl border border-dashed border-slate-300">
            <p className="text-slate-500">No sources configured.</p>
          </div>
        )}
      </div>
    </div>
  );
}
