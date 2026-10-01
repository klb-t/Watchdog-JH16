import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {Navigate,useNavigate} from 'react-router-dom';
import {resolveWorkspace,workspacePreferences as config,type WorkspaceLanguage} from '../../shared/workspace_preferences';
import {availableWorkspaceGroups} from '../../shared/workspace_navigation';
import {useAccess} from './access';

const defaults={preset:config.default_preset,language:config.default_language};
const Context=createContext({...defaults,profile:resolveWorkspace(defaults.preset,defaults.language),setPreset:(_v:string)=>{},setLanguage:(_v:WorkspaceLanguage)=>{}});
export const useWorkspace=()=>useContext(Context);
export function WorkspacePreferencesProvider({children}:{children:ReactNode}) {
  const [prefs,setPrefs]=useState(()=>{
    try {const v=JSON.parse(localStorage.getItem('watchdog-workspace-preferences')??'null');
      if(v&&config.presets[v.preset]&&['pl','en'].includes(v.language)) return v as typeof defaults;
    } catch { /* default is an explicit versioned setting */ }
    return defaults;
  });
  useEffect(()=>{try{localStorage.setItem('watchdog-workspace-preferences',JSON.stringify(prefs));}catch{}},[prefs]);
  return <Context.Provider value={{...prefs,profile:resolveWorkspace(prefs.preset,prefs.language),setPreset:preset=>{if(config.presets[preset])setPrefs(p=>({...p,preset}));},setLanguage:language=>setPrefs(p=>({...p,language}))}}>{children}</Context.Provider>;
}
export function WorkspaceLanding({group}:{group:string}) {
  const {profile,language}=useWorkspace(),access=useAccess();
  const target=availableWorkspaceGroups(profile,access.capabilities).find(g=>g.id===group)?.views[0];
  return target?<Navigate to={target.href} replace/>:<p className="p-6" data-testid="access-denied">{config.strings[language].unavailable}</p>;
}
export function WorkspaceControls() {
  const w=useWorkspace(),access=useAccess(),navigate=useNavigate();
  const text=config.strings[w.language];
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(0);
  const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null),returnFocus=useRef<HTMLElement|null>(null);
  const entries=availableWorkspaceGroups(w.profile,access.capabilities).flatMap(g=>g.views.map(v=>({...v,title:`${g.label} › ${v.label}`})));
  entries.push({href:'/setup',label:w.profile.labels.settings,title:w.profile.labels.settings,anyCapability:[]});
  if(access.capabilities.includes('principal.invite')) entries.push({href:'/settings/access',label:text.legacy,title:text.legacy,anyCapability:[]});
  if(access.mode==='accounts'&&access.capabilities.includes('principal.view')) entries.push({href:'/access',label:text.accounts,title:text.accounts,anyCapability:[]});
  if(access.capabilities.includes('diagnostics.view')) entries.push({href:'/diagnostics',label:w.profile.labels.diagnostics,title:w.profile.labels.diagnostics,anyCapability:[]});
  const fold=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').toLowerCase();
  const found=entries.filter(e=>fold([e.title,e.href,config.views[e.href]?.en??''].join(' ')).includes(fold(query.trim())));
  const close=()=>{dialog.current?.close();setOpen(false);returnFocus.current?.focus();};
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setOpen(v=>!v);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  useEffect(()=>{if(open){returnFocus.current=document.activeElement as HTMLElement;setQuery('');setActive(0);dialog.current?.showModal();input.current?.focus();}else if(dialog.current?.open){dialog.current.close();returnFocus.current?.focus();}},[open]);
  const go=(href:string|undefined)=>{if(href){close();navigate(href);}};
  return <div className="px-3 py-2 flex flex-wrap gap-2 text-xs">
    <label>{text.language}<select aria-label={text.language} value={w.language} onChange={e=>w.setLanguage(e.target.value as WorkspaceLanguage)} className="block border rounded p-1"><option value="pl">Polski</option><option value="en">English</option></select></label>
    <label className="min-w-0">{text.preset}<select data-testid="workspace-preset" aria-label={text.preset} value={w.preset} onChange={e=>w.setPreset(e.target.value)} className="block max-w-full border rounded p-1">{Object.entries(config.presets).map(([id,p])=><option key={id} value={id}>{p.label[w.language]}</option>)}</select></label>
    <button className="border rounded px-2 py-1" data-testid="open-command-palette" onClick={()=>setOpen(true)}>{text.search} <kbd>⌘/Ctrl K</kbd></button>
    {open&&<dialog ref={dialog} onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===dialog.current)close();}} className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg p-4 backdrop:bg-slate-900/40" aria-label={text.search} data-testid="command-palette">
      <input ref={input} value={query} onChange={e=>{setQuery(e.target.value);setActive(0);}} placeholder={text.placeholder} aria-label={text.search} data-testid="command-input" className="border rounded p-3 w-full" onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setActive(a=>Math.min(a+1,found.length-1));}if(e.key==='ArrowUp'){e.preventDefault();setActive(a=>Math.max(a-1,0));}if(e.key==='Enter'){e.preventDefault();go(found[active]?.href);}}}/>
      <ul role="listbox" className="max-h-[60vh] overflow-auto">{found.map((e,i)=><li key={e.href} role="option" aria-selected={i===active}><button onClick={()=>go(e.href)} onMouseEnter={()=>setActive(i)} className={`w-full text-left p-2 ${i===active?'bg-indigo-50':''}`}>{e.title}{config.views[e.href]?.advanced?` · ${text.advanced}`:''}</button></li>)}{!found.length&&<li>{text.empty}</li>}</ul>
    </dialog>}
  </div>;
}
