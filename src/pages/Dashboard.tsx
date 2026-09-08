import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchRuns, fetchSources } from '../lib/api';
import { Run, Source } from '../types';
import { Activity, Database, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { cn } from '../lib/utils';

export function Dashboard() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchRuns(), fetchSources()])
      .then(([r, s]) => {
        setRuns(r);
        setSources(s);
        setLoading(false);
      })
      .catch(console.error);
  }, []);

  const completedRuns = runs.filter(r => r.status === 'COMPLETED').length;
  const failedRuns = runs.filter(r => r.status === 'FAILED').length;
  const activeRuns = runs.filter(r => ['QUEUED', 'RUNNING', 'NORMALIZING', 'ANALYZING'].includes(r.status)).length;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-slate-500 mt-1 text-sm">System status and recent activity</p>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-32 bg-white rounded-xl border border-slate-200"></div>)}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard title="Active Sources" value={sources.length} icon={Database} />
            <StatCard title="Active Runs" value={activeRuns} icon={Activity} />
            <StatCard title="Completed" value={completedRuns} icon={CheckCircle2} className="text-emerald-600" />
            <StatCard title="Failed" value={failedRuns} icon={XCircle} className="text-red-600" />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-sm font-semibold">Recent Runs</h2>
              <Link to="/runs" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">View all</Link>
            </div>
            <div className="divide-y divide-slate-100">
              {runs.slice(0, 5).map(run => (
                <div key={run.id} className="p-4 px-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-center space-x-4">
                    <StatusIcon status={run.status} />
                    <div>
                      <Link to={`/runs/${run.id}`} className="text-sm font-medium hover:underline">
                        {run.id.split('-')[0]}...{run.id.split('-').pop()}
                      </Link>
                      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                        <span className="font-medium">{run.run_type}</span>
                        <span>•</span>
                        <span>{new Date(run.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <StatusBadge status={run.status} />
                  </div>
                </div>
              ))}
              {runs.length === 0 && (
                <div className="p-8 text-center text-slate-500 text-sm">No runs recorded yet.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ title, value, icon: Icon, className }: any) {
  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-center space-x-4">
      <div className={cn("p-3 rounded-lg bg-slate-50", className)}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    COMPLETED: "bg-emerald-100 text-emerald-800 border-emerald-200",
    FAILED: "bg-red-100 text-red-800 border-red-200",
    QUEUED: "bg-slate-100 text-slate-800 border-slate-200",
    RUNNING: "bg-blue-100 text-blue-800 border-blue-200",
    NORMALIZING: "bg-indigo-100 text-indigo-800 border-indigo-200",
    ANALYZING: "bg-purple-100 text-purple-800 border-purple-200",
  };

  return (
    <span className={cn("px-2.5 py-1 text-xs font-medium rounded-full border", styles[status] || styles.QUEUED)}>
      {status}
    </span>
  );
}

export function StatusIcon({ status }: { status: string }) {
  if (status === 'COMPLETED') return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
  if (status === 'FAILED') return <XCircle className="w-5 h-5 text-red-500" />;
  if (status === 'QUEUED') return <Clock className="w-5 h-5 text-slate-400" />;
  return <Activity className="w-5 h-5 text-blue-500 animate-pulse" />;
}
