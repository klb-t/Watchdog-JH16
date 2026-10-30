import { useEffect, useState } from 'react';
import { fetchAnalyzers, submitRun } from '../lib/api';
import { Analyzer } from '../types';
import { Activity, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import text from '../../config/ui/analyzers.json';
import { useUiText } from '../lib/ui_text';

export function Analyzers() {
  const [analyzers, setAnalyzers] = useState<Analyzer[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { t } = useUiText(text);

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
      alert(t('run_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-slate-500 mt-1 text-sm">{t('intro')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {analyzers.map(a => (
          <div key={`${a.preset_id}-${a.analyzer_id}`} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between min-w-0">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="p-2.5 rounded-lg bg-indigo-50 text-indigo-600">
                  <Activity className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-900 break-words">{a.analyzer_id}</h3>
                  <p className="text-sm text-slate-500 break-words">{t('preset', { preset: a.preset_id || t('preset_default') })}</p>
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
                <span>{t('run')}</span>
              </button>
            </div>
          </div>
        ))}
        {analyzers.length === 0 && (
          <div className="col-span-full p-12 text-center bg-white rounded-xl border border-dashed border-slate-300">
            <p className="text-slate-500">{t('empty')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
