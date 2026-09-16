import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Database, AlertTriangle } from 'lucide-react';
import { fetchSources, submitRun } from '../lib/api';
import { Source } from '../types';

/**
 * E1.21 — Study page: source selection, run trigger, run status with a live
 * trace link.
 *
 * A source that is not `implemented` or `fixture` is rendered as unavailable
 * and cannot be selected. `05_PROVIDERS_AND_CAPABILITIES.md` requires that the
 * UI never present a plan as a capability.
 */
export function Study() {
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchSources()
      .then(s => {
        setSources(s);
        const firstRunnable = s.find(x => x.status === 'implemented' || x.status === 'fixture');
        if (firstRunnable) setSelected(firstRunnable.source_id);
      })
      .catch(e => setError(String(e)));
  }, []);

  const runnable = (s: Source) => s.status === 'implemented' || s.status === 'fixture';

  const start = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await submitRun({
        type: 'PIPELINE',
        config: {
          source_id: selected,
          source_params: { fixture_set: 'faithful_2014-06-20', fixture_name: 'study' },
          method_id: 'jh16_faithful',
          // Part of the query plan's identity (D15); never defaulted server-side.
          language: 'en',
          query_expansion_mode: 'STRICT_CANONICAL',
          entities: ['alcohol', 'cannabis', 'heroin'],
          query_templates: {
            popularity: '"{entity}"',
            harm: '"{entity}" "harm" OR "harmful"',
          },
          method_params: { reference_scores: { alcohol: 72, cannabis: 20, heroin: 55 } },
        },
      });
      navigate(`/runs/${res.run_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6" data-testid="study-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Study</h1>
        <p className="text-slate-500 mt-1 text-sm">Choose a source and start a fixture run.</p>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm" data-testid="study-error">
          {error}
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
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-slate-400" />
                  <span className="font-medium text-slate-900">{s.source_id}</span>
                  <span
                    data-testid={`status-${s.source_id}`}
                    className={[
                      'px-2 py-0.5 rounded-full text-xs border',
                      available
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border-slate-300',
                    ].join(' ')}
                  >
                    {s.status}
                  </span>
                  {!available && (
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <AlertTriangle className="w-3 h-3" /> not available
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 mt-1">{s.description}</p>
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
        {submitting ? 'Starting…' : 'Start fixture run'}
      </button>
    </div>
  );
}
