import type {JsonPresence,SourceComparison} from '../../shared/source_history';
import {buttonClass} from '../lib/automation_client';
import text from '../../config/ui/source-comparison.json';
import {useUiText} from '../lib/ui_text';

const pinnedPl = text.languages.pl as Record<string,string>;
const snake = (name: string) => name.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);

/** The same pinned comparison and export surface serves history and watched-source reading. */
export function SourceComparisonView({comparison}:{comparison:SourceComparison}){
  const {t,tCode}=useUiText(text);
  const profile=comparison.body.profile;
  // The comparison pins its own (Polish) profile labels; a translation replaces one only while it was written for exactly that text.
  const pinned = (key: string, stored: string) => pinnedPl[key] === stored ? tCode('', key) : stored;
  const label = (name: keyof typeof profile.labels) => pinned(`label_${snake(name)}`, profile.labels[name]);
  const change = (kind: keyof typeof profile.changes) => pinned(`change_${kind}`, profile.changes[kind]);
  const preview = (presence: JsonPresence) => {
    if (!presence.present) return label('absent');
    const text = JSON.stringify(presence.value,null,2), cap = profile!.limits.previewCharacters;
    return text.length > cap ? text.slice(0,cap) + '…' : text;
  };
  function download() {
    if (!comparison) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(comparison,null,2)+'\n'],{type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = `watchdog-source-comparison-${comparison.contentHash.slice(0,12)}.json`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  const limit = comparison.body.difference.limitReached;
  return <div className="rounded border border-slate-300 p-3 space-y-3 min-w-0" data-testid="source-comparison">
        <p className="font-semibold">{comparison.body.equal ? label('equal') : label('different')}</p>
        <p className="text-xs">{label('arrayMeaning')}</p>
        {comparison.body.difference.truncated && <p role="status" className="bg-amber-50 text-amber-950 p-2">{label('truncated')} ({limit === null ? limit : tCode('limit_', limit)})</p>}
        <div className="flex flex-wrap gap-3 items-center"><button className={buttonClass} onClick={download}>{label('export')}</button><code className="text-xs break-all">{t('hash',{hash:comparison.contentHash})}</code></div>
        <div className="space-y-3">{comparison.body.difference.changes.map(c => <article className="border-t pt-2" key={c.path}>
          <p className="text-sm break-all"><b>{change(c.kind)}</b> · <code>{c.path === '' ? '""' : c.path}</code></p>
          <dl className="grid sm:grid-cols-2 gap-2 text-xs">{(['before','after'] as const).map(side => <div className="min-w-0" key={side}><dt className="font-semibold">{label(side)}</dt>
            <dd className="bg-slate-50 p-2"><pre className="whitespace-pre-wrap break-all">{preview(c[side])}</pre></dd></div>)}</dl>
        </article>)}</div>
        <details><summary className="text-sm">{label('details')}</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{JSON.stringify({
          algorithm:comparison.body.difference.algorithm,contextHash:comparison.body.contextHash,profile:comparison.body.profile.contentHash,
          from:{...comparison.body.from,value:undefined},to:{...comparison.body.to,value:undefined},limits:profile.limits,visitedNodes:comparison.body.difference.visitedNodes,
        },null,2)}</pre></details>
      </div>;
}
