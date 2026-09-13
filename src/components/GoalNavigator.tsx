import { useState } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import profile from '../../config/goal-navigation.json';
import { CAPABILITIES, type Capability } from '../../shared/authorization';
import { useAccess } from '../lib/access';
const goals = z.object({ version: z.literal('goal-navigation-1'), goals: z.array(z.object({ id:z.string(), label:z.string(), description:z.string(),
  href:z.string().regex(/^\/(?!\/)[a-z]+$/), capability:z.string().refine(s=>s.split('|').every(c=>CAPABILITIES.includes(c as Capability))), contexts:z.array(z.string()) }).strict()) }).strict().parse(profile);
const normalize = (s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').toLocaleLowerCase('pl');
export function GoalNavigator() {
  const access=useAccess(),[search,setSearch]=useState('');
  const available=goals.goals.filter(g=>g.capability.split('|').some(c=>access.capabilities.includes(c as Capability)));
  const query=normalize(search).split(/\s+/).filter(Boolean), visible=available.filter(g=>query.every(q=>normalize(`${g.label} ${g.description} ${g.contexts.join(' ')}`).includes(q)));
  return <section className="space-y-4" data-testid="goal-navigator"><div><h1 className="text-2xl font-semibold">Co chcesz zrobić?</h1><p className="text-sm text-slate-600 mt-1">Wybierz cel. Dostępne działania wynikają z możliwości Twojego konta.</p></div>
    <label className="block text-sm">Znajdź działanie<input className="mt-1 p-3 border rounded w-full" value={search} onChange={e=>setSearch(e.target.value)} placeholder="np. receptor, mapa, replikacja, debug"/></label>
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{visible.map(g=><Link key={g.id} to={g.href} className="border bg-white rounded-xl p-4 hover:border-indigo-500 focus:outline-indigo-600"><h2 className="font-semibold">{g.label}</h2><p className="text-sm text-slate-600 mt-2">{g.description}</p></Link>)}</div>
    {!visible.length && <p className="text-sm">Brak pasującego działania w obecnym zakresie. <Link className="underline" to="/setup">Otwórz konfigurację i asystenta propozycji rozszerzeń</Link>.</p>}
  </section>;
}
