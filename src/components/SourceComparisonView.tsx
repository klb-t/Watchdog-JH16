import type {JsonPresence,SourceComparison} from '../../shared/source_history';
import {buttonClass} from '../lib/automation_client';

/** The same pinned comparison and export surface serves history and watched-source reading. */
export function SourceComparisonView({comparison}:{comparison:SourceComparison}){
  const profile=comparison.body.profile,labels=profile.labels;
  const preview = (presence: JsonPresence) => {
    if (!presence.present) return labels.absent;
    const text = JSON.stringify(presence.value,null,2), cap = profile!.limits.previewCharacters;
    return text.length > cap ? text.slice(0,cap) + '…' : text;
  };
  function download() {
    if (!comparison) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(comparison,null,2)+'\n'],{type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = `watchdog-source-comparison-${comparison.contentHash.slice(0,12)}.json`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  return <div className="rounded border border-slate-300 p-3 space-y-3 min-w-0" data-testid="source-comparison">
        <p className="font-semibold">{comparison.body.equal ? labels.equal : labels.different}</p>
        <p className="text-xs">{labels.arrayMeaning}</p>
        {comparison.body.difference.truncated && <p role="status" className="bg-amber-50 text-amber-950 p-2">{labels.truncated} ({comparison.body.difference.limitReached})</p>}
        <div className="flex flex-wrap gap-3 items-center"><button className={buttonClass} onClick={download}>{labels.export}</button><code className="text-xs break-all">SHA-256: {comparison.contentHash}</code></div>
        <div className="space-y-3">{comparison.body.difference.changes.map(change => <article className="border-t pt-2" key={change.path}>
          <p className="text-sm break-all"><b>{profile.changes[change.kind]}</b> · <code>{change.path === '' ? '""' : change.path}</code></p>
          <dl className="grid sm:grid-cols-2 gap-2 text-xs">{(['before','after'] as const).map(side => <div className="min-w-0" key={side}><dt className="font-semibold">{labels[side]}</dt>
            <dd className="bg-slate-50 p-2"><pre className="whitespace-pre-wrap break-all">{preview(change[side])}</pre></dd></div>)}</dl>
        </article>)}</div>
        <details><summary className="text-sm">{labels.details}</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{JSON.stringify({
          algorithm:comparison.body.difference.algorithm,contextHash:comparison.body.contextHash,profile:comparison.body.profile.contentHash,
          from:{...comparison.body.from,value:undefined},to:{...comparison.body.to,value:undefined},limits:profile.limits,visitedNodes:comparison.body.difference.visitedNodes,
        },null,2)}</pre></details>
      </div>;
}
