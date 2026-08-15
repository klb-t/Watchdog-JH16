import { useEffect, useState } from 'react';
import { fetchAnalyzers, submitRun } from '../lib/api';
import { Analyzer } from '../types';
import { Activity, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function Analyzers() {
  const [analyzers, setAnalyzers] = useState<Analyzer[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAnalyzers().then(setAnalyzers).catch(console.error);
  }, []);

  const handleRun = async (analyzerId: string) => {
    try {
      setSubmitting(true);
      const res = await submitRun({
        type: 'ANALYSIS',
        config: { method_id: analyzerId }
      });
      navigate(`/runs/${res.run_id}`);
    } catch (e) {
      console.error(e);
      alert('Failed to start analysis run');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analyzers</h1>
        <p className="text-slate-500 mt-1 text-sm">Available analytical models and presets</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {analyzers.map(a => (
          <div key={`${a.preset_id}-${a.analyzer_id}`} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-lg bg-indigo-50 text-indigo-600">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">{a.analyzer_id}</h3>
                  <p className="text-sm text-slate-500">Preset: {a.preset_id || 'Default'}</p>
                </div>
              </div>
            </div>
            
            <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => handleRun(a.analyzer_id)}
                disabled={submitting}
                className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                <Play className="w-4 h-4" />
                <span>Run Analysis</span>
              </button>
            </div>
          </div>
        ))}
        {analyzers.length === 0 && (
          <div className="col-span-full p-12 text-center bg-white rounded-xl border border-dashed border-slate-300">
            <p className="text-slate-500">No analyzers available.</p>
          </div>
        )}
      </div>
    </div>
  );
}
