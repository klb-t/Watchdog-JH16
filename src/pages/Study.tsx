import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Database, AlertTriangle } from 'lucide-react';
import { fetchSources } from '../lib/api';
import { Source } from '../types';

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
const JH16_SOURCES: Record<string, string> = {
  fixture_jh2016: 'Liczby z Tabel 1 i 3 publikacji (2014) — kontrola obliczeń, nie nowy pomiar.',
  serp_result_count: 'Nowe liczby wyników Google przez klucz SerpApi tej instalacji. Osobisty klucz: Ustawienia → kreator.',
};
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
        const firstRunnable = s.find(x => (x.status === 'implemented' || x.status === 'fixture') && x.source_id in JH16_SOURCES);
        if (firstRunnable) setSelected(firstRunnable.source_id);
      })
      .catch(e => setError(String(e)));
  }, []);

  const runnable = (s: Source) => (s.status === 'implemented' || s.status === 'fixture') && s.source_id in JH16_SOURCES;

  const start = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/studies/jh2016', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_id: selected }) });
      const res = await response.json();
      if (!response.ok) throw new Error(res.message ?? res.error ?? `HTTP ${response.status}`);
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
        <p className="text-slate-500 mt-1 text-sm">JH16 (zablokowany preset: 16 substancji, 32 zapytania). Wybierz, skąd pochodzą liczby wyników.</p>
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
                      <AlertTriangle className="w-3 h-3" /> {s.source_id in JH16_SOURCES ? 'not available' : 'not a JH16 source'}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 mt-1">{s.description}</p>
                {s.source_id in JH16_SOURCES && <p className="text-xs text-slate-700 mt-1">{JH16_SOURCES[s.source_id]}</p>}
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
        {submitting ? 'Starting…' : selected === 'serp_result_count' ? 'Start JH16 (32 nowe zapytania SerpApi)' : 'Start JH16 run'}
      </button>
    </div>
  );
}
