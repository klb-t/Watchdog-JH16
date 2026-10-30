import { useEffect, useState } from 'react';
import { fetchSources } from '../lib/api';
import { Source } from '../types';
import { Database, Play } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAccess } from '../lib/access';
import { responseError } from '../lib/api_error';
import { useUiText } from '../lib/ui_text';
import text from '../../config/ui/sources.json';

export function Sources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const access = useAccess();
  const { t, errorText } = useUiText(text);
  // A coded error is shown in the reader's language; an uncoded one as sent; anything else gets the page's own sentence.
  const [error, setError] = useState<{ e: unknown; fallback: 'error_fetch_sources' | 'error_recompute' } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setSources([]); setLoading(true); setError(null);
    fetchSources().then(value => { if (active) setSources(value); })
      .catch(e => { if (active) setError({ e, fallback: 'error_fetch_sources' }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [access.principalId]);

  // Every action here does what it says: the paper's counts go through the locked
  // JH16 study; a live source is started from the settings wizard, which carries
  // the method review, the request limit and the personal key.
  const handleAcquire = async (source: Source) => {
    if (!access.capabilities.includes('run.create')) return;
    if (source.source_id !== 'fixture_jh2016') { navigate('/setup'); return; }
    try {
      setSubmitting(true); setError(null);
      const r = await fetch('/api/studies/jh2016', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_id: 'fixture_jh2016' }) });
      const d = await r.json().catch(() => null); if (!r.ok) throw responseError(r, d);
      navigate(`/runs/${d.run_id}/results`);
    } catch (e) {
      setError({ e, fallback: 'error_recompute' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-slate-500 mt-1 text-sm">{t('intro')}</p>
        {access.capabilities.includes('provider.view') && <Link to="/source-access" className="inline-block mt-2 text-sm text-indigo-700 underline">{t('access_catalog_link')}</Link>}
      </div>

      {error && <p role="alert" className="p-4 border border-red-200 rounded-lg text-red-800">{error.e instanceof Error ? errorText(error.e) : t(error.fallback)}</p>}
      {loading && <p role="status">{t('loading')}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sources.map(source => <SourceCard key={source.source_id} source={source} canAcquire={access.capabilities.includes('run.create')}
          submitting={submitting} onAcquire={() => void handleAcquire(source)} />)}
        {!loading && !error && sources.length === 0 && (
          <div className="col-span-full p-12 text-center bg-white rounded-xl border border-dashed border-slate-300">
            <p className="text-slate-500">{t('empty')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function isSourceRunnable(source: Pick<Source, 'status'>): boolean {
  return source.status === 'implemented' || source.status === 'fixture';
}

export function SourceCard({ source, canAcquire, submitting, onAcquire }: {
  source: Source & { remediation?: string }; canAcquire: boolean; submitting: boolean; onAcquire: () => void;
}) {
  const { t } = useUiText(text);
  return <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between" data-source-status={source.status}>
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-lg bg-indigo-50 text-indigo-600">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">{source.source_id}</h3>
                  <p className="text-sm text-slate-500">{t('adapter', { adapter: source.adapter })}</p>
                </div>
              </div>
            </div>
            <p className="mt-3 text-sm font-medium">{source.status}</p>
            <p className="mt-2 text-sm text-slate-600">{source.description}</p>
            {source.remediation && <p className="mt-2 text-sm text-amber-800">{source.remediation}</p>}
            
            {canAcquire && <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end">
              {source.source_id === 'fixture_jh2016' ? <button onClick={onAcquire} disabled={submitting}
                className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50">
                <Play className="w-4 h-4" /><span>{t('action_recompute_jh16')}</span></button>
              : ['serp_result_count', 'trends_interest_index'].includes(source.source_id) ? <Link to="/setup" className="px-4 py-2 rounded-lg text-sm font-medium border border-indigo-300 text-indigo-800" data-testid={`source-wizard-${source.source_id}`}>{t('action_wizard')}</Link>
              : source.source_id === 'trends_interest_by_region' ? <Link to="/replications" className="px-4 py-2 rounded-lg text-sm font-medium border border-indigo-300 text-indigo-800" data-testid={`source-replications-${source.source_id}`}>{t('action_replications')}</Link>
              : <span className="text-sm text-slate-500" data-testid={`source-unavailable-${source.source_id}`}>{t('unavailable', { reason: source.status === 'planned' ? t('unavailable_planned') : source.status })}</span>}
            </div>}
          </div>;
}
