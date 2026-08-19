import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';

/**
 * E1.22 — Method review page.
 *
 * A proposed spec renders step by step in red with its per-step rationale;
 * approving turns it green. The colour convention is from D7 and
 * `04_METHOD_COMPILER_AND_APPROVAL.md`, and it is deliberate: a reader must be
 * able to tell a machine proposal from a human-reviewed one at a glance.
 *
 * Colour is never the only signal — each state also carries an icon and a text
 * label, per `10_EVIDENCE_TIER_AND_TRUST_UI.md`'s accessibility rule.
 */

interface SpecStep {
  id: string;
  primitive: string;
  params: Record<string, unknown>;
  inputs: Record<string, string>;
  missing_policy: string;
  rationale: string | null;
  ambiguous: boolean;
}

interface SpecView {
  id: string;
  spec_hash: string;
  approval_state: 'PROPOSED' | 'APPROVED';
  issues: { path: string; rule: string; message: string }[];
  steps: SpecStep[];
}

export function MethodReview() {
  const [view, setView] = useState<SpecView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetch('/api/method-specs/jh2016-faithful')
      .then(r => r.json())
      .then(setView)
      .catch(e => setError(String(e)));

  useEffect(() => { load(); }, []);

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/method-specs/${view!.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // A named human actor is required; there is no bulk approve.
        body: JSON.stringify({ approved_by: 'local-user' }),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? 'approval failed');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!view) return <div className="p-8" data-testid="method-loading">Loading…</div>;

  const approved = view.approval_state === 'APPROVED';

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6" data-testid="method-review-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Method review</h1>
          <p className="text-slate-500 mt-1 text-sm font-mono">{view.spec_hash.slice(0, 16)}…</p>
        </div>

        <span
          data-testid="approval-state"
          data-state={view.approval_state}
          className={[
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border',
            approved
              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
              : 'bg-red-50 text-red-800 border-red-300',
          ].join(' ')}
        >
          {approved ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {approved ? 'APPROVED' : 'PROPOSED — awaiting review'}
        </span>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm" data-testid="method-error">
          {error}
        </div>
      )}

      {view.issues.length > 0 && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm" data-testid="spec-issues">
          {view.issues.map((i, n) => <div key={n}><code>{i.path}</code>: {i.message} [{i.rule}]</div>)}
        </div>
      )}

      <div className="space-y-3" data-testid="spec-steps">
        {view.steps.map((step, index) => (
          <div
            key={step.id}
            data-testid={`step-${step.id}`}
            data-state={view.approval_state}
            className={[
              'p-4 rounded-xl border-2',
              approved ? 'bg-emerald-50/40 border-emerald-300' : 'bg-red-50/40 border-red-300',
            ].join(' ')}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">step {index + 1}</span>
              <code className="font-semibold text-slate-900">{step.id}</code>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
                {step.primitive}
              </span>
              <span className="text-xs text-slate-500">missing: {step.missing_policy}</span>
              {step.ambiguous && (
                <span className="text-xs px-2 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-900">
                  ambiguous — blocks approval
                </span>
              )}
            </div>
            {step.rationale && (
              <p className="text-sm text-slate-600 mt-2 italic">{step.rationale}</p>
            )}
          </div>
        ))}
      </div>

      <button
        data-testid="approve-spec"
        onClick={approve}
        disabled={busy || approved}
        className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
      >
        {approved ? 'Approved' : busy ? 'Approving…' : 'Approve this method'}
      </button>
    </div>
  );
}
