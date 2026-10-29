import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchRuns } from '../lib/api';
import { Run } from '../types';
import { StatusBadge, StatusIcon } from './Dashboard';
import text from '../../config/ui/runs.json';
import { useUiText } from '../lib/ui_text';

export function Runs() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const { t, c, date, errorText } = useUiText(text);

  useEffect(() => {
    fetchRuns()
      .then(r => {
        setRuns(r);
        setLoading(false);
      })
      .catch(e => { console.error(e); setError(e); setLoading(false); });
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-slate-500 mt-1 text-sm">{t('intro')}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('col_id')}</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('col_type')}</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('col_status')}</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('col_created')}</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">{t('col_action')}</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {loading ? (
               <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-500">{c('loading')}</td></tr>
            ) : error ? (
               <tr><td colSpan={5} role="alert" className="px-6 py-12 text-center text-red-700">{errorText(error)}</td></tr>
            ) : runs.length === 0 ? (
               <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-500">{t('empty')}</td></tr>
            ) : runs.map((run) => (
              <tr key={run.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center space-x-3">
                    <StatusIcon status={run.status} />
                    <Link to={`/runs/${run.id}`} className="text-sm font-medium text-indigo-600 hover:text-indigo-900 font-mono">
                      {run.id}
                    </Link>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-slate-900 font-medium">{run.run_type}</span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <StatusBadge status={run.status} />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                  {date(run.created_at)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <Link to={`/runs/${run.id}`} className="text-indigo-600 hover:text-indigo-900">
                    {t('view_details')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
