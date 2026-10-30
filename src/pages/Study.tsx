import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Database, AlertTriangle } from 'lucide-react';
import { fetchSources } from '../lib/api';
import { Source } from '../types';
import text from '../../config/ui/study.json';
import { useUiText } from '../lib/ui_text';
import { responseError } from '../lib/api_error';

/**
 * E1.21 — Study page: source selection, run trigger, run status with a live
 * trace link.
 *
 * A source that is not `implemented` or `fixture` is rendered as unavailable
 * and cannot be selected. `05_PROVIDERS_AND_CAPABILITIES.md` requires that the
 * UI never present a plan as a capability.
 *
 * The run itself is the locked JH16 preset, assembled by the server from the
 * preset and reference files; this page only chooses where the counts come
 * from. Only sources that can measure the preset's result counts are offered.
 */
const JH16_SOURCES: Record<string, 'source_note_fixture_jh2016' | 'source_note_serp_result_count'> = {
  fixture_jh2016: 'source_note_fixture_jh2016',
  serp_result_count: 'source_note_serp_result_count',
};
export function Study() {
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const navigate = useNavigate();
  const { t, tCode, errorText } = useUiText(text);

  useEffect(() => {
    fetchSources()
      .then(s => {
        setSources(s);
        const firstRunnable = s.find(x => (x.status === 'implemented' || x.status === 'fixture') && x.source_id in JH16_SOURCES);
        if (firstRunnable) setSelected(firstRunnable.source_id);
      })
      .catch(e => setError(e));
  }, []);

  const runnable = (s: Source) => (s.status === 'implemented' || s.status === 'fixture') && s.source_id in JH16_SOURCES;

  const start = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/studies/jh2016', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_id: selected }) });
      const res = await response.json();
      if (!response.ok) throw responseError(response, res);
      navigate(`/runs/${res.run_id}`);
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6" data-testid="study-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-slate-500 mt-1 text-sm">{t('intro')}</p>
      </div>

      {error !== null && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm break-words" data-testid="study-error">
          {errorText(error)}
        </div>
      )}

      <div className="space-y-2" data-testid="source-list">
        {sources.map(s => {
          const available = runnable(s);
          return (
            <label
              key={s.source_id}
              data-testid={`source-${s.source_id}`}
              data-available={available ? 'true' : 'false'}
              className={[
                'flex items-start gap-3 p-4 rounded-xl border transition-colors',
                available
                  ? 'bg-white border-slate-200 hover:border-indigo-300 cursor-pointer'
                  : 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed',
              ].join(' ')}
            >
              <input
                type="radio"
                name="source"
                className="mt-1"
                value={s.source_id}
                checked={selected === s.source_id}
                disabled={!available}
                onChange={() => setSelected(s.source_id)}
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Database className="w-4 h-4 text-slate-400" />
                  <span className="font-medium text-slate-900 break-all">{s.source_id}</span>
                  <span
                    data-testid={`status-${s.source_id}`}
                    className={[
                      'px-2 py-0.5 rounded-full text-xs border',
                      available
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border-slate-300',
                    ].join(' ')}
                  >
                    {tCode('source_status_', s.status.replace(/[^a-z0-9]+/g, '_'))}
                  </span>
                  {!available && (
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <AlertTriangle className="w-3 h-3" /> {s.source_id in JH16_SOURCES ? t('not_available') : t('not_jh16_source')}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 mt-1">{s.description}</p>
                {s.source_id in JH16_SOURCES && <p className="text-xs text-slate-700 mt-1">{t(JH16_SOURCES[s.source_id])}</p>}
                {!available && (s as any).remediation && <p className="text-xs text-amber-800 mt-1">{(s as any).remediation}</p>}
              </div>
            </label>
          );
        })}
      </div>

      <button
        data-testid="start-run"
        onClick={start}
        disabled={submitting || !selected}
        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
      >
        <Play className="w-4 h-4" />
        {submitting ? t('starting') : selected === 'serp_result_count' ? t('start_serp') : t('start')}
      </button>
    </div>
  );
}
