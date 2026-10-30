import {useEffect,useRef,useState} from 'react';
import type {SourceWatchProfile} from '../../shared/source_watch';
import {automationApi as api,buttonClass} from '../lib/automation_client';
import text from '../../config/ui/source-watch.json';
import {useUiText} from '../lib/ui_text';
import {configText} from '../lib/config_text';

export function SourceWatchButton({substanceId,anchor,contextHash,disabled,onSubscribed}:{substanceId:string;anchor:number;contextHash:string;disabled:boolean;onSubscribed?:(id:string)=>void}){
  const [profile,setProfile]=useState<SourceWatchProfile|null>(null),[busy,setBusy]=useState(false),[subscribed,setSubscribed]=useState(false),[error,setError]=useState<unknown>(null);
  const {lang,errorText}=useUiText(text);
  /** Watch-profile labels are hashed server configuration; only their display is translated. */
  const L=(key:'subscribe'|'subscribed'|'openInbox')=>profile?configText(text,lang,'pl',key==='openInbox'?'label_open_inbox':`label_${key}`,profile.labels[key]):'';
  const generation=useRef(0);
  useEffect(()=>{const token=++generation.current;
    api('/api/memory/watches/profile').then(p=>{if(token===generation.current)setProfile(p.profile);}).catch(e=>{if(token===generation.current)setError(e);});
    return ()=>{generation.current++;};
  },[substanceId,contextHash]);
  const subscribe=async()=>{const token=++generation.current;setBusy(true);setError(null);
    try{const result=await api('/api/memory/watches',{substanceId,anchor,contextHash});if(token===generation.current){setSubscribed(true);onSubscribed?.(result.watch.id);}}
    catch(e){if(token===generation.current)setError(e);}
    finally{if(token===generation.current)setBusy(false);}
  };
  return <div className="space-y-2">
    {profile&&<><button className={buttonClass} disabled={disabled||busy} onClick={subscribe}>{L('subscribe')}</button>
      {subscribed&&<p role="status">{L('subscribed')} <a className="underline" href="#source-watch-inbox">{L('openInbox')}</a></p>}</>}
    {error!==null&&<p role="alert" className="text-red-800 break-words">{errorText(error)}</p>}
  </div>;
}
