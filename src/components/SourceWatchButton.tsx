import {useEffect,useRef,useState} from 'react';
import type {SourceWatchProfile} from '../../shared/source_watch';
import {automationApi as api,buttonClass} from '../lib/automation_client';

export function SourceWatchButton({substanceId,anchor,contextHash,disabled,onSubscribed}:{substanceId:string;anchor:number;contextHash:string;disabled:boolean;onSubscribed?:(id:string)=>void}){
  const [profile,setProfile]=useState<SourceWatchProfile|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const generation=useRef(0);
  useEffect(()=>{const token=++generation.current;
    api('/api/memory/watches/profile').then(p=>{if(token===generation.current)setProfile(p.profile);}).catch(e=>{if(token===generation.current)setError(e.message);});
    return ()=>{generation.current++;};
  },[substanceId,contextHash]);
  const subscribe=async()=>{const token=++generation.current;setBusy(true);setError('');
    try{const result=await api('/api/memory/watches',{substanceId,anchor,contextHash});if(token===generation.current){setMessage(profile!.labels.subscribed);onSubscribed?.(result.watch.id);}}
    catch(e){if(token===generation.current)setError((e as Error).message);}
    finally{if(token===generation.current)setBusy(false);}
  };
  return <div className="space-y-2">
    {profile&&<><button className={buttonClass} disabled={disabled||busy} onClick={subscribe}>{profile.labels.subscribe}</button>
      {message&&<p role="status">{message} <a className="underline" href="#source-watch-inbox">{profile.labels.openInbox}</a></p>}</>}
    {error&&<p role="alert" className="text-red-800">{error}</p>}
  </div>;
}
