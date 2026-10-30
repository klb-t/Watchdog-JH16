import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import profile from '../../config/goal-navigation.json';
import { type Capability } from '../../shared/authorization';
import {GoalNavigationSchema} from '../../shared/goal_navigation';
import { useAccess } from '../lib/access';
import { automationApi } from '../lib/automation_client';
import { useUiText } from '../lib/ui_text';
import text from '../../config/ui/goal-navigator.json';
const goals = GoalNavigationSchema.parse(profile);
type Goal = (typeof goals.goals)[number];
const normalize = (s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/ł/g,'l').toLocaleLowerCase('pl');
export function GoalNavigator() {
  const access=useAccess(),[search,setSearch]=useState(''),[favorites,setFavorites]=useState<string[]|null>(null),[error,setError]=useState<unknown>(null),{t,errorText}=useUiText(text);
  // Favourites live in the person's settings; until they load (or if they cannot), the stars stay disabled rather than pretending.
  useEffect(()=>{ let active=true; if (!access.principalId) return;
    automationApi('/api/settings').then(d=>{ if (active) setFavorites(d.settings.value.favoriteGoals ?? []); }).catch(e=>active&&setError(e));
    return ()=>{ active=false; }; },[access.principalId]);
  const toggle=async(id:string)=>{ if (!favorites) return; setError(null);
    try { const d=await automationApi('/api/settings/favorite-goals',{goalId:id,favorite:!favorites.includes(id)}); setFavorites(d.settings.value.favoriteGoals ?? []);
      window.dispatchEvent(new Event('watchdog-settings-changed')); } catch(e) { setError(e); } };
  const available=goals.goals.filter(g=>g.capability.split('|').some(c=>access.capabilities.includes(c as Capability)));
  const query=normalize(search).split(/\s+/).filter(Boolean), visible=available.filter(g=>query.every(q=>normalize(`${g.label} ${g.description} ${g.contexts.join(' ')}`).includes(q)));
  const pinned=(favorites??[]).map(id=>visible.find(g=>g.id===id)).filter((g):g is Goal=>!!g), rest=visible.filter(g=>!pinned.includes(g));
  const card=(g:Goal)=>{ const on=!!favorites?.includes(g.id);
    return <div key={g.id} className="relative border bg-white rounded-xl hover:border-indigo-500" data-testid={`goal-${g.id}`}>
      <Link to={g.href} className="block p-4 pr-12 focus:outline-indigo-600"><h2 className="font-semibold">{g.label}</h2><p className="text-sm text-slate-600 mt-2">{g.description}</p></Link>
      <button type="button" className="absolute top-2 right-2 p-2 rounded text-slate-400 hover:text-amber-500 disabled:opacity-40" disabled={!favorites} aria-pressed={on}
        aria-label={on?t('favorite_remove',{goal:g.label}):t('favorite_add',{goal:g.label})} onClick={()=>void toggle(g.id)} data-testid={`favorite-${g.id}`}>
        <Star className={`w-5 h-5 ${on?'fill-amber-400 text-amber-500':''}`} /></button></div>; };
  return <section className="space-y-4" data-testid="goal-navigator"><div><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="text-sm text-slate-600 mt-1">{t('intro')}</p></div>
    <label className="block text-sm">{t('search_label')}<input className="mt-1 p-3 border rounded w-full" value={search} onChange={e=>setSearch(e.target.value)} placeholder={t('search_placeholder')}/></label>
    {error!==null && <p className="text-sm text-red-700" role="alert">{t('favorites_unavailable',{error:errorText(error)})}</p>}
    {pinned.length>0 && <div data-testid="goal-favorites"><h2 className="text-sm font-semibold text-slate-700 mb-2">{t('favorites')}</h2><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{pinned.map(card)}</div></div>}
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{rest.map(card)}</div>
    {!visible.length && <p className="text-sm">{(([before,after])=><>{before}<Link className="underline" to="/setup">{t('no_match_link')}</Link>{after}</>)(t('no_match').split('{link}'))}</p>}
  </section>;
}
